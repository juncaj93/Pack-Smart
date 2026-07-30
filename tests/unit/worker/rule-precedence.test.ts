import { describe, expect, it } from 'vitest'
import { applyPrecedence, computeQuantity, type EngineContext, type PackingRule } from '@shared/rules'

/**
 * How several rules for one item combine, and which of them wins when they
 * disagree.
 *
 * `technical-docs/11_RULE_PRECEDENCE.md` states this in prose, and prose drifts.
 * These are the claims that document makes, pinned — so the next person to add a
 * rule type finds out here whether they changed the contract, rather than
 * finding out from a packing list.
 *
 * Two of Alex's rulings live in this file:
 *
 *   1. A user rule may ask for FEWER than a default, but only by explicitly
 *      replacing it. Writing an unrelated rule must never reduce one.
 *   2. `fixed_per_trip` is a floor, not an assignment. Reversing the row order
 *      must not change the answer.
 */

let counter = 0

function rule(overrides: Partial<PackingRule> & { ruleType: PackingRule['ruleType'] }): PackingRule {
  return {
    // Unique per call. The engine sorts by (type, id) to make its answer
    // independent of arrival order, so two rules sharing an id would make the
    // order-reversal tests prove less than they claim to.
    id: `rule-${(counter += 1)}`,
    itemId: 'item',
    quantityValue: 1,
    buffer: null,
    condition: null,
    dependsOnItemId: null,
    enabled: true,
    originalText: null,
    source: 'system',
    supersedesRuleId: null,
    ...overrides,
  }
}

const context = (facts: Record<string, unknown> = {}): EngineContext => ({
  facts: { trip_days: 10, nights: 9, ...facts },
  includedItemIds: new Set<string>(),
  // Empty on purpose: these are about how RULES combine, and a preference
  // override would be a third voice in an argument that already has two.
  preferences: {},
})

const quantityOf = (rules: PackingRule[], facts?: Record<string, unknown>) =>
  computeQuantity(rules, context(facts)).quantity

/** Every rule set, forwards and backwards, must give one answer. */
function bothWays(rules: PackingRule[], facts?: Record<string, unknown>): number | null {
  const forwards = quantityOf(rules, facts)
  const backwards = quantityOf([...rules].reverse(), facts)
  expect(forwards).toBe(backwards)
  return forwards
}

describe('several rules do not compete, they combine', () => {
  it('takes the larger of two quantity opinions', () => {
    /*
     * `Math.max`, and the reasoning is asymmetric on purpose: a spare pair of
     * socks costs a little space, and arriving one short costs the evening.
     */
    expect(
      bothWays([
        rule({ ruleType: 'per_day', quantityValue: 1 }),
        rule({ ruleType: 'per_day', quantityValue: 2 }),
      ]),
    ).toBe(20)
  })

  /*
   * The example from Alex's second ruling, verbatim: ten days, `2 per day` and
   * `fixed per trip = 3`, and the answer is 20 whichever way round the database
   * hands them over.
   *
   * This assertion used to be the opposite. `fixed_per_trip` ASSIGNED the base,
   * so the same pair gave 3 or 20 depending on row order, and the old test
   * pinned that gap deliberately so the decision could not be forgotten. This is
   * the decision.
   */
  it('treats `always pack 3` as a floor, not as a replacement', () => {
    expect(
      bothWays([
        rule({ ruleType: 'per_day', quantityValue: 2 }),
        rule({ ruleType: 'fixed_per_trip', quantityValue: 3 }),
      ]),
    ).toBe(20)
  })

  it('still uses the fixed quantity when it is the larger one', () => {
    // A floor that is not reached by anything else is the answer, which is what
    // makes it a floor rather than a no-op.
    expect(
      bothWays([
        rule({ ruleType: 'per_day', quantityValue: 1 }),
        rule({ ruleType: 'fixed_per_trip', quantityValue: 30 }),
      ]),
    ).toBe(30)
  })

  it('is order-independent with several applicable rules of different kinds', () => {
    /*
     * Five rules, every combining behaviour represented: a fixed floor, two
     * per-duration counts, a minimum and a spare. Reversal is the crude check;
     * what it is really asserting is that no rule in the set ASSIGNS.
     */
    const rules = [
      rule({ ruleType: 'fixed_per_trip', quantityValue: 3 }),
      rule({ ruleType: 'per_day', quantityValue: 2 }),
      rule({ ruleType: 'per_night', quantityValue: 1 }),
      rule({ ruleType: 'minimum', quantityValue: 4 }),
      rule({ ruleType: 'spare', quantityValue: 2 }),
    ]
    expect(bothWays(rules)).toBe(22)
  })

  it('gives the same explanation whichever order the rules arrive in', () => {
    // The quantity being stable is not enough. `qtyBreakdown` IS the explanation
    // Alex reads, and a row whose reasoning is written differently on two
    // regenerations of the same trip is a row he cannot trust.
    const rules = [
      rule({ ruleType: 'per_day', quantityValue: 2 }),
      rule({ ruleType: 'fixed_per_trip', quantityValue: 3 }),
      rule({ ruleType: 'spare', quantityValue: 1 }),
    ]
    const forwards = computeQuantity(rules, context()).breakdown.map((s) => s.label)
    const backwards = computeQuantity([...rules].reverse(), context()).breakdown.map((s) => s.label)
    expect(forwards).toEqual(backwards)
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
    expect(
      bothWays([
        rule({ ruleType: 'per_day', quantityValue: 1 }),
        rule({ ruleType: 'spare', quantityValue: 2 }),
      ]),
    ).toBe(12)
  })

  it('lets a minimum raise and a maximum lower the answer', () => {
    expect(
      bothWays([
        rule({ ruleType: 'fixed_per_trip', quantityValue: 1 }),
        rule({ ruleType: 'minimum', quantityValue: 4 }),
      ]),
    ).toBe(4)

    expect(
      bothWays([
        rule({ ruleType: 'per_day', quantityValue: 2 }),
        rule({ ruleType: 'maximum', quantityValue: 6 }),
      ]),
    ).toBe(6)
  })
})

