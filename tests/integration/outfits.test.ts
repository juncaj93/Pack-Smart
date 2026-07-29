import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { listChecklist } from '../../worker/repos/checklist'
import {
  generateOutfits,
  listOutfits,
  outfitsUsingItem,
  setGroupStatus,
  setSlotItem,
  swapCandidates,
  syncChecklistFromOutfits,
} from '../../worker/repos/outfits'
import { createTrip } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * Outfit planning against real SQL, including the outfit-to-checklist link that
 * product doc 04 §8 requires to work in both directions.
 */

const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-07-31',
  endDate: '2026-08-11',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari', 'nice_dinner'],
  international: true,
  laundryAvailable: false,
  flightHours: 15,
}

const NOW = 1_780_000_000
let db: TestDatabase

function garment(overrides: {
  id?: string
  name: string
  subcategory: string
  dressiness?: number | null
  warmth?: number | null
  uses?: string[]
  favorite?: boolean
  reuseCapacity?: number | null
}): string {
  const id = overrides.id ?? crypto.randomUUID()
  const category =
    overrides.subcategory === 'Shoes' || overrides.subcategory === 'Sandals'
      ? 'Footwear'
      : ['Pants', 'Shorts', 'Swimwear'].includes(overrides.subcategory)
        ? 'Bottoms & Swimwear'
        : 'Tops & Outerwear'

  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, subcategory, color, pattern, brand,
                         notes, favorite, usage_frequency, warmth, dressiness, weather_tags,
                         typical_uses, reuse_capacity, owned_quantity, is_critical,
                         requires_final_check, default_packing_timing, always_include,
                         never_include, archived_at, source, created_at, updated_at)
       VALUES (?,'clothing',?,?,?,NULL,NULL,NULL,NULL,?,'sometimes',?,?,NULL,?,?,NULL,
               0,0,'anytime',0,0,NULL,'seed_import',1,1)`,
    )
    .run(
      id, overrides.name, category, overrides.subcategory,
      overrides.favorite ? 1 : 0,
      overrides.warmth ?? null,
      overrides.dressiness ?? 1,
      JSON.stringify(overrides.uses ?? ['casual']),
      overrides.reuseCapacity ?? null,
    )
  return id
}

function seedWardrobe() {
  return {
    tee: garment({ id: 'tee', name: 'Grey Tee', subcategory: 'T-Shirt' }),
    tee2: garment({ id: 'tee2', name: 'Navy Tee', subcategory: 'T-Shirt' }),
    tee3: garment({ id: 'tee3', name: 'Olive Tee', subcategory: 'T-Shirt' }),
    // Enough tops to actually dress a twelve-day trip. A t-shirt is worn once,
    // so a short wardrobe leaves days genuinely uncovered — which the planner
    // reports rather than papers over.
    tee4: garment({ id: 'tee4', name: 'Black Tee', subcategory: 'T-Shirt' }),
    tee5: garment({ id: 'tee5', name: 'White Tee', subcategory: 'T-Shirt' }),
    tee6: garment({ id: 'tee6', name: 'Red Tee', subcategory: 'T-Shirt' }),
    tee7: garment({ id: 'tee7', name: 'Blue Tee', subcategory: 'T-Shirt' }),
    tee8: garment({ id: 'tee8', name: 'Green Tee', subcategory: 'T-Shirt' }),
    tee9: garment({ id: 'tee9', name: 'Brown Tee', subcategory: 'T-Shirt' }),
    tee10: garment({ id: 'tee10', name: 'Tan Tee', subcategory: 'T-Shirt' }),
    tee11: garment({ id: 'tee11', name: 'Rust Tee', subcategory: 'T-Shirt' }),
    jeans: garment({ id: 'jeans', name: 'Blue Jeans', subcategory: 'Pants' }),
    shorts: garment({ id: 'shorts', name: 'Grey Shorts', subcategory: 'Shorts' }),
    // Trousers are worn three times each, so twelve days needs four pairs.
    cargo: garment({ id: 'cargo', name: 'Cargo Pants', subcategory: 'Pants' }),
    shirt: garment({
      id: 'shirt', name: 'White Oxford', subcategory: 'Shirt',
      dressiness: 3, uses: ['dressy'], favorite: true,
    }),
    pants: garment({ id: 'pants', name: 'Khaki Chinos', subcategory: 'Pants' }),
    dressPants: garment({
      id: 'dress-pants', name: 'Charcoal Trousers', subcategory: 'Pants',
      dressiness: 3, uses: ['dressy'],
    }),
    shoes: garment({ id: 'shoes', name: 'Walking Shoes', subcategory: 'Shoes' }),
    dressShoes: garment({
      id: 'dress-shoes', name: 'Leather Loafers', subcategory: 'Shoes',
      dressiness: 3, uses: ['dressy'],
    }),
  }
}

beforeEach(() => {
  db = createTestDatabase()
  seedWardrobe()
})

afterEach(() => {
  db.close()
})

async function planned() {
  const trip = await createTrip(db.binding, TRIP, NOW)
  const { groups } = await generateOutfits(db.binding, trip, NOW)
  return { trip, groups }
}

describe('outfit generation', () => {
  it('plans a group per activity plus travel and casual days', async () => {
    const { groups } = await planned()
    const names = groups.map((g) => g.name)

    expect(names).toContain('Safari')
    expect(names).toContain('Nice dinners')
    expect(names).toContain('Travel days')
  })

  it('dresses the nice dinner from the dressy end of the wardrobe', async () => {
    const { groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!

    expect(dinner.slots.find((s) => s.role === 'top')?.itemId).toBe('shirt')
    expect(dinner.slots.find((s) => s.role === 'bottom')?.itemId).toBe('dress-pants')
    expect(dinner.slots.find((s) => s.role === 'footwear')?.itemId).toBe('dress-shoes')
  })

  it('keeps the dressy shirt out of the safari despite it being the favourite', async () => {
    const { groups } = await planned()
    const safari = groups.find((g) => g.name === 'Safari')!
    expect(safari.slots.find((s) => s.role === 'top')?.itemId).not.toBe('shirt')
  })

  it('does not wear the same t-shirt twice anywhere in the plan', async () => {
    // A tee is worn once. Twelve days of tees means twelve different tees, not
    // one shirt assigned twelve times.
    const { groups } = await planned()
    const tops = groups
      .flatMap((g) => g.slots)
      .filter((s) => s.role === 'top' && s.itemId)
      .map((s) => s.itemId)

    expect(new Set(tops).size).toBe(tops.length)
  })

  it('covers every day of the trip when the wardrobe can', async () => {
    const { groups } = await planned()

    for (const group of groups) {
      const topWearings = group.slots
        .filter((s) => s.role === 'top' && s.itemId)
        .reduce((sum, s) => sum + s.wearings, 0)
      expect(topWearings).toBe(group.occurrences)
    }
  })

  it('says how many days it cannot dress rather than repeating a shirt', async () => {
    // Only three tees survive for a long trip once the dressy ones are excluded.
    db.raw.prepare("UPDATE item SET archived_at = 1 WHERE id LIKE 'tee_' AND id != 'tee'").run()

    const trip = await createTrip(db.binding, { ...TRIP, activities: [] }, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW)
    const casual = groups.find((g) => g.name === 'Casual days')!

    const gap = casual.slots.find((s) => s.role === 'top' && !s.itemId)
    expect(gap?.unmetReason).toMatch(/nothing left to wear on \d+ days/i)
    expect(casual.status).toBe('incomplete')
  })

  it('will not approve an outfit that is still missing a required garment', async () => {
    db.raw.prepare("UPDATE item SET archived_at = 1 WHERE subcategory = 'Shoes'").run()

    const trip = await createTrip(db.binding, { ...TRIP, activities: [] }, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW)
    const casual = groups.find((g) => g.name === 'Casual days')!

    const outcome = await setGroupStatus(db.binding, casual.id, 'approved', NOW)
    expect(outcome.status).toBe('incomplete')
  })

  it('marks a group incomplete and says why when nothing fits', async () => {
    // No swimwear in this wardrobe at all.
    const trip = await createTrip(db.binding, { ...TRIP, activities: ['swimming'] }, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW)
    const pool = groups.find((g) => g.name === 'Pool and downtime')!

    expect(pool.status).toBe('incomplete')
    const swim = pool.slots.find((s) => s.role === 'swim')!
    expect(swim.itemId).toBeNull()
    expect(swim.unmetReason).toMatch(/no swimwear in your wardrobe/i)
  })

  it('records which criterion chose each garment', async () => {
    const { groups } = await planned()
    const reasons = groups.flatMap((g) => g.slots).map((s) => s.reason).filter(Boolean)
    expect(reasons.length).toBeGreaterThan(0)
  })

  it('refuses to regenerate over an approved plan', async () => {
    const { trip, groups } = await planned()
    const safari = groups.find((g) => g.name === 'Safari')!
    await setGroupStatus(db.binding, safari.id, 'approved', NOW)

    const again = await generateOutfits(db.binding, trip, NOW)
    expect(again.regenerated).toBe(false)
    expect(again.groups.find((g) => g.name === 'Safari')?.id).toBe(safari.id)
  })

  it('produces the same plan twice for the same trip', async () => {
    const first = await planned()
    const second = await generateOutfits(db.binding, first.trip, NOW)

    const pick = (groups: typeof first.groups) =>
      groups.map((g) => `${g.name}:${g.slots.map((s) => s.itemId ?? '-').join(',')}`)

    expect(pick(second.groups)).toEqual(pick(first.groups))
  })
})

describe('swapping', () => {
  it('offers suitable garments first but does not hide the rest', async () => {
    const { groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const top = dinner.slots.find((s) => s.role === 'top')!

    const candidates = await swapCandidates(db.binding, dinner.id, top.id)
    const names = candidates.map((c) => c.item.displayName)

    expect(names).toContain('White Oxford')
    // The casual tees are listed too, marked unsuitable rather than hidden.
    expect(names).toContain('Grey Tee')
    expect(candidates.find((c) => c.item.id === 'tee')?.suitable).toBe(false)
    expect(candidates.find((c) => c.item.id === 'tee')?.reason).toBeTruthy()
    expect(candidates[0]?.suitable).toBe(true)
  })

  it('offers only garments that could fill the slot at all', async () => {
    const { groups } = await planned()
    const safari = groups.find((g) => g.name === 'Safari')!
    const footwear = safari.slots.find((s) => s.role === 'footwear')!

    const candidates = await swapCandidates(db.binding, safari.id, footwear.id)
    expect(candidates.every((c) => ['shoes', 'dress-shoes'].includes(c.item.id))).toBe(true)
  })

  it('marks a group incomplete when a required slot is emptied', async () => {
    const { trip, groups } = await planned()
    const safari = groups.find((g) => g.name === 'Safari')!
    const top = safari.slots.find((s) => s.role === 'top')!

    await setSlotItem(db.binding, top.id, null, NOW)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === safari.id)!
    expect(after.status).toBe('incomplete')
  })
})

describe('approved outfits are the source of truth for the clothing checklist', () => {
  it('puts nothing on the checklist until an outfit is approved', async () => {
    const { trip } = await planned()
    await syncChecklistFromOutfits(db.binding, trip, NOW)

    const clothing = (await listChecklist(db.binding, trip.id)).filter(
      (e) => e.source === 'outfit_generated',
    )
    expect(clothing).toHaveLength(0)
  })

  it('adds the approved outfit’s clothing, with the outfit named as the reason', async () => {
    const { trip, groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!

    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)

    const entries = await listChecklist(db.binding, trip.id)
    const oxford = entries.find((e) => e.name === 'White Oxford')!

    expect(oxford).toBeDefined()
    expect(oxford.source).toBe('outfit_generated')
    expect(oxford.reason).toBe('Worn for Nice dinners')
  })

  it('packs one pair of shoes for a group worn many times', async () => {
    const { trip, groups } = await planned()
    const casual = groups.find((g) => g.name === 'Casual days')!

    await setGroupStatus(db.binding, casual.id, 'approved', NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)

    const entries = await listChecklist(db.binding, trip.id)
    const shoes = entries.find((e) => e.name === 'Walking Shoes')
    expect(shoes?.requiredQty).toBe(1)
  })

  it('removes clothing when its outfit is un-approved', async () => {
    const { trip, groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!

    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)
    expect((await listChecklist(db.binding, trip.id)).some((e) => e.name === 'White Oxford')).toBe(true)

    await setGroupStatus(db.binding, dinner.id, 'draft', NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)
    expect((await listChecklist(db.binding, trip.id)).some((e) => e.name === 'White Oxford')).toBe(false)
  })

  it('never removes a row Alex has set aside or overridden', async () => {
    const { trip, groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!

    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)

    const oxford = (await listChecklist(db.binding, trip.id)).find((e) => e.name === 'White Oxford')!
    db.raw.prepare('UPDATE checklist_entry SET excluded_at = ? WHERE id = ?').run(NOW, oxford.id)

    await setGroupStatus(db.binding, dinner.id, 'draft', NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)

    const after = (await listChecklist(db.binding, trip.id)).find((e) => e.name === 'White Oxford')
    expect(after).toBeDefined()
    expect(after?.excludedAt).toBe(NOW)
  })

  it('names the outfits that rely on a garment', async () => {
    const { trip, groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)

    expect(await outfitsUsingItem(db.binding, trip.id, 'shirt')).toContain('Nice dinners')
  })

  it('leaves gear rows alone', async () => {
    const { trip, groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!

    db.raw
      .prepare(
        `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                      required_qty, packed_qty, packing_timing, requires_final_check,
                                      source, is_critical, trip_only, sort_order, created_at, updated_at)
         VALUES ('gear-row',?,NULL,'Passport','Documents',1,0,'last_minute',1,'always_packed',1,0,0,1,1)`,
      )
      .run(trip.id)

    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)
    await setGroupStatus(db.binding, dinner.id, 'draft', NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)

    expect((await listChecklist(db.binding, trip.id)).some((e) => e.name === 'Passport')).toBe(true)
  })
})
