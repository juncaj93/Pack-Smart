import { describe, expect, it } from 'vitest'
import {
  isOutstanding,
  reviewProposals,
  summaryLines,
  type ReviewAnswer,
  type ReviewContext,
  type ReviewItemFacts,
  type ReviewObservations,
  type ReviewOutfitFacts,
  type ReviewRule,
} from '@shared/review'

/**
 * The post-trip review's model (F1, doc 09 §16).
 *
 * The tests that matter here are the REFUSALS, for the same reason they are in
 * `learning.test.ts`: a proposal Alex disagrees with costs more than one never
 * made. Three of them exist only because the engine makes them possible to get
 * wrong — proposing against a deliberate removal, capping an item that has
 * nothing left to step down, and rewriting a rule he wrote himself.
 */

function observations(overrides: Partial<ReviewObservations> = {}): ReviewObservations {
  return {
    bringing: 40,
    packed: 38,
    wearLogUsed: true,
    unworn: [],
    removed: [],
    outfitsApproved: 3,
    ...overrides,
  }
}

function rule(overrides: Partial<ReviewRule> = {}): ReviewRule {
  return {
    id: 'rule-1',
    ruleType: 'per_day',
    quantityValue: 2,
    source: 'system',
    enabled: true,
    ...overrides,
  }
}

function item(overrides: Partial<ReviewItemFacts> = {}): ReviewItemFacts {
  return {
    itemId: 'socks',
    itemName: 'Wool Socks',
    onTripList: true,
    excludedOnTrip: false,
    rules: [],
    ...overrides,
  }
}

function outfit(overrides: Partial<ReviewOutfitFacts> = {}): ReviewOutfitFacts {
  return {
    groupId: 'group-1',
    name: 'Safari mornings',
    approved: true,
    hasGarments: true,
    ...overrides,
  }
}

function answer(overrides: Partial<ReviewAnswer> = {}): ReviewAnswer {
  return {
    id: 'answer-1',
    kind: 'forgot',
    itemId: null,
    outfitGroupId: null,
    note: null,
    resolution: 'pending',
    ...overrides,
  }
}

function context(
  items: ReviewItemFacts[] = [],
  outfits: ReviewOutfitFacts[] = [],
): ReviewContext {
  return {
    items: new Map(items.map((facts) => [facts.itemId, facts])),
    outfits: new Map(outfits.map((facts) => [facts.groupId, facts])),
  }
}

function only(answers: ReviewAnswer[], ctx: ReviewContext) {
  const [proposal] = reviewProposals(answers, ctx)
  if (!proposal) throw new Error('no proposal')
  return proposal
}

/* ------------------------------------------------------------------ */

describe('the summary, which is shown rather than asked', () => {
  it('states what was packed and what came home unworn', () => {
    const lines = summaryLines(observations({ unworn: ['Rain Shell'] }))

    expect(lines.join(' ')).toContain('38 of 40')
    expect(lines.join(' ')).toContain('Rain Shell came home unworn')
  })

  /*
   * The guard that makes the whole block trustworthy, and the same one
   * `pendingUnwornProposals` applies across trips: on a trip where Today was
   * never opened, EVERY packed item looks unworn. Claiming that as a finding
   * would be confidently wrong about the entire wardrobe.
   */
  it('says nobody was watching rather than claiming nothing was worn', () => {
    const lines = summaryLines(observations({ wearLogUsed: false, unworn: [] }))

    expect(lines.join(' ')).toContain('did not use Today')
    expect(lines.join(' ')).not.toContain('worn at least once')
  })

  it('does not claim an empty trip packed anything', () => {
    const lines = summaryLines(
      observations({ bringing: 0, packed: 0, outfitsApproved: 0, wearLogUsed: false }),
    )

    expect(lines.some((line) => line.includes('of 0'))).toBe(false)
  })

  it('names what was taken off the list', () => {
    const lines = summaryLines(observations({ removed: ['Travel Iron', 'Swimsuit'] }))

    expect(lines.join(' ')).toContain('Travel Iron and Swimsuit')
  })

  it('stops naming names past four', () => {
    const lines = summaryLines(observations({ unworn: ['A', 'B', 'C', 'D', 'E'] }))

    expect(lines.join(' ')).toContain('and 2 more')
  })
})

/* ------------------------------------------------------------------ */

