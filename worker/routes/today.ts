import { Hono } from 'hono'
import { WEAR_ACTION_LABELS, type WearAction } from '@shared/during-trip'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import { listChecklist } from '../repos/checklist'
import {
  adjustDay,
  ensureDailyPlans,
  getDayPlan,
  listWearLog,
  logWear,
  packedAlternatives,
} from '../repos/during-trip'
import { getTrip } from '../repos/trips'
import { buildBriefing, currentDateFor } from '../services/today'
import { isValidDate, tripDateRange, type Trip } from '@shared/trips'

export const todayRoutes = new Hono<AppBindings>()

/** Mounted under /api/trips/:id/today, behind the session guard. */

/**
 * The phone's own calendar date, when it sent one.
 *
 * Validated rather than trusted: this decides which day of the trip Alex sees,
 * and a malformed value should fall through to the next-best source instead of
 * putting the screen on a date that does not exist.
 */
function deviceDateFrom(value: string | undefined): string | null {
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
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const now = nowSeconds()
  await ensureDailyPlans(c.env.DB, trip, now)

  const deviceDate = deviceDateFrom(c.req.query('today'))
  const date = resolveDate(trip, c.req.query('date'), deviceDate)
  const [plan, wearLog, entries] = await Promise.all([
    getDayPlan(c.env.DB, trip, date),
    listWearLog(c.env.DB, trip.id, date),
    listChecklist(c.env.DB, trip.id),
  ])

  const briefing = await buildBriefing(c.env.DB, {
    trip,
    date,
    plan,
    entries,
    deviceDate,
    at: new Date(),
  })

  return c.json({
    trip,
    date,
    dates: tripDateRange(trip.startDate, trip.endDate),
    plan,
    wearLog,
    actionLabels: WEAR_ACTION_LABELS,
    ...briefing,
  })
})

todayRoutes.get('/alternatives', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const date = resolveDate(trip, c.req.query('date'), deviceDateFrom(c.req.query('today')))
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
  const [plan, wearLog, entries] = await Promise.all([
    getDayPlan(db, trip, date),
    listWearLog(db, trip.id, date),
    listChecklist(db, trip.id),
  ])

  const briefing = await buildBriefing(db, {
    trip,
    date,
    plan,
    entries,
    deviceDate,
    at: new Date(),
  })

  return { date, plan, wearLog, ...briefing }
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
    .json<{
      itemId?: string
      action?: string
      date?: string
      today?: string
      replaceWith?: string | null
    }>()
    .catch(() => ({}) as Record<string, never>)

  if (!body.itemId) return c.json(apiError('bad_request', 'Which item?'), 400)
  if (!body.action || !ACTIONS.includes(body.action as WearAction)) {
    return c.json(apiError('bad_request', 'Unknown action.'), 400)
  }

  const deviceDate = deviceDateFrom(body.today)
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
    .json<{ fromItemId?: string; toItemId?: string | null; date?: string; today?: string }>()
    .catch(() => ({}) as Record<string, never>)

  if (!body.fromItemId) return c.json(apiError('bad_request', 'Which item?'), 400)

  const deviceDate = deviceDateFrom(body.today)
  const date = resolveDate(trip, body.date, deviceDate)
  await adjustDay(c.env.DB, trip.id, date, body.fromItemId, body.toItemId ?? null, nowSeconds())

  return c.json(await stateAfterWrite(c.env.DB, trip, date, deviceDate))
})
