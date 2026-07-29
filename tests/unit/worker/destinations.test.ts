import { describe, expect, it } from 'vitest'
import { destinationForDate, type TripDestination } from '@shared/trips'

/**
 * Which place Alex is in on a given date.
 *
 * The answer decides which forecast a day's outfit is planned against, so a
 * wrong answer produces a confident forecast for the wrong continent. The tests
 * that matter most are the ones proving it returns NOTHING rather than a
 * plausible guess.
 */

function stop(partial: Partial<TripDestination> & { id: string }): TripDestination {
  return { name: partial.id, country: null, arriveDate: null, departDate: null, ...partial }
}

const CAPE_TOWN = stop({ id: 'cpt', arriveDate: '2026-08-01', departDate: '2026-08-05' })
const REYKJAVIK = stop({ id: 'kef', arriveDate: '2026-08-06', departDate: '2026-08-10' })

describe('a trip with dated stops', () => {
  const stops = [CAPE_TOWN, REYKJAVIK]

  it('puts each date at the stop that covers it', () => {
    expect(destinationForDate(stops, '2026-08-01')?.id).toBe('cpt')
    expect(destinationForDate(stops, '2026-08-05')?.id).toBe('cpt')
    expect(destinationForDate(stops, '2026-08-06')?.id).toBe('kef')
    expect(destinationForDate(stops, '2026-08-10')?.id).toBe('kef')
  })

  /*
   * A gap is a real thing — a travel day between two stays — and it has no
   * honest answer. Returning the nearest stop would plan it against weather
   * hundreds of miles away.
   */
  it('returns nothing for a date no stop covers', () => {
    const gapped = [
      stop({ id: 'cpt', arriveDate: '2026-08-01', departDate: '2026-08-03' }),
      stop({ id: 'kef', arriveDate: '2026-08-07', departDate: '2026-08-10' }),
    ]
    expect(destinationForDate(gapped, '2026-08-05')).toBeNull()
  })

  it('returns nothing for a date outside every stop', () => {
    expect(destinationForDate(stops, '2026-09-01')).toBeNull()
  })

  it('takes the first when two overlap, so the answer is stable', () => {
    const overlapping = [
      stop({ id: 'first', arriveDate: '2026-08-01', departDate: '2026-08-06' }),
      stop({ id: 'second', arriveDate: '2026-08-05', departDate: '2026-08-10' }),
    ]
    expect(destinationForDate(overlapping, '2026-08-05')?.id).toBe('first')
    expect(destinationForDate([...overlapping].reverse(), '2026-08-05')?.id).toBe('second')
  })

  it('handles an open-ended stop', () => {
    const openEnded = [
      stop({ id: 'cpt', arriveDate: '2026-08-01', departDate: null }),
      stop({ id: 'kef', arriveDate: '2026-09-01', departDate: '2026-09-05' }),
    ]
    expect(destinationForDate(openEnded, '2026-08-25')?.id).toBe('cpt')
  })

  /*
   * A stop dated to part of the trip still covers the travel days either side,
   * because it is the ONLY place named. "I do not know where you are" is not a
   * more honest answer on a trip with exactly one destination — it is just a
   * worse one, and it would cost weather on the days Alex flies.
   */
  it('lets a lone dated stop still cover the whole trip', () => {
    const single = [stop({ id: 'cpt', arriveDate: '2026-08-01', departDate: '2026-08-05' })]
    expect(destinationForDate(single, '2026-07-31')?.id).toBe('cpt')
    expect(destinationForDate(single, '2026-08-06')?.id).toBe('cpt')
  })
})

describe('a trip with one undated stop', () => {
  /*
   * Nearly every trip. It must not require dates Alex has already given once as
   * the trip's own start and end.
   */
  it('lets the single destination cover every date', () => {
    const single = [stop({ id: 'cpt' })]
    expect(destinationForDate(single, '2026-08-01')?.id).toBe('cpt')
    expect(destinationForDate(single, '2027-01-01')?.id).toBe('cpt')
  })
})

describe('what it refuses to do', () => {
  /*
   * The rule doing the real work. Falling back to the first stop would look
   * tidier and would silently plan a Reykjavik day against Cape Town's weather.
   */
  it('will not guess on a multi-stop trip with no dates', () => {
    const undated = [stop({ id: 'cpt' }), stop({ id: 'kef' })]
    expect(destinationForDate(undated, '2026-08-03')).toBeNull()
  })

  it('has no answer for a trip with no destinations', () => {
    expect(destinationForDate([], '2026-08-03')).toBeNull()
  })
})