describe('what did you forget', () => {
  it('offers to pack something that was never on the list', () => {
    const proposal = only(
      [answer({ kind: 'forgot', itemId: 'adapter' })],
      context([item({ itemId: 'adapter', itemName: 'Plug Adapter', onTripList: false })]),
    )

    expect(proposal.message).toContain('Plug Adapter')
    expect(proposal.effect).toContain('every trip')
    expect(proposal.change).toEqual({ kind: 'always_pack', itemId: 'adapter' })
  })

  /*
   * The refusal this question most needs.
   *
   * "Always pack it" against a row Alex deliberately took off this trip is the
   * app arguing with a decision he already made — and it is the same item the
   * EXISTING removal proposal may be counting towards "stop suggesting this".
   * Two halves of one product pulling in opposite directions.
   */
  it('refuses to propose against something he removed himself', () => {
    const proposal = only(
      [answer({ kind: 'forgot', itemId: 'iron' })],
      context([item({ itemId: 'iron', itemName: 'Travel Iron', excludedOnTrip: true })]),
    )

    expect(proposal.change).toBeNull()
    expect(proposal.limitation).toContain('took it off')
  })

  it('says so when it was on the list and simply never ticked', () => {
    const proposal = only(
      [answer({ kind: 'forgot', itemId: 'socks' })],
      context([item({ onTripList: true })]),
    )

    expect(proposal.change).toBeNull()
    expect(proposal.limitation).toContain('already on this trip')
  })

  it('does not add a second always-pack rule to something that has one', () => {
    const proposal = only(
      [answer({ kind: 'forgot', itemId: 'socks' })],
      context([item({ onTripList: false, rules: [rule({ ruleType: 'fixed_per_trip', quantityValue: 1 })] })]),
    )

    expect(proposal.change).toBeNull()
  })

  it('records something he does not own, and says there is no rule for it', () => {
    const proposal = only([answer({ kind: 'forgot', note: 'European plug adapter' })], context())

    expect(proposal.message).toContain('European plug adapter')
    expect(proposal.change).toBeNull()
    expect(proposal.limitation).toContain('My Stuff')
  })
})

/* ------------------------------------------------------------------ */

describe('did you run out', () => {
  /*
   * A spare, not a bigger rate and not a floor. Running out once on a twelve-day
   * trip means one more than the trip worked out — a `minimum` of 8 would also
   * apply to a weekend, and stepping the rate up would add twelve pairs.
   */
  it('adds one spare rather than raising the rate', () => {
    const proposal = only(
      [answer({ kind: 'ran_out', itemId: 'socks' })],
      context([item({ rules: [rule({ ruleType: 'per_day', quantityValue: 1 })] })]),
    )

    expect(proposal.change).toEqual({
      kind: 'add_spare',
      itemId: 'socks',
      spareRuleId: null,
      to: 1,
    })
    expect(proposal.effect).toContain('one spare')
  })

  it('raises an existing spare by one rather than adding a second rule', () => {
    const proposal = only(
      [answer({ kind: 'ran_out', itemId: 'socks' })],
      context([item({ rules: [rule({ id: 'spare-1', ruleType: 'spare', quantityValue: 1 })] })]),
    )

    expect(proposal.change).toEqual({
      kind: 'add_spare',
      itemId: 'socks',
      spareRuleId: 'spare-1',
      to: 2,
    })
  })
})

/* ------------------------------------------------------------------ */

describe('was there too much', () => {
  it('steps the rate down, because the rate is what produced the number', () => {
    const proposal = only(
      [answer({ kind: 'too_many', itemId: 'socks' })],
      context([item({ rules: [rule({ id: 'per-day', ruleType: 'per_day', quantityValue: 2 })] })]),
    )

    expect(proposal.change).toEqual({ kind: 'step_down', ruleId: 'per-day', to: 1 })
    expect(proposal.effect).toContain('1 per day')
  })

  it('removes a spare when there is no rate to step', () => {
    const proposal = only(
      [answer({ kind: 'too_many', itemId: 'socks' })],
      context([item({ rules: [rule({ id: 'spare-1', ruleType: 'spare', quantityValue: 1 })] })]),
    )

    expect(proposal.change).toEqual({ kind: 'remove_spare', ruleId: 'spare-1' })
  })

  it('steps a flat count down when that is what decided it', () => {
    const proposal = only(
      [answer({ kind: 'too_many', itemId: 'socks' })],
      context([item({ rules: [rule({ id: 'flat', ruleType: 'fixed_per_trip', quantityValue: 3 })] })]),
    )

    expect(proposal.change).toEqual({ kind: 'step_down', ruleId: 'flat', to: 2 })
  })

  /*
   * The refusal that keeps this honest.
   *
   * A `maximum` would satisfy the question and silently apply a three-day
   * trip's number to a thirty-day one — a cap that looks like learning and is a
   * bug waiting for a long trip.
   */
  it('proposes nothing rather than capping an item already at its smallest', () => {
    const proposal = only(
      [answer({ kind: 'too_many', itemId: 'socks' })],
      context([item({ rules: [rule({ ruleType: 'per_day', quantityValue: 1 })] })]),
    )

    expect(proposal.change).toBeNull()
    expect(proposal.limitation).toContain('smallest number')
  })

  it('ignores a rule that is switched off', () => {
    const proposal = only(
      [answer({ kind: 'too_many', itemId: 'socks' })],
      context([item({ rules: [rule({ ruleType: 'per_day', quantityValue: 4, enabled: false })] })]),
    )

    expect(proposal.change).toBeNull()
  })
})

