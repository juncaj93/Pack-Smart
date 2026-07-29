import { Hono } from 'hono'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import {
  generateOutfits,
  lastLook,
  listOutfits,
  setGroupStatus,
  setSlotItem,
  swapCandidates,
  syncChecklistFromOutfits,
} from '../repos/outfits'
import { getTrip } from '../repos/trips'
import { refreshWeather } from '../services/weather'

export const outfitRoutes = new Hono<AppBindings>()

/** Mounted under /api/trips/:id/outfits, behind the session guard. */

outfitRoutes.get('/', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  return c.json({ groups: await listOutfits(c.env.DB, trip.id) })
})

outfitRoutes.post('/generate', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const now = nowSeconds()

  /*
   * Fetch the forecast before planning, not after.
   *
   * Weather is a hard filter on jackets and mid-layers, so a plan built without
   * it and corrected later would visibly change its mind about what to bring —
   * exactly the behaviour risk R12 rules out. If the forecast cannot be reached
   * this returns nothing and the plan is made without it, as it always was.
   */
  const today = new Date(now * 1000).toISOString().slice(0, 10)
  const { days: weather } = await refreshWeather(c.env.DB, trip, today, now)

  const { groups, regenerated } = await generateOutfits(c.env.DB, trip, now, weather)
  return c.json({ groups, regenerated })
})

outfitRoutes.post('/:groupId/status', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const body = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string })
  if (body.status !== 'approved' && body.status !== 'draft') {
    return c.json(apiError('bad_request', 'Unknown outfit status.'), 400)
  }

  const now = nowSeconds()
  const outcome = await setGroupStatus(c.env.DB, c.req.param('groupId')!, body.status, now)

  // Approving an outfit is what puts its clothing on the checklist. Doing it
  // here rather than as a separate action is what keeps the two in step.
  const sync = await syncChecklistFromOutfits(c.env.DB, trip, now)

  return c.json({
    groups: await listOutfits(c.env.DB, trip.id),
    sync,
    // Says so plainly when an approval could not be honoured.
    refused: body.status === 'approved' && outcome.status !== 'approved',
  })
})

/**
 * The pre-packing wardrobe review. Read-only; adding is done through the normal
 * checklist endpoint, so there is one way to put something in the bag.
 */
outfitRoutes.get('/last-look', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  return c.json(await lastLook(c.env.DB, trip.id))
})

outfitRoutes.get('/:groupId/slots/:slotId/candidates', async (c) => {
  const candidates = await swapCandidates(c.env.DB, c.req.param('groupId')!, c.req.param('slotId')!)
  return c.json({
    candidates: candidates.map((candidate) => ({
      id: candidate.item.id,
      name: candidate.item.displayName,
      subcategory: candidate.item.subcategory,
      color: candidate.item.color,
      favorite: candidate.item.favorite,
      suitable: candidate.suitable,
      reason: candidate.reason,
    })),
  })
})

outfitRoutes.put('/:groupId/slots/:slotId', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const body = await c.req
    .json<{ itemId?: string | null }>()
    .catch(() => ({}) as { itemId?: string | null })

  const now = nowSeconds()
  await setSlotItem(c.env.DB, c.req.param('slotId')!, body.itemId ?? null, now)
  const sync = await syncChecklistFromOutfits(c.env.DB, trip, now)

  return c.json({ groups: await listOutfits(c.env.DB, trip.id), sync })
})
