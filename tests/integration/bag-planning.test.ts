import { describe, expect, it } from 'vitest'
import type { ChecklistEntry } from '@shared/checklist'
import {
  NO_TRAITS,
  RESILIENCE_CAP,
  availableBags,
  bagContext,
  bagFor,
  isFlying,
  mustStayWithYou,
  planBags,
  recommendBag,
  resilienceSet,
  type BagContext,
  type CarriedBag,
  type ItemTraits,
} from '@shared/bags'
import type { Trip } from '@shared/trips'

/**
 * Which bag each thing goes in (P3).
 *
 * The rules are pure, so these are unit tests over the real engine rather than
 * over a mock of it. What they are protecting, in order of how much it would
 * cost to get wrong:
 *
 * 1. **The safety floor.** Nothing on it is ever recommended for the hold, for
 *    any reason, including "the hold is the only bag there is". Those tests are
 *    mutation-checked, because a floor that cannot fail is decoration.
 * 2. **Unknown stays unknown.** A trait nobody has answered must never read as
 *    a negative one.
 * 3. **Alex's choice stands.** A better rule may not move something he placed.
 * 4. **No aviation logic on a trip with no flight.**
 */

let row = 0
function entry(overrides: Partial<ChecklistEntry> = {}): ChecklistEntry {
  row += 1
  return {
    id: `entry-${row}`, tripId: 'trip', itemId: `item-${row}`,
    name: `Thing ${row}`, detail: null, brand: null, color: null, category: 'Travel Gear',
    requiredQty: 1, qtyBreakdown: null, qtyOverride: null, packedQty: 0,
    packingTiming: 'anytime', requiresFinalCheck: false, finalCheckedAt: null,
    excludedAt: null, source: 'always_packed', reason: null,
    isCritical: false, tripOnly: false, sortOrder: row, bag: null, bagSource: null,
    updatedAt: 0,
    ...overrides,
  }
}

function traits(overrides: Partial<ItemTraits> = {}): ItemTraits {
  return { ...NO_TRAITS, ...overrides }
}

/** A trip carrying exactly these bags, flying unless told otherwise. */
function context(bags: CarriedBag[], flying = true): BagContext {
  return bagContext({ bags, luggageMode: null, flightHours: flying ? 11 : null })
}

const ALL: CarriedBag[] = ['personal_item', 'carry_on', 'checked']

/**
 * The whole plan for a trip carrying these bags, through the real entry point.
 *
 * `bagProblems` is deliberately not callable without the resolved bags, so a
 * test cannot reconstruct them by hand and drift from what the screens read.
 * This drives `planBags`, which is what production drives.
 */
function plan(entries: ChecklistEntry[], bags: CarriedBag[], flying = true) {
  return planBags({ bags, luggageMode: null, flightHours: flying ? 11 : null }, entries)
}

/* ------------------------------------------------------------------ */

describe('which bags a trip has', () => {
  it('reads what Alex said, in a stable order, ignoring anything it does not know', () => {
    expect(availableBags({ luggageMode: null, bags: ['checked', 'personal_item'] })).toEqual([
      'personal_item',
      'checked',
    ])
  })

  it('treats an empty list as a real answer rather than as silence', () => {
    // A road trip has none of these, and that is different from not asking.
    expect(availableBags({ luggageMode: 'checked', bags: [] })).toEqual([])
  })

  it('falls back to the old single mode for every trip that predates 0025', () => {
    // `carry_on` meant "I am not checking a bag", which in practice is a
    // carry-on AND the personal item under the seat.
    expect(availableBags({ luggageMode: 'carry_on', bags: null })).toEqual([
      'personal_item',
      'carry_on',
    ])
    expect(availableBags({ luggageMode: 'checked', bags: null })).toEqual(ALL)
    expect(availableBags({ luggageMode: null, bags: null })).toEqual(ALL)
  })

  it('does not call a trip a flight because nobody said otherwise', () => {
    expect(isFlying({ flightHours: null })).toBe(false)
    expect(isFlying({ flightHours: 0 })).toBe(false)
    expect(isFlying({ flightHours: 11 })).toBe(true)
  })
})

/* ------------------------------------------------------------------ */

