import { Hono } from 'hono'
import { WEAR_ACTION_LABELS, type WearAction } from '@shared/during-trip'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import { listChecklist } from '../repos/checklist'
import {
  adjustDay,
  ensureDailyPlans,
  getDayPlans,
  listWearLog,
  logWear,
  dismissConflict,
  packedAlternatives,
} from '../repos/during-trip'
import { getTrip } from '../repos/trips'
import { buildBriefing, currentDateFor } from '../services/today'
import { refreshWeather, shouldRefresh } from '../services/weather'
import { weatherFetchedAt } from '../repos/weather'
import { isValidDate, tripDateRange, type Trip } from '@shared/trips'
import { stopwatch } from '../timing'

export const todayRoutes = new Hono<AppBindings>()

/** Mounted under /api/trips/:id/today, behind the session guard. */

/**
 * The phone's own calendar date, read off the request header.
 *
 * A HEADER rather than a query parameter, and that is a caching decision rather
 * than a stylistic one: `sw.js` caches `GET /api/*` by full URL, so a `?today=`
 * would mint a fresh entry every midnight and miss the previous day's — on
 * precisely the day an offline read is worth having.
 *
 * Validated rather than trusted: this decides which day of the trip Alex sees,
 * and a malformed value falls through to the next-best source instead of putting
 * the screen on a date that does not exist.
 */
const CLIENT_DATE_HEADER = 'X-Client-Date'

function deviceDateFrom(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const value = c.req.header(CLIENT_DATE_HEADER)
  return value && isValidDate(value) ? value : null
}

/**
 * Which day to show.
 *
 * An explicit `?date=` is Alex paging through the trip and always wins. Otherwise
 * this is "what day is it", which is a real question with three possible sources
 * — see `resolveTodayDate`. A trip the current day falls outside opens on its
 * first day, which is what a trip being read before it starts should show.
 */
function resolveDate(trip: Trip, requested: string | undefined, deviceDate: string | null): string {
  const dates = tripDateRange(trip.startDate, trip.endDate)
  if (requested && isValidDate(requested) && dates.includes(requested)) return requested

  const today = currentDateFor(trip, deviceDate, new Date()).date
  return dates.includes(today) ? today : (dates[0] ?? trip.startDate)
}

todayRoutes.get('/', async (c) => {
  /*
   * Named stages, because Today is the last uninstrumented path on the P1B list
   * and the audit put it second in the table at 51-73ms. The stages are the ones
   * the handler actually has rather than the ones a guess would name — in
   * particular `plans`, which is a WRITE inside a GET.
   */
  const watch = stopwatch()
  const trip = await watch.at('trip', () => getTrip(c.env.DB, c.req.param('id')!))
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const now = nowSeconds()
  // The outfit groups come back, because `getDayPlans` below wants the same
  // list and reading it twice is three round trips for rows that cannot have
  // changed in between (P1B).
  const groups = await watch.at('plans', () => ensureDailyPlans(c.env.DB, trip, now))

  const deviceDate = deviceDateFrom(c)
  const date = resolveDate(trip, c.req.query('date'), deviceDate)
  const [plans, wearLog, entries] = await watch.at('reads', () =>
    Promise.all([
      getDayPlans(c.env.DB, trip, date, groups),
      listWearLog(c.env.DB, trip.id, date),
      listChecklist(c.env.DB, trip.id),
    ]),
  )

  /*
   * The briefing is still built from the FIRST plan (G2).
   *
   * Everything it answers — the date, the city, the weather, the readiness
   * lines — is about the day rather than about one activity within it, so
   * building it twice would produce the same sentences twice. The outfits are
   * the part that differs, and they travel as `plans`.
   */
  const briefing = await watch.at('briefing', () =>
    buildBriefing(c.env.DB, {
      trip,
      date,
      plan: plans[0]!,
      entries,
      deviceDate,
      at: new Date(),
    }),
  )

  /*
   * A stale forecast is refreshed BESIDE the response, never in front of it (E2).
   *
   * Today is held to one serial round trip, and Alex opens it standing in a
   * hotel room on somebody else's wifi. Two Open-Meteo calls in front of the
   * screen would be exactly the waterfall P1 spent three slices removing — so
   * this answers with what is stored, labelled honestly as stale, and the fresh
   * forecast lands for the next open.
   *
   * Only when something IS stored and has aged out. A trip with no weather at
   * all is deliberately not a reason to reach out on every open: the trip fires
   * its own refresh when it is created or its dates change, and a destination
   * Open-Meteo cannot find would otherwise cost a network call every time Alex
   * looked at Today, for ever, to be told the same thing. The manual control is
   * the answer for that case, because a person asking is a reason and a screen
   * opening is not.
   */
  if (shouldRefresh(briefing.weatherFetchedAt, now)) {
    const work = refreshWeather(c.env.DB, trip, briefing.todayDate, now).catch(() => undefined)
    try {
      c.executionCtx.waitUntil(work)
    } catch {
      // No execution context — a direct route test. The refresh is already
      // running; there is simply nothing to keep alive.
    }
  }

  c.header('Server-Timing', watch.header())

  return c.json({
    trip,
    date,
    dates: tripDateRange(trip.startDate, trip.endDate),
    /*
     * `plan` stays, and `plans` is added beside it.
     *
     * Additive on purpose: a client that has not been updated — one loading the
     * previous JavaScript out of the service worker's cache — keeps working and
     * shows the day's first outfit, which is exactly what it showed before.
     * A response that had simply changed shape would have shown it nothing.
     */
    plan: plans[0]!,
    plans,
    wearLog,
    actionLabels: WEAR_ACTION_LABELS,
    ...briefing,
  })
})

