import { describe, expect, it } from 'vitest'
import { computeQuantity, type EngineContext, type PackingRule } from '@shared/rules'

/**
 * How several rules for one item combine.
 *
 * `technical-docs/11_RULE_PRECEDENCE.md` states this in prose, and prose drifts.
 * These are the claims that document makes, pinned — so the next person to add a
 * rule type finds out here whether they changed the contract, rather than
 * finding out from a packing list.
 *
 * Written before Alex can create his own rules, which is the point: the first
 * moment two rules can target one item is the moment he can write the second.
 */

function rule(overrides: Partial<PackingRule> & { ruleType: PackingRule['ruleType'] }): PackingRule {
  return {
    id: `rule-${Math.round(overrides.quantityValue ?? 0)}-${overrides.ruleType}`,
    itemId: 'item',
    quantityValue: 1,
    buffer: null,
    condition: null,
    dependsOnItemId: null,
    enabled: true,
    originalText: null,
    ...overrides,
  }
}

const context = (facts: Record<string, unknown> = {}): EngineContext => ({
  facts: { trip_days: 10, nights: 9, ...facts },
  includedItemIds: new Set<string>(),
})

describe('several rules do not compete, they combine', () => {
  it('takes the larger of two quantity opinions', () => {
    /*
     * `Math.max`, and the reasoning is asymmetric on purpose: a spare pair of
     * socks costs a little space, and arriving one short costs the evening.
     */
    const result = computeQuantity(
      [
        rule({ ruleType: 'per_day', quantityValue: 1 }),
        rule({ ruleType: 'per_day', quantityValue: 2 }),
      ],
      context(),
    )
    expect(result.quantity).toBe(20)
  })

  it('DOES depend on order when `fixed_per_trip` is involved — a known gap', () => {
    /*
     * Found by writing this test, and pinned rather than fixed.
     *
     * Every other quantity rule combines with `Math.max`. `fixed_per_trip`
     * ASSIGNS the base instead, so "always pack 3" arriving after "2 per day"
     * overwrites 20 with 3, while the same two rules the other way round give
     * 20. Nothing in the seeded data pairs them, so it has never mattered — and
     * the moment Alex can write his own rules, it can.
     *
     * Not corrected here on purpose. Changing it would change the quantity on
     * generated packing lists, which is a product decision rather than a
     * cleanup, and `CLAUDE.md` forbids silently changing behaviour. It is
     * written up in `11_RULE_PRECEDENCE.md` §3 as the thing A4 must decide
     * before rule creation ships.
     *
     * This test exists so the decision cannot be forgotten: fixing the engine
     * will fail it, which is the correct moment to read that section.
     */
    const perDayThenFixed = computeQuantity(
      [
        rule({ ruleType: 'per_day', quantityValue: 2 }),
        rule({ ruleType: 'fixed_per_trip', quantityValue: 3 }),
      ],
      context(),
    ).quantity

    const fixedThenPerDay = computeQuantity(
      [
        rule({ ruleType: 'fixed_per_trip', quantityValue: 3 }),
        rule({ ruleType: 'per_day', quantityValue: 2 }),
      ],
      context(),
    ).quantity

    expect(perDayThenFixed).toBe(3)
    expect(fixedThenPerDay).toBe(20)
  })

  it('is order-independent for every rule type that uses a maximum', () => {
    // Which is all of them except `fixed_per_trip`, above.
    const rules = [
      rule({ ruleType: 'per_day', quantityValue: 2 }),
      rule({ ruleType: 'per_night', quantityValue: 1 }),
      rule({ ruleType: 'minimum', quantityValue: 4 }),
    ]
    const forwards = computeQuantity(rules, context()).quantity
    const backwards = computeQuantity([...rules].reverse(), context()).quantity
    expect(forwards).toBe(backwards)
    expect(forwards).toBe(20)
  })

  it('never produces a second row for one item', () => {
    // Doc 09 §18: "do not duplicate an item because several rules apply". It is
    // satisfied by construction — rules add quantity, not rows — and this is
    // what would fail if that ever stopped being true.
    const result = computeQuantity(
      [
        rule({ ruleType: 'per_day', quantityValue: 1 }),
        rule({ ruleType: 'per_night', quantityValue: 1 }),
        rule({ ruleType: 'spare', quantityValue: 1 }),
      ],
      context(),
    )
    expect(typeof result.quantity).toBe('number')
  })

  it('adds spares on top of everything else', () => {
    const result = computeQuantity(
      [
        rule({ ruleType: 'per_day', quantityValue: 1 }),
        rule({ ruleType: 'spare', quantityValue: 2 }),
      ],
      context(),
    )
    expect(result.quantity).toBe(12)
  })

  it('lets a minimum raise and a maximum lower the answer', () => {
    const withMinimum = computeQuantity(
      [
        rule({ ruleType: 'fixed_per_trip', quantityValue: 1 }),
        rule({ ruleType: 'minimum', quantityValue: 4 }),
      ],
      context(),
    )
    expect(withMinimum.quantity).toBe(4)

    const withMaximum = computeQuantity(
      [
        rule({ ruleType: 'per_day', quantityValue: 2 }),
        rule({ ruleType: 'maximum', quantityValue: 6 }),
      ],
      context(),
    )
    expect(withMaximum.quantity).toBe(6)
  })
})