describe('the safety floor', () => {
  const FLOOR: Array<[string, Partial<ChecklistEntry>, Partial<ItemTraits>]> = [
    ['a passport', { category: 'Documents', name: 'Passport' }, {}],
    ['essential medication', { category: 'Medication', name: 'Inhaler' }, {}],
    ['glasses', { category: 'Vision', name: 'Glasses' }, {}],
    ['a laptop', { category: 'Electronics', name: 'Laptop' }, {}],
    ['keys, which no category describes', { isCritical: true, name: 'Keys' }, {}],
    ['a wallet marked essential', { isCritical: true, name: 'Wallet' }, {}],
    ['anything medical', {}, { medical: true }],
    ['anything irreplaceable', {}, { valuable: true }],
    ['anything needed in transit', {}, { transitNeeded: true }],
  ]

  for (const [what, over, tr] of FLOOR) {
    it(`never puts ${what} in the hold, whatever bags exist`, () => {
      const item = entry(over)
      const facts = traits(tr)
      expect(mustStayWithYou(item, facts)).toBe(true)

      for (const bags of [ALL, ['personal_item'], ['carry_on'], ['carry_on', 'checked']] as CarriedBag[][]) {
        const advice = recommendBag(item, context(bags), facts)
        expect(advice?.bag, `${what} with ${bags.join('+')}`).not.toBe('checked')
      }
    })
  }

  /**
   * §4's case, and the one a scoring system would get wrong.
   *
   * A bag exists, so the tempting answer is to use it. Pack Smart refuses: it
   * recommends nothing and says so once, at the top, rather than quietly
   * putting a passport in the hold because that is where the space was.
   */
  it('refuses to assign at all when the only bag is the hold', () => {
    const passport = entry({ category: 'Documents', name: 'Passport' })
    const checkedOnly = context(['checked'])

    expect(recommendBag(passport, checkedOnly)).toBeNull()
    expect(bagFor(passport, checkedOnly)).toEqual({ bag: null, source: null, why: null })

    const problems = plan([passport], ['checked']).problems
    expect(problems).toHaveLength(1)
    expect(problems[0]!.kind).toBe('no_safe_bag')
    expect(problems[0]!.message).toMatch(/Passport/)
    // And it says what to do about it rather than only what is wrong.
    expect(problems[0]!.message).toMatch(/Add a personal item or carry-on/)
  })

  it('counts them rather than naming all of them when several are stranded', () => {
    const stranded = [
      entry({ category: 'Documents', name: 'Passport' }),
      entry({ category: 'Medication', name: 'Inhaler' }),
      entry({ isCritical: true, name: 'Keys' }),
    ]
    const problems = plan(stranded, ['checked']).problems
    expect(problems[0]!.message).toMatch(/^3 things you are packing/)
  })

  /**
   * Capacity pressure is a warning, never permission.
   *
   * The one place a scoring system would "helpfully" relieve a full cabin bag
   * by moving something down into the hold. Nothing here may.
   */
  it('does not move a floor item to the hold to relieve a crowded cabin', () => {
    /*
     * Alex's own assignments, because that is what crowds a cabin bag. The
     * planner sends a bulky thing to the hold when there is one, so three of
     * them in the carry-on is a choice rather than a recommendation.
     */
    const bulky = (name: string) =>
      entry({ name, bag: 'carry_on', bagSource: 'user', category: 'Travel Gear',
        traits: traits({ bulky: true }) })
    const meds = entry({ category: 'Medication', name: 'Inhaler' })
    const all = [bulky('A'), bulky('B'), bulky('C'), meds]

    const { problems, advice } = plan(all, ALL)
    expect(problems.some((p) => p.kind === 'crowded')).toBe(true)

    // ...and the advice for the medication is unchanged by the crowding.
    expect(advice.get(meds.id)?.bag).toBe('personal_item')
  })

  /**
   * The defect this argument exists for.
   *
   * Crowding read `entry.bag`, which is only written when Alex assigns a bag
   * himself. Everything Pack Smart RECOMMENDS into a cabin bag was invisible to
   * it, so on a trip where he has assigned nothing the warning could not fire —
   * a feature that looks like it works and never speaks.
   */
  it('counts bulky things the planner itself put in the cabin', () => {
    // Fragile keeps a bulky thing in the cabin even though a hold exists.
    const fragile = (name: string) =>
      entry({ name, category: 'Travel Gear', traits: traits({ bulky: true, fragile: true }) })
    const all = [fragile('A'), fragile('B'), fragile('C')]

    const { problems, advice } = plan(all, ALL)
    // Nobody assigned anything: every one of these is a recommendation.
    expect(all.every((e) => e.bag === null)).toBe(true)
    expect(advice.get(all[0]!.id)?.source).toBe('recommended')
    expect(problems.some((p) => p.kind === 'crowded')).toBe(true)
  })

  /**
   * A row the planner declined to place is not in a bag.
   *
   * With no hold, `recommendBag` has nothing useful to say about a bulky thing
   * and returns null. Treating "no answer" as "this bag" would invent crowding
   * out of silence — and would do it for BOTH cabin bags at once, from the same
   * three rows.
   */
  it('does not invent a bag for rows it declined to place', () => {
    const bulky = (name: string) =>
      entry({ name, category: 'Travel Gear', traits: traits({ bulky: true }) })
    const all = [bulky('A'), bulky('B'), bulky('C')]

    const { problems, advice } = plan(all, ['personal_item', 'carry_on'])
    expect(advice.get(all[0]!.id)?.bag).toBeNull()
    expect(problems.some((p) => p.kind === 'crowded')).toBe(false)
  })

  /** A drive carrying none of these is not a hold-safety problem. */
  it('says nothing about checked baggage on a trip that has none', () => {
    const passport = entry({ category: 'Documents', name: 'Passport' })
    expect(plan([passport], [], false).problems).toEqual([])
    // Nor on a flight where he simply has not said which bags he is taking.
    expect(plan([passport], [], true).problems).toEqual([])
  })
})

