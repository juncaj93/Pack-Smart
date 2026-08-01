import { Hono } from 'hono'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import {
  generateOutfits,
  lastLook,
  listOutfits,
  setGroupDeferred,
  setGroupStatus,
  undoRemembered,
  setSlotItem,
  swapCandidates,
  syncChecklistFromOutfits,
} from '../repos/outfits'
import { getTrip } from '../repos/trips'
import { getWeather } from '../services/weather'

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
   * Uses the STORED forecast. Never fetches one here.
   *
   * An earlier version reached out to Open-Meteo before planning, and it cost
   * seconds: two requests, each waiting out its timeout wherever the service is
   * slow or blocked, while Alex looked at a "Planning…" button. Weather is worth
   * a lot to the plan and nothing at all to that wait — the fetch belongs where
   * it is free, which is in the background after a trip is saved.
   *
   * With no stored forecast this plans exactly as it did before weather existed.
   */
  const { days: weather } = await getWeather(c.env.DB, trip.id)

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
    /*
     * Whether this approval wrote a lasting saved-outfit relationship.
     *
     * The screen needs it to say so and offer Undo. Approving affects one trip
     * by default; a pairing outlives it, so it may not be created silently
     * (CLAUDE.md, doc 04 §5).
     */
    remembered: outcome.remembered,
  })
})

/**
 * "Decide later" — and resuming it.
 *
 * A separate endpoint rather than a fourth value on `/status`, because it is a
 * different kind of statement: `/status` says what Alex has decided about the
 * outfit, this says he has not decided yet. Collapsing them would make the
 * request that means "I am not answering" look like an answer, and the
 * synchronisation that follows an approval must not run for it — nothing about
 * the packing list changes here, which is the whole point.
 */
outfitRoutes.post('/:groupId/defer', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const body = await c.req
    .json<{ deferred?: boolean }>()
    .catch(() => ({}) as { deferred?: boolean })
  if (typeof body.deferred !== 'boolean') {
    return c.json(apiError('bad_request', 'Say whether this is being left for later.'), 400)
  }

  await setGroupDeferred(c.env.DB, c.req.param('groupId')!, body.deferred, nowSeconds())
  return c.json({ groups: await listOutfits(c.env.DB, trip.id) })
})

/**
 * Declines the saved-outfit relationship this approval created, keeping the
 * approval itself.
 *
 * Deliberately separate from un-approving: doc 04 §5 requires the lasting
 * effect be refusable on its own. Alex keeps the outfit and declines the habit.
 */
outfitRoutes.post('/:groupId/forget-pairings', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  await undoRemembered(c.env.DB, c.req.param('groupId')!)
  return c.json({ ok: true })
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
  /*
   * The trip AND the stored forecast, so the sheet filters on exactly what the
   * planner filtered on — the dressiness ceiling, and the warmth and rain of
   * this group's own days (C2b).
   *
   * The stored forecast, never a fresh fetch: this runs every time Alex opens
   * the sheet, and a network call here would put a weather request on a
   * repeated interaction and break it offline.
   */
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  const { days: weather } = trip
    ? await getWeather(c.env.DB, trip.id)
    : { days: [] as Awaited<ReturnType<typeof getWeather>>['days'] }

  const { candidates, context } = await swapCandidates(
    c.env.DB,
    c.req.param('groupId')!,
    c.req.param('slotId')!,
    trip,
    weather,
  )

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
    // What the list was filtered by, so the sheet can say so rather than
    // appearing to reject half the wardrobe for no reason.
    context,
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
