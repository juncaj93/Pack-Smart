import { describe, expect, it } from 'vitest'
import {
  PLAN_SIGNALS_VERSION,
  changeSummary,
  planChanges,
  planSignals,
  replanNotice,
  type PlanSignals,
} from '@shared/replan'
import type { Trip } from '@shared/trips'
import type { WeatherDay } from '@shared/weather'

/**
 * Change-aware replanning, at the threshold that decides whether it fires.
 *
 * The product requirement is a pair of opposites and the whole design lives
 * between them: `67°F → 65°F` must create no work, and `57–67°F → 41–49°F`
 * must. Everything else here exists to keep that line where the planner puts
 * it — on `warmthBandForDays`, the hard filter that decides which jackets are
 * admissible, rather than on a degree threshold invented for this module.
 *
 * The two directions are tested separately on purpose. A comparison that fires
 * on everything is as useless as one that fires on nothing, and only one of
 * them is obvious from a passing suite.
 */

const TRIP: Trip = {
  id: 't1',
  name: 'Traverse City',
  emoji: '🍽️',
  startDate: '2026-09-10',
  endDate: '2026-09-14',
  status: 'planning',
  notes: null,
  luggageMode: null,
  bags: null,
  laundryAvailable: false,
  maxDressiness: 3,
  flightHours: null,
  international: false,
  timezone: null,
  destinations: [
    { id: 'd1', name: 'Traverse City', country: 'United States', arriveDate: null, departDate: null },
  ],
  activities: ['nice_dinner'],
  days: [],
  facts: [],
  archivedAt: null,
  reviewedAt: null,
  createdAt: 0,
  updatedAt: 0,
}

/** Fahrenheit in, because the thresholds under test are stated in Fahrenheit. */
function days(lowF: number, highF: number, rainPercent = 0): WeatherDay[] {
  const c = (f: number) => ((f - 32) * 5) / 9
  return ['2026-09-10', '2026-09-11'].map((date) => ({
    date,
    destinationId: 'd1',
    tempMinC: c(lowF),
    tempMaxC: c(highF),
    precipitationProbability: rainPercent,
    windKph: null,
    source: 'forecast' as const,
  }))
}

describe('what counts as the trip having changed', () => {
  it('a two-degree forecast wobble is not a change', () => {
    /*
     * The exact case the brief names. Both forecasts sit inside the same warmth
     * band, so no garment that was admissible has stopped being admissible —
     * there is nothing for a replan to do, and saying so would be churn.
     */
    const before = planSignals(TRIP, days(57, 67))
    const after = planSignals(TRIP, days(55, 65))

    expect(planChanges(before, after)).toEqual([])
  })

  it('a forecast that crosses a planning threshold is a change, and says which way', () => {
    const before = planSignals(TRIP, days(57, 67))
    const after = planSignals(TRIP, days(41, 49))

    const changes = planChanges(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.kind).toBe('weather_colder')
    // The degrees are for the sentence only; the DECISION was the band.
    expect(changes[0]!.detail).toMatch(/colder/)
    expect(changes[0]!.detail).toMatch(/°F/)
  })

  it('warmer is reported as warmer', () => {
    const changes = planChanges(planSignals(TRIP, days(41, 49)), planSignals(TRIP, days(57, 67)))
    expect(changes.map((c) => c.kind)).toEqual(['weather_warmer'])
  })

  it('rain appearing is its own change, at the threshold the outer layer uses', () => {
    const before = planSignals(TRIP, days(57, 67, 10))
    const after = planSignals(TRIP, days(57, 67, 80))

    expect(planChanges(before, after).map((c) => c.kind)).toEqual(['weather_rain'])
  })

  it('rain moving below the threshold is not rain', () => {
    // 10% to 40%: a visible difference in the number, no difference to packing.
    const before = planSignals(TRIP, days(57, 67, 10))
    const after = planSignals(TRIP, days(57, 67, 40))

    expect(planChanges(before, after)).toEqual([])
  })

  it('an added activity is named', () => {
    const before = planSignals(TRIP, days(57, 67))
    const after = planSignals({ ...TRIP, activities: ['nice_dinner', 'hiking'] }, days(57, 67))

    const changes = planChanges(before, after)
    expect(changes.map((c) => c.kind)).toEqual(['activities'])
    expect(changes[0]!.detail).toMatch(/added/i)
  })

  it('a dressier trip is a change', () => {
    const before = planSignals(TRIP, days(57, 67))
    const after = planSignals({ ...TRIP, maxDressiness: 5 }, days(57, 67))

    const changes = planChanges(before, after)
    expect(changes.map((c) => c.kind)).toEqual(['formality'])
    expect(changes[0]!.detail).toMatch(/dressier/i)
  })

  it('naming which days are which is a change', () => {
    const before = planSignals(TRIP, days(57, 67))
    const after = planSignals(
      { ...TRIP, days: [{ date: '2026-09-11', activityTag: 'nice_dinner' }] },
      days(57, 67),
    )

    expect(planChanges(before, after).map((c) => c.kind)).toEqual(['days'])
  })

  /*
   * The safety property. Every plan on the database was made before the
   * snapshot column existed, and none of them is wrong — announcing that
   * everything about them has changed would be a screenful of false alarms on
   * first deploy.
   */
  it('no snapshot means nothing is claimed to have changed', () => {
    expect(planChanges(null, planSignals(TRIP, days(41, 49)))).toEqual([])
  })

  it('a snapshot from an older version is not compared', () => {
    const before: PlanSignals = {
      ...planSignals(TRIP, days(57, 67)),
      version: PLAN_SIGNALS_VERSION - 1,
    }
    expect(planChanges(before, planSignals(TRIP, days(41, 49)))).toEqual([])
  })

  /*
   * Determinism, at the level this module controls: the snapshot is a value,
   * not a rendering of one, so two runs over the same trip must be byte-equal
   * or the comparison will report phantom changes on every replan.
   */
  it('the same trip produces the same snapshot however its lists are ordered', () => {
    const a = planSignals({ ...TRIP, activities: ['hiking', 'nice_dinner'] }, days(57, 67))
    const b = planSignals({ ...TRIP, activities: ['nice_dinner', 'hiking'] }, days(57, 67))

    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(planChanges(a, b)).toEqual([])
  })

  it('a trip that has not moved produces no changes at all', () => {
    const signals = planSignals(TRIP, days(57, 67))
    expect(planChanges(signals, signals)).toEqual([])
  })
})

