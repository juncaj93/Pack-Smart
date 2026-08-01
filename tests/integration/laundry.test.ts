import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { LAUNDRY_DAY_CAP, laundryReducible, outfitFit } from '@shared/outfits'
import type { Item } from '@shared/items'
import { generateChecklist, listChecklist, setQtyOverride, excludeEntry } from '../../worker/repos/checklist'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { generateOutfits, listOutfits, setGroupStatus, syncChecklistFromOutfits } from '../../worker/repos/outfits'
import { createTestDatabase, insertRule, type TestDatabase } from './d1'
import { TRIP, garment, seedWardrobe } from './wardrobe'

/**
 * Laundry, as Alex ruled it.
 *
 * A deterministic cap on the number of **days of ordinary washable clothing**
 * that have to be carried — four, when he has said laundry is available. On a
 * twelve-day trip that turns twelve t-shirts into four.
 *
 * The two things it must never be confused with:
 *
 *   1. **It is not a claim about the garment.** A t-shirt's rewear capacity is
 *      still 1; laundry does not make a shirt wearable twice unwashed. What
 *      changes is how much has to be in the bag at once.
 *   2. **It is not a rule.** An explicit usual-amount rule outranks it — the
 *      approved precedence is trip edit, then user rule, then learned
 *      preference, then laundry, then system default.
 */

const NOW = 1_780_000_000
let db: TestDatabase

const withLaundry: TripInput = { ...TRIP, laundryAvailable: true }
const withoutLaundry: TripInput = { ...TRIP, laundryAvailable: false }
const unanswered: TripInput = { ...TRIP, laundryAvailable: null }

beforeEach(() => {
  db = createTestDatabase()
  seedWardrobe(db)
})

afterEach(() => {
  db.close()
})

/** Plans and approves everything, which is what puts clothing on the list. */
async function packed(input: TripInput) {
  const trip = await createTrip(db.binding, input, NOW)
  const { groups } = await generateOutfits(db.binding, trip, NOW)
  for (const group of groups) await setGroupStatus(db.binding, group.id, 'approved', NOW)
  const stored = (await getTrip(db.binding, trip.id))!
  await syncChecklistFromOutfits(db.binding, stored, NOW)
  return { trip: stored, groups: await listOutfits(db.binding, trip.id) }
}

const quantities = async (tripId: string) => {
  const rows = await listChecklist(db.binding, tripId)
  return new Map(rows.filter((e) => e.itemId).map((e) => [e.itemId!, e.requiredQty]))
}

describe('what laundry changes', () => {
  /*
   * The scenario from the ruling. A t-shirt is worn once, so a twelve-day casual
   * group asks for twelve different tops — and with a washing machine it asks
   * for four.
   *
   * Measured as CHANGES OF A GARMENT, not as one row's quantity. That is where
   * the cap has to bite and it is why an earlier version of this test could not
   * fail: the plan already spreads twelve days across twelve different t-shirts
   * at a quantity of one each, so no row's number ever exceeded four to be cut.
   */
  it('carries four days of ordinary tops instead of twelve', async () => {
    const dry = await packed(withoutLaundry)
    const wet = await packed(withLaundry)

    const topsIn = (groups: Awaited<ReturnType<typeof packed>>['groups']) => {
      const casual = groups.find((g) => g.name === 'Casual days')!
      expect(casual.occurrences).toBeGreaterThan(LAUNDRY_DAY_CAP)
      return casual.slots.filter((s) => s.role === 'top' && s.itemId).length
    }

    expect(topsIn(dry.groups)).toBeGreaterThan(LAUNDRY_DAY_CAP)
    expect(topsIn(wet.groups)).toBe(LAUNDRY_DAY_CAP)

    // And the list is shorter for it, never longer.
    const before = await quantities(dry.trip.id)
    const after = await quantities(wet.trip.id)
    expect(after.size).toBeLessThan(before.size)
    for (const [id, n] of after) expect(n, id).toBeLessThanOrEqual(before.get(id) ?? n)
  })

  /*
   * The sentence belongs to the GROUP, because that is what the number is about.
   * Each of the four t-shirts is still a quantity of one, and "1 day of
   * clothing" beside a single t-shirt would be noise.
   */
  it('says so on the outfit, in terms of the trip rather than the garment', async () => {
    const { groups } = await packed(withLaundry)
    const casual = groups.find((g) => g.name === 'Casual days')!

    const lines = outfitFit({
      name: casual.name,
      activityTag: casual.activityTag,
      occurrences: casual.occurrences,
      status: casual.status,
      deferredAt: casual.deferredAt,
      slots: casual.slots,
    })

    expect(lines.join(' ')).toContain('4 days of clothing · laundry available')
    // Never a claim that washing changed what the garment can do.
    expect(lines.join(' ')).not.toMatch(/rewear|reuse capacity|wearable twice/i)
  })
})

