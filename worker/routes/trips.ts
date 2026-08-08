import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Trip, TripDay, TripInput } from '@shared/trips'
import { ACTIVITY_LABELS, isValidDate, toTemplate, validateTripInput } from '@shared/trips'
import { describeWeather } from '@shared/weather'
import { BAG_ORDER, type BagKey } from '@shared/checklist'
import { garmentDetail } from '@shared/items'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import {
  addTripOnlyItem,
  excludeEntry,
  generateChecklist,
  setBag,
  getEntry,
  listChecklist,
  restoreEntry,
  setFinalChecked,
  setPackedQty,
  setQtyOverride,
  setTiming,
} from '../repos/checklist'
import { tripCoverageGaps } from '../repos/coverage'
import { getItem } from '../repos/items'
import { generateOutfits, outfitConflicts, outfitsUsingItem } from '../repos/outfits'
import {
  archiveTrip,
  createTrip,
  deleteTrip,
  getTrip,
  listTrips,
  restoreTrip,
  setTripDays,
  updateTrip,
} from '../repos/trips'
import { WEATHER_STATUS_TEXT, getWeather, refreshWeather } from '../services/weather'
import { outfitRoutes } from './outfits'
import { reviewRoutes } from './review'
import { todayRoutes } from './today'

export const tripRoutes = new Hono<AppBindings>()

/** Outfit planning for one trip. Nested so it always has a trip in scope. */
tripRoutes.route('/:id/outfits', outfitRoutes)
tripRoutes.route('/:id/today', todayRoutes)
tripRoutes.route('/:id/review', reviewRoutes)

/** Everything under here is already behind the session guard mounted in index.ts. */

/**
 * Starts a weather refresh without making Alex wait for it.
 *
 * `waitUntil` keeps the Worker alive past the response, so a save returns at the
 * speed it always did while the forecast lands a moment later — by which time
 * Alex has tapped through at least one screen to reach Outfits, which is the
 * first thing that reads it. Blocking the save instead would put two network
 * round trips, and their timeouts wherever Open-Meteo is slow or blocked, in
 * front of the most common action in the app.
 *
 * Fire and forget in the strict sense: nothing downstream depends on it, and a
 * failure leaves whatever forecast was already stored untouched.
 */
function refreshWeatherInBackground(c: Context<AppBindings>, trip: Trip, now: number) {
  const today = new Date(now * 1000).toISOString().slice(0, 10)
  const work = refreshWeather(c.env.DB, trip, today, now).catch(() => undefined)

  try {
    c.executionCtx.waitUntil(work)
  } catch {
    // No execution context — a direct route test, for instance. The refresh is
    // already running; there is simply nothing to keep alive.
  }
}

tripRoutes.get('/', async (c) => {
  const trips = await listTrips(c.env.DB)
  return c.json({ trips })
})

tripRoutes.post('/', async (c) => {
  let body: Partial<TripInput>
  try {
    body = await c.req.json<Partial<TripInput>>()
  } catch {
    return c.json(apiError('bad_request', 'Expected a JSON body.'), 400)
  }

  const validation = validateTripInput(body)
  if (!validation.ok) {
    return c.json(
      { error: { code: 'bad_request', message: 'Check the highlighted fields.' }, fields: validation.errors },
      400,
    )
  }

  const now = nowSeconds()
  const trip = await createTrip(c.env.DB, normalise(body), now)

  // Generate immediately so the trip is never shown with an empty list Alex has
  // to go and ask for. Regeneration is idempotent, so this costs nothing later.
  const generation = await generateChecklist(c.env.DB, trip, now)
  refreshWeatherInBackground(c, trip, now)

  return c.json({ trip, generation }, 201)
})

tripRoutes.get('/:id', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  return trip ? c.json(trip) : c.json(apiError('bad_request', 'No such trip.'), 404)
})


/* ------------------------------------------------------------------ */
/* archive, restore, delete                                            */
/* ------------------------------------------------------------------ */

/**
 * Archiving is a PUT of a state, not a delete.
 *
 * Two endpoints rather than one toggle: a toggle makes "archive this" and
 * "restore this" the same request, which means a retry after a dropped
 * connection can undo what it just did. On hotel wifi that is not theoretical.
 */
tripRoutes.post('/:id/archive', async (c) => {
  const trip = await archiveTrip(c.env.DB, c.req.param('id'), nowSeconds())
  return trip ? c.json(trip) : c.json(apiError('bad_request', 'No such trip.'), 404)
})

tripRoutes.post('/:id/restore', async (c) => {
  const trip = await restoreTrip(c.env.DB, c.req.param('id'), nowSeconds())
  return trip ? c.json(trip) : c.json(apiError('bad_request', 'No such trip.'), 404)
})

