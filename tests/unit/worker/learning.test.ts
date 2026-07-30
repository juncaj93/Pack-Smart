import { describe, expect, it } from 'vitest'
import { REMOVAL_THRESHOLD, removalProposals, type RemovalRow } from '@shared/learning'

/**
 * Learning from repeated removals (product doc 04 §7).
 *
 * The tests that matter are the REFUSALS. A suggestion Alex disagrees with costs
 * more than one never made — it teaches him the panel is wrong, and then the
 * useful suggestions get dismissed too.
 */

function row(overrides: Partial<RemovalRow> = {}): RemovalRow {
  return {
    itemId: 'travel-iron',
    itemName: 'Travel Iron',
    trips: REMOVAL_THRESHOLD,
    ruleId: 'rule-1',
    isCritical: false,
    ...overrides,
  }
}

describe('what it offers', () => {
  it('offers to stop adding something taken off enough trips', () => {
    const [proposal] = removalProposals([row()])

    expect(proposal?.itemName).toBe('Travel Iron')
    expect(proposal?.ruleId).toBe('rule-1')
    expect(proposal?.message).toContain('3 trips')
  })

  // Explainability: the sentence has to say what was seen, in his terms.
  it('says what it observed and what accepting does', () => {
    const [proposal] = removalProposals([row({ trips: 5 })])

    expect(proposal?.message).toContain('Travel Iron')
    expect(proposal?.message).toContain('5 trips')
    expect(proposal?.effect).toContain('Packing rules')
  })

  it('puts the strongest evidence first', () => {
    const proposals = removalProposals([
      row({ itemId: 'a', itemName: 'A', ruleId: 'ra', trips: 3 }),
      row({ itemId: 'b', itemName: 'B', ruleId: 'rb', trips: 7 }),
    ])

    expect(proposals.map((p) => p.itemName)).toEqual(['B', 'A'])
  })

  it('orders ties by name, so the list never wobbles', () => {
    const proposals = removalProposals([
      row({ itemId: 'z', itemName: 'Zebra Towel', ruleId: 'rz' }),
      row({ itemId: 'a', itemName: 'Apple Corer', ruleId: 'ra' }),
    ])

    expect(proposals.map((p) => p.itemName)).toEqual(['Apple Corer', 'Zebra Towel'])
  })
})

describe('what it refuses to offer', () => {
  /*
   * Two is a coincidence — a swimsuit removed from two winter trips says nothing
   * about the summer. Three separate trips is a habit.
   */
  it('stays quiet below the threshold', () => {
    expect(removalProposals([row({ trips: REMOVAL_THRESHOLD - 1 })])).toEqual([])
  })

  /*
   * THE safety interaction. A critical item with no enabled rule can never reach
   * a list (doc 02 §9c), so accepting such a proposal would manufacture exactly
   * the silent omission that check exists to catch — the app would help Alex
   * disable his own passport and then warn him about it.
   */
  it('never offers to stop adding something marked essential', () => {
    expect(removalProposals([row({ itemName: 'Passport', isCritical: true, trips: 9 })])).toEqual([])
  })

  // A proposal that cannot be honoured is worse than none.
  it('does not offer when there is no rule to turn off', () => {
    expect(removalProposals([row({ ruleId: null, trips: 9 })])).toEqual([])
  })

  it('offers nothing at all from an empty history', () => {
    expect(removalProposals([])).toEqual([])
  })
})