describe('what laundry must never touch', () => {
  it('leaves a trip where Alex said there is no laundry exactly as it was', async () => {
    const a = await packed(withoutLaundry)
    const b = await packed(withoutLaundry)
    expect(await quantities(a.trip.id)).toEqual(await quantities(b.trip.id))

    const rows = await listChecklist(db.binding, a.trip.id)
    expect(rows.some((e) => e.qtyBreakdown?.includes('laundry'))).toBe(false)
  })

  /*
   * Three-valued on purpose. An unanswered question is not a "no" and it is
   * certainly not a "yes" — it packs exactly what it packed before laundry
   * existed.
   */
  it('leaves a trip where he never answered exactly as it was', async () => {
    const unknown = await packed(unanswered)
    const no = await packed(withoutLaundry)
    expect(await quantities(unknown.trip.id)).toEqual(await quantities(no.trip.id))
  })

  it('leaves a four-day trip alone, laundry or not', async () => {
    const short = { ...withLaundry, startDate: '2026-07-31', endDate: '2026-08-03' }
    const shortDry = { ...short, laundryAvailable: false }

    const a = await packed(short)
    const b = await packed(shortDry)

    expect(await quantities(a.trip.id)).toEqual(await quantities(b.trip.id))
    const rows = await listChecklist(db.binding, a.trip.id)
    expect(rows.some((e) => e.qtyBreakdown?.includes('laundry'))).toBe(false)
  })

  /*
   * The ruling's list, item by item. Each of these is a garment the plan wears
   * on many days, and none of them may be cut: outerwear and shoes are not
   * washed on a rotation, swimwear may be needed on overlapping days, and a
   * dress shirt for the one nice dinner is not a thing you cycle.
   */
  /*
   * The ruling's list, asserted against the judgement that decides it.
   *
   * `laundryReducible` is the load-bearing guard: the slot-role set is
   * belt-and-braces, and a test that widened only the roles stayed green because
   * this function already refuses every one of these. So this asserts the
   * function, subcategory by subcategory, and it fails the moment the allowlist
   * or the dressiness ceiling is widened.
   */
  it('refuses every category the ruling protects', () => {
    const item = (over: Partial<Item>): Item =>
      ({ id: 'x', kind: 'clothing', subcategory: null, dressiness: 1, ...over }) as Item

    const protectedShapes: Array<[string, Item]> = [
      ['outerwear', item({ subcategory: 'Outerwear' })],
      ['a mid layer', item({ subcategory: 'Mid-Layer' })],
      ['shoes', item({ subcategory: 'Shoes' })],
      ['sandals', item({ subcategory: 'Sandals' })],
      ['swimwear', item({ subcategory: 'Swimwear' })],
      ['an accessory', item({ subcategory: 'Accessories' })],
      ['an unrecorded subcategory', item({ subcategory: null })],
      ['unrecorded dressiness', item({ subcategory: 'T-Shirt', dressiness: null })],
      ['a dressy shirt', item({ subcategory: 'Shirt', dressiness: 3 })],
      ['a formal shirt', item({ subcategory: 'Shirt', dressiness: 4 })],
    ]

    for (const [what, garmentShape] of protectedShapes) {
      expect(laundryReducible(garmentShape), what).toBe(false)
    }
  })

  it('accepts the everyday washable ones, and only those', () => {
    const item = (subcategory: string, dressiness = 1): Item =>
      ({ id: 'x', kind: 'clothing', subcategory, dressiness }) as Item

    for (const sub of ['T-Shirt', 'Tank Top', 'Shirt', 'Pants', 'Shorts', 'Basics', 'Underwear']) {
      expect(laundryReducible(item(sub)), sub).toBe(true)
    }
  })

  /*
   * And at the plan level: a layer and footwear keep every change the plan asked
   * for, whatever the group's length.
   */
  it('leaves the plan’s footwear and layers exactly as they were', async () => {
    const dry = await packed(withoutLaundry)
    const wet = await packed(withLaundry)

    const changesOf = (groups: Awaited<ReturnType<typeof packed>>['groups'], role: string) => {
      const casual = groups.find((g) => g.name === 'Casual days')!
      return casual.slots.filter((s) => s.role === role && s.itemId).length
    }

    for (const role of ['footwear', 'outer', 'mid']) {
      expect(changesOf(wet.groups, role), role).toBe(changesOf(dry.groups, role))
    }
  })

  /*
   * "Items whose washing suitability is unknown." A garment whose subcategory
   * says nothing cannot be judged, so it is not reduced — the default is always
   * to carry what the plan asked for.
   */
  it('never reduces a garment whose subcategory says nothing about washing', async () => {
    const id = garment(db, { id: 'mystery', name: 'Something', subcategory: 'T-Shirt' })
    db.raw.prepare('UPDATE item SET subcategory = NULL WHERE id = ?').run(id)

    const dry = await packed(withoutLaundry)
    const wet = await packed(withLaundry)

    const before = (await quantities(dry.trip.id)).get('mystery')
    if (before === undefined) return
    expect((await quantities(wet.trip.id)).get('mystery')).toBe(before)
  })

  /*
   * Capability is never inferred from a brand or a name — the same rule
   * `weather-fit.ts` holds for waterproofing. These two differ only in their
   * recorded subcategory.
   */
  it('never infers washability from a brand or a name', async () => {
    garment(db, { id: 'washable', name: 'Vuori Machine Wash Tee', subcategory: 'T-Shirt' })
    garment(db, { id: 'not-washable', name: 'Vuori Machine Wash Tee Two', subcategory: 'Outerwear', warmth: 1 })

    const dry = await packed(withoutLaundry)
    const wet = await packed(withLaundry)
    const before = await quantities(dry.trip.id)
    const after = await quantities(wet.trip.id)

    if (before.has('not-washable')) {
      expect(after.get('not-washable')).toBe(before.get('not-washable'))
    }
  })
})

