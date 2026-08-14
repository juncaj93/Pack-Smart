import { describe, expect, it } from 'vitest'
import { CHECKLIST_FILTERS, filterChecklist, sectionStage } from '@shared/checklist'
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
    detail: null, brand: null, color: null,
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

/**
 * Which stage of packing Alex is actually on (P4b).
 *
 * The packing screen has to answer *what do I physically pack next*, and before
 * the day he leaves that is `Pack now` alone: `Pack later` is by definition the
 * things still in use until the morning, and `Final check` is an act performed
 * at the door. Both become the work on the same day, and they become it through
 * `isDepartureImminent` rather than through a second opinion about when the
 * morning begins.
 *
 * Nothing here is stored and no vocabulary is added — `packing_timing` is still
 * `anytime` or `day_of` and `sectionFor` still derives the four sections. This
 * says only which of them is today's work.
 */
describe('which stage is the work right now', () => {
  const before = { departureImminent: false }
  const leaving = { departureImminent: true }

  it('is Pack now, on every day of the trip’s life', () => {
    expect(sectionStage('pack_now', before)).toBe('now')
    expect(sectionStage('pack_now', leaving)).toBe('now')
  })

  it('waits for the morning before offering Pack later and Final check', () => {
    expect(sectionStage('pack_later', before)).toBe('later')
    expect(sectionStage('final_check', before)).toBe('later')
  })

  it('opens both of them once departure is imminent', () => {
    expect(sectionStage('pack_later', leaving)).toBe('now')
    expect(sectionStage('final_check', leaving)).toBe('now')
  })

  /* A shelf is never work, on any day. It is where things go when Alex has
     decided against them, and the only way to take one back. */
  it('never makes Not bringing the work', () => {
    expect(sectionStage('not_bringing', before)).toBe('shelf')
    expect(sectionStage('not_bringing', leaving)).toBe('shelf')
  })
})
