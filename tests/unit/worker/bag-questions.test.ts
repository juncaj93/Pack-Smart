import { describe, expect, it } from 'vitest'
import {
  MAX_BAG_QUESTIONS,
  bagQuestionsFor,
  traitsOfItem,
  type BagQuestionKey,
  type LiveTrip,
} from '@shared/bag-questions'
import { NO_TRAITS, bagContext, type CarriedBag, type ItemTraits } from '@shared/bags'
import type { ChecklistEntry } from '@shared/checklist'
import { UNRECORDED_TRAITS, type Item } from '@shared/items'

/**
 * When a bag question is worth asking (P3b).
 *
 * The whole feature is one claim — **a question appears only when its answers
 * would put the thing in different bags on a trip Alex is actually taking** —
 * and every test here is an attempt to break it. The two ways it can fail are
 * opposite and both fatal:
 *
 * 1. **Asking too much.** Every trait is null on every row in the closet, so a
 *    gate that leaks turns 119 garments into 500 questions. That is the null
 *    scan H1d was built to prevent, and it kills the queue by being ignorable.
 * 2. **Asking too little.** A gate that is too tight never asks anything, and
 *    the traits stay null forever while the planner stays quiet about bags.
 *
 * Nothing here touches a database. The gate is a pure function over the real
 * planner, so these are unit tests over the actual rules rather than over a
 * description of them.
 */

let row = 0

function entry(overrides: Partial<ChecklistEntry> = {}): ChecklistEntry {
  row += 1
  return {
    id: `entry-${row}`, tripId: 'trip', itemId: `item-${row}`,
    name: `Thing ${row}`, detail: null, category: 'Travel Gear',
    requiredQty: 1, qtyBreakdown: null, qtyOverride: null, packedQty: 0,
    packingTiming: 'anytime', requiresFinalCheck: false, finalCheckedAt: null,
    excludedAt: null, source: 'always_packed', reason: null,
    isCritical: false, tripOnly: false, sortOrder: row, bag: null, bagSource: null,
    traits: NO_TRAITS,
    updatedAt: 0,
    ...overrides,
  }
}

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1', kind: 'gear', displayName: 'Shampoo', category: 'Toiletries',
    subcategory: null, color: null, pattern: null, brand: null, notes: null,
    usageFrequency: 'sometimes', warmth: null, dressiness: null,
    dressinessContexts: [], weatherTags: [], typicalUses: [],
    reuseCapacity: null, ownedQuantity: null, comfort: null, versatility: null,
    isCritical: false,
    ...UNRECORDED_TRAITS,
    requiresFinalCheck: false, defaultPackingTiming: 'anytime',
    alwaysInclude: false, neverInclude: false, archivedAt: null,
    source: 'manual', fieldProvenance: {}, createdAt: 0, updatedAt: 0,
    ...overrides,
  }
}

/** A trip carrying exactly these bags, flying unless told otherwise. */
function trip(bags: CarriedBag[], entries: ChecklistEntry[], flying = true): LiveTrip {
  return {
    tripId: 'trip',
    tripName: 'Lisbon',
    context: bagContext({ bags, luggageMode: null, flightHours: flying ? 3 : null }),
    entries,
  }
}

const ALL: CarriedBag[] = ['personal_item', 'carry_on', 'checked']

function keys(questions: { key: BagQuestionKey }[]): BagQuestionKey[] {
  return questions.map((q) => q.key)
}

/** The questions asked about an item that is on one trip's list. */
function ask(
  it: Item,
  bags: CarriedBag[],
  { flying = true, entryOverrides = {}, traits = NO_TRAITS }: {
    flying?: boolean
    entryOverrides?: Partial<ChecklistEntry>
    traits?: ItemTraits
  } = {},
): BagQuestionKey[] {
  const rows = [entry({ itemId: it.id, name: it.displayName, category: it.category, traits, ...entryOverrides })]
  return keys(bagQuestionsFor(it, [trip(bags, rows, flying)], traits))
}

/* ------------------------------------------------------------------ */
/* nothing to change means nothing to ask                              */
/* ------------------------------------------------------------------ */