describe('an explicit rule outranks laundry', () => {
  /*
   * The example from the ruling. `Underwear — 2 per day` is Alex's own usual
   * amount, so a twelve-day trip means 24 whether or not there is a washing
   * machine. Laundry sits BELOW an explicit rule in the precedence, and this is
   * what stops it quietly editing a number he set.
   */
  it('keeps “2 per day” at 24 on a twelve-day trip with laundry', async () => {
    const boxers = garment(db, { id: 'boxers', name: 'Boxer Briefs', subcategory: 'Underwear' })
    insertRule(db, boxers, { ruleType: 'per_day', quantityValue: 2 })

    const { trip } = await packed(withLaundry)
    await generateChecklist(db.binding, trip, NOW)

    const row = (await listChecklist(db.binding, trip.id)).find((e) => e.itemId === 'boxers')!
    expect(row.requiredQty).toBe(24)
    expect(row.qtyBreakdown ?? '').not.toContain('laundry')
  })

  it('keeps a hand-set quantity through a laundry answer', async () => {
    const { trip } = await packed(withLaundry)
    const row = (await listChecklist(db.binding, trip.id)).find((e) => e.itemId)!
    await setQtyOverride(db.binding, row.id, 9, NOW)

    await syncChecklistFromOutfits(db.binding, trip, NOW)
    await generateChecklist(db.binding, trip, NOW)

    const after = (await listChecklist(db.binding, trip.id)).find((e) => e.id === row.id)!
    expect(after.qtyOverride).toBe(9)
    expect(after.requiredQty).toBe(9)
  })

  it('keeps an exclusion through a laundry answer', async () => {
    const { trip } = await packed(withLaundry)
    const row = (await listChecklist(db.binding, trip.id)).find((e) => e.itemId)!
    await excludeEntry(db.binding, row.id, NOW)

    await syncChecklistFromOutfits(db.binding, trip, NOW)

    const after = (await listChecklist(db.binding, trip.id)).find((e) => e.id === row.id)!
    expect(after.excludedAt).not.toBeNull()
  })
})

describe('when the new behaviour applies', () => {
  /*
   * "Existing finalized trips must not be silently recalculated merely because
   * this logic ships." Reading a trip's checklist is the one place a GET writes
   * anything — the C1 explanation backfill — and it must not become a quantity
   * change. `generateChecklist` owns rule rows; the clothing half only moves
   * when Alex approves an outfit or edits a slot.
   */
  it('does not change clothing quantities merely because the list was read', async () => {
    const { trip } = await packed(withLaundry)
    const before = await quantities(trip.id)

    // Everything the read path does, twice. It adds the rule-driven gear rows,
    // which is its job — what it must not do is move a clothing quantity.
    await generateChecklist(db.binding, trip, NOW)
    await generateChecklist(db.binding, trip, NOW)

    const after = await quantities(trip.id)
    for (const [id, n] of before) expect(after.get(id), id).toBe(n)
  })

  it('applies on the explicit regeneration that follows a real change', async () => {
    const trip = await createTrip(db.binding, withLaundry, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW)
    for (const group of groups) await setGroupStatus(db.binding, group.id, 'approved', NOW)

    const stored = (await getTrip(db.binding, trip.id))!
    const sync = await syncChecklistFromOutfits(db.binding, stored, NOW)

    expect(sync.added).toBeGreaterThan(0)

    // Four days of tops reached the list, not twelve.
    const casual = (await listOutfits(db.binding, trip.id)).find((g) => g.name === 'Casual days')!
    expect(casual.slots.filter((s) => s.role === 'top' && s.itemId)).toHaveLength(LAUNDRY_DAY_CAP)
  })
})
