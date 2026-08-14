import { describe, expect, it } from 'vitest'
import type { ChecklistEntry } from '@shared/checklist'
import {
  daysBetween,
  departureLabel,
  openQuestions,
  readiness,
  type ReadinessInput,
} from '@shared/readiness'
import type { Trip } from '@shared/trips'

/**
 * The one derived answer to "where is this trip up to".
 *
 * Doc 09 §4 asks for a single readiness state driving every screen and
 * producing ONE recommended next action. These pin the two things that make
 * that worth having: that the answer is the same wherever it is read, and that
 * the next action is the thing actually worth doing rather than the thing the
 * screen happened to check first.
 */

const TODAY = '2026-08-01'

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip', name: 'Lisbon', emoji: '🧳',
    startDate: '2026-08-15', endDate: '2026-08-22',
    status: 'planning', notes: null, luggageMode: null, bags: null,
    // Answered by default: an unanswered fact is a stage of its own, and most
    // of these tests are about something else.
    laundryAvailable: false, maxDressiness: null, flightHours: 3, international: true,
    timezone: null, destinations: [], activities: [], days: [], facts: [],
    archivedAt: null, reviewedAt: null, createdAt: 0, updatedAt: 0,
    ...overrides,
  }
}

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

const packed = (o: Partial<ChecklistEntry> = {}) => entry({ packedQty: 1, ...o })

function state(overrides: Partial<ReadinessInput> = {}) {
  return readiness({ trip: trip(), entries: [], outfits: [], today: TODAY, ...overrides })
}