/* ------------------------------------------------------------------ */

describe('a user rule may ask for fewer, but only by replacing a default', () => {
  const systemUnderwear = rule({
    id: 'system-underwear',
    ruleType: 'per_day',
    quantityValue: 2,
    source: 'system',
  })

  it('applies a lower quantity when the user explicitly overrode the default', () => {
    // Alex's ruling, in its own words: system says 2 per day, he edits it to 1,
    // the answer is 1 per day. Impossible before migration 0011, because there
    // was no way for a rule to say WHICH default it was replacing.
    const override = rule({
      id: 'user-underwear',
      ruleType: 'per_day',
      quantityValue: 1,
      source: 'user',
      supersedesRuleId: 'system-underwear',
    })

    expect(bothWays([systemUnderwear, override])).toBe(10)
  })

  it('restores the default exactly when the override is removed', () => {
    // The other half of the same ruling, and the reason overriding is safe: the
    // system rule was never touched, so removing Alex's copy is a return to the
    // original rather than an attempt to reconstruct it.
    expect(quantityOf([systemUnderwear])).toBe(20)
  })

  it('does NOT reduce a default when the user writes an unrelated rule', () => {
    /*
     * The failure mode Alex named explicitly. A separate rule for a different
     * circumstance must not be read as a quiet reduction — and here the unrelated
     * rule asks for a SMALLER number than the default, which is precisely the
     * case a naive "the user wins" rule would get wrong.
     */
    const unrelated = rule({
      id: 'user-unrelated',
      ruleType: 'minimum',
      quantityValue: 1,
      source: 'user',
      supersedesRuleId: null,
    })

    expect(bothWays([systemUnderwear, unrelated])).toBe(20)
  })

  it('lets a user rule raise a default, since combining is the default behaviour', () => {
    const extra = rule({
      ruleType: 'minimum',
      quantityValue: 25,
      source: 'user',
      supersedesRuleId: null,
    })
    expect(bothWays([systemUnderwear, extra])).toBe(25)
  })

  it('keeps system and user rules distinguishable', () => {
    // Not a behaviour so much as the schema fact everything above rests on. If
    // `source` ever stops arriving, the override tests would still pass on the
    // strength of `supersedesRuleId` alone, and the distinction the interface
    // shows would be gone with nothing failing.
    const seeded = rule({ ruleType: 'per_day', quantityValue: 2 })
    const mine = rule({ ruleType: 'minimum', quantityValue: 3, source: 'user' })
    const learned = rule({ ruleType: 'maximum', quantityValue: 9, source: 'learned' })

    expect([seeded.source, mine.source, learned.source]).toEqual(['system', 'user', 'learned'])
  })

  it('drops a superseded default however the rules are ordered', () => {
    const override = rule({
      ruleType: 'per_day',
      quantityValue: 1,
      source: 'user',
      supersedesRuleId: 'system-underwear',
    })

    const forwards = applyPrecedence([systemUnderwear, override]).map((r) => r.id)
    const backwards = applyPrecedence([override, systemUnderwear]).map((r) => r.id)
    expect(forwards).toEqual([override.id])
    expect(backwards).toEqual([override.id])
  })

  it('lets a DISABLED override switch a default off', () => {
    /*
     * How "turn this default off" is stored, and the reason `applyPrecedence`
     * deliberately ignores `enabled` on the replacing rule: the override
     * contributes nothing, but it still supersedes. Skipping disabled rules
     * before resolving would resurrect the very default it was written to
     * silence.
     */
    const off = rule({
      ruleType: 'per_day',
      quantityValue: 2,
      source: 'user',
      enabled: false,
      supersedesRuleId: 'system-underwear',
    })

    expect(bothWays([systemUnderwear, off])).toBeNull()
  })
})

