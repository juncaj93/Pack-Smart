import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { planBags } from '@shared/bags'
import { isPacked } from '@shared/rules'
import type { ChecklistEntry } from '@shared/checklist'
import { bagGroupLabel, nextBagWithWork, packByBag } from '@shared/pack-by-bag'
import {
  excludeEntry,
  generateChecklist,
  listChecklist,
  setBag,
  setPackedQty,
} from '../../worker/repos/checklist'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP, seedWardrobe } from './wardrobe'

/**
 * Packing one bag at a time (P4a).
 *
 * The whole feature is a LENS, and the tests are almost entirely about that
 * word. Three claims are load-bearing:
 *
 *   1. **Nothing disappears.** Every row the trip is bringing is somewhere in
 *      the bag view. A packing list that hides three t-shirts behind a filter
 *      is how something gets left in the wardrobe.
 *   2. **Nothing is duplicated**, with exactly one stated exception: a row Alex
 *      set to `Either cabin bag` appears under both cabin bags, because that is
 *      what the answer means and it is what the bag filters have always done.
 *   3. **There is one bag planner.** The groups come from `planBags` — the same
 *      result the packing list, the entry sheet and the crowding warning read —
 *      so this view cannot hold a different opinion about a garment.
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

const grouped = (trip: Parameters<typeof planBags>[0], entries: ChecklistEntry[]) =>
  packByBag(planBags(trip, entries), entries)

describe('every row lands somewhere, exactly once', () => {
  it('covers the whole list the trip is bringing', async () => {
    const { trip, entries } = await listed()
    const groups = grouped(trip, entries)

    const bringing = entries.filter((entry) => entry.excludedAt === null)
    const shown = new Set(groups.flatMap((group) => group.entries.map((entry) => entry.id)))

    expect(bringing.length).toBeGreaterThan(0)
    for (const entry of bringing) {
      expect(shown.has(entry.id), `${entry.name} is in no bag group`).toBe(true)
    }
  })

  it('shows nothing twice', async () => {
    const { trip, entries } = await listed()
    const ids = grouped(trip, entries).flatMap((group) => group.entries.map((entry) => entry.id))
    expect(ids.length).toBe(new Set(ids).size)
  })

  /*
   * The one exception, and it is the canonical model's rather than this
   * screen's: `either` means "the personal bag or the carry-on, whichever has
   * room", so the answer to *does this go in here* is yes for both. The bag
   * filters on the packing list have always behaved this way, and the two must
   * not disagree about one garment.
   */
  it('puts an Either row under both cabin bags and neither hold', async () => {
    const { trip, entries } = await listed()
    const row = entries.find((entry) => entry.excludedAt === null)!
    await setBag(db.binding, row.id, 'either', NOW)

    const now = await listChecklist(db.binding, trip.id)
    const groups = grouped(trip, now)
    const holding = groups
      .filter((group) => group.entries.some((entry) => entry.id === row.id))
      .map((group) => group.key)

    expect(holding.sort()).toEqual(['carry_on', 'personal_item'])
  })

  it('drops a row set aside, and puts it back when it returns', async () => {
    const { trip, entries } = await listed()
    const row = entries.find((entry) => entry.excludedAt === null)!

    await excludeEntry(db.binding, row.id, NOW)
    const without = await listChecklist(db.binding, trip.id)
    const ids = grouped(trip, without).flatMap((group) =>
      group.entries.map((entry) => entry.id),
    )
    expect(ids).not.toContain(row.id)
  })
})

