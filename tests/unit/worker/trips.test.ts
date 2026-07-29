import { describe, expect, it } from 'vitest'
import {
  daysBetween,
  deriveTripFacts,
  factsToRecord,
  isValidDate,
  seasonFor,
  tripDateRange,
  tripDays,
  tripNights,
  validateTripInput,
  type TripInput,
} from '@shared/trips'

/**
 * The worked example the approved docs use throughout: 31 Jul -> 11 Aug is
 * 12 trip days and 11 nights, which is why contacts and underwear come to 24.
 * Getting this wrong is two pairs of each, every trip.
 */
const START = '2026-07-31'
const END = '2026-08-11'

describe('trip day and night counting', () => {
  it('counts the approved worked example correctly', () => {
    expect(tripDays(START, END)).toBe(12)
    expect(tripNights(START, END)).toBe(11)
  })

  it('counts a single-day trip as 1 day and 0 nights', () => {
    expect(tripDays('2026-05-04', '2026-05-04')).toBe(1)
    expect(tripNights('2026-05-04', '2026-05-04')).toBe(0)
  })

  it('counts an overnight trip as 2 days and 1 night', () => {
    expect(tripDays('2026-05-04', '2026-05-05')).toBe(2)
    expect(tripNights('2026-05-04', '2026-05-05')).toBe(1)
  })

  it('crosses month and year boundaries', () => {
    expect(tripDays('2026-12-28', '2027-01-03')).toBe(7)
    expect(tripDays('2026-02-27', '2026-03-02')).toBe(4)
  })

  it('handles a leap year', () => {
    expect(tripDays('2028-02-27', '2028-03-01')).toBe(4) // 27, 28, 29, 1
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
  })

  it('is unaffected by daylight saving transitions', () => {
    // Spring forward in most of Europe/US. Local-time arithmetic loses an hour
    // here and can round to the wrong number of days.
    expect(tripDays('2026-03-28', '2026-03-30')).toBe(3)
    expect(tripDays('2026-10-24', '2026-10-26')).toBe(3)
  })

  it('lists every date in the range, inclusive of both ends', () => {
    const range = tripDateRange(START, END)
    expect(range).toHaveLength(12)
    expect(range[0]).toBe(START)
    expect(range[11]).toBe(END)
  })
})

describe('date validation', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isValidDate('2026-07-31')).toBe(true)
    expect(isValidDate('2026-02-30')).toBe(false)
    expect(isValidDate('2026-13-01')).toBe(false)
    expect(isValidDate('31-07-2026')).toBe(false)
    expect(isValidDate('')).toBe(false)
  })

  it('knows leap days', () => {
    expect(isValidDate('2028-02-29')).toBe(true)
    expect(isValidDate('2027-02-29')).toBe(false)
  })
})

describe('seasons', () => {
  it('reads the northern-hemisphere season from the start month', () => {
    expect(seasonFor('2026-07-31')).toBe('summer')
    expect(seasonFor('2026-01-15')).toBe('winter')
    expect(seasonFor('2026-04-02')).toBe('spring')
    expect(seasonFor('2026-10-09')).toBe('autumn')
  })
})

describe('trip validation', () => {
  const valid: TripInput = {
    name: 'South Africa',
    startDate: START,
    endDate: END,
    destinations: [{ name: 'Cape Town' }],
    activities: ['safari'],
  }

  it('accepts a complete trip', () => {
    expect(validateTripInput(valid).ok).toBe(true)
  })

  it('rejects a return date before the start', () => {
    const result = validateTripInput({ ...valid, startDate: END, endDate: START })
    expect(result.errors.endDate).toMatch(/before/i)
  })

  it('accepts a same-day trip', () => {
    expect(validateTripInput({ ...valid, endDate: START }).ok).toBe(true)
  })

  it('requires a name and a destination', () => {
    expect(validateTripInput({ ...valid, name: '  ' }).errors.name).toBeTruthy()
    expect(validateTripInput({ ...valid, destinations: [] }).errors.destinations).toBeTruthy()
  })

  it('rejects an absurdly long trip as a likely typo', () => {
    expect(validateTripInput({ ...valid, endDate: '2030-01-01' }).errors.endDate).toBeTruthy()
  })
})

describe('trip facts', () => {
  const input: TripInput = {
    name: 'South Africa',
    startDate: START,
    endDate: END,
    destinations: [{ name: 'Cape Town', country: 'South Africa' }],
    activities: ['safari', 'winery'],
    international: true,
    laundryAvailable: false,
    flightHours: 15,
  }

  it('records days and nights as certain structured facts', () => {
    const facts = deriveTripFacts(input)
    const days = facts.find((f) => f.factKey === 'trip_days')
    const nights = facts.find((f) => f.factKey === 'nights')

    expect(days?.value).toBe(12)
    expect(days?.certainty).toBe('certain')
    expect(days?.source).toBe('structured')
    expect(nights?.value).toBe(11)
  })

  it('explains every fact in plain words, with no confidence percentage', () => {
    for (const fact of deriveTripFacts(input)) {
      expect(fact.explanation.length).toBeGreaterThan(0)
      expect(fact.explanation).not.toMatch(/\d+%/)
    }
  })

  it('takes international status from an explicit answer, never from prose', () => {
    const facts = deriveTripFacts(input)
    const international = facts.find((f) => f.factKey === 'international')
    expect(international?.value).toBe(true)
    expect(international?.source).toBe('user')
  })

  it('omits unknown facts entirely rather than defaulting them', () => {
    const sparse = deriveTripFacts({
      name: 'Weekend', startDate: '2026-05-01', endDate: '2026-05-03',
      destinations: [{ name: 'Chicago' }], activities: [],
    })
    const keys = sparse.map((f) => f.factKey)

    // No laundry answer means no laundry fact — not `false`, which would be a
    // quiet claim Alex never made.
    expect(keys).not.toContain('laundry_available')
    expect(keys).not.toContain('international')
    expect(keys).not.toContain('activities')
  })

  it('keeps possible-certainty facts out of the engine', () => {
    const record = factsToRecord([
      { factKey: 'nights', value: 11, certainty: 'certain', source: 'structured', explanation: '' },
      { factKey: 'guessed', value: true, certainty: 'possible', source: 'detected', explanation: '' },
    ])
    expect(record.nights).toBe(11)
    expect(record).not.toHaveProperty('guessed')
  })
})