/* ------------------------------------------------------------------ */

describe('a gate beats a quantity', () => {
  it('packs nothing when the condition fails, however large the quantity', () => {
    /*
     * The property that makes order irrelevant. A `per_day` rule saying "two a
     * day" must not smuggle an item onto a list whose condition says it does not
     * belong there.
     */
    expect(
      bothWays(
        [
          rule({ ruleType: 'per_day', quantityValue: 2 }),
          rule({
            ruleType: 'conditional_include',
            condition: { fact: 'international', eq: true },
          }),
        ],
        { international: false },
      ),
    ).toBeNull()
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

  it('reports incomplete even when another gate had already said no', () => {
    /*
     * Two gates, one answering "no" and one answering "the trip never said".
     * Evaluating them inline returned at the first failure, so whether the row
     * came back marked incomplete depended on which rule the database listed
     * first — a needs-answer prompt that appeared or vanished with row order.
     */
    const rules = [
      rule({ ruleType: 'conditional_include', condition: { fact: 'international', eq: true } }),
      rule({ ruleType: 'conditional_include', condition: { fact: 'laundry_available', eq: true } }),
    ]
    const facts = { international: false }

    expect(computeQuantity(rules, context(facts)).incomplete).toBe(true)
    expect(computeQuantity([...rules].reverse(), context(facts)).incomplete).toBe(true)
  })

  it('packs when the condition holds', () => {
    expect(
      quantityOf(
        [
          rule({
            ruleType: 'conditional_include',
            quantityValue: 1,
            condition: { fact: 'flight_hours', gt: 5 },
          }),
        ],
        { flight_hours: 7 },
      ),
    ).toBe(1)
  })

  it('lets a counting rule decide the quantity a gate merely permitted', () => {
    // The gate says "pack this"; the per-day rule says how many. Which of them
    // was listed first used to decide whether the answer was 1 or 20.
    expect(
      bothWays(
        [
          rule({
            ruleType: 'conditional_include',
            quantityValue: 1,
            condition: { fact: 'international', eq: true },
          }),
          rule({ ruleType: 'per_day', quantityValue: 2 }),
        ],
        { international: true },
      ),
    ).toBe(20)
  })
})

describe('a disabled rule is not a rule', () => {
  it('contributes nothing at all', () => {
    expect(
      bothWays([
        rule({ ruleType: 'per_day', quantityValue: 1 }),
        rule({ ruleType: 'per_day', quantityValue: 5, enabled: false }),
      ]),
    ).toBe(10)
  })

  it('cannot gate anything either', () => {
    // A disabled condition must not keep an item off the list — otherwise
    // turning a rule off would silently be a way of turning an item off.
    expect(
      bothWays(
        [
          rule({ ruleType: 'fixed_per_trip', quantityValue: 1 }),
          rule({
            ruleType: 'conditional_include',
            condition: { fact: 'international', eq: true },
            enabled: false,
          }),
        ],
        { international: false },
      ),
    ).toBe(1)
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

  it('says "at least" for a fixed quantity above one, because that is what it now means', () => {
    const result = computeQuantity([rule({ ruleType: 'fixed_per_trip', quantityValue: 3 })], context())
    expect(result.breakdown.map((s) => s.label)).toEqual(['at least 3'])
  })
})
