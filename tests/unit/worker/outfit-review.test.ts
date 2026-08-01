import { describe, expect, it } from 'vitest'
import {
  coverageBreakdown,
  coverageSentence,
  formalityLabel,
  uncoveredNeeds,
  isUnresolved,
  needsReviewNow,
  outfitCoverage,
  outfitFit,
  outfitMarkers,
  reviewProgress,
  templateFor,
  TRAVEL_TEMPLATE,
  EVERYDAY_TEMPLATE,
  type ReviewableGroup,
} from '@shared/outfits'

/**
 * The vocabulary the guided review speaks (doc 09 §7).
 *
 * Pure functions, tested on their own, because everything the screen states
 * about an outfit comes through here — and a review that says the wrong thing
 * confidently is worse than no review, which is the whole reason §7 lists what
 * must be shown rather than leaving it to a designer's judgement.
 */

function group(over: Partial<ReviewableGroup> = {}): ReviewableGroup {
  return {
    name: 'Casual days',
    activityTag: null,
    occurrences: 1,
    status: 'draft',
    deferredAt: null,
    slots: [],
    ...over,
  }
}

let itemCounter = 0
const filled = (roleLabel: string, wearings = 1) => ({
  roleLabel,
  required: true,
  itemId: `item-${(itemCounter += 1)}`,
  wearings,
})

/* ------------------------------------------------------------------ */

describe('which template a stored group came from', () => {
  it('resolves an activity group by its tag', () => {
    expect(templateFor('nice_dinner')?.name).toBe('Nice dinners')
  })

  /*
   * The gap this closes: `outfit_group.activity_tag` is NULL for both untagged
   * templates, so a stored travel outfit and a stored ordinary day were
   * indistinguishable — and doc 09 §7 asks for travel-day outfits to be marked.
   */
  it('tells the two untagged templates apart by name', () => {
    expect(templateFor(null, 'Travel days')).toBe(TRAVEL_TEMPLATE)
    expect(templateFor(null, 'Casual days')).toBe(EVERYDAY_TEMPLATE)
  })

  it('says nothing rather than guessing for a name it does not know', () => {
    expect(templateFor(null, 'Something Alex renamed')).toBeNull()
    expect(templateFor(null)).toBeNull()
  })

  it('states the band the template actually carries', () => {
    expect(formalityLabel(TRAVEL_TEMPLATE)).toBe('Loungewear to Smart casual')
    expect(formalityLabel(templateFor('wedding')!)).toBe('Dressy to Formal')
  })
})

describe('what an outfit is marked as', () => {
  it('marks a travel-day outfit, which grouping alone never did', () => {
    const markers = outfitMarkers(group({ name: 'Travel days', occurrences: 2 }))
    expect(markers.map((m) => m.label)).toContain('Travel days')
  })

  it('marks an outfit worn on several days', () => {
    expect(outfitMarkers(group({ occurrences: 4 })).map((m) => m.label)).toContain('Worn 4 days')
    expect(outfitMarkers(group({ occurrences: 1 })).map((m) => m.label)).not.toContain('Worn 1 days')
  })

  it('does not call an ordinary single day a travel day', () => {
    expect(outfitMarkers(group({ name: 'Casual days' }))).toEqual([])
  })

  it('says a deferred outfit is not on the packing list', () => {
    const markers = outfitMarkers(group({ deferredAt: 1_800_000_000 }))
    const deferred = markers.find((m) => m.label === 'Decided later')
    expect(deferred?.detail).toMatch(/not on your packing list/i)
  })

  /*
   * An approved outfit whose deferral was never cleared would be a contradiction
   * on screen: "on your packing list" and "not on your packing list until you
   * approve it", together. The repo clears it on approval; this makes the
   * vocabulary safe even if a row somewhere carries both.
   */
  it('never marks an approved outfit as left for later', () => {
    const markers = outfitMarkers(group({ status: 'approved', deferredAt: 1_800_000_000 }))
    expect(markers.map((m) => m.label)).not.toContain('Decided later')
  })

  it('says an incomplete outfit cannot be approved yet', () => {
    const markers = outfitMarkers(group({ status: 'incomplete' }))
    expect(markers.find((m) => m.label === 'Missing something')?.detail).toMatch(/cannot be approved/i)
  })
})