describe('the gate refuses to ask when the answer would change nothing', () => {
  it('asks nothing at all when there are no trips ahead', () => {
    // The whole closet is unrecorded. Without a live trip that is not a queue
    // of 500 questions, it is a queue of none.
    expect(bagQuestionsFor(item(), [], NO_TRAITS)).toEqual([])
  })

  it('asks nothing about an item that is on no live list', () => {
    const other = entry({ itemId: 'someone-else' })
    expect(keys(bagQuestionsFor(item(), [trip(ALL, [other])], NO_TRAITS))).toEqual([])
  })

  it('asks nothing about a row Alex has taken off the trip', () => {
    expect(ask(item(), ALL, { entryOverrides: { excludedAt: 100 } })).toEqual([])
  })

  it('asks nothing about a row Alex has already placed himself', () => {
    // His choice outranks every rule, so no answer could move it. Asking would
    // be collecting data to make a decision that has already been made.
    expect(ask(item(), ALL, { entryOverrides: { bag: 'checked', bagSource: 'user' } })).toEqual([])
  })

  it('does not ask again about a trait that is already recorded', () => {
    const recorded = { ...NO_TRAITS, liquid: true, liquidSize: 'full' as const }
    expect(
      ask(item({ isLiquid: true, liquidSize: 'full' }), ALL, { traits: recorded }),
    ).not.toContain('liquid')
  })

  it('still asks when the liquid is known and its SIZE is not', () => {
    // The half that matters is the half the security queue cares about.
    const half = { ...NO_TRAITS, liquid: true }
    expect(ask(item({ isLiquid: true }), ALL, { traits: half })).toContain('liquid')
  })
})

/* ------------------------------------------------------------------ */
/* aviation logic stays in the air                                     */
/* ------------------------------------------------------------------ */

describe('a drive is not a flight', () => {
  it('asks nothing about liquids on a trip with no flight', () => {
    expect(ask(item(), ALL, { flying: false })).not.toContain('liquid')
  })

  it('asks about the same bottle the moment the trip involves flying', () => {
    expect(ask(item(), ALL, { flying: true })).toContain('liquid')
  })

  it('asks nothing about a delayed bag when nothing is being checked', () => {
    const socks = item({ id: 'socks', displayName: 'Wool socks', kind: 'clothing', category: 'Accessories & Undergarments' })
    expect(ask(socks, ['personal_item', 'carry_on'])).not.toContain('delay')
  })
})

/* ------------------------------------------------------------------ */
/* plausibility — the gate the simulation cannot provide               */
/* ------------------------------------------------------------------ */

describe('questions that would change an answer and are still absurd', () => {
  it('never asks whether a T-shirt is a full-size liquid', () => {
    /*
     * This one CANNOT be caught by the simulation, and that is the whole
     * argument for a separate plausibility list. `liquid: true` is a fact the
     * planner acts on, so flipping it genuinely moves a T-shirt into the hold —
     * the answers disagree, the gate passes, and the question is still absurd.
     */
    const shirt = item({
      id: 'shirt', kind: 'clothing', displayName: 'Linen shirt',
      category: 'Tops & Outerwear', subcategory: 'Shirt',
    })
    expect(ask(shirt, ALL)).not.toContain('liquid')
  })

  it('never asks whether a pair of socks is breakable', () => {
    /*
     * Everything ABOVE fragility in the order is already answered here, and
     * that is deliberate rather than tidy. Leave them unrecorded and the two
     * question cap alone keeps `fragile` off the card — so the test would pass
     * with the plausibility list deleted, which is precisely the mutation it
     * exists to catch. Answering them first makes fragility the next question
     * in line, and the only thing that can still refuse it is the rule under
     * test.
     */
    const settled: ItemTraits = {
      ...NO_TRAITS,
      liquid: false,
      transitNeeded: false,
      delaySensitive: false,
    }
    const socks = item({
      id: 'socks', kind: 'clothing', displayName: 'Wool socks',
      category: 'Accessories & Undergarments', subcategory: 'Socks',
      isLiquid: false, isTransitNeeded: false, isDelaySensitive: false,
    })
    expect(ask(socks, ALL, { traits: settled })).not.toContain('fragile')
  })

  it('does ask whether a camera is breakable', () => {
    const camera = item({ id: 'camera', displayName: 'Film camera', category: 'Travel Gear' })
    expect(ask(camera, ALL)).toContain('fragile')
  })
})

/* ------------------------------------------------------------------ */
/* the floor answers for itself                                        */
/* ------------------------------------------------------------------ */

