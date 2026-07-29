import { Hono } from 'hono'
import { WEAR_ACTION_LABELS, type WearAction } from '@shared/during-trip'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import {
  adjustDay,
  ensureDailyPlans,
  getDayPlan,
  listWearLog,
  logWear,
  packedAlternatives,
} from '../repos/during-trip'
import { getTrip } from '../repos/trips'
import { isValidDate, tripDateRange } from '@shared/trips'

export const todayRoutes = new Hono<AppBindings>()

/** Mounted under /api/trips/:id/today, behind the session guard. */

function resolveDate(trip: { startDate: string; endDate: string }, requested?: string): string {
  const dates = tripDateRange(trip.startDate, trip.endDate)
  if (requested && isValidDate(requested) && dates.includes(requested)) return requested

  // Default to the real today when the trip covers it, otherwise the first day —
  // opening the app mid-trip should land on today, not on day one.
  const today = new Date().toISOString().slice(0, 10)
  return dates.includes(today) ? today : (dates[0] ?? trip.startDate)
}

todayRoutes.get('/', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const now = nowSeconds()
  await ensureDailyPlans(c.env.DB, trip, now)

  const date = resolveDate(trip, c.req.query('date'))
  const [plan, wearLog] = await Promise.all([
    getDayPlan(c.env.DB, trip, date),
    listWearLog(c.env.DB, trip.id, date),
  ])

  return c.json({
    trip,
    date,
    dates: tripDateRange(trip.startDate, trip.endDate),
    plan,
    wearLog,
    actionLabels: WEAR_ACTION_LABELS,
  })
})

todayRoutes.get('/alternatives', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const date = resolveDate(trip, c.req.query('date'))
  const role = c.req.query('role') ?? ''

  return c.json({ options: await packedAlternatives(c.env.DB, trip, date, role) })
})

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

  const date = resolveDate(trip, body.date)
  const now = nowSeconds()
  const action = body.action as WearAction

  await logWear(c.env.DB, trip.id, body.itemId, date, action, now)

  if (action !== 'will_wear' && action !== 'already_wore') {
    await adjustDay(c.env.DB, trip.id, date, body.itemId, body.replaceWith ?? null, now)
  }

  const [plan, wearLog] = await Promise.all([
    getDayPlan(c.env.DB, trip, date),
    listWearLog(c.env.DB, trip.id, date),
  ])

  return c.json({ date, plan, wearLog })
})

todayRoutes.post('/swap', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const body = await c.req
    .json<{ fromItemId?: string; toItemId?: string | null; date?: string }>()
    .catch(() => ({}) as Record<string, never>)

  if (!body.fromItemId) return c.json(apiError('bad_request', 'Which item?'), 400)

  const date = resolveDate(trip, body.date)
  await adjustDay(c.env.DB, trip.id, date, body.fromItemId, body.toItemId ?? null, nowSeconds())

  const [plan, wearLog] = await Promise.all([
    getDayPlan(c.env.DB, trip, date),
    listWearLog(c.env.DB, trip.id, date),
  ])

  return c.json({ date, plan, wearLog })
})
