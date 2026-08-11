import { describe, expect, it } from 'vitest'
import { readiness, type ReadinessInput } from '@shared/readiness'
import type { ChecklistEntry } from '@shared/checklist'
import type { Trip } from '@shared/trips'

/**
 * "Am I basically ready?"
 *
 * The summary REPORTS; `next` still decides. That separation is the contract
 * this file exists to hold: doc 09 §2 makes `next` exactly one action, and a
 * summary that quietly reordered the ladder would be two screens disagreeing
 * about what to do next again — the thing the readiness model was written to
 * end.
 *
 * The other half is where the facts come from. Every line is COUNTED from a
 * result computed elsewhere — `coverageGaps`, `bagProblems`, the outfit rows.
 * Readiness does not know what swimwear is, and these tests are written so that
 * it cannot start knowing: they pass coverage gaps as opaque sentences, so a
 * version that grew its own swim rules could not satisfy them.
 *
 * And what it reports is PLANNING readiness. Ordinary unfinished packing is not
 * an issue — see "a trip in the middle of being packed" below, which exists to
 * stop the removed essentials panel growing back here under a calmer label.
 */

const TODAY = '2026-08-01'

function trip(partial: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    name: 'Cape Town',
    emoji: '🦁',
    startDate: '2026-08-10',
    endDate: '2026-08-20',
    status: 'upcoming',
    notes: null,
    luggageMode: null,
    bags: null,
    laundryAvailable: false,
    maxDressiness: null,
    flightHours: 11,
    international: true,
    timezone: null,
    destinations: [],
    activities: [],
    days: [],
    facts: [],
    archivedAt: null,
    reviewedAt: null,
    ...partial,
  } as Trip
}

function entry(partial: Partial<ChecklistEntry> = {}): ChecklistEntry {
  return {
    id: 'e1', tripId: 't1', itemId: 'i1', name: 'Toothbrush', detail: null,
    category: 'Toiletries', requiredQty: 1, qtyBreakdown: null, qtyOverride: null,
    packedQty: 1, packingTiming: 'anytime', requiresFinalCheck: false,
    finalCheckedAt: null, excludedAt: null, source: 'always_packed', reason: null,
    isCritical: false, tripOnly: false, sortOrder: 0, bag: null, bagSource: null,
    updatedAt: 0,
    ...partial,
  }
}

/** A trip with everything done: one row, packed, one approved outfit. */
function settled(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    trip: trip(),
    entries: [entry()],
    outfits: [{ status: 'approved' }],
    today: TODAY,
    ...over,
  }
}

const labels = (input: ReadinessInput) => readiness(input).issues.map((issue) => issue.label)

describe('a trip with nothing outstanding', () => {
  it('is Ready, and says nothing further', () => {
    const result = readiness(settled())

    expect(result.summary).toBe('Ready')
    expect(result.issues).toEqual([])
  })
})

describe('what counts as unfinished', () => {
  it('reports an unsafe bag configuration', () => {
    expect(labels(settled({ bagProblems: [{ kind: 'no_safe_bag' }] }))).toContain('1 bag issue')
  })

  /*
   * Crowding is a warning, not a safety problem — `bagProblems` says so by
   * carrying two kinds. Counting both would tell Alex his trip is unfinished
   * because a bag is full, which it is allowed to be.
   */
  it('does not report crowding as a bag issue', () => {
    expect(labels(settled({ bagProblems: [{ kind: 'crowded' }] }))).toEqual([])
  })

  it('reports outfits that still need attention', () => {
    expect(labels(settled({ outfits: [{ status: 'draft' }, { status: 'incomplete' }] })))
      .toContain('2 outfits need attention')
  })

  it('reports a plan that was asked for and never made', () => {
    expect(
      labels(settled({
        trip: trip({ days: [{ date: '2026-08-11', activityTag: 'safari' }] }),
        outfits: [],
        outfitsStale: true,
      })),
    ).toContain('Outfits not planned yet')
  })

  it('lists several at once, most material first', () => {
    const result = labels(
      settled({
        bagProblems: [{ kind: 'no_safe_bag' }],
        coverage: [{ message: 'You have nothing recorded as slides or Birkenstocks.' }],
        outfits: [{ status: 'draft' }],
      }),
    )

    expect(result).toEqual([
      '1 bag issue',
      '1 thing your wardrobe cannot cover',
      '1 outfit needs attention',
    ])
  })
})

/**
 * Packing is not an exception to the plan. It IS the plan being carried out.
 *
 * Doc 09 §0q removed "10 essentials still to pack — Bite Guard, Deodorant and
 * Glasses, and 7 more." from the trip screen, and this describes the shape the
 * ruling actually rules out rather than the string: a count of ordinary
 * unfinished work, given the standing space reserved for things that are wrong.
 * Reporting it here under a calmer label would be the same product behaviour in
 * a different font, so these are written to fail on the count in ANY wording.
 */