describe('what the safety floor already decides', () => {
  it('asks nothing about a passport, because every answer puts it in the same place', () => {
    /*
     * Not a plausibility exclusion — `transit` genuinely lists Documents. The
     * floor claims a passport before any trait rule is reached, so all the
     * answers agree and the simulation finds nothing to learn. The two gates
     * cover different things and this is the case that proves the second one
     * does work.
     */
    const passport = item({ id: 'passport', displayName: 'Passport', category: 'Documents' })
    expect(ask(passport, ALL, { entryOverrides: { category: 'Documents' } })).toEqual([])
  })

  it('asks nothing about something Alex already flagged essential', () => {
    const charger = item({ id: 'charger', displayName: 'Charger', category: 'Travel Gear', isCritical: true })
    expect(ask(charger, ALL, { entryOverrides: { isCritical: true } })).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* the delayed-bag question is a confirmation, not a survey            */
/* ------------------------------------------------------------------ */

describe('the delayed-bag question', () => {
  const socks = item({
    id: 'socks', kind: 'clothing', displayName: 'Wool socks',
    category: 'Accessories & Undergarments', subcategory: 'Socks',
  })

  it('asks about something the rules are already protecting', () => {
    const rows = [entry({ itemId: 'socks', name: 'Wool socks' })]
    expect(keys(bagQuestionsFor(socks, [trip(ALL, rows)], NO_TRAITS))).toContain('delay')
  })

  it('does not ask about every other garment on the list', () => {
    /*
     * The bound that keeps this from becoming a survey. A jacket is a perfectly
     * reasonable thing to want in the cabin, and answering yes WOULD move it —
     * so the simulation alone would ask about it, and about every other garment
     * too. The question is a confirmation of what Pack Smart already decided,
     * which caps it at the four rows the rules picked.
     */
    const jacket = item({
      id: 'jacket', kind: 'clothing', displayName: 'Rain jacket',
      category: 'Tops & Outerwear', subcategory: 'Jacket',
    })
    const rows = [entry({ itemId: 'jacket', name: 'Rain jacket' })]
    expect(keys(bagQuestionsFor(jacket, [trip(ALL, rows)], NO_TRAITS))).not.toContain('delay')
  })
})

/* ------------------------------------------------------------------ */
/* the card stays short                                                */
/* ------------------------------------------------------------------ */

describe('how much one card may ask', () => {
  const camera = item({ id: 'camera', displayName: 'Camera bag', category: 'Travel Gear' })

  it('never asks more than the card can hold', () => {
    const rows = [entry({ itemId: 'camera', name: 'Camera bag', category: 'Travel Gear' })]
    const asked = bagQuestionsFor(camera, [trip(ALL, rows)], NO_TRAITS)
    expect(asked.length).toBeLessThanOrEqual(MAX_BAG_QUESTIONS)
    expect(asked.length).toBeGreaterThan(0)
  })

  it('does not let a withdrawn question consume one of the slots', () => {
    /*
     * The bug this is here for: filter the result instead of the loop, and
     * saying "not sure" about transit silently suppresses the fragility
     * question that was queued behind it — a question Alex was never asked and
     * never declined.
     */
    const rows = [entry({ itemId: 'camera', name: 'Camera bag', category: 'Travel Gear' })]
    const all = keys(bagQuestionsFor(camera, [trip(ALL, rows)], NO_TRAITS))
    const withoutFirst = keys(
      bagQuestionsFor(camera, [trip(ALL, rows)], NO_TRAITS, (key) => key === all[0]),
    )

    expect(withoutFirst).not.toContain(all[0])
    expect(withoutFirst.length).toBe(MAX_BAG_QUESTIONS)
  })
})

/* ------------------------------------------------------------------ */
/* the answers write what they say and nothing else                    */
/* ------------------------------------------------------------------ */

describe('what an answer records', () => {
  it('writes both halves of the liquid answer, and only those', () => {
    const rows = [entry({ itemId: 'item-1', name: 'Shampoo', category: 'Toiletries' })]
    const question = bagQuestionsFor(item(), [trip(ALL, rows)], NO_TRAITS).find(
      (q) => q.key === 'liquid',
    )

    expect(question?.answers.map((a) => a.traits)).toEqual([
      { liquid: true, liquidSize: 'full' },
      { liquid: true, liquidSize: 'cabin' },
      { liquid: false, liquidSize: null },
    ])
  })

  it('names the trip, so the question is never abstract', () => {
    const rows = [entry({ itemId: 'item-1', name: 'Shampoo', category: 'Toiletries' })]
    const question = bagQuestionsFor(item(), [trip(ALL, rows)], NO_TRAITS)[0]
    expect(question?.because).toContain('Lisbon')
  })
})

/* ------------------------------------------------------------------ */

describe('reading the traits off a catalog row', () => {
  it('carries an unrecorded trait across as null rather than as false', () => {
    expect(traitsOfItem(item())).toEqual(NO_TRAITS)
  })

  it('carries every recorded trait across', () => {
    expect(
      traitsOfItem(
        item({
          isLiquid: true, liquidSize: 'cabin', isFragile: false, isValuable: true,
          isMedical: false, isTransitNeeded: true, isBulky: false, isDelaySensitive: true,
        }),
      ),
    ).toEqual({
      liquid: true, liquidSize: 'cabin', fragile: false, valuable: true,
      medical: false, transitNeeded: true, bulky: false, delaySensitive: true,
    })
  })
})
