import { describe, expect, it } from 'vitest'
import { CHECKLIST_FILTERS, filterChecklist } from '@shared/checklist'
import type { ChecklistEntry } from '@shared/checklist'

/**
 * The cuts across a packing list.
 *
 * The property that matters most here is the one about **Not Bringing**. Those
 * rows are not unpacked — they are not coming — and every filter except
 * `Everything` has to drop them. Counting them as "still to pack" would leave the
 * one number Alex reads under pressure permanently wrong by however many things
 * he deliberately left behind, and it would be wrong in the direction that makes
 * him keep looking for things that are not missing.
 */

function entry(overrides: Partial<ChecklistEntry> & { id: string }): ChecklistEntry {
  return {
    tripId: 'trip',
    itemId: 'item',
    name: 'Thing',
    category: 'Travel Gear',
    requiredQty: 1,
    qtyBreakdown: null,
    qtyOverride: null,
    packedQty: 0,
    packingTiming: 'anytime',
    requiresFinalCheck: false,
    finalCheckedAt: null,
    excludedAt: null,
    source: 'rule',
    reason: null,
    isCritical: false,
    tripOnly: false,
    sortOrder: 0,
    bag: null,
    bagSource: null,
    updatedAt: 0,
    ...overrides,
  }
}

const packed = entry({ id: 'packed', name: 'Packed', packedQty: 1 })
const unpacked = entry({ id: 'unpacked', name: 'Unpacked' })
const dayOf = entry({ id: 'day-of', name: 'Bite guard', packingTiming: 'day_of' })
const essential = entry({ id: 'essential', name: 'Passport', isCritical: true })
const notBringing = entry({ id: 'left', name: 'Left behind', excludedAt: 1 })

const ALL = [packed, unpacked, dayOf, essential, notBringing]
const names = (rows: ChecklistEntry[]) => rows.map((row) => row.name).sort()

describe('what each filter shows', () => {
  it('shows the whole list, Not Bringing included, under Everything', () => {
    // The only view where a row Alex put aside is still visible — it is the only
    // way to put one back.
    expect(filterChecklist(ALL, 'all')).toEqual(ALL)
  })

  it('shows only what is left to pack', () => {
    expect(names(filterChecklist(ALL, 'unpacked'))).toEqual(['Bite guard', 'Passport', 'Unpacked'])
  })

  /**
   * `Packed`, `Pack day of` and `Essentials` were retired in G4, and each one
   * had somewhere better to be answered (doc 09 §4).
   *
   * This asserts they are gone from the CONTROL rather than that they behave —
   * the behaviour test would be a test of a filter nobody can choose. What
   * replaced each of them is asserted where it lives: the packed rows sinking is
   * `checklist-order.test.ts`, the Pack later section is `packing-timing.test.ts`,
   * and the essentials band is `orderRank`.
   */
  it('no longer offers a cut the list already makes for itself', () => {
    const keys = CHECKLIST_FILTERS.map((option) => option.key)
    for (const retired of ['packed', 'day_of', 'essentials', 'bag_wear']) {
      expect(keys, retired).not.toContain(retired)
    }
  })
})

describe('a row you are not bringing is not a row you have not packed', () => {
  it.each(['unpacked', 'bag_personal_item', 'bag_carry_on', 'bag_checked'] as const)(
    'is dropped by %s',
    (filter) => {
      expect(names(filterChecklist(ALL, filter))).not.toContain('Left behind')
    },
  )

  it('is dropped even when it would otherwise match', () => {
    /*
     * The case a naive implementation gets wrong: an essential Alex has decided
     * not to take still carries `isCritical`, so it still attracts the personal
     * bag recommendation — and a bag filter that only read the resolved bag
     * would list it as though it were coming.
     */
    const excludedEssential = entry({
      id: 'x',
      name: 'Ski goggles',
      isCritical: true,
      excludedAt: 1,
    })
    expect(filterChecklist([excludedEssential], 'bag_personal_item')).toEqual([])
    expect(filterChecklist([excludedEssential], 'unpacked')).toEqual([])
  })
})

describe('the control itself', () => {
  /*
   * Five, and exactly the five Alex named (doc 09 §6a, G4).
   *
   * Doc 02 §2 keeps uncommon controls out of the way, and a filter list long
   * enough to scroll is a second list to search. Two about what is left, three
   * about the bag in front of him.
   *
   * `Either cabin bag` deliberately has no filter of its own. A thing that does
   * not care which cabin bag it is in is not a bag you are standing over — it
   * shows up under both of them instead.
   */
  it('offers exactly the five, in the order they were asked for', () => {
    expect(CHECKLIST_FILTERS.map((option) => option.label)).toEqual([
      'Everything',
      'Still to pack',
      'Personal bag',
      'Carry-on',
      'Checked bag',
    ])
  })

  it('starts with the unfiltered view', () => {
    expect(CHECKLIST_FILTERS[0]?.key).toBe('all')
  })

  it('says what it shows in words, not in field names', () => {
    for (const option of CHECKLIST_FILTERS) {
      expect(option.label).not.toMatch(/[a-z][A-Z]|_/)
    }
  })
})
