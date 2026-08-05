import { describe, expect, it } from 'vitest'
import type { ChecklistEntry } from '@shared/checklist'
import { CATEGORY_ORDER, applyOrder, categoryRank, orderRank, orderSection } from '@shared/checklist'

/**
 * Completed items move to the bottom (doc 09 §4.2).
 *
 * The arithmetic half. What order a section is in is a pure function of its
 * rows, and it is tested here rather than through a screen because the
 * interesting cases — a run of rapid completions, an Undo, a row that appears
 * mid-session — are about the ORDER, and a DOM test would prove the rendering
 * and take the ordering on trust.
 *
 * The settle half — that the order does not move while Alex's thumb is on a row
 * — is `tests/unit/dom/PackingList.test.tsx`, because that one genuinely is
 * about timing in a component.
 */

let counter = 0

function entry(over: Partial<ChecklistEntry> = {}): ChecklistEntry {
  counter += 1
  return {
    id: `e${counter}`,
    tripId: 't1',
    itemId: `i${counter}`,
    name: `Item ${counter}`,
    category: 'Travel Gear',
    requiredQty: 1,
    qtyBreakdown: null,
    qtyOverride: null,
    packedQty: 0,
    packingTiming: 'anytime',
    requiresFinalCheck: false,
    finalCheckedAt: null,
    excludedAt: null,
    source: 'always_packed',
    reason: null,
    isCritical: false,
    tripOnly: false,
    // Unassigned, which is what every row was before migration 0014 and what a
    // new one still is. Present rather than omitted: `Partial` widens an absent
    // key to `| undefined`, so leaving them out made the fixture's type a
    // fraction looser than a real entry ever is.
    bag: null,
    bagSource: null,
    updatedAt: 0,
    sortOrder: counter,
    ...over,
  }
}

const packed = (over: Partial<ChecklistEntry> = {}) =>
  entry({ requiredQty: 1, packedQty: 1, ...over })

const names = (entries: ChecklistEntry[]) => entries.map((e) => e.name)

describe('where a row belongs', () => {
  it('puts an unpacked essential above an ordinary unpacked one', () => {
    expect(orderRank(entry({ isCritical: true }))).toBeLessThan(orderRank(entry()))
  })

  it('puts what is left for the day below tonight’s work', () => {
    expect(orderRank(entry())).toBeLessThan(orderRank(entry({ packingTiming: 'day_of' })))
  })

  it('puts anything packed at the bottom, essential or not', () => {
    expect(orderRank(packed({ isCritical: true }))).toBeGreaterThan(
      orderRank(entry({ packingTiming: 'day_of' })),
    )
  })

  /*
   * A packed essential is not an outstanding essential. Ranking it high because
   * of the flag would keep the passport pinned to the top of the list all
   * evening after it went in the bag, which is the opposite of what the section
   * is for.
   */
  it('does not keep an essential at the top once it is in the bag', () => {
    expect(orderRank(packed({ isCritical: true }))).toBe(orderRank(packed()))
  })
})

describe('ordering a section', () => {
  it('reads unpacked essentials, then the rest, then day-of, then packed', () => {
    const rows = [
      packed({ name: 'Packed thing' }),
      entry({ name: 'Day of thing', packingTiming: 'day_of' }),
      entry({ name: 'Ordinary thing' }),
      entry({ name: 'Passport', isCritical: true }),
    ]

    expect(names(orderSection(rows))).toEqual([
      'Passport',
      'Ordinary thing',
      'Day of thing',
      'Packed thing',
    ])
  })

  /*
   * Stable within a band, which is what stops checking one thing reshuffling
   * everything around it. A sort that is merely "correct" can still be
   * disorienting.
   */
  it('leaves rows of equal standing exactly where they were', () => {
    const rows = [entry({ name: 'C' }), entry({ name: 'A' }), entry({ name: 'B' })]
    expect(names(orderSection(rows))).toEqual(['C', 'A', 'B'])
  })

  it('moves one row and nothing else when it is packed', () => {
    const rows = [entry({ name: 'A' }), entry({ name: 'B' }), entry({ name: 'C' })]
    const after = rows.map((row) => (row.name === 'A' ? { ...row, packedQty: 1 } : row))

    expect(names(orderSection(after))).toEqual(['B', 'C', 'A'])
  })

  it('brings a row back to its unpacked place when the packing is undone', () => {
    const rows = [entry({ name: 'A' }), entry({ name: 'B' }), entry({ name: 'C' })]
    const done = rows.map((row) => (row.name === 'A' ? { ...row, packedQty: 1 } : row))
    const undone = done.map((row) => (row.name === 'A' ? { ...row, packedQty: 0 } : row))

    // Back among the unpacked, and in its original position within that band —
    // Undo returns the row to where it was, not to wherever the sort felt like.
    expect(names(orderSection(undone))).toEqual(['A', 'B', 'C'])
  })

  it('is not confused by a row that is partly packed', () => {
    const rows = [entry({ name: 'Socks', requiredQty: 4, packedQty: 2 }), entry({ name: 'Tee' })]
    // Two of four is not packed. It is still tonight's work.
    expect(names(orderSection(rows))).toEqual(['Socks', 'Tee'])
  })
})

/**
 * The category order Alex asked for (G4): essentials first, clothing last.
 *
 * Its whole design is where it sits in the sort — **below** `orderRank` and
 * above arrival — so these tests are as much about what it does NOT move as
 * about what it does.
 */