/**
 * Permanent, and the only endpoint in Pack Smart that destroys anything.
 *
 * There is no Undo behind this one, which is why it is the only place the product
 * asks "are you sure?" instead — doc 02 §2 prefers undo to a confirmation, and the
 * exception is exactly the case where undo cannot exist. What it removes and what
 * it deliberately leaves alone is `deleteTrip` in `repos/trips.ts`.
 */
tripRoutes.delete('/:id', async (c) => {
  const removed = await deleteTrip(c.env.DB, c.req.param('id'))
  return removed
    ? c.json({ deleted: true })
    : c.json(apiError('bad_request', 'No such trip.'), 404)
})

/**
 * Editing a trip regenerates its list.
 *
 * Regeneration deliberately preserves everything Alex has touched — see
 * generateChecklist. Changing the dates updates the quantities that were derived
 * from them without discarding a single hand-made decision.
 */
tripRoutes.put('/:id', async (c) => {
  let body: Partial<TripInput>
  try {
    body = await c.req.json<Partial<TripInput>>()
  } catch {
    return c.json(apiError('bad_request', 'Expected a JSON body.'), 400)
  }

  const validation = validateTripInput(body)
  if (!validation.ok) {
    return c.json(
      { error: { code: 'bad_request', message: 'Check the highlighted fields.' }, fields: validation.errors },
      400,
    )
  }

  const now = nowSeconds()
  const trip = await updateTrip(c.env.DB, c.req.param('id'), normalise(body), now)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const generation = await generateChecklist(c.env.DB, trip, now)
  // The dates or the destination may have changed, so the stored forecast may
  // now be for the wrong week or the wrong place.
  refreshWeatherInBackground(c, trip, now)

  return c.json({ trip, generation })
})

/* ------------------------------------------------------------------ */
/* which days are what                                                 */
/* ------------------------------------------------------------------ */

/**
 * Records what Alex is doing on each day, and replans the outfits from it.
 *
 * The replan is the whole point of the screen — saying four days are safari
 * days and still being shown one safari outfit would be worse than not asking.
 * `generateOutfits` refuses to run over approved outfits, so this cannot
 * silently undo a plan Alex has already signed off.
 */
tripRoutes.put('/:id/days', async (c) => {
  const body = await c.req
    .json<{
      days?: Array<{ id?: string; date?: string; activityTag?: string | null }>
    }>()
    .catch(() => ({}) as Record<string, never>)

  if (!Array.isArray(body.days)) {
    return c.json(apiError('bad_request', 'Expected a list of days.'), 400)
  }

  const days: TripDay[] = []
  for (const day of body.days) {
    if (typeof day?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue
    const tag = day.activityTag
    if (tag !== null && tag !== undefined && !(tag in ACTIVITY_LABELS)) {
      return c.json(apiError('bad_request', 'That is not an activity Pack Smart knows.'), 400)
    }
    /*
     * The id is carried through so `setTripDays` can tell an activity being
     * EDITED from one being added (G2). It is validated against the trip's own
     * events there rather than trusted here — an id from another trip simply
     * does not match, and the entry is inserted as new.
     */
    days.push({
      id: typeof day.id === 'string' ? day.id : undefined,
      date: day.date,
      activityTag: tag ?? null,
    })
  }

  const trip = await setTripDays(c.env.DB, c.req.param('id'), days)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const now = nowSeconds()
  const { days: weather } = await getWeather(c.env.DB, trip.id, now)
  const { regenerated, replanned, kept } = await generateOutfits(c.env.DB, trip, now, weather)

  /*
   * Both numbers, not one boolean.
   *
   * Before D1c this answered `replanned: false` whenever anything was approved,
   * and the screen had no way to tell "there was nothing to do" from "one
   * approval froze the whole trip". Saying `2 replanned, 1 left as you approved
   * it` is the difference between a plan that ignored Alex and a plan that
   * respected a decision he made.
   */
  return c.json({ trip, replanned: regenerated, replannedCount: replanned, keptApproved: kept })
})

/* ------------------------------------------------------------------ */
/* weather                                                             */
/* ------------------------------------------------------------------ */

/**
 * The forecast for a trip, refreshed on request.
 *
 * A POST because it can reach out to Open-Meteo and write what it finds. It
 * never fails the request: a blocked or slow weather service returns a status
 * the screen can explain, because "Pack Smart does not know the weather" is a
 * fine thing to say and an error page is not.
 */
tripRoutes.post('/:id/weather', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const now = nowSeconds()
  const today = new Date(now * 1000).toISOString().slice(0, 10)
  const { days, status, fetchedAt, freshness } = await refreshWeather(c.env.DB, trip, today, now)

  return c.json({
    days,
    status,
    fetchedAt,
    freshness,
    summary: describeWeather(days),
    note: WEATHER_STATUS_TEXT[status],
  })
})