/* ------------------------------------------------------------------ */

describe('unknown stays unknown', () => {
  it('does not read a missing trait as a negative one', () => {
    const bottle = entry({ name: 'Shampoo', category: 'Toiletries' })

    // Liquid, size not recorded: nothing useful to say, and guessing the size
    // is the one guess with a security queue at the end of it.
    expect(recommendBag(bottle, context(ALL), traits({ liquid: true }))).toBeNull()

    // Nothing recorded at all: silent, exactly as before P3.
    expect(recommendBag(bottle, context(ALL))).toBeNull()
  })

  it('is silent about bulk and fragility nobody has recorded', () => {
    const thing = entry({ name: 'Tripod', category: 'Travel Gear' })
    expect(recommendBag(thing, context(ALL))).toBeNull()
    expect(recommendBag(thing, context(ALL), traits({ bulky: true }))?.bag).toBe('checked')
  })
})

/* ------------------------------------------------------------------ */

describe('liquids, which are only a rule in the air', () => {
  const shampoo = () => entry({ name: 'Shampoo', category: 'Toiletries' })

  it('sends a full-size bottle to the hold when flying and there is one', () => {
    const advice = recommendBag(shampoo(), context(ALL), traits({ liquid: true, liquidSize: 'full' }))
    expect(advice).toEqual({ bag: 'checked', why: 'Too big for cabin security.' })
  })

  it('says nothing about a full-size bottle when there is no hold to put it in', () => {
    // Advice he cannot take is worse than none: the honest answer is that this
    // bottle and this luggage do not go together.
    expect(
      recommendBag(shampoo(), context(['personal_item', 'carry_on']), traits({ liquid: true, liquidSize: 'full' })),
    ).toBeNull()
  })

  it('leaves a cabin-legal bottle in the cabin', () => {
    const advice = recommendBag(shampoo(), context(ALL), traits({ liquid: true, liquidSize: 'cabin' }))
    expect(advice?.bag).toBe('carry_on')
  })

  it('says nothing about liquids at all when the trip is not a flight', () => {
    const driving = context(ALL, false)
    expect(recommendBag(shampoo(), driving, traits({ liquid: true, liquidSize: 'full' }))).toBeNull()
    expect(recommendBag(shampoo(), driving, traits({ liquid: true, liquidSize: 'cabin' }))).toBeNull()
  })
})

/* ------------------------------------------------------------------ */

describe('the delayed-bag set', () => {
  const wardrobe = () => [
    entry({ name: 'Boxer Briefs', category: 'Accessories & Undergarments' }),
    entry({ name: 'Merino Socks', category: 'Accessories & Undergarments' }),
    entry({ name: 'Linen Shirt', category: 'Tops & Outerwear' }),
    entry({ name: 'Chino Trousers', category: 'Bottoms & Swimwear' }),
    entry({ name: 'Spare Shirt', category: 'Tops & Outerwear' }),
    entry({ name: 'Spare Socks', category: 'Accessories & Undergarments' }),
  ]

  it('exists only when a checked bag is actually coming', () => {
    expect(resilienceSet(wardrobe(), context(['personal_item', 'carry_on'])).size).toBe(0)
  })

  it('exists only on a flight — a boot is not a baggage hall', () => {
    expect(resilienceSet(wardrobe(), context(ALL, false)).size).toBe(0)
  })

  it('is bounded, and does not grow with the wardrobe', () => {
    const chosen = resilienceSet(wardrobe(), context(ALL))
    expect(chosen.size).toBeGreaterThan(0)
    expect(chosen.size).toBeLessThanOrEqual(RESILIENCE_CAP)
  })

  it('takes one of each kind rather than every shirt in the list', () => {
    const chosen = resilienceSet(wardrobe(), context(ALL))
    const names = wardrobe().filter((e) => chosen.has(e.id)).map((e) => e.name)
    // At most one top, whichever it picked.
    expect(names.filter((n) => /shirt/i.test(n)).length).toBeLessThanOrEqual(1)
  })

  it('puts what it chose in the cabin, and says why in one sentence', () => {
    const all = wardrobe()
    const chosen = resilienceSet(all, context(ALL))
    const picked = all.find((e) => chosen.has(e.id))!
    expect(recommendBag(picked, context(ALL), NO_TRAITS, chosen)).toEqual({
      bag: 'carry_on',
      why: 'Useful if your checked bag is delayed.',
    })
  })

  it('never reaches for something Alex has already placed himself', () => {
    const all = wardrobe().map((e) => ({ ...e, bag: 'checked' as const, bagSource: 'user' as const }))
    expect(resilienceSet(all, context(ALL)).size).toBe(0)
  })
})