/**
 * "Keep this outfit" — recorded, so the banner does not come straight back.
 *
 * Scoped to the forecast it was answered against, which the server reads rather
 * than trusting the client to send: a dismissal must silence THIS claim about
 * the weather and not the next one.
 */
todayRoutes.post('/dismiss', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const body = await c.req
    .json<{ kind?: string; date?: string }>()
    .catch(() => ({}) as Record<string, never>)

  if (!body.kind) return c.json(apiError('bad_request', 'Which warning?'), 400)

  const deviceDate = deviceDateFrom(c)
  const date = resolveDate(trip, body.date, deviceDate)
  const fetchedAt = await weatherFetchedAt(c.env.DB, trip.id)

  await dismissConflict(c.env.DB, trip.id, date, body.kind, fetchedAt ?? 0, nowSeconds())

  return c.json(await stateAfterWrite(c.env.DB, trip, date, deviceDate))
})

/**
 * Go and look again, because Alex asked.
 *
 * The one path that blocks on the network, and it should: he tapped a button
 * that says it is checking, so waiting is the honest response and a screen that
 * came back instantly having done nothing would be worse.
 */
todayRoutes.post('/weather', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const body = await c.req.json<{ date?: string }>().catch(() => ({}) as Record<string, never>)
  const deviceDate = deviceDateFrom(c)
  const date = resolveDate(trip, body.date, deviceDate)
  const now = nowSeconds()

  /*
   * `force` is what makes a manual refresh mean anything.
   *
   * `refreshWeather` returns early while the stored forecast is still fresh,
   * which is right for every automatic path and wrong for this one: a person who
   * taps `Check again` and is handed the same twelve-hour-old numbers has been
   * told nothing about whether anything changed.
   */
  await refreshWeather(c.env.DB, trip, currentDateFor(trip, deviceDate, new Date()).date, now, {
    force: true,
  }).catch(() => undefined)

  return c.json(await stateAfterWrite(c.env.DB, trip, date, deviceDate))
})

todayRoutes.get('/alternatives', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const date = resolveDate(trip, c.req.query('date'), deviceDateFrom(c))
  const role = c.req.query('role') ?? ''

  return c.json({ options: await packedAlternatives(c.env.DB, trip, date, role) })
})

/**
 * What every write answers with.
 *
 * The whole briefing, not just the plan. A swap can empty the unresolved
 * section, change which garment the carry list names, and move the screen's next
 * action — returning only `plan` left the sentence above it describing a state
 * that had just stopped being true, and no round trip is saved by making the
 * screen ask again.
 */
async function stateAfterWrite(
  db: D1Database,
  trip: Trip,
  date: string,
  deviceDate: string | null,
) {
  const [plans, wearLog, entries] = await Promise.all([
    getDayPlans(db, trip, date),
    listWearLog(db, trip.id, date),
    listChecklist(db, trip.id),
  ])
  const plan = plans[0]!

  const briefing = await buildBriefing(db, {
    trip,
    date,
    plan,
    entries,
    deviceDate,
    at: new Date(),
  })

  return { date, plan, plans, wearLog, ...briefing }
}

const ACTIONS: WearAction[] = ['will_wear', 'already_wore', 'not_available', 'too_warm', 'too_cold']

/**
 * The five During Trip controls, plus a swap.
 *
 * "Not available", "too warm" and "too cold" all mean the same thing mechanically
 * — this garment is out today — so they record the reason and, when a
 * replacement is offered, adjust the day. The reason is kept because it is what
 * a later version would learn from; today it is honest record-keeping.
 */
todayRoutes.post('/wear', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const body = await c.req
    .json<{ itemId?: string; action?: string; date?: string; replaceWith?: string | null }>()
    .catch(() => ({}) as Record<string, never>)

  if (!body.itemId) return c.json(apiError('bad_request', 'Which item?'), 400)
  if (!body.action || !ACTIONS.includes(body.action as WearAction)) {
    return c.json(apiError('bad_request', 'Unknown action.'), 400)
  }

  const deviceDate = deviceDateFrom(c)
  const date = resolveDate(trip, body.date, deviceDate)
  const now = nowSeconds()
  const action = body.action as WearAction

  await logWear(c.env.DB, trip.id, body.itemId, date, action, now)

  if (action !== 'will_wear' && action !== 'already_wore') {
    await adjustDay(c.env.DB, trip.id, date, body.itemId, body.replaceWith ?? null, now)
  }

  return c.json(await stateAfterWrite(c.env.DB, trip, date, deviceDate))
})

todayRoutes.post('/swap', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const body = await c.req
    .json<{ fromItemId?: string; toItemId?: string | null; date?: string }>()
    .catch(() => ({}) as Record<string, never>)

  if (!body.fromItemId) return c.json(apiError('bad_request', 'Which item?'), 400)

  const deviceDate = deviceDateFrom(c)
  const date = resolveDate(trip, body.date, deviceDate)
  await adjustDay(c.env.DB, trip.id, date, body.fromItemId, body.toItemId ?? null, nowSeconds())

  return c.json(await stateAfterWrite(c.env.DB, trip, date, deviceDate))
})