describe('what counts as decided', () => {
  it('treats a deferral as unresolved, never as an answer', () => {
    expect(isUnresolved(group({ status: 'draft' }))).toBe(true)
    expect(isUnresolved(group({ status: 'approved' }))).toBe(false)
    // The clause that matters most: deciding later must not quietly count as done.
    expect(isUnresolved(group({ status: 'draft', deferredAt: 1 }))).toBe(true)
  })

  it('stops the walkthrough only where an answer is still wanted', () => {
    expect(needsReviewNow(group())).toBe(true)
    expect(needsReviewNow(group({ deferredAt: 1 }))).toBe(false)
    expect(needsReviewNow(group({ status: 'approved' }))).toBe(false)
    // Incomplete still stops it — it is the outfit most in need of attention.
    expect(needsReviewNow(group({ status: 'incomplete' }))).toBe(true)
  })
})

describe('the coverage summary', () => {
  it('counts days covered and outfits approved as different things', () => {
    const coverage = outfitCoverage([
      group({ status: 'approved', occurrences: 6 }),
      group({ status: 'approved', occurrences: 4 }),
      group({ status: 'draft', occurrences: 2 }),
    ])

    expect(coverage.needs).toBe(12)
    expect(coverage.covered).toBe(10)
    expect(coverage.approvedGroups).toBe(2)
    expect(coverage.unresolved).toBe(1)
  })

  it('speaks doc 09 §7’s own sentence once every need is covered', () => {
    const coverage = outfitCoverage([
      group({ status: 'approved', occurrences: 6 }),
      group({ status: 'approved', occurrences: 4 }),
    ])
    expect(coverageSentence(coverage)).toBe('10 outfit needs covered by 2 approved outfits.')
  })

  /*
   * The failure this exists to prevent: seven approved outfits covering six days
   * of twelve, reported as "10 outfit needs covered" because the shortfall was
   * never in the sentence.
   */
  it('states the shortfall rather than the total when there is one', () => {
    const coverage = outfitCoverage([
      group({ status: 'approved', occurrences: 6 }),
      group({ status: 'draft', occurrences: 6 }),
    ])
    expect(coverageSentence(coverage)).toBe('6 of 12 outfit needs covered by 1 approved outfit.')
  })

  it('says so plainly when nothing has been approved', () => {
    const coverage = outfitCoverage([group({ occurrences: 3 }), group({ occurrences: 1 })])
    expect(coverageSentence(coverage)).toBe('4 outfit needs to cover, none approved yet.')
  })

  it('counts a deferral as reviewed but never as covered', () => {
    const coverage = outfitCoverage([
      group({ status: 'approved', occurrences: 2 }),
      group({ status: 'draft', deferredAt: 1, occurrences: 2 }),
      group({ status: 'draft', occurrences: 2 }),
    ])

    expect(coverage.reviewed).toBe(2)
    expect(coverage.deferred).toBe(1)
    expect(coverage.covered).toBe(2)
    expect(coverage.unresolved).toBe(2)
    expect(reviewProgress(coverage)).toBe('2 of 3 outfits reviewed')
  })

  it('says nothing about coverage for a trip with no outfits', () => {
    expect(coverageSentence(outfitCoverage([]))).toBe('No outfits planned yet.')
  })

  it('names the days no approved outfit covers', () => {
    const coverage = outfitCoverage([
      group({ status: 'approved', occurrences: 8 }),
      group({ status: 'draft', occurrences: 4 }),
    ])
    expect(uncoveredNeeds(coverage)).toBe(4)
    expect(uncoveredNeeds(outfitCoverage([group({ status: 'approved', occurrences: 3 })]))).toBe(0)
  })
})