describe('saying what changed', () => {
  it('one change speaks for itself', () => {
    const changes = planChanges(planSignals(TRIP, days(57, 67)), planSignals(TRIP, days(41, 49)))
    expect(changeSummary(changes)).toBe(changes[0]!.detail)
  })

  it('several weather changes are summarised as the weather', () => {
    const before = planSignals(TRIP, days(57, 67, 10))
    const after = planSignals(TRIP, days(41, 49, 80))

    const changes = planChanges(before, after)
    expect(changes).toHaveLength(2)
    expect(changeSummary(changes)).toBe('The forecast changed since you planned.')
  })

  it('nothing changed says nothing', () => {
    expect(changeSummary([])).toBeNull()
  })
})

describe('what the replan did', () => {
  const colder = planChanges(planSignals(TRIP, days(57, 67)), planSignals(TRIP, days(41, 49)))

  it('leads with the cause and follows with the effect', () => {
    const line = replanNotice({
      changes: colder,
      flagged: [{ id: 'g1', name: 'Nice dinners', reason: 'Cashmere Sweater is no longer right' }],
      replannedCount: 2,
      keptApproved: 1,
      regenerated: true,
    })

    expect(line).toMatch(/colder/)
    expect(line).toMatch(/2 outfits planned again/)
    expect(line).toMatch(/1 outfit needs review/)
  })

  /*
   * The difference between "the app did nothing" and "the app checked, and
   * nothing needed to change". Only one of those is reassuring, and a replan
   * that found a real change is exactly when it is worth saying.
   */
  it('says so when something changed and the plan still stood', () => {
    const line = replanNotice({
      changes: colder,
      flagged: [],
      replannedCount: 0,
      keptApproved: 3,
      regenerated: false,
    })

    expect(line).toMatch(/Nothing needed to change/)
  })

  it('a replan with nothing to report reports the approvals it honoured', () => {
    expect(
      replanNotice({
        changes: [],
        flagged: [],
        replannedCount: 0,
        keptApproved: 3,
        regenerated: false,
      }),
    ).toBe('Your approved outfits were left as they are.')
  })

  it('never invents a delta', () => {
    expect(
      replanNotice({
        changes: [],
        flagged: [],
        replannedCount: 0,
        keptApproved: 0,
        regenerated: true,
      }),
    ).toBeNull()
  })
})