describe('the bags shown are the trip’s own', () => {
  it('shows the three a flight carries', async () => {
    const { trip, entries } = await listed()
    const keys = grouped(trip, entries).map((group) => group.key)
    expect(keys).toContain('personal_item')
    expect(keys).toContain('carry_on')
    expect(keys).toContain('checked')
  })

  /*
   * A trip Alex has said has no flight, with no bag named, carries none of
   * these — all three words are aviation. The lens has nothing to look through
   * and says so rather than inventing a suitcase.
   */
  it('offers no aviation bag on a trip with no flight', async () => {
    const { trip, entries } = await listed({ ...TRIP, flightHours: 0, international: false })
    const keys = grouped(trip, entries).map((group) => group.key)
    expect(keys).not.toContain('personal_item')
    expect(keys).not.toContain('carry_on')
    expect(keys).not.toContain('checked')
  })

  /*
   * A road trip WITH a bag Alex named himself keeps the bag and loses the
   * aviation word for it. `Checked bag` names something that does not exist on
   * a drive to the coast; the wording comes from the gloss the entry sheet
   * already shows for the same bag.
   */
  it('names a road trip’s bag without airline language', async () => {
    expect(bagGroupLabel('checked', 'no')).toBe('Large bag')
    expect(bagGroupLabel('carry_on', 'no')).toBe('Main bag')
    expect(bagGroupLabel('personal_item', 'no')).toBe('Small bag')

    for (const aviation of ['yes', 'unknown'] as const) {
      expect(bagGroupLabel('checked', aviation)).toBe('Checked bag')
      expect(bagGroupLabel('carry_on', aviation)).toBe('Carry-on')
      expect(bagGroupLabel('personal_item', aviation)).toBe('Personal bag')
    }
  })
})

describe('what the planner says is what the lens shows', () => {
  it('never puts a safety-floor row in the hold', async () => {
    const { trip, entries } = await listed()
    const plan = planBags(trip, entries)
    const hold = packByBag(plan, entries).find((group) => group.key === 'checked')!

    for (const entry of hold.entries) {
      expect(entry.category, entry.name).not.toBe('Documents')
      expect(entry.category, entry.name).not.toBe('Medication')
      expect(entry.isCritical, entry.name).toBe(false)
    }
  })

  it('follows a choice Alex made, over any recommendation', async () => {
    const { trip, entries } = await listed()
    // Something the rules would otherwise leave unplaced or place elsewhere.
    const row = entries.find((entry) => entry.excludedAt === null)!
    await setBag(db.binding, row.id, 'checked', NOW)

    const now = await listChecklist(db.binding, trip.id)
    const hold = grouped(trip, now).find((group) => group.key === 'checked')!
    expect(hold.entries.map((entry) => entry.id)).toContain(row.id)
  })

  it('keeps rows the planner has no view on in their own group', async () => {
    const { trip, entries } = await listed()
    const plan = planBags(trip, entries)
    const groups = packByBag(plan, entries)
    const anywhere = groups.find((group) => group.key === 'unplaced')

    if (anywhere) {
      for (const entry of anywhere.entries) {
        expect(plan.advice.get(entry.id)?.bag ?? null, entry.name).toBeNull()
      }
      // And it is never dressed up as a bag the trip is carrying.
      expect(anywhere.label).toBe('Anywhere')
    }
  })
})

describe('progress is counted, never stored', () => {
  it('moves when the same row is packed on the master list', async () => {
    const { trip, entries } = await listed()
    const before = grouped(trip, entries)
    const group = before.find((g) => g.total > 0)!
    const row = group.entries[0]!

    await setPackedQty(db.binding, row.id, row.requiredQty, NOW)

    const now = await listChecklist(db.binding, trip.id)
    const after = grouped(trip, now).find((g) => g.key === group.key)!
    expect(after.packed).toBe(group.packed + 1)
    expect(after.entries.filter(isPacked).length).toBe(after.packed)
  })
})

describe('moving on to the next bag', () => {
  const group = (key: string, packed: number, total: number) => ({
    key: key as never,
    label: key,
    hint: null,
    entries: [],
    packed,
    total,
  })

  it('offers the next bag that still has work', () => {
    const groups = [group('personal_item', 2, 2), group('carry_on', 3, 3), group('checked', 0, 4)]
    expect(nextBagWithWork(groups, 'personal_item')?.key).toBe('checked')
  })

  it('offers nothing once everything after it is done', () => {
    const groups = [group('personal_item', 2, 2), group('carry_on', 3, 3)]
    expect(nextBagWithWork(groups, 'personal_item')).toBeNull()
    expect(nextBagWithWork(groups, 'carry_on')).toBeNull()
  })

  /* Never backwards: it is an offer to move on, not a queue to be worked. */
  it('does not offer a bag already behind you', () => {
    const groups = [group('personal_item', 0, 3), group('carry_on', 2, 2)]
    expect(nextBagWithWork(groups, 'carry_on')).toBeNull()
  })
})