/* ------------------------------------------------------------------ */

describe('a rule Alex wrote himself', () => {
  /*
   * `11_RULE_PRECEDENCE.md`: an explicit user rule outranks anything learned.
   * The proposal may still be shown and still be accepted — refusing outright
   * would make his own setting unreachable from the screen that has just been
   * told it is wrong — but it may never happen quietly.
   */
  it('names the conflict rather than changing it silently', () => {
    const proposal = only(
      [answer({ kind: 'too_many', itemId: 'socks' })],
      context([
        item({ rules: [rule({ id: 'mine', ruleType: 'per_day', quantityValue: 3, source: 'user' })] }),
      ]),
    )

    expect(proposal.conflict).toContain('yourself')
    expect(proposal.change).toEqual({ kind: 'step_down', ruleId: 'mine', to: 2 })
  })

  it('says nothing about a system default, which is not his to defend', () => {
    const proposal = only(
      [answer({ kind: 'too_many', itemId: 'socks' })],
      context([item({ rules: [rule({ source: 'system' })] })]),
    )

    expect(proposal.conflict).toBeNull()
  })

  it('says nothing about a rule it taught itself', () => {
    const proposal = only(
      [answer({ kind: 'too_many', itemId: 'socks' })],
      context([item({ rules: [rule({ source: 'learned' })] })]),
    )

    expect(proposal.conflict).toBeNull()
  })
})

/* ------------------------------------------------------------------ */

describe('the outfit that was wrong', () => {
  it('offers to forget the pairing without touching the trip', () => {
    const proposal = only(
      [answer({ kind: 'outfit_wrong', outfitGroupId: 'group-1' })],
      context([], [outfit()]),
    )

    expect(proposal.change).toEqual({ kind: 'forget_pairings', outfitGroupId: 'group-1' })
    expect(proposal.effect).toContain('does not change')
  })

  // Only an approval wrote pairings, so only an approval has any to forget.
  it('proposes nothing for an outfit that was never approved', () => {
    const proposal = only(
      [answer({ kind: 'outfit_wrong', outfitGroupId: 'group-1' })],
      context([], [outfit({ approved: false })]),
    )

    expect(proposal.change).toBeNull()
    expect(proposal.limitation).toContain('never approved')
  })

  it('proposes nothing for an outfit with no garments in it', () => {
    const proposal = only(
      [answer({ kind: 'outfit_wrong', outfitGroupId: 'group-1' })],
      context([], [outfit({ hasGarments: false })]),
    )

    expect(proposal.change).toBeNull()
  })
})

/* ------------------------------------------------------------------ */

describe('the question with no rule behind it', () => {
  it('records the note and does not pretend to have learned anything', () => {
    const proposal = only(
      [answer({ kind: 'missing_from_screen', note: 'No reminder to charge the camera' })],
      context(),
    )

    expect(proposal.message).toContain('charge the camera')
    expect(proposal.change).toBeNull()
    expect(proposal.effect).toBeNull()
    expect(proposal.limitation).toContain('cannot change a screen')
  })
})

/* ------------------------------------------------------------------ */

describe('what is still waiting on a decision', () => {
  it('counts a pending proposal that has something to apply', () => {
    const proposal = only(
      [answer({ kind: 'ran_out', itemId: 'socks' })],
      context([item()]),
    )

    expect(isOutstanding(proposal)).toBe(true)
  })

  it('does not count one that has already been answered', () => {
    const proposal = only(
      [answer({ kind: 'ran_out', itemId: 'socks', resolution: 'declined' })],
      context([item()]),
    )

    expect(isOutstanding(proposal)).toBe(false)
  })

  // Nothing to apply is nothing to decide. Counting these would put a number on
  // screen that no tap can ever reduce.
  it('does not count one with nothing to apply', () => {
    const proposal = only(
      [answer({ kind: 'missing_from_screen', note: 'something' })],
      context(),
    )

    expect(isOutstanding(proposal)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */

describe('what the pickers must stop offering', () => {
  it('carries the subject through, so a question is not asked twice', () => {
    const proposals = reviewProposals(
      [
        answer({ id: 'a', kind: 'ran_out', itemId: 'socks' }),
        answer({ id: 'b', kind: 'outfit_wrong', outfitGroupId: 'group-1' }),
      ],
      context([item()], [outfit()]),
    )

    expect(proposals[0]?.itemId).toBe('socks')
    expect(proposals[1]?.outfitGroupId).toBe('group-1')
  })
})