tripRoutes.get('/:id/weather', async (c) => {
  const { days, status, fetchedAt, freshness } = await getWeather(
    c.env.DB,
    c.req.param('id'),
    nowSeconds(),
  )
  return c.json({
    days,
    status,
    fetchedAt,
    freshness,
    summary: describeWeather(days),
    note: WEATHER_STATUS_TEXT[status],
  })
})

/**
 * A finished trip, as the starting point for the next one.
 *
 * Returns a PROPOSAL and writes nothing — the same shape as the itinerary
 * importer, and for the same reason: Alex reviews it in the trip sheet and
 * saves, so nothing exists until he says so. A route that created the trip
 * outright would leave a half-formed one behind every time he tapped and
 * changed his mind.
 *
 * What it deliberately does NOT carry: packed state, wear history, daily plans,
 * outfits, and the old forecast. Those describe a trip that happened. The new
 * trip generates its own against today's wardrobe and its own dates.
 */
tripRoutes.get('/:id/duplicate', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  return c.json({ template: toTemplate(trip), from: { id: trip.id, name: trip.name } })
})

/* ------------------------------------------------------------------ */
/* checklist                                                           */
/* ------------------------------------------------------------------ */

tripRoutes.get('/:id/checklist', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  let entries = await listChecklist(c.env.DB, trip.id)

  /*
   * A one-release backfill, and the only reason a GET writes anything.
   *
   * C1 gives every generated row a reason. Rows written BEFORE it have
   * `reason_text` null and stay that way, because the checklist is regenerated
   * when a trip changes rather than when it is read — so a trip Alex is not
   * editing would keep blank explanations indefinitely, and "every necessity
   * has a reason" would be true of new trips only.
   *
   * `generateChecklist` is the right tool because of what it refuses to touch:
   * a hand-set quantity, an exclusion, or an item Alex added are all preserved
   * by contract (see `worker/repos/checklist.ts`), so this cannot undo an edit.
   * It is idempotent, and the condition below stops being true after the first
   * open of each trip, so this is a no-op from then on.
   *
   * Only engine-owned rows count. A trip-only item has no `itemId` and no rule
   * to explain it, and its blank reason is the correct answer rather than a
   * gap — inventing a system reason for something Alex added by hand is the
   * one thing C1 explicitly must not do.
   */
  const unexplained = entries.some(
    (entry) => entry.itemId !== null && entry.excludedAt === null && entry.reason === null,
  )
  if (unexplained) {
    await generateChecklist(c.env.DB, trip, nowSeconds())
    entries = await listChecklist(c.env.DB, trip.id)
  }

  // What this trip knows it is not covering (doc 02 §9c). Served with the
  // checklist because it is a statement about the same list, and a second
  // request would let the two disagree on screen.
  const coverage = await tripCoverageGaps(c.env.DB, trip)

  /*
   * Approved outfits standing on a garment this trip is not bringing (doc 04 §8).
   *
   * Served here, and not only in the moment of removal, because the undo bar
   * that announces it is gone in six seconds and the conflict is not. §8 ends
   * "the user must never maintain two conflicting clothing plans" — a state that
   * only appears in a toast is exactly one Alex can be left holding unaware.
   */
  const conflicts = await outfitConflicts(c.env.DB, trip.id)

  return c.json({ trip, entries, coverage, conflicts })
})

tripRoutes.post('/:id/checklist/generate', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const generation = await generateChecklist(c.env.DB, trip, nowSeconds())
  const entries = await listChecklist(c.env.DB, trip.id)
  return c.json({ generation, entries })
})

tripRoutes.post('/:id/checklist/items', async (c) => {
  const body = await c.req
    .json<{ name?: string; category?: string; quantity?: number }>()
    .catch(() => ({}) as { name?: string; category?: string; quantity?: number })

  const name = (body.name ?? '').trim()
  if (!name) return c.json(apiError('bad_request', 'Give the item a name.'), 400)

  const trip = await getTrip(c.env.DB, c.req.param('id'))
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  // Trip-only by construction: this writes checklist_entry with item_id NULL and
  // never touches the catalog (product doc 05 §10).
  const entry = await addTripOnlyItem(
    c.env.DB,
    trip.id,
    name,
    (body.category ?? 'Travel Gear').trim() || 'Travel Gear',
    Number(body.quantity ?? 1),
    nowSeconds(),
  )
  return entry ? c.json(entry, 201) : c.json(apiError('internal', 'Could not add that item.'), 500)
})