describe('one next action, and it is the one worth doing', () => {
  it('asks for a list before anything else, because every other stage judges one', () => {
    const result = state()
    expect(result.stage).toBe('nothing_planned')
    expect(result.next?.route).toBe('trip')
    expect(result.progress).toBeNull()
  })

  it('asks a question that would change the list, while there is time to act on it', () => {
    const result = state({
      trip: trip({ international: null }),
      entries: [entry()],
    })
    expect(result.stage).toBe('questions')
    expect(result.next?.label).toBe('Answer one question')
    // The sentence says what the answer CHANGES. "Improves recommendations"
    // is the kind of confident nothing doc 09 §25 rules out.
    expect(result.next?.detail).toMatch(/passport/i)
  })

  it('stops asking once the answer could no longer change anything in time', () => {
    /*
     * Two days out, a question is an interruption: the list Alex has is the list
     * he is taking. Doc 09 §5 makes questions deferrable without blocking, and
     * this is the other half of that — they defer themselves.
     */
    const result = state({
      trip: trip({ international: null, startDate: '2026-08-03', endDate: '2026-08-10' }),
      entries: [entry()],
    })
    expect(result.stage).not.toBe('questions')
    // Still recorded, so a screen can offer them quietly. Not asked as THE
    // next action.
    expect(result.openQuestions).toHaveLength(1)
  })

  it('reviews outfits before packing, because approving one adds to the list', () => {
    const result = state({
      entries: [entry()],
      outfits: [{ status: 'approved' }, { status: 'draft' }, { status: 'incomplete' }],
    })
    expect(result.stage).toBe('outfits')
    expect(result.next?.label).toBe('Review 2 outfits')
  })

  it('does not invent an outfit need for a trip with no outfits planned', () => {
    // A trip with no groups is not "outfits outstanding" — it may be a trip Alex
    // does not want outfits for, and deciding otherwise is the app deciding his
    // taste for him.
    const result = state({ entries: [entry()], outfits: [] })
    expect(result.stage).toBe('packing')
  })

  /*
   * The rung P1B would otherwise have removed.
   *
   * Saving days used to replan before it answered, so a trip created from a past
   * trip's day plan arrived here with draft outfits and the ladder said "review
   * 3 outfits". The replan now happens on the Outfits screen, so for a moment
   * there are days and no groups — and the test above, read literally, calls
   * that "no outfit work" and sends Alex off to pack.
   *
   * Naming days IS asking for outfits. The distinction is the days, not a guess
   * about taste: a trip with no days named and no groups still means what it
   * meant before.
   */
  it('offers to plan outfits when days are named and the plan is behind them', () => {
    const result = state({
      trip: trip({ days: [{ id: 'd1', date: '2026-08-16', activityTag: 'safari' }] }),
      entries: [entry()],
      outfits: [],
      outfitsStale: true,
    })
    expect(result.stage).toBe('outfits')
    expect(result.next?.label).toBe('Plan your outfits')
    expect(result.next?.route).toBe('outfits')
  })

  it('still says nothing about outfits when no day has been named', () => {
    const result = state({ entries: [entry()], outfits: [], outfitsStale: true })
    expect(result.stage).toBe('packing')
  })

  /*
   * The number is still MEASURED; it is simply not narrated back at him under
   * the button it came from (doc 09 §0q). `progress` carries it for the
   * checklist's own line, and the recommended action says the one thing it is
   * for.
   */
  it('measures what is left without explaining the button with it', () => {
    const result = state({ entries: [packed(), entry(), entry()] })
    expect(result.stage).toBe('packing')
    expect(result.next?.label).toBe('Keep packing')
    expect(result.next?.detail).toBeNull()
    expect(result.progress).toEqual({ packed: 1, total: 3 })
  })

  it('separates "grab it on the way" from "ready"', () => {
    /*
     * A toothbrush still in the bathroom is not a finished bag. Telling Alex he
     * is ready when he is not is the confident-but-wrong behaviour doc 09 §25
     * forbids, so final check is a stage of its own.
     */
    const result = state({
      entries: [packed(), packed({ requiresFinalCheck: true })],
    })
    expect(result.stage).toBe('final_check')
    expect(result.next?.label).toBe('Final check')
  })

  it('offers nothing at all when the trip is ready', () => {
    // The one place `next` is legitimately null. An app that always has a
    // suggestion has one because it is padding, not because there is something
    // to do.
    const result = state({ entries: [packed(), packed()] })
    expect(result.stage).toBe('ready')
    expect(result.next).toBeNull()
  })

  it('changes job once the trip has started', () => {
    // Doc 04 §11: the question stops being "help me pack" and becomes "what do
    // I wear today".
    const result = state({
      trip: trip({ startDate: '2026-07-30', endDate: '2026-08-10' }),
      entries: [entry()],
    })
    expect(result.stage).toBe('underway')
    expect(result.next?.route).toBe('today')
  })

  it('offers the review once a trip is over', () => {
    const result = state({
      trip: trip({ startDate: '2026-07-01', endDate: '2026-07-10' }),
      entries: [entry({ isCritical: true })],
    })
    expect(result.stage).toBe('finished')
    expect(result.next?.route).toBe('review')
    // And it does not shout about an essential that was never packed on a trip
    // that is over.
    expect(result.essentialsUrgent).toBe(false)
  })

  /*
   * The review is offered ONCE.
   *
   * `reviewedAt` rather than "are there any answers": a review Alex reads with
   * nothing to report leaves nothing behind, and offering it to him again is
   * how a prompt teaches him to ignore it. After that a finished, reviewed trip
   * genuinely has nothing left to do — the second place `next` is legitimately
   * null.
   */
  it('says nothing more once the review has been done', () => {
    const result = state({
      trip: trip({ startDate: '2026-07-01', endDate: '2026-07-10', reviewedAt: 1_780_000_000 }),
      entries: [entry({ isCritical: true })],
    })
    expect(result.stage).toBe('finished')
    expect(result.next).toBeNull()
  })

  it('does not offer the review to a trip that has not happened yet', () => {
    const result = state({ entries: [entry()] })

    expect(result.stage).not.toBe('finished')
    expect(result.next?.route).not.toBe('review')
  })
})

describe('essentials escalate when they are actionable, not whenever they exist', () => {
  const essential = { isCritical: true }

  it('stays quiet a fortnight out, where the progress line already says it', () => {
    /*
     * Doc 09 §4.1. An unpacked passport two weeks before a trip is not a
     * problem — it is a trip that has not been packed yet, and saying so in red
     * every time Alex opens the app is how he learns to ignore the one that
     * matters on the morning of the flight.
     */
    const result = state({ entries: [entry(essential), entry(), entry()] })
    expect(result.essentialsUrgent).toBe(false)
    expect(result.next?.label).toBe('Keep packing')
  })

  it('escalates close to departure', () => {
    const result = state({
      trip: trip({ startDate: '2026-08-03', endDate: '2026-08-10' }),
      entries: [entry(essential), entry(), entry()],
    })
    expect(result.essentialsUrgent).toBe(true)
    expect(result.next?.label).toBe('Pack the essentials')
    /*
     * And it does not say how many. Counting them here would put the removed
     * panel back on the calmest screen in the app, a fortnight of trips at a
     * time; the count belongs on the morning he leaves, where forgetting one has
     * consequences (doc 09 §0t, `departureRisk`).
     */
    expect(result.next?.detail).toBeNull()
  })

  it('escalates when almost everything else is packed', () => {
    // The other actionable moment: the bag is nearly finished and the thing
    // left is the thing that matters.
    const entries = [entry(essential), packed(), packed(), packed(), packed(), packed(), packed(), packed(), packed(), packed()]
    const result = state({ entries })
    expect(result.essentialsUrgent).toBe(true)
  })

  it('never escalates when there is no essential outstanding', () => {
    const result = state({
      trip: trip({ startDate: '2026-08-02', endDate: '2026-08-10' }),
      entries: [packed(essential), entry()],
    })
    expect(result.essentialsUrgent).toBe(false)
  })
})