describe('the order the bag fills in', () => {
  it('puts the documents and the pills above the clothes', () => {
    const shirt = entry({ name: 'Linen Shirt', category: 'Tops & Outerwear' })
    const passport = entry({ name: 'Passport', category: 'Documents' })
    const pills = entry({ name: 'Zinc', category: 'Medication' })

    expect(names(orderSection([shirt, pills, passport]))).toEqual([
      'Passport',
      'Zinc',
      'Linen Shirt',
    ])
  })

  it('ends with clothing, whatever order the rows arrived in', () => {
    const rows = CATEGORY_ORDER.map((category) => entry({ name: category, category })).reverse()
    expect(names(orderSection(rows))).toEqual(CATEGORY_ORDER)
  })

  it('reads head to toe within the clothes, not alphabetically', () => {
    // Alphabetical would put `Accessories & Undergarments` first, which is not
    // an order anyone packing a bag would recognise.
    const clothing = [
      'Footwear',
      'Accessories & Undergarments',
      'Bottoms & Swimwear',
      'Tops & Outerwear',
    ].map((category) => entry({ name: category, category }))

    expect(names(orderSection(clothing))).toEqual([
      'Tops & Outerwear',
      'Bottoms & Swimwear',
      'Accessories & Undergarments',
      'Footwear',
    ])
  })

  it('never lifts a packed row over an unpacked one to group it', () => {
    /*
     * The failure a category rank placed too high produces: a packed passport
     * climbing over an unpacked t-shirt because Documents outranks Tops. D2's
     * rule is that finished work sinks, and it outranks everything here.
     */
    const packedPassport = packed({ name: 'Passport', category: 'Documents' })
    const unpackedShirt = entry({ name: 'Linen Shirt', category: 'Tops & Outerwear' })

    expect(names(orderSection([packedPassport, unpackedShirt]))).toEqual([
      'Linen Shirt',
      'Passport',
    ])
  })

  it('never lifts an ordinary row over an essential to group it', () => {
    // Same rule one band up: `orderRank` puts unpacked essentials first, and a
    // category may reorder inside that band but never across it.
    const essentialShirt = entry({
      name: 'Linen Shirt',
      category: 'Tops & Outerwear',
      isCritical: true,
    })
    const ordinaryPassport = entry({ name: 'Passport', category: 'Documents' })

    expect(names(orderSection([ordinaryPassport, essentialShirt]))).toEqual([
      'Linen Shirt',
      'Passport',
    ])
  })

  it('lands an unrecognised category with the gear, and above the clothes', () => {
    const custom = entry({ name: 'Drone', category: 'Something New' })
    const gear = entry({ name: 'Packing Cubes', category: 'Travel Gear' })
    const passport = entry({ name: 'Passport', category: 'Documents' })
    const shirt = entry({ name: 'Linen Shirt', category: 'Tops & Outerwear' })

    expect(categoryRank(custom)).toBe(categoryRank(gear))
    expect(names(orderSection([shirt, custom, passport, gear]))).toEqual([
      'Passport',
      'Drone',
      'Packing Cubes',
      'Linen Shirt',
    ])
  })

  it('keeps two rows of one category in the order they arrived', () => {
    // Stability is the third key, and it is what stops ticking one t-shirt
    // reshuffling the others beside it.
    const first = entry({ name: 'A shirt', category: 'Tops & Outerwear', sortOrder: 1 })
    const second = entry({ name: 'B shirt', category: 'Tops & Outerwear', sortOrder: 2 })
    expect(names(orderSection([first, second]))).toEqual(['A shirt', 'B shirt'])
    expect(names(orderSection([second, first]))).toEqual(['B shirt', 'A shirt'])
  })
})

describe('holding an order while Alex is working', () => {
  /*
   * The settle rule, as arithmetic. The screen takes a snapshot of the order and
   * keeps applying it until the tapping stops, so a row checked under his thumb
   * stays under his thumb.
   */
  it('keeps the order it was given, even after rows have changed', () => {
    const rows = [entry({ name: 'A' }), entry({ name: 'B' }), entry({ name: 'C' })]
    const snapshot = rows.map((row) => row.id)
    const after = rows.map((row) => (row.name === 'A' ? { ...row, packedQty: 1 } : row))

    expect(names(applyOrder(after, snapshot))).toEqual(['A', 'B', 'C'])
  })

  it('falls back to the real order when it has no snapshot', () => {
    const rows = [packed({ name: 'A' }), entry({ name: 'B' })]
    expect(names(applyOrder(rows, []))).toEqual(['B', 'A'])
  })

  /*
   * A row that appears mid-session — Alex adds something, or restores one from
   * Not bringing — has to appear somewhere, and somewhere predictable beats
   * somewhere clever.
   */
  it('places a row that arrived after the snapshot rather than dropping it', () => {
    const rows = [entry({ name: 'A' }), entry({ name: 'B' })]
    const snapshot = rows.map((row) => row.id)
    const added = [...rows, entry({ name: 'New', isCritical: true })]

    const shown = names(applyOrder(added, snapshot))
    expect(shown).toHaveLength(3)
    expect(shown).toContain('New')
  })

  it('drops a row from the snapshot that is no longer there', () => {
    const rows = [entry({ name: 'A' }), entry({ name: 'B' })]
    const snapshot = [...rows.map((row) => row.id), 'gone']

    expect(names(applyOrder(rows, snapshot))).toEqual(['A', 'B'])
  })
})