interface EntryPatch {
  packedQty?: number
  qtyOverride?: number | null
  packingTiming?: string
  finalChecked?: boolean
  /** `null` hands the row back to Pack Smart's recommendation (doc 09 §11). */
  bag?: string | null
  /**
   * Apply this only if the row has not been written since (F2).
   *
   * The `updatedAt` the client last saw. Sent by the offline queue and by
   * nothing else — an ordinary tap with a live connection is unconditional,
   * because there is no stale intent to protect against when the read and the
   * write are a second apart.
   */
  ifUnmodifiedSince?: number
}

/*
 * What the client may SEND. Narrower than the column's CHECK constraint on
 * purpose: the two retired values are still legal in storage so that no table has
 * to be rebuilt, but nothing may write one again.
 */
const TIMINGS = ['anytime', 'day_of']

/**
 * One PATCH for every row edit.
 *
 * The checklist sheet changes several of these at once — bumping a quantity and
 * marking it packed — and a single round trip keeps that instant beside an open
 * suitcase rather than three sequential requests on hotel wifi.
 */
tripRoutes.patch('/:id/checklist/:entryId', async (c) => {
  const entryId = c.req.param('entryId')
  const existing = await getEntry(c.env.DB, entryId)
  if (!existing || existing.tripId !== c.req.param('id')) {
    return c.json(apiError('bad_request', 'No such checklist item.'), 404)
  }

  let body: EntryPatch
  try {
    body = await c.req.json<EntryPatch>()
  } catch {
    return c.json(apiError('bad_request', 'Expected a JSON body.'), 400)
  }

  /*
   * A change made offline does not get to undo a newer one (F2).
   *
   * Strictly greater-than, so a write in the same second as the read is
   * accepted. `updated_at` has one-second resolution, and being lenient inside
   * that second is the safe direction: the alternative refuses a perfectly
   * ordinary tap on a row that was just generated.
   *
   * The whole PATCH is refused rather than the offending field, because the
   * client sends one entry's queued fields together and half-applying them
   * would leave a state neither side asked for.
   */
  if (body.ifUnmodifiedSince !== undefined && existing.updatedAt > body.ifUnmodifiedSince) {
    return c.json(
      {
        ...apiError('conflict', 'This changed somewhere else since you did.'),
        // The current row, so the client can show what it would have overwritten
        // without spending a second round trip to find out.
        entry: existing,
      },
      409,
    )
  }

  const now = nowSeconds()
  let entry = existing

  if (body.qtyOverride !== undefined) {
    if (body.qtyOverride !== null && (!Number.isFinite(body.qtyOverride) || body.qtyOverride < 0)) {
      return c.json(apiError('bad_request', 'Quantity cannot be negative.'), 400)
    }
    entry = (await setQtyOverride(c.env.DB, entryId, body.qtyOverride, now)) ?? entry
  }

  if (body.packingTiming !== undefined) {
    if (!TIMINGS.includes(body.packingTiming)) {
      return c.json(apiError('bad_request', 'Unknown packing timing.'), 400)
    }
    entry = (await setTiming(c.env.DB, entryId, body.packingTiming, now)) ?? entry
  }

  if (body.packedQty !== undefined) {
    if (!Number.isFinite(body.packedQty) || body.packedQty < 0) {
      return c.json(apiError('bad_request', 'Packed quantity cannot be negative.'), 400)
    }
    entry = (await setPackedQty(c.env.DB, entryId, body.packedQty, now)) ?? entry
  }

  if (body.finalChecked !== undefined) {
    entry = (await setFinalChecked(c.env.DB, entryId, body.finalChecked, now)) ?? entry
  }

  if (body.bag !== undefined) {
    if (body.bag !== null && !BAG_ORDER.includes(body.bag as BagKey)) {
      return c.json(apiError('bad_request', 'That is not a bag Pack Smart knows.'), 400)
    }
    entry = (await setBag(c.env.DB, entryId, body.bag, now)) ?? entry
  }

  return c.json(entry)
})

/**
 * Not Bringing, not deletion — the row stays, restorable, with its reason intact.
 *
 * Names the outfits that relied on the garment, and the slot each one is now
 * short of, because doc 04 §8 requires that removing clothing from the checklist
 * surfaces its effect on the plan and offers a replacement rather than quietly
 * leaving an outfit half-dressed.
 *
 * The outfit itself is deliberately NOT edited here. Nothing to undo means undo
 * cannot get it wrong, and the affected-outfit marking is derived from this row
 * on every read — see `outfitConflicts`.
 */
