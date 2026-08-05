import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import {
  BAG_LABELS,
  BAG_MEANING,
  BAG_ORDER,
  bagFor,
  filterChecklist,
  recommendBag,
  rowSecondaryParts,
} from '@shared/checklist'
import type { ChecklistEntry } from '@shared/checklist'
import {
  addTripOnlyItem,
  excludeEntry,
  generateChecklist,
  listChecklist,
  restoreEntry,
  setBag,
  setPackedQty,
  setQtyOverride,
  setTiming,
} from '../../worker/repos/checklist'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { generateOutfits, setGroupStatus, syncChecklistFromOutfits } from '../../worker/repos/outfits'
import { createTestDatabase, insertItem, insertRule, type TestDatabase } from './d1'
import { TRIP, seedWardrobe } from './wardrobe'

/**
 * Which bag each thing goes in (doc 09 §11).
 *
 * Two claims are load-bearing and everything here is one of them:
 *
 *   1. **A choice Alex made survives everything.** Packing, unpacking, a
 *      quantity edit, Day-of, an outfit resync, a regeneration, an exclusion and
 *      the undo of one. A bag assignment that quietly evaporates is worse than
 *      no bag assignment, because he will have stopped checking by then.
 *   2. **A recommendation is never a rule.** It is computed on read, never
 *      stored, always overridable, and it says why.
 */

const NOW = 1_780_000_000
let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
  seedWardrobe(db)
})

afterEach(() => {
  db.close()
})

async function listed(input: TripInput = TRIP) {
  const trip = await createTrip(db.binding, input, NOW)
  const stored = (await getTrip(db.binding, trip.id))!
  await generateChecklist(db.binding, stored, NOW)
  return { trip: stored, entries: await listChecklist(db.binding, trip.id) }
}

const reload = async (tripId: string, id: string) =>
  (await listChecklist(db.binding, tripId)).find((e) => e.id === id)!

describe('assigning a bag', () => {
  it('takes each of the five, and reassigns', async () => {
    const { trip, entries } = await listed()
    const row = entries[0]!

    for (const key of BAG_ORDER) {
      await setBag(db.binding, row.id, key, NOW)
      const after = await reload(trip.id, row.id)
      expect(after.bag, key).toBe(key)
      expect(after.bagSource, key).toBe('user')
    }
  })

  it('hands the row back to the suggestion when the choice is cleared', async () => {
    const { trip, entries } = await listed()
    const row = entries.find((e) => e.category === 'Documents' || e.isCritical) ?? entries[0]!

    await setBag(db.binding, row.id, 'checked', NOW)
    expect((await reload(trip.id, row.id)).bagSource).toBe('user')

    await setBag(db.binding, row.id, null, NOW)
    const cleared = await reload(trip.id, row.id)
    expect(cleared.bag).toBeNull()
    expect(cleared.bagSource).toBeNull()
  })

  /*
   * On the row, so the answer is visible without opening anything — but only
   * Alex's OWN choice. A recommendation beside half the list says nothing.
   */
  it('shows a chosen bag on the row, and a suggested one nowhere', async () => {
    const { trip, entries } = await listed()
    const ordinary = entries.find((e) => recommendBag(e) === null)!
    await setBag(db.binding, ordinary.id, 'checked', NOW)

    expect(rowSecondaryParts(await reload(trip.id, ordinary.id))).toContain('Checked')

    const suggested = entries.find((e) => recommendBag(e) !== null)
    if (suggested) {
      expect(rowSecondaryParts(await reload(trip.id, suggested.id)).join(' ')).not.toMatch(
        /Personal bag/,
      )
    }
  })

  it('never creates a second row for the same item', async () => {
    const { trip, entries } = await listed()
    const row = entries[0]!
    const before = (await listChecklist(db.binding, trip.id)).length

    await setBag(db.binding, row.id, 'carry_on', NOW)
    await setBag(db.binding, row.id, 'checked', NOW)

    expect((await listChecklist(db.binding, trip.id)).length).toBe(before)
  })
})