describe('the breakdown behind the sentence', () => {
  it('reports each category doc 09 §7 names', () => {
    const parts = coverageBreakdown([
      group({ status: 'approved' }),
      group({ status: 'draft', deferredAt: 1 }),
      group({ status: 'incomplete' }),
      group({ status: 'draft' }),
    ])
    expect(parts).toEqual(['1 approved', '1 left for later', '1 missing a piece', '1 not reviewed'])
  })

  /*
   * The reason this takes the groups rather than the coverage.
   *
   * A deferred INCOMPLETE outfit is counted by both `coverage.deferred` and
   * `coverage.incomplete` — correctly, since both are true of it. A breakdown
   * built by adding those two would count it twice and then report a negative
   * remainder, which is a summary that contradicts its own headline.
   */
  it('puts a deferred incomplete outfit in exactly one bucket', () => {
    const groups = [
      group({ status: 'approved' }),
      group({ status: 'incomplete', deferredAt: 1 }),
    ]
    const parts = coverageBreakdown(groups)

    expect(parts).toEqual(['1 approved', '1 left for later'])
    // The parts always sum to the total. That is the whole guarantee.
    const total = parts.reduce((sum, part) => sum + Number(part.split(' ')[0]), 0)
    expect(total).toBe(groups.length)
  })

  it('says nothing about a category with nothing in it', () => {
    expect(coverageBreakdown([group({ status: 'approved' })])).toEqual(['1 approved'])
    expect(coverageBreakdown([])).toEqual([])
  })

  it('sums to the total for every mixture', () => {
    const mixtures: ReviewableGroup[][] = [
      [group({ status: 'draft' }), group({ status: 'draft' })],
      [group({ status: 'incomplete' }), group({ status: 'incomplete', deferredAt: 2 })],
      [
        group({ status: 'approved', deferredAt: 3 }),
        group({ status: 'draft', deferredAt: 4 }),
        group({ status: 'incomplete' }),
        group({ status: 'draft' }),
      ],
    ]

    for (const groups of mixtures) {
      const total = coverageBreakdown(groups).reduce(
        (sum, part) => sum + Number(part.split(' ')[0]),
        0,
      )
      expect(total, JSON.stringify(groups.map((g) => [g.status, g.deferredAt]))).toBe(groups.length)
    }
  })
})

describe('why an outfit fits', () => {
  /*
   * Never the formality band, and never the weather. The review already shows
   * both as labelled facts, and the first draft repeated the band immediately
   * beneath its own label — one fact looking like two, which is the opposite of
   * an explanation.
   */
  it('says what the filter guaranteed without repeating the facts above it', () => {
    const [first] = outfitFit(group({ name: 'Nice dinners', activityTag: 'nice_dinner' }))
    expect(first).toBe('Every piece suits nice dinners at that level of dress.')
    expect(first).not.toContain(formalityLabel(templateFor('nice_dinner')!))
  })

  it('explains the day arithmetic when several garments cover one group', () => {
    const lines = outfitFit(
      group({
        name: 'Casual days',
        occurrences: 3,
        slots: [filled('Top'), filled('Top'), filled('Top'), filled('Bottoms', 3)],
      }),
    )
    expect(lines).toContain('3 changes of top across the 3 days.')
  })

  it('says nothing about days for an outfit worn once', () => {
    const lines = outfitFit(
      group({ name: 'Nice dinners', activityTag: 'nice_dinner', slots: [filled('Top')] }),
    )
    expect(lines).toHaveLength(1)
  })

  /*
   * The honesty requirement, asserted rather than assumed: nothing here may read
   * a brand, a colour or a garment's name to decide what it can do. The fit
   * lines are built from the template's band and from `wearings`, so a group
   * whose template is unknown says less rather than something invented.
   */
  it('says nothing about formality for a group it cannot place', () => {
    expect(outfitFit(group({ name: 'Renamed by Alex', occurrences: 1 }))).toEqual([])
  })
})