tripRoutes.post('/:id/checklist/:entryId/exclude', async (c) => {
  const entryId = c.req.param('entryId')
  const before = await getEntry(c.env.DB, entryId)
  const entry = await excludeEntry(c.env.DB, entryId, nowSeconds())
  if (!entry) return c.json(apiError('bad_request', 'No such checklist item.'), 404)

  const affectedOutfits = before?.itemId
    ? await outfitsUsingItem(c.env.DB, c.req.param('id'), before.itemId)
    : []

  return c.json({ ...entry, affectedOutfits })
})

tripRoutes.post('/:id/checklist/:entryId/restore', async (c) => {
  const entry = await restoreEntry(c.env.DB, c.req.param('entryId'), nowSeconds())
  return entry ? c.json(entry) : c.json(apiError('bad_request', 'No such checklist item.'), 404)
})

/* ------------------------------------------------------------------ */

function normalise(body: Partial<TripInput>): TripInput {
  return {
    name: body.name ?? '',
    // An allowlist, so a stray field cannot reach the database — which also
    // means every new field has to be added here or it is silently dropped.
    emoji: body.emoji ?? null,
    startDate: body.startDate ?? '',
    endDate: body.endDate ?? '',
    /*
     * Rebuilt field by field rather than passed through.
     *
     * This whole function is an allowlist, and the emoji taught us why: a field
     * that is not named here reaches the database as undefined and the feature
     * looks broken for reasons nothing on screen explains. Destination dates are
     * validated to ISO here so a malformed one becomes "no date" — which
     * `destinationForDate` handles — rather than a string that silently never
     * matches any day.
     */
    destinations: (body.destinations ?? [])
      .filter((d) => d?.name?.trim())
      .map((d) => ({
        name: d.name,
        country: d.country ?? null,
        arriveDate: isValidDate(d.arriveDate ?? '') ? d.arriveDate! : null,
        departDate: isValidDate(d.departDate ?? '') ? d.departDate! : null,
      })),
    activities: body.activities ?? [],
    notes: body.notes ?? null,
    luggageMode: body.luggageMode ?? null,
    laundryAvailable: body.laundryAvailable ?? null,
    maxDressiness:
      typeof body.maxDressiness === 'number' && body.maxDressiness >= 0 && body.maxDressiness <= 4
        ? Math.round(body.maxDressiness)
        : null,
    flightHours: body.flightHours ?? null,
    international: body.international ?? null,
  }
}

/**
 * Adds a garment Alex owns to this trip's list from One Last Look.
 *
 * Writes a checklist row only — the catalog is untouched, and the row is not
 * attached to an outfit, because he asked for it directly rather than the
 * planner choosing it.
 */
tripRoutes.post('/:id/checklist/from-wardrobe', async (c) => {
  const body = await c.req.json<{ itemId?: string }>().catch(() => ({}) as { itemId?: string })
  if (!body.itemId) return c.json(apiError('bad_request', 'Which item?'), 400)

  const trip = await getTrip(c.env.DB, c.req.param('id'))
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const item = await getItem(c.env.DB, body.itemId)
  if (!item) return c.json(apiError('bad_request', 'No such item.'), 404)

  const existing = await c.env.DB.prepare(
    'SELECT id FROM checklist_entry WHERE trip_id = ? AND item_id = ?',
  )
    .bind(trip.id, item.id)
    .first<{ id: string }>()

  if (existing) {
    // Already on the list, possibly set aside. Bringing it back is the right
    // answer here rather than a duplicate row.
    const restored = await restoreEntry(c.env.DB, existing.id, nowSeconds())
    return c.json(restored)
  }

  const now = nowSeconds()
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, detail_snapshot,
                                  category_snapshot,
                                  required_qty, qty_breakdown_json, qty_override, packed_qty,
                                  packing_timing, requires_final_check, final_checked_at,
                                  excluded_at, source, reason_text, rule_snapshot_json,
                                  is_critical, trip_only, sort_order, created_at, updated_at)
     VALUES (?,?,?,?,?,?,1,NULL,NULL,0,?,?,NULL,NULL,'user_added',?,NULL,?,0,0,?,?)`,
  )
    .bind(
      id, trip.id, item.id, item.displayName, garmentDetail(item), item.category,
      item.defaultPackingTiming, item.requiresFinalCheck ? 1 : 0,
      'You added this yourself', item.isCritical ? 1 : 0, now, now,
    )
    .run()

  return c.json(await getEntry(c.env.DB, id), 201)
})
