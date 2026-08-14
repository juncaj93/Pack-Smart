import { Hono } from 'hono'
import { garmentDetail } from '@shared/items'
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
import { getTrip, outfitsAreStale, storedPlanSignals } from '../repos/trips'
import { planChanges, planSignals } from '@shared/replan'
import { planDelta } from '@shared/plan-delta'
import { getWeather } from '../services/weather'
import { stopwatch } from '../timing'

export const outfitRoutes = new Hono<AppBindings>()

/** Mounted under /api/trips/:id/outfits, behind the session guard. */

outfitRoutes.get('/', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  /*
   * `stale` is how the deferred replan stays a guarantee (P1B).
   *
   * Saying which days are what no longer replans inside the endpoint that
   * writes them, so something has to know the plan is behind. This does: two
   * integers on the trip row, compared. It is read here rather than pushed by
   * whoever wrote the days, so the answer is the same whether Alex arrived by
   * tapping through, by refreshing, or by opening the app again tomorrow after
   * the connection dropped halfway.
   */
  /*
   * What has moved since this plan was made (§31).
   *
   * Read here rather than only on the replan, because it is what decides
   * whether the control at the bottom of the screen says `Refresh suggestions`
   * or `Update outfits for changes` — and a button that only discovers there
   * was something to do after it has been pressed is not change-aware, it is
   * just a button with a longer receipt.
   *
   * The stored forecast, never a fresh fetch: this is a screen Alex opens
   * repeatedly and a weather call here would put a network round trip on it
   * and break it offline.
   */
  const { days: weather } = await getWeather(c.env.DB, trip.id, nowSeconds())

  return c.json({
    groups: await listOutfits(c.env.DB, trip.id),
    stale: await outfitsAreStale(c.env.DB, trip.id),
    changes: planChanges(await storedPlanSignals(c.env.DB, trip.id), planSignals(trip, weather)),
  })
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
  const watch = stopwatch()
  const { days: weather } = await watch.at('weather', () =>
    getWeather(c.env.DB, trip.id, nowSeconds()),
  )

  const changes = planChanges(
    await storedPlanSignals(c.env.DB, trip.id),
    planSignals(trip, weather),
  )

  /*
   * The plan as it stands, before anything is replanned.
   *
   * `changes` above says what moved in the INPUTS — a warmth band crossed, rain
   * becoming likely — and that is the reason to act. It cannot say what acting
   * did: colder weather that stays inside the same band changes nothing, and a
   * new activity a trip is already dressed for changes nothing either. Without
   * a before, every sentence about the result would be written from the trigger
   * and could therefore be wrong.
   */
  const before = await watch.at('before', () => listOutfits(c.env.DB, trip.id))

  const { groups, regenerated, replanned, kept, flagged } = await watch.at('replan', () =>
    generateOutfits(c.env.DB, trip, now, weather),
  )

  /*
   * Outfits only, and the emptiness is the honest part.
   *
   * A replan rewrites drafts; it does not touch the checklist, because what
   * puts clothing on the list is APPROVING an outfit. Passing empty entries and
   * gaps says that plainly rather than diffing two identical lists to reach the
   * same answer more slowly.
   */
  const deltas = planDelta(
    { entries: [], groups: before, gaps: [] },
    { entries: [], groups, gaps: [] },
  )

  c.header('Server-Timing', watch.header())

  /*
   * The two counts D1c added, arriving at last on the screen that can use them.
   *
   * `PUT /trips/:id/days` used to report them and nothing ever showed them,
   * because both of its callers navigated away the moment it answered. Now that
   * this is where the replan happens, `2 replanned, 1 left as you approved it`
   * can be said to somebody who is looking at the outfits in question.
   */
  /*
   * The changes are computed BEFORE the plan runs and returned after it.
   *
   * `generateOutfits` overwrites the snapshot as its last act, so asking
   * afterwards would compare the new plan against itself and always answer
   * "nothing changed" — the delta would be empty on exactly the run that had
   * something to report.
   */
  return c.json({
    groups,
    regenerated,
    replannedCount: replanned,
    keptApproved: kept,
    changes,
    flagged,
    /*
     * What the replan actually DID, beside what prompted it.
     *
     * Both are returned because they answer different questions and the screen
     * needs both: `changes` is why the button offered to run, `deltas` is what
     * running it produced. They can legitimately disagree — a forecast that
     * crossed a band but left every garment still the best choice reports a
     * change and an empty delta, and that pair is the truth rather than a bug.
     */
    deltas,
  })
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
    ? await getWeather(c.env.DB, trip.id, nowSeconds())
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
      // Which one of them this is (G6). The name no longer repeats the brand
      // and the colour, and this list can hold seven quarter-zips.
      detail: garmentDetail(candidate.item),
      brand: candidate.item.brand,
      suitable: candidate.suitable,
      reason: candidate.reason,
      // Whether it is the kind of garment this slot usually holds (G3). Alex
      // may pick either; this only decides where the sheet offers it.
      inSlot: candidate.inSlot,
      /*
       * The one criterion that actually separated this garment from the next
       * one down (§18), or null — which is most of the time, and deliberately.
       *
       * `rank` is already silent where a criterion had nothing to say, so a
       * row carrying a reason is a row where the reason is load-bearing. A list
       * where every option is annotated is a list where the annotations are
       * wallpaper, which is what the outfit card's own reason lines had become.
       */
      recommendation: candidate.recommendation ?? null,
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
