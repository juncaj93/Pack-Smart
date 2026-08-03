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

  it('shows only what is in the bag', () => {
    expect(names(filterChecklist(ALL, 'packed'))).toEqual(['Packed'])
  })

  it('shows what waits for the morning', () => {
    expect(names(filterChecklist(ALL, 'day_of'))).toEqual(['Bite guard'])
  })

  it('shows the things it would be bad to forget', () => {
    expect(names(filterChecklist(ALL, 'essentials'))).toEqual(['Passport'])
  })
})

describe('a row you are not bringing is not a row you have not packed', () => {
  it.each(['unpacked', 'packed', 'day_of', 'essentials'] as const)(
    'is dropped by %s',
    (filter) => {
      expect(names(filterChecklist(ALL, filter))).not.toContain('Left behind')
    },
  )

  it('is dropped even when it would otherwise match', () => {
    /*
     * The case a naive implementation gets wrong: an essential that Alex has
     * decided not to take still carries `isCritical`, and a filter that only
     * checked that flag would list it under Essentials as though it were
     * outstanding.
     */
    const excludedEssential = entry({
      id: 'x',
      name: 'Ski goggles',
      isCritical: true,
      excludedAt: 1,
    })
    expect(filterChecklist([excludedEssential], 'essentials')).toEqual([])
    expect(filterChecklist([excludedEssential], 'unpacked')).toEqual([])
  })
})

describe('the filter agrees with the sections', () => {
  it('means by "Pack day of" exactly what the Pack later section means', () => {
    /*
     * `last_minute` is the retired spelling of `day_of` and still sits in rows
     * written before the rename. `sectionFor` has always understood it; a filter
     * that tested `packingTiming === 'day_of'` directly would silently omit those
     * rows from the one view that exists for departure morning.
     */
    const legacy = entry({ id: 'legacy', name: 'Toothbrush', packingTiming: 'last_minute' })
    expect(names(filterChecklist([legacy, dayOf, unpacked], 'day_of'))).toEqual([
      'Bite guard',
      'Toothbrush',
    ])
  })
})

describe('the control itself', () => {
  /*
   * Five about packing state, and one per bag Alex can stand over.
   *
   * Doc 02 §2 keeps uncommon controls out of the way, and a filter list long
   * enough to scroll is a second list to search — so this counts, and the count
   * is justified rather than raised. The bag filters are what makes assignment
   * worth having: packing one physical bag means seeing only what goes in it,
   * and doc 09 §9 admits them precisely once bag assignment exists.
   *
   * `Either bag` deliberately has no filter. A thing that does not care which
   * cabin bag it is in is not a bag you are standing over — it shows up under
   * both of them instead.
   */
  it('offers the five packing states, plus one filter per real bag', () => {
    expect(CHECKLIST_FILTERS.filter((f) => !f.key.startsWith('bag_'))).toHaveLength(5)
    expect(CHECKLIST_FILTERS.filter((f) => f.key.startsWith('bag_'))).toHaveLength(4)
    expect(CHECKLIST_FILTERS.map((f) => f.key)).not.toContain('bag_either')
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