describe('a recommendation is not a rule', () => {
  const entry = (over: Partial<ChecklistEntry>): ChecklistEntry =>
    ({
      id: 'x', tripId: 't', itemId: 'i', name: 'Thing', category: 'Travel Gear',
      requiredQty: 1, qtyBreakdown: null, qtyOverride: null, packedQty: 0,
      packingTiming: 'anytime', requiresFinalCheck: false, finalCheckedAt: null,
      excludedAt: null, source: 'always_packed', reason: null, isCritical: false,
      tripOnly: false, sortOrder: 0, bag: null, bagSource: null, ...over,
    }) as ChecklistEntry

  it('keeps documents, medication, vision and electronics within reach', async () => {
    for (const category of ['Documents', 'Medication', 'Vision', 'Electronics']) {
      const suggestion = recommendBag(entry({ category }))
      expect(suggestion?.bag, category).toBe('personal_item')
      // And it says why, because a recommendation that cannot explain itself is
      // indistinguishable from a rule.
      expect(suggestion?.why, category).toBeTruthy()
    }
  })

  /*
   * Read from the recorded category, never from a name. These two differ only in
   * how the workbook classified them.
   */
  it('never infers importance from a name', () => {
    expect(recommendBag(entry({ name: 'Passport Holder', category: 'Travel Gear' }))).toBeNull()
    expect(recommendBag(entry({ name: 'Rolex', category: 'Travel Gear' }))).toBeNull()
    expect(recommendBag(entry({ name: 'Anonymous', category: 'Documents' }))?.bag).toBe(
      'personal_item',
    )
  })

  it('says nothing at all about an ordinary thing', () => {
    expect(recommendBag(entry({ category: 'Travel Gear' }))).toBeNull()
    expect(bagFor(entry({ category: 'Travel Gear' }))).toEqual({
      bag: null,
      source: null,
      why: null,
    })
  })

  it('lets Alex overrule it, and stops calling it a suggestion', () => {
    const overruled = entry({ category: 'Documents', bag: 'checked', bagSource: 'user' })
    expect(bagFor(overruled)).toEqual({ bag: 'checked', source: 'user', why: null })
  })

  it('is computed rather than stored, so no row carries an unmade decision', async () => {
    const { trip } = await listed()
    const stored = (await listChecklist(db.binding, trip.id)).filter((e) => e.bag !== null)
    expect(stored).toEqual([])

    /*
     * And yet the medication still reads as belonging in the personal bag.
     *
     * Asserted non-empty first. The seeded wardrobe carries no Documents row, so
     * the version of this that looped over documents proved nothing at all — it
     * passed with `recommendBag` returning null for everything.
     */
    const reachable = (await listChecklist(db.binding, trip.id)).filter(
      (e) => e.category === 'Medication',
    )
    expect(reachable.length).toBeGreaterThan(0)
    for (const row of reachable) {
      expect(bagFor(row).bag, row.name).toBe('personal_item')
      expect(bagFor(row).source, row.name).toBe('recommended')
    }
  })
})

describe('a choice Alex made survives', () => {
  async function chosen() {
    const { trip, entries } = await listed()
    const row = entries[0]!
    await setBag(db.binding, row.id, 'checked', NOW)
    return { trip, id: row.id }
  }

  const stillChecked = async (tripId: string, id: string) => {
    const after = await reload(tripId, id)
    expect(after.bag).toBe('checked')
    expect(after.bagSource).toBe('user')
  }

  it('packing it, and unpacking it again', async () => {
    const { trip, id } = await chosen()
    await setPackedQty(db.binding, id, 1, NOW)
    await stillChecked(trip.id, id)
    await setPackedQty(db.binding, id, 0, NOW)
    await stillChecked(trip.id, id)
  })

  it('moving it to Pack day of, and back', async () => {
    const { trip, id } = await chosen()
    await setTiming(db.binding, id, 'day_of', NOW)
    await stillChecked(trip.id, id)
    await setTiming(db.binding, id, 'anytime', NOW)
    await stillChecked(trip.id, id)
  })

  it('a hand-set quantity', async () => {
    const { trip, id } = await chosen()
    await setQtyOverride(db.binding, id, 7, NOW)
    await stillChecked(trip.id, id)
  })

  it('a checklist regeneration', async () => {
    const { trip, id } = await chosen()
    await generateChecklist(db.binding, trip, NOW)
    await generateChecklist(db.binding, trip, NOW)
    await stillChecked(trip.id, id)
  })

  it('being set aside and put back', async () => {
    const { trip, id } = await chosen()
    await excludeEntry(db.binding, id, NOW)
    await stillChecked(trip.id, id)
    await restoreEntry(db.binding, id, NOW)
    await stillChecked(trip.id, id)
  })

  /*
   * The outfit writer rewrites the clothing half of the list on every approval.
   * A bag assignment on a garment has to come through that untouched, or it
   * disappears the first time Alex approves an outfit after choosing one.
   */
  it('an outfit synchronisation', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW)
    for (const group of groups) await setGroupStatus(db.binding, group.id, 'approved', NOW)
    const stored = (await getTrip(db.binding, trip.id))!
    await syncChecklistFromOutfits(db.binding, stored, NOW)

    const garment = (await listChecklist(db.binding, trip.id)).find(
      (e) => e.source === 'outfit_generated',
    )!
    await setBag(db.binding, garment.id, 'carry_on', NOW)

    await syncChecklistFromOutfits(db.binding, stored, NOW)
    await syncChecklistFromOutfits(db.binding, stored, NOW)

    const after = await reload(trip.id, garment.id)
    expect(after.bag).toBe('carry_on')
    expect(after.bagSource).toBe('user')
  })

  it('and it survives on an item Alex added by hand', async () => {
    const { trip } = await listed()
    const own = (await addTripOnlyItem(db.binding, trip.id, 'Snorkel', 'Travel Gear', 1, NOW))!
    await setBag(db.binding, own.id, 'checked', NOW)

    await generateChecklist(db.binding, trip, NOW)
    await stillChecked(trip.id, own.id)
  })
})

