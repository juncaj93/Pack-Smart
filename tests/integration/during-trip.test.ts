import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { excludeEntry, generateChecklist, listChecklist, setPackedQty } from '../../worker/repos/checklist'
import {
  adjustDay,
  ensureDailyPlans,
  getDayPlan,
  listWearLog,
  logWear,
  packedAlternatives,
  packedCatalog,
} from '../../worker/repos/during-trip'
import {
  generateOutfits,
  listOutfits,
  setGroupStatus,
  syncChecklistFromOutfits,
} from '../../worker/repos/outfits'
import { createTrip } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * During Trip, against real SQL.
 *
 * The rule under test is the absolute one from product doc 04 §10: only
 * clothing and gear confirmed as PACKED may ever be recommended. Not Bringing,
 * unpacked and archived items must be unreachable — not merely unlikely.
 */

const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-07-31',
  endDate: '2026-08-11',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari'],
  international: true,
  laundryAvailable: false,
}

const NOW = 1_780_000_000
let db: TestDatabase

function garment(id: string, name: string, subcategory: string) {
  const category =
    subcategory === 'Shoes' ? 'Footwear' : subcategory === 'Pants' ? 'Bottoms & Swimwear' : 'Tops & Outerwear'
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, subcategory, favorite, usage_frequency,
                         dressiness, typical_uses, is_critical, requires_final_check,
                         default_packing_timing, always_include, never_include, source,
                         created_at, updated_at)
       VALUES (?,'clothing',?,?,?,0,'sometimes',1,'["casual"]',0,0,'anytime',0,0,'seed_import',1,1)`,
    )
    .run(id, name, category, subcategory)
  return id
}

function gear(id: string, name: string, condition?: unknown) {
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency, is_critical,
                         requires_final_check, default_packing_timing, always_include,
                         never_include, source, created_at, updated_at)
       VALUES (?,'gear',?,'Travel Gear',0,'sometimes',0,0,'anytime',0,0,'seed_import',1,1)`,
    )
    .run(id, name)
  db.raw
    .prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, condition_json,
                                 enabled, needs_review, created_at)
       VALUES (?,?,?,1,?,1,0,1)`,
    )
    .run(
      crypto.randomUUID(), id,
      condition ? 'conditional_include' : 'fixed_per_trip',
      condition ? JSON.stringify(condition) : null,
    )
  return id
}

beforeEach(() => {
  db = createTestDatabase()
  for (let i = 1; i <= 14; i += 1) garment(`tee${i}`, `Tee ${i}`, 'T-Shirt')
  for (let i = 1; i <= 5; i += 1) garment(`pants${i}`, `Pants ${i}`, 'Pants')
  garment('shoes', 'Walking Shoes', 'Shoes')
  // Triggered by the safari, so it belongs in the Bring list.
  gear('binoculars', 'Binoculars', { fact: 'activities', contains: 'safari' })
  // Routine gear that simply lives in the bag.
  gear('toothpaste', 'Toothpaste')
})

afterEach(() => {
  db.close()
})

/** Plans a trip, approves every complete outfit, and packs everything. */
async function packedTrip(options: { packEverything?: boolean } = {}) {
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, trip, NOW)
  await generateOutfits(db.binding, trip, NOW)

  for (const group of await listOutfits(db.binding, trip.id)) {
    if (group.status !== 'incomplete') await setGroupStatus(db.binding, group.id, 'approved', NOW)
  }
  await syncChecklistFromOutfits(db.binding, trip, NOW)

  if (options.packEverything !== false) {
    for (const entry of await listChecklist(db.binding, trip.id)) {
      await setPackedQty(db.binding, entry.id, entry.requiredQty, NOW)
    }
  }

  await ensureDailyPlans(db.binding, trip, NOW)
  return trip
}

describe('the packed-only rule is absolute', () => {
  it('recommends nothing at all when nothing is packed', async () => {
    const trip = await packedTrip({ packEverything: false })
    const plan = await getDayPlan(db.binding, trip, TRIP.startDate)

    expect(plan.wear).toHaveLength(0)
    expect(plan.bring).toHaveLength(0)
  })

  it('never offers an unpacked garment', async () => {
    const trip = await packedTrip()

    const entries = await listChecklist(db.binding, trip.id)
    const target = entries.find((e) => e.name === 'Walking Shoes')!
    await setPackedQty(db.binding, target.id, 0, NOW)

    const catalog = await packedCatalog(db.binding, trip.id)
    expect(catalog.has('shoes')).toBe(false)

    const plan = await getDayPlan(db.binding, trip, TRIP.startDate)
    expect(plan.wear.some((w) => w.itemId === 'shoes')).toBe(false)
  })

  it('never offers a Not Bringing garment', async () => {
    const trip = await packedTrip()

    const entries = await listChecklist(db.binding, trip.id)
    const target = entries.find((e) => e.name === 'Walking Shoes')!
    await excludeEntry(db.binding, target.id, NOW)

    expect((await packedCatalog(db.binding, trip.id)).has('shoes')).toBe(false)
  })

  it('never offers a garment archived after it was packed', async () => {
    const trip = await packedTrip()
    db.raw.prepare("UPDATE item SET archived_at = ? WHERE id = 'shoes'").run(NOW)

    expect((await packedCatalog(db.binding, trip.id)).has('shoes')).toBe(false)
  })

  it('offers a packed alternative only from the bag', async () => {
    const trip = await packedTrip()

    const entries = await listChecklist(db.binding, trip.id)
    for (const entry of entries) {
      if (entry.name.startsWith('Tee ')) await setPackedQty(db.binding, entry.id, 0, NOW)
    }

    const options = await packedAlternatives(db.binding, trip, TRIP.startDate, 'top')
    expect(options).toHaveLength(0)
  })

  it('brings the gear this trip called for, not the whole bag', async () => {
    const trip = await packedTrip()
    const plan = await getDayPlan(db.binding, trip, TRIP.startDate)
    const names = plan.bring.map((b) => b.name)

    expect(names).toContain('Binoculars')
    // Routine gear lives in the bag; listing it here would bury the useful line.
    expect(names).not.toContain('Toothpaste')
    // Clothing belongs under Wear, never duplicated into Bring.
    expect(plan.bring.some((b) => b.name.startsWith('Tee '))).toBe(false)
  })

  it('shows one garment per role, not the whole group’s allocation', async () => {
    // "Casual days x N" holds N days of tops. A single day must show one.
    const trip = await packedTrip()
    const plan = await getDayPlan(db.binding, trip, '2026-08-03')

    const roles = plan.wear.map((w) => w.role)
    expect(new Set(roles).size).toBe(roles.length)
    expect(plan.wear.filter((w) => w.role === 'top')).toHaveLength(1)
  })

  it('gives different days of the same group different clothes', async () => {
    const trip = await packedTrip()

    const one = await getDayPlan(db.binding, trip, '2026-08-03')
    const two = await getDayPlan(db.binding, trip, '2026-08-04')

    expect(one.groupName).toBe(two.groupName)
    expect(one.wear.find((w) => w.role === 'top')?.itemId).not.toBe(
      two.wear.find((w) => w.role === 'top')?.itemId,
    )
  })
})

describe('the plan is read, not regenerated', () => {
  it('shows the same clothes on a second opening', async () => {
    const trip = await packedTrip()

    const first = await getDayPlan(db.binding, trip, TRIP.startDate)
    const second = await getDayPlan(db.binding, trip, TRIP.startDate)

    expect(second.wear.map((w) => w.itemId)).toEqual(first.wear.map((w) => w.itemId))
    expect(second.groupName).toBe(first.groupName)
  })

  it('does not reshuffle the day assignments when ensure runs again', async () => {
    const trip = await packedTrip()
    const before = db.raw
      .prepare('SELECT plan_date, outfit_group_id FROM daily_plan WHERE trip_id = ? ORDER BY plan_date')
      .all(trip.id)

    await ensureDailyPlans(db.binding, trip, NOW + 100)

    const after = db.raw
      .prepare('SELECT plan_date, outfit_group_id FROM daily_plan WHERE trip_id = ? ORDER BY plan_date')
      .all(trip.id)

    expect(after).toEqual(before)
  })

  it('covers every date of the trip exactly once', async () => {
    const trip = await packedTrip()
    const rows = db.raw
      .prepare('SELECT plan_date FROM daily_plan WHERE trip_id = ?')
      .all(trip.id) as Array<{ plan_date: string }>

    expect(rows).toHaveLength(12)
    expect(new Set(rows.map((r) => r.plan_date)).size).toBe(12)
  })

  it('puts the travel outfit on the first and last days', async () => {
    const trip = await packedTrip()

    const first = await getDayPlan(db.binding, trip, '2026-07-31')
    const last = await getDayPlan(db.binding, trip, '2026-08-11')

    expect(first.groupName).toBe('Travel days')
    expect(last.groupName).toBe('Travel days')
  })
})

describe('live adjustments', () => {
  it('swaps one garment for another for that day only', async () => {
    const trip = await packedTrip()
    const plan = await getDayPlan(db.binding, trip, '2026-08-01')
    const top = plan.wear.find((w) => w.role === 'top')!

    const alternatives = await packedAlternatives(db.binding, trip, '2026-08-01', 'top')
    const replacement = alternatives[0]!

    await adjustDay(db.binding, trip.id, '2026-08-01', top.itemId, replacement.itemId, NOW)

    const adjusted = await getDayPlan(db.binding, trip, '2026-08-01')
    expect(adjusted.wear.find((w) => w.role === 'top')?.itemId).toBe(replacement.itemId)
    expect(adjusted.wear.find((w) => w.role === 'top')?.reason).toBe('You swapped this in')

    // Another day is untouched — this is an adjustment, not a replan.
    const other = await getDayPlan(db.binding, trip, '2026-08-02')
    expect(other.wear.find((w) => w.role === 'top')?.itemId).not.toBe(replacement.itemId)
  })

  it('drops a garment from the day when nothing replaces it', async () => {
    const trip = await packedTrip()
    const plan = await getDayPlan(db.binding, trip, '2026-08-01')
    const top = plan.wear.find((w) => w.role === 'top')!

    await adjustDay(db.binding, trip.id, '2026-08-01', top.itemId, null, NOW)

    const adjusted = await getDayPlan(db.binding, trip, '2026-08-01')
    expect(adjusted.wear.some((w) => w.itemId === top.itemId)).toBe(false)
  })

  it('records what happened to a garment and keeps one entry per day', async () => {
    const trip = await packedTrip()

    await logWear(db.binding, trip.id, 'tee1', '2026-08-01', 'will_wear', NOW)
    await logWear(db.binding, trip.id, 'tee1', '2026-08-01', 'already_wore', NOW + 1)

    const log = await listWearLog(db.binding, trip.id, '2026-08-01')
    expect(log.tee1).toBe('already_wore')

    const rows = db.raw
      .prepare("SELECT count(*) AS n FROM wear_log WHERE trip_id = ? AND item_id = 'tee1'")
      .get(trip.id) as { n: number }
    expect(rows.n).toBe(1)
  })

  it('does not offer a garment already worn on another day as an alternative', async () => {
    const trip = await packedTrip()
    await logWear(db.binding, trip.id, 'tee5', '2026-08-01', 'already_wore', NOW)

    const plan = await getDayPlan(db.binding, trip, '2026-08-02')
    const missing = plan.missing.flatMap((m) => m.alternatives.map((a) => a.itemId))
    expect(missing).not.toContain('tee5')
  })
})

describe('a planned garment that did not make the bag', () => {
  it('is named, with packed alternatives, rather than silently dropped', async () => {
    const trip = await packedTrip()

    // Take the planned top for one day back out of the bag.
    const plan = await getDayPlan(db.binding, trip, '2026-08-01')
    const top = plan.wear.find((w) => w.role === 'top')!

    const entries = await listChecklist(db.binding, trip.id)
    const row = entries.find((e) => e.itemId === top.itemId)!
    await setPackedQty(db.binding, row.id, 0, NOW)

    const after = await getDayPlan(db.binding, trip, '2026-08-01')
    const gap = after.missing.find((m) => m.role === 'top')

    expect(gap).toBeDefined()
    expect(gap?.name).toBe(top.name)
    expect(gap?.alternatives.length).toBeGreaterThan(0)
    // Every alternative offered is itself packed.
    const packed = await packedCatalog(db.binding, trip.id)
    expect(gap?.alternatives.every((a) => packed.has(a.itemId))).toBe(true)
  })
})
