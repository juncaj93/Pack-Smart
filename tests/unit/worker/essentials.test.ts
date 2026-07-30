import { describe, expect, it } from 'vitest'
import { coverageGaps } from '@shared/essentials'
import type { Item } from '@shared/items'

/**
 * What a trip knows it is not covering (product doc 02 §9c).
 *
 * The tests that carry weight are the SILENCE ones. A warning about something
 * Alex does not need is how a useful alert becomes noise he dismisses, so
 * "reports nothing" is as much a requirement here as "reports the gap".
 */

function item(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    kind: 'gear',
    displayName: id,
    category: 'Travel Gear',
    subcategory: null,
    color: null,
    brand: null,
    favorite: false,
    usageFrequency: 'sometimes',
    warmth: null,
    dressiness: null,
    weatherTags: [],
    typicalUses: [],
    reuseCapacity: null,
    isCritical: false,
    requiresFinalCheck: false,
    defaultPackingTiming: 'anytime',
    alwaysInclude: false,
    neverInclude: false,
    notes: null,
    archivedAt: null,
    ...overrides,
  } as Item
}

/** A wardrobe that satisfies every universal check, so tests isolate one thing. */
function covered(extra: Item[] = []): Item[] {
  return [item('Anker USB-C Charger'), item('Passport'), ...extra]
}

const DOMESTIC = { international: false }
const ABROAD = { international: true }

function gaps(items: Item[], ruled: string[] = [], trip = DOMESTIC) {
  return coverageGaps({ items, ruledItemIds: new Set(ruled), trip })
}

describe('essentials that can never reach a list', () => {
  /*
   * The defect this exists for. An item with no rule never reaches any list, and
   * "Still not packed" cannot help because it only reports rows that exist. So
   * the charger sits at home while the app looks complete.
   */
  it('names a critical item that no rule will ever place', () => {
    const found = gaps(covered([item('Insulin', { isCritical: true })]))

    expect(found).toHaveLength(1)
    expect(found[0]!.kind).toBe('unreachable')
    expect(found[0]!.message).toContain('Insulin')
    expect(found[0]!.message).toContain('no rule')
  })

  it('says nothing when the critical item has a rule', () => {
    expect(gaps(covered([item('Insulin', { isCritical: true })]), ['Insulin'])).toEqual([])
  })

  // `alwaysInclude` is the other way onto a list, and mirrors generateChecklist.
  it('says nothing when the critical item is always included', () => {
    const found = gaps(covered([item('Insulin', { isCritical: true, alwaysInclude: true })]))
    expect(found).toEqual([])
  })

  it('carries the item id, so the screen can offer the fix on the right row', () => {
    const found = gaps(covered([item('Passport Wallet', { isCritical: true })]))
    expect(found[0]!.itemId).toBe('Passport Wallet')
  })

  /*
   * Not marked critical is Alex's judgement, and it is not this check's business
   * to overrule him. Reporting every ruleless item would bury the real ones.
   */
  it('leaves an ordinary ruleless item alone', () => {
    expect(gaps(covered([item('Travel Chess Set')]))).toEqual([])
  })

  /*
   * Clothing reaches the list through approved outfits, not rules (doc 04 §8).
   *
   * Claiming otherwise would be false, and visibly so: approve an outfit
   * containing the garment and the warning would sit directly above the row it
   * says cannot exist. Worth a test because the exemption is easy to delete
   * while "tidying" the condition above it.
   */
  it('does not accuse a critical garment of being unreachable', () => {
    const found = gaps(
      covered([item('Prescription Sunglasses', { kind: 'clothing', isCritical: true })]),
    )
    expect(found).toEqual([])
  })
})

describe('universal essentials missing entirely', () => {
  it('says so when nothing is recorded as a charger', () => {
    const found = gaps([item('Passport')])

    expect(found).toHaveLength(1)
    expect(found[0]!.kind).toBe('missing')
    expect(found[0]!.message).toContain('phone charger')
  })

  it('accepts a charger named in Alex’s own words', () => {
    for (const name of ['Anker Power Bank', 'USB-C cable', 'Lightning Cable', 'Wall plug EU']) {
      expect(gaps([item(name), item('Passport')]), name).toEqual([])
    }
  })

  // The notes field counts: an item can be described without being titled.
  it('accepts a charger described in the notes', () => {
    const found = gaps([item('Dopp kit', { notes: 'holds the charger and cables' }), item('Passport')])
    expect(found).toEqual([])
  })
})

describe('what it refuses to say', () => {
  /*
   * THE point of the design. Pack Smart must never announce that Alex has no
   * medication — owning none may be exactly right, and a warning about a thing
   * he does not need teaches him to dismiss the ones that matter.
   */
  it('never reports a personal essential as missing', () => {
    const found = gaps(covered())

    const text = found.map((g) => g.message).join(' ').toLowerCase()
    for (const personal of ['medication', 'medicine', 'glasses', 'contacts', 'prescription']) {
      expect(text, `warned about absent ${personal}`).not.toContain(personal)
    }
  })

  it('says nothing at all about a fully covered domestic trip', () => {
    expect(gaps(covered())).toEqual([])
  })

  /*
   * A passport is only universal abroad. Warning about one on every domestic trip
   * is the false alarm this whole asymmetry exists to prevent — and the trip flag
   * is null until answered, which the repo layer treats as "not abroad".
   */
  it('does not ask for a passport on a domestic trip', () => {
    expect(gaps([item('Anker USB-C Charger')], [], DOMESTIC)).toEqual([])
  })

  it('does ask for a passport abroad', () => {
    const found = gaps([item('Anker USB-C Charger')], [], ABROAD)
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('passport')
  })

  /*
   * Never invents an item. Every sentence either names something Alex owns or
   * states an absence — none of them nominates a product to buy.
   */
  it('offers a fix that is his action, not the app’s', () => {
    const found = gaps([item('Passport')])
    expect(found[0]!.fix).toMatch(/Add it in My Stuff|ignore this/)
  })
})
