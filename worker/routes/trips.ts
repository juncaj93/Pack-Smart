import { Hono } from 'hono'
import type { TripInput } from '@shared/trips'
import { validateTripInput } from '@shared/trips'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import {
  addTripOnlyItem,
  excludeEntry,
  generateChecklist,
  getEntry,
  listChecklist,
  restoreEntry,
  setFinalChecked,
  setPackedQty,
  setQtyOverride,
  setTiming,
} from '../repos/checklist'
import { getItem } from '../repos/items'
import { outfitsUsingItem } from '../repos/outfits'
import { createTrip, getTrip, listTrips, setTripStatus, updateTrip } from '../repos/trips'
import { outfitRoutes } from './outfits'
import { todayRoutes } from './today'

export const tripRoutes = new Hono<AppBindings>()

/** Outfit planning for one trip. Nested so it always has a trip in scope. */
tripRoutes.route('/:id/outfits', outfitRoutes)
tripRoutes.route('/:id/today', todayRoutes)

/** Everything under here is already behind the session guard mounted in index.ts. */

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

  return c.json({ trip, generation }, 201)
})

tripRoutes.get('/:id', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  return trip ? c.json(trip) : c.json(apiError('bad_request', 'No such trip.'), 404)
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
  return c.json({ trip, generation })
})

const STATUSES = ['planning', 'packing', 'active', 'completed'] as const

tripRoutes.post('/:id/status', async (c) => {
  const body = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string })
  const status = body.status
  if (!status || !(STATUSES as readonly string[]).includes(status)) {
    return c.json(apiError('bad_request', 'Unknown trip status.'), 400)
  }

  const trip = await setTripStatus(c.env.DB, c.req.param('id'), status as (typeof STATUSES)[number], nowSeconds())
  return trip ? c.json(trip) : c.json(apiError('bad_request', 'No such trip.'), 404)
})

/* ------------------------------------------------------------------ */
/* checklist                                                           */
/* ------------------------------------------------------------------ */

tripRoutes.get('/:id/checklist', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const entries = await listChecklist(c.env.DB, trip.id)
  return c.json({ trip, entries })
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
}

const TIMINGS = ['anytime', 'night_before', 'day_of', 'last_minute']

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

  return c.json(entry)
})

/**
 * Not Bringing, not deletion — the row stays, restorable, with its reason intact.
 *
 * Names the outfits that relied on the garment, because doc 04 §8 requires that
 * removing clothing from the checklist surfaces its effect on the plan rather
 * than quietly leaving an outfit half-dressed.
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
    startDate: body.startDate ?? '',
    endDate: body.endDate ?? '',
    destinations: (body.destinations ?? []).filter((d) => d?.name?.trim()),
    activities: body.activities ?? [],
    notes: body.notes ?? null,
    luggageMode: body.luggageMode ?? null,
    laundryAvailable: body.laundryAvailable ?? null,
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
    `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                  required_qty, qty_breakdown_json, qty_override, packed_qty,
                                  packing_timing, requires_final_check, final_checked_at,
                                  excluded_at, source, reason_text, rule_snapshot_json,
                                  is_critical, trip_only, sort_order, created_at, updated_at)
     VALUES (?,?,?,?,?,1,NULL,NULL,0,?,?,NULL,NULL,'user_added',?,NULL,?,0,0,?,?)`,
  )
    .bind(
      id, trip.id, item.id, item.displayName, item.category,
      item.defaultPackingTiming, item.requiresFinalCheck ? 1 : 0,
      'You added this yourself', item.isCritical ? 1 : 0, now, now,
    )
    .run()

  return c.json(await getEntry(c.env.DB, id), 201)
})