describe('a new trip starts unassigned', () => {
  /*
   * Where a passport lives is a fact about a journey, not about the passport.
   * Nothing approved asks for reusable bag defaults, so a copied trip must not
   * inherit last trip's answers — the duplicate route already carries no packed
   * state, no outfits and no forecast, and this belongs in the same list.
   */
  it('does not inherit a bag from another trip', async () => {
    const first = await listed()
    for (const row of first.entries) await setBag(db.binding, row.id, 'checked', NOW)

    const second = await listed({ ...TRIP, name: 'Another trip' })
    expect(second.entries.filter((e) => e.bag !== null)).toEqual([])
  })

  it('writes no default onto the wardrobe item', async () => {
    const { entries } = await listed()
    await setBag(db.binding, entries[0]!.id, 'checked', NOW)

    const columns = db.raw.prepare('PRAGMA table_info(item)').all() as Array<{ name: string }>
    expect(columns.map((c) => c.name)).not.toContain('bag')
  })
})

describe('filtering by bag', () => {
  async function withBags() {
    const shirt = insertItem(db, { displayName: 'Linen Shirt', category: 'Tops & Outerwear' })
    insertRule(db, shirt, { ruleType: 'fixed_per_trip', quantityValue: 1 })
    const { trip, entries } = await listed()

    const byName = new Map(entries.map((e) => [e.name, e]))
    await setBag(db.binding, byName.get('Linen Shirt')!.id, 'checked', NOW)
    return { trip, entries: await listChecklist(db.binding, trip.id) }
  }

  it('shows what is in that bag, chosen or suggested', async () => {
    const { entries } = await withBags()

    const checked = filterChecklist(entries, 'bag_checked')
    expect(checked.map((e) => e.name)).toContain('Linen Shirt')

    // The suggestion counts too, or the filter would be empty for everything
    // Alex has not personally assigned — which is most of the list.
    const personal = filterChecklist(entries, 'bag_personal_item')
    expect(personal.length).toBeGreaterThan(0)
    for (const row of personal) expect(bagFor(row).bag).not.toBe('checked')
  })

  /*
   * "Either" means the answer is yes for either cabin bag, so it appears under
   * both rather than under neither.
   */
  it('puts an Either-bag item under both cabin bags and neither hold', async () => {
    const { trip, entries } = await withBags()
    const row = entries.find((e) => e.name === 'Linen Shirt')!
    await setBag(db.binding, row.id, 'either', NOW)

    const now = await listChecklist(db.binding, trip.id)
    const names = (f: Parameters<typeof filterChecklist>[1]) =>
      filterChecklist(now, f).map((e) => e.name)

    expect(names('bag_carry_on')).toContain('Linen Shirt')
    expect(names('bag_personal_item')).toContain('Linen Shirt')
    expect(names('bag_checked')).not.toContain('Linen Shirt')
  })

  /*
   * `Either` is a DECISION, and an unassigned row is the absence of one. They
   * look alike on a list — neither names a physical bag — so the difference has
   * to be real in the data and visible on the row.
   */
  it('is not the same thing as unassigned', async () => {
    const { trip, entries } = await withBags()
    const row = entries.find((e) => e.name === 'Linen Shirt')!
    await setBag(db.binding, row.id, 'either', NOW)

    const chosen = await reload(trip.id, row.id)
    expect(chosen.bag).toBe('either')
    expect(chosen.bagSource).toBe('user')
    expect(bagFor(chosen).source).toBe('user')
    expect(rowSecondaryParts(chosen)).toContain('Either cabin bag')

    await setBag(db.binding, row.id, null, NOW)
    const unassigned = await reload(trip.id, row.id)
    expect(unassigned.bag).toBeNull()
    expect(rowSecondaryParts(unassigned)).not.toContain('Either cabin bag')

    // And unassigned appears under no bag filter at all, where Either appears
    // under two.
    const now = await listChecklist(db.binding, trip.id)
    for (const filter of ['bag_carry_on', 'bag_personal_item', 'bag_checked'] as const) {
      expect(filterChecklist(now, filter).map((e) => e.name), filter).not.toContain('Linen Shirt')
    }
  })

  it('says which two bags it means, rather than leaving the word to carry it', () => {
    expect(BAG_LABELS.either).toBe('Either cabin bag')
    expect(BAG_MEANING.either).toMatch(/personal bag/i)
    expect(BAG_MEANING.either).toMatch(/carry-on/i)
    // And the four that name a real place need no gloss.
    for (const key of BAG_ORDER.filter((k) => k !== 'either')) {
      expect(BAG_MEANING[key], key).toBeUndefined()
    }
  })

  it('never shows something set aside', async () => {
    const { trip, entries } = await withBags()
    const row = entries.find((e) => e.name === 'Linen Shirt')!
    await excludeEntry(db.binding, row.id, NOW)

    const now = await listChecklist(db.binding, trip.id)
    expect(filterChecklist(now, 'bag_checked').map((e) => e.name)).not.toContain('Linen Shirt')
  })
})