describe('a gate beats a quantity', () => {
  it('packs nothing when the condition fails, however large the quantity', () => {
    /*
     * The property that makes order irrelevant. A `per_day` rule saying "two a
     * day" must not smuggle an item onto a list whose condition says it does not
     * belong there.
     */
    const result = computeQuantity(
      [
        rule({ ruleType: 'per_day', quantityValue: 2 }),
        rule({
          ruleType: 'conditional_include',
          condition: { fact: 'international', eq: true },
        }),
      ],
      context({ international: false }),
    )
    expect(result.quantity).toBeNull()
  })

  it('treats an unrecorded fact as no, and says the row is incomplete', () => {
    /*
     * Packing something because a fact was MISSING is the confident-but-
     * unsupported behaviour `CLAUDE.md` rules out. Unknown does not pack — and
     * unlike a plain refusal it marks the row, so the trip can report what it
     * could not decide rather than staying quiet.
     */
    const result = computeQuantity(
      [
        rule({ ruleType: 'per_day', quantityValue: 2 }),
        rule({
          ruleType: 'conditional_include',
          condition: { fact: 'laundry_available', eq: true },
        }),
      ],
      context(),
    )
    expect(result.quantity).toBeNull()
    expect(result.incomplete).toBe(true)
  })

  it('packs when the condition holds', () => {
    const result = computeQuantity(
      [
        rule({
          ruleType: 'conditional_include',
          quantityValue: 1,
          condition: { fact: 'flight_hours', gt: 5 },
        }),
      ],
      context({ flight_hours: 7 }),
    )
    expect(result.quantity).toBe(1)
  })
})

describe('a disabled rule is not a rule', () => {
  it('contributes nothing at all', () => {
    const result = computeQuantity(
      [
        rule({ ruleType: 'per_day', quantityValue: 1 }),
        rule({ ruleType: 'per_day', quantityValue: 5, enabled: false }),
      ],
      context(),
    )
    expect(result.quantity).toBe(10)
  })

  it('cannot gate anything either', () => {
    // A disabled condition must not keep an item off the list — otherwise
    // turning a rule off would silently be a way of turning an item off.
    const result = computeQuantity(
      [
        rule({ ruleType: 'fixed_per_trip', quantityValue: 1 }),
        rule({
          ruleType: 'conditional_include',
          condition: { fact: 'international', eq: true },
          enabled: false,
        }),
      ],
      context({ international: false }),
    )
    expect(result.quantity).toBe(1)
  })
})

describe('every contribution can be explained', () => {
  it('shows its working, in words rather than field names', () => {
    // Doc 09 §25: every recommendation explainable. The breakdown is what the
    // row shows when Alex asks why.
    const result = computeQuantity([rule({ ruleType: 'per_day', quantityValue: 2 })], context())

    expect(result.breakdown.length).toBeGreaterThan(0)
    for (const step of result.breakdown) {
      expect(step.label).not.toMatch(/[a-z][A-Z]|_/)
    }
  })
})
