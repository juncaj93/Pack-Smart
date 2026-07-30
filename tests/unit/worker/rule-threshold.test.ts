import { describe, expect, it } from 'vitest'
import { readThreshold, thresholdUnit, writeThreshold } from '@shared/rule-threshold'

/**
 * The one number in a rule that Alex can change.
 *
 * The whole design of this is a refusal: a condition is a recursive `all` /
 * `any` / `not` tree, perfectly capable of expressing things no sensible editor
 * could show, and doc 09 §18 forbids turning this into a generic rule builder
 * over raw database fields. So a rule is editable **only when the entire
 * condition holds exactly one numeric comparison**.
 *
 * Most of these tests are therefore about what it declines to touch. That is the
 * interesting half: an editor that quietly changed the first of two numbers
 * would be worse than one that says it cannot help.
 */

const json = (value: unknown) => JSON.stringify(value)

describe('finding the one number', () => {
  it('reads the Neck Pillow case from the brief', () => {
    expect(readThreshold(json({ fact: 'flight_hours', gt: 5 }))).toEqual({
      fact: 'flight_hours',
      operator: 'gt',
      value: 5,
    })
  })

  it.each(['gt', 'gte', 'lt', 'lte'] as const)('reads a %s comparison', (operator) => {
    expect(readThreshold(json({ fact: 'nights', [operator]: 3 }))?.operator).toBe(operator)
  })

  it('finds it inside an all', () => {
    const condition = { all: [{ fact: 'international', eq: true }, { fact: 'nights', gte: 4 }] }
    expect(readThreshold(json(condition))).toEqual({
      fact: 'nights',
      operator: 'gte',
      value: 4,
    })
  })
})

describe('what it declines to touch', () => {
  it('declines a rule with no number in it', () => {
    // "Only when leaving the country" has nothing to edit.
    expect(readThreshold(json({ fact: 'international', eq: true }))).toBeNull()
    expect(readThreshold(json({ fact: 'activities', contains: 'beach' }))).toBeNull()
  })

  it('declines a rule with two numbers, rather than picking one', () => {
    /*
     * The assertion this file exists for. A rule reading "at least 3 nights AND
     * a flight over 5 hours" has no single threshold; an editor showing one box
     * would silently change whichever comparison it happened to find first.
     */
    const condition = { all: [{ fact: 'nights', gte: 3 }, { fact: 'flight_hours', gt: 5 }] }
    expect(readThreshold(json(condition))).toBeNull()
    expect(writeThreshold(json(condition), 9)).toBeNull()
  })

  it('declines nonsense rather than throwing', () => {
    for (const bad of [null, '', 'not json', '{', json({}), json({ fact: 'x' })]) {
      expect(readThreshold(bad)).toBeNull()
      expect(writeThreshold(bad, 6)).toBeNull()
    }
  })
})

describe('changing it', () => {
  it('moves the number and nothing else', () => {
    const before = json({ fact: 'flight_hours', gt: 5 })
    const after = writeThreshold(before, 6)

    expect(JSON.parse(after!)).toEqual({ fact: 'flight_hours', gt: 6 })
    expect(readThreshold(after)?.value).toBe(6)
  })

  it('keeps the rest of a compound condition exactly as it was', () => {
    /*
     * Rebuilt from the parsed tree rather than by string substitution, so the
     * parts that were not edited come back byte-identical in meaning. A regex
     * over the JSON would eventually match a number that was not the threshold.
     */
    const before = json({
      all: [{ fact: 'international', eq: true }, { fact: 'nights', gte: 4 }],
    })
    const after = JSON.parse(writeThreshold(before, 7)!) as { all: unknown[] }

    expect(after.all[0]).toEqual({ fact: 'international', eq: true })
    expect(after.all[1]).toEqual({ fact: 'nights', gte: 7 })
  })

  it('survives a round trip', () => {
    const once = writeThreshold(json({ fact: 'nights', gte: 2 }), 8)
    const twice = writeThreshold(once, 3)
    expect(readThreshold(twice)?.value).toBe(3)
  })
})

describe('how it reads on screen', () => {
  it('names the unit for the facts that have one', () => {
    expect(thresholdUnit('flight_hours')).toBe('hours')
    expect(thresholdUnit('nights')).toBe('nights')
    expect(thresholdUnit('trip_days')).toBe('days')
  })

  it('agrees with the number beside it', () => {
    // "1 nights" was reachable before this was editable, by an unlucky import.
    // Now it is one tap away, which makes the plural worth getting right.
    expect(thresholdUnit('nights', 1)).toBe('night')
    expect(thresholdUnit('flight_hours', 1)).toBe('hour')
    expect(thresholdUnit('nights', 2)).toBe('nights')
  })

  it('offers no unit rather than a guessed one', () => {
    // Doc 09 §25: no confident language the data does not support. That applies
    // to a noun as much as to a number.
    expect(thresholdUnit('international')).toBeNull()
    expect(thresholdUnit('something_new')).toBeNull()
  })
})