/* ------------------------------------------------------------------ */

describe('Alex outranks the rules', () => {
  it('keeps his choice even where the recommendation is emphatic', () => {
    const passport = entry({
      category: 'Documents', name: 'Passport', bag: 'checked', bagSource: 'user',
    })
    // The floor decides what Pack Smart RECOMMENDS. It does not overrule a
    // decision, and it does not quietly rewrite one either.
    expect(bagFor(passport, context(ALL))).toEqual({ bag: 'checked', source: 'user', why: null })
  })

  it('fills the gap when he has not chosen, and says so', () => {
    const passport = entry({ category: 'Documents', name: 'Passport' })
    expect(bagFor(passport, context(ALL))).toEqual({
      bag: 'personal_item',
      source: 'recommended',
      why: 'You need it before you reach the bag.',
    })
  })

  it('recommends without writing anything', () => {
    /*
     * The property the whole design rests on: `bagFor` is pure, so improving
     * these rules improves every trip that already exists, with no migration
     * and no risk of a suggestion later being mistaken for a decision.
     */
    const before = entry({ category: 'Documents' })
    const snapshot = JSON.stringify(before)
    bagFor(before, context(ALL))
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

/* ------------------------------------------------------------------ */

describe('every bag combination answers something sensible', () => {
  const COMBINATIONS: CarriedBag[][] = [
    [],
    ['personal_item'],
    ['carry_on'],
    ['checked'],
    ['personal_item', 'carry_on'],
    ['personal_item', 'checked'],
    ['carry_on', 'checked'],
    ALL,
  ]

  for (const bags of COMBINATIONS) {
    it(`never recommends a bag the trip does not have: ${bags.join('+') || 'none'}`, () => {
      const ctx = context(bags)
      const rows = [
        entry({ category: 'Documents', name: 'Passport' }),
        entry({ category: 'Toiletries', name: 'Shampoo' }),
        entry({ category: 'Travel Gear', name: 'Tripod' }),
        entry({ category: 'Tops & Outerwear', name: 'Linen Shirt' }),
      ]
      const chosen = resilienceSet(rows, ctx)

      for (const row of rows) {
        const advice = recommendBag(row, ctx, traits({ liquid: true, liquidSize: 'full' }), chosen)
        if (!advice) continue
        expect(bags, `${row.name} -> ${advice.bag}`).toContain(advice.bag)
      }
    })
  }

  it('says nothing at all when the trip carries none of them', () => {
    const rows = [entry({ category: 'Documents', name: 'Passport' })]
    expect(recommendBag(rows[0]!, context([]))).toBeNull()
  })
})

/* ------------------------------------------------------------------ */

describe('a trip that predates all of this', () => {
  it('gets exactly the answers it got before P3', () => {
    /*
     * `bagFor(entry)` with no context at all. Every existing caller does this,
     * and the four category rules plus the `isCritical` fallback are what they
     * returned before — so no screen changed its answer the day P3 shipped.
     */
    expect(bagFor(entry({ category: 'Documents' })).bag).toBe('personal_item')
    expect(bagFor(entry({ category: 'Medication' })).bag).toBe('personal_item')
    expect(bagFor(entry({ category: 'Vision' })).bag).toBe('personal_item')
    expect(bagFor(entry({ category: 'Electronics' })).bag).toBe('personal_item')
    expect(bagFor(entry({ isCritical: true })).bag).toBe('personal_item')
    expect(bagFor(entry({ category: 'Travel Gear' })).bag).toBeNull()
  })

  it('reads a stored trip with no bag list through its old luggage mode', () => {
    const trip = { luggageMode: 'carry_on', flightHours: 11, bags: null } as Pick<
      Trip,
      'luggageMode' | 'flightHours' | 'bags'
    >
    const ctx = bagContext(trip)
    expect(ctx.checked).toBe(false)
    expect(ctx.cabin).toEqual(['personal_item', 'carry_on'])
  })
})