describe('a trip in the middle of being packed', () => {
  /** Ten unpacked rows, three of them essentials — the state that used to alarm. */
  const midPack = () =>
    settled({
      entries: Array.from({ length: 10 }, (_, i) =>
        entry({ id: `e${i}`, name: `Thing ${i}`, packedQty: 0, isCritical: i < 3 }),
      ),
    })

  it('is Ready, with nothing packed at all', () => {
    const result = readiness(midPack())

    expect(result.summary).toBe('Ready')
    expect(result.issues).toEqual([])
  })

  it('reports no count of unpacked things, whatever it might be called', () => {
    const said = JSON.stringify(readiness(midPack()).issues)

    expect(said).not.toMatch(/pack/i)
    expect(said).not.toMatch(/essential/i)
    expect(said).not.toMatch(/\b(7|10)\b/)
  })

  /*
   * The half that keeps this honest. Removing the presentation must not remove
   * the intelligence — the numbers are still on the result for anything that
   * genuinely needs them, and the packing list downstream is built from them.
   */
  it('still carries the progress it refuses to alarm about', () => {
    expect(readiness(midPack()).progress).toEqual({ packed: 0, total: 10 })
  })

  it('still recommends packing as the one thing to do', () => {
    const result = readiness(midPack())

    expect(result.stage).toBe('packing')
    expect(result.next?.route).toBe('checklist')
  })

  /*
   * `essentialsUrgent` is the timing judgement, and it survives untouched: three
   * days out, unpacked essentials become the recommended action. That is the
   * escalation path the ruling deliberately kept — one primary action, not a
   * standing panel.
   */
  it('escalates essentials into the action, not into the list, near departure', () => {
    const soon = readiness(
      settled({
        trip: trip({ startDate: '2026-08-02', endDate: '2026-08-09' }),
        entries: [entry({ packedQty: 0, isCritical: true })],
      }),
    )

    expect(soon.essentialsUrgent).toBe(true)
    expect(soon.next?.label).toBe('Pack the essentials')
    expect(soon.issues).toEqual([])
    expect(soon.summary).toBe('Ready')
  })

  /*
   * And the genuine exceptions still get the space. A trip that is unsafe or
   * uncoverable is not made quiet by any of the above — the ruling narrowed what
   * counts, it did not empty the list.
   */
  it('still says so when something is actually wrong mid-pack', () => {
    const result = readiness(
      settled({
        entries: [entry({ packedQty: 0 }), entry({ id: 'e2', packedQty: 0 })],
        bagProblems: [{ kind: 'no_safe_bag' }],
        coverage: [{ message: 'You have nothing recorded as swimwear.' }],
      }),
    )

    expect(result.summary).toBe('Almost ready')
    expect(result.issues.map((i) => i.label)).toEqual([
      '1 bag issue',
      '1 thing your wardrobe cannot cover',
    ])
  })
})

/**
 * The coverage half, and the reason these fixtures are deliberately opaque.
 *
 * Readiness counts gaps; it never inspects them. Passing sentences it cannot
 * parse is what makes that testable — a version that grew its own swimwear rules
 * would have nothing here to read.
 */
describe('what the wardrobe cannot cover', () => {
  it('counts a swimwear shortfall without knowing what swimwear is', () => {
    expect(labels(settled({ coverage: [{ message: 'You have nothing recorded as swimwear.' }] })))
      .toContain('1 thing your wardrobe cannot cover')
  })

  it('counts a tank-top shortfall the same way', () => {
    expect(
      labels(settled({
        coverage: [{ message: 'You are packing 3 swimsuits and 2 tank tops to wear over them.' }],
      })),
    ).toContain('1 thing your wardrobe cannot cover')
  })

  it('counts several gaps as several', () => {
    expect(
      labels(settled({
        coverage: [
          { message: 'You have nothing recorded as slides or Birkenstocks.' },
          { message: 'You have nothing recorded as a passport.' },
        ],
      })),
    ).toContain('2 things your wardrobe cannot cover')
  })

  /*
   * Absent means "not known yet", not "nothing wrong". A caller with no coverage
   * result must not be told the wardrobe covers everything.
   */
  it('says nothing at all when no coverage result was given', () => {
    expect(readiness(settled()).issues).toEqual([])
    expect(readiness(settled()).summary).toBe('Ready')
  })
})

/**
 * Closet completeness is not trip readiness.
 *
 * There is no input for it, and that is the enforcement: an unrated garment, an
 * unanswered review question and an unresolved duplicate cannot reach this
 * function at all. Asserted anyway, because the way this rule gets broken is
 * someone adding the input.
 */
describe('what must never count', () => {
  it('is Ready with a closet full of unrated, unreviewed garments', () => {
    const result = readiness(settled())

    expect(result.summary).toBe('Ready')
    expect(Object.keys(result)).not.toContain('closetReview')
    expect(JSON.stringify(result)).not.toMatch(/unrated|duplicate|comfort|versatility/i)
  })
})

describe('the one-action contract', () => {
  it('leaves `next` exactly as it was, whatever the summary says', () => {
    const busy = settled({
      bagProblems: [{ kind: 'no_safe_bag' }],
      coverage: [{ message: 'You have nothing recorded as swimwear.' }],
      entries: [entry({ packedQty: 0 })],
    })

    const withReports = readiness(busy)
    const withoutReports = readiness(settled({ entries: [entry({ packedQty: 0 })] }))

    // Two issues on one and none on the other, and the SAME single next action.
    expect(withReports.issues.length).toBeGreaterThan(withoutReports.issues.length)
    expect(withReports.next).toEqual(withoutReports.next)
    expect(withReports.stage).toBe(withoutReports.stage)
  })

  it('still recommends one thing, not a list', () => {
    const result = readiness(settled({ entries: [entry({ packedQty: 0 })] }))
    expect(result.next).not.toBeNull()
    expect(Array.isArray(result.next)).toBe(false)
  })
})

describe('a trip that is over', () => {
  it('has nothing outstanding, whatever the list still says', () => {
    const result = readiness(
      settled({
        trip: trip({ status: 'completed' }),
        entries: [entry({ packedQty: 0 })],
        bagProblems: [{ kind: 'no_safe_bag' }],
      }),
    )

    expect(result.stage).toBe('finished')
    expect(result.summary).toBe('Ready')
    expect(result.issues).toEqual([])
  })
})