describe('excluded rows are not work', () => {
  it('does not count something moved to Not Bringing', () => {
    const result = state({
      entries: [packed(), entry({ excludedAt: 1 })],
    })
    expect(result.stage).toBe('ready')
    expect(result.progress).toEqual({ packed: 1, total: 1 })
  })
})

describe('the questions are about facts a rule actually reads', () => {
  /*
   * The assertion that every offered fact is one a SEEDED rule reads lives in
   * `tests/integration/readiness-questions.test.ts`, because checking it means
   * reading the migrations and `shared/import.ts` off disk — and
   * `tsconfig.integration.json` is the only project that carries Node types
   * alongside the rest. These two are the pure half.
   */
  it('asks nothing once the trip has answered', () => {
    expect(openQuestions(trip())).toEqual([])
  })

  it('offers one concise question at a time, in a fixed order', () => {
    const all = openQuestions(
      trip({ international: null, flightHours: null, laundryAvailable: null }),
    )
    expect(all.map((q) => q.fact)).toEqual(['international', 'flight_hours', 'laundry_available'])
  })
})

describe('one countdown, two registers', () => {
  /*
   * Three screens each had their own copy of this, and they did not agree on
   * the words: Home said "9 days to go", the Trips list said "9 days". The
   * phrasing still differs — a list chip has no room for the long form — but
   * the FACT behind both now comes from one function, so they cannot drift
   * apart about which day it is.
   */
  const soon = trip({ startDate: '2026-08-10', endDate: '2026-08-20' })

  it('says the same thing in both registers', () => {
    expect(departureLabel(soon, TODAY, 'full')).toBe('9 days to go')
    expect(departureLabel(soon, TODAY, 'short')).toBe('9 days')
  })

  it.each([
    ['2026-08-02', 'Leaving tomorrow', 'Tomorrow'],
    ['2026-08-01', 'Leaving today', 'Today'],
  ])('agrees about %s', (start, full, short) => {
    const t = trip({ startDate: start, endDate: '2026-08-20' })
    expect(departureLabel(t, TODAY, 'full')).toBe(full)
    expect(departureLabel(t, TODAY, 'short')).toBe(short)
  })

  it('reads a trip in progress and a trip over the same way in both', () => {
    const underway = trip({ startDate: '2026-07-28', endDate: '2026-08-05' })
    expect(departureLabel(underway, TODAY, 'full')).toBe('On the trip')
    expect(departureLabel(underway, TODAY, 'short')).toBe('On the trip')

    const over = trip({ startDate: '2026-07-01', endDate: '2026-07-10' })
    expect(departureLabel(over, TODAY, 'full')).toBe('Trip finished')
    expect(departureLabel(over, TODAY, 'short')).toBe('Finished')
  })

  it('is the same string readiness puts in its headline', () => {
    // The property that matters: the list chip and the headline cannot disagree
    // because neither computes anything of its own.
    const result = readiness({ trip: soon, entries: [], outfits: [], today: TODAY })
    expect(result.headline).toBe(departureLabel(soon, TODAY, 'full'))
  })
})

describe('dates', () => {
  it('counts whole days, and goes negative once a date has passed', () => {
    expect(daysBetween('2026-08-01', '2026-08-15')).toBe(14)
    expect(daysBetween('2026-08-01', '2026-08-01')).toBe(0)
    expect(daysBetween('2026-08-01', '2026-07-30')).toBe(-2)
  })

  it('is not affected by the machine it runs on', () => {
    // UTC arithmetic on purpose: a local-time reading of the same two dates
    // moves by one across a DST boundary, and "days to go" is not something
    // that should change because the clocks did.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
  })
})
