import { describe, expect, it } from 'vitest'
import { PACKING_TIMING_LABELS, readTiming } from '@shared/items'
import { sectionFor } from '@shared/rules'

/**
 * "When to pack it" has two answers: Anytime and Day of Departure.
 *
 * The point of these tests is not that two chips render. It is that removing the
 * other two changed **nothing** — `sectionFor` had always folded four values into
 * two, and the pairs it folded together are exactly the pairs that collapsed. If
 * that stops being true, this is where it shows.
 *
 * There is no migration, deliberately. A stored `night_before` is harmless: the
 * column's CHECK still admits it, `readTiming` turns it into `anytime` on the way
 * out, and `sectionFor` has always put it in Pack now anyway. Rewriting those rows
 * would be the first data rewrite in this repository's history, in exchange for
 * tidiness in a column nobody reads directly — the wrong side of "delete code, not
 * data" (`10_AUDIT_AND_ROADMAP.md` §4b), and the same reasoning that keeps the
 * conflict marking derived rather than stored in doc 04 §8.
 */

const base = {
  excludedAt: null,
  requiresFinalCheck: false,
  finalCheckedAt: null,
}

describe('two answers, and they are the only two', () => {
  it('offers exactly Anytime and Day of Departure', () => {
    expect(Object.keys(PACKING_TIMING_LABELS)).toEqual(['anytime', 'day_of'])
    expect(Object.values(PACKING_TIMING_LABELS)).toEqual(['Anytime', 'Day of Departure'])
  })

  it('puts each one in the section it always went to', () => {
    expect(sectionFor({ ...base, packingTiming: 'anytime' })).toBe('pack_now')
    expect(sectionFor({ ...base, packingTiming: 'day_of' })).toBe('pack_later')
  })
})

describe('the retired values meant nothing different', () => {
  /*
   * The load-bearing assertion of this whole change. `night_before` and `anytime`
   * both produced Pack now; `last_minute` and `day_of` both produced Pack later.
   * If either pair ever disagreed, collapsing them would move rows between
   * sections — and it does not.
   */
  it('landed in the same section as the value that replaced it', () => {
    expect(sectionFor({ ...base, packingTiming: 'night_before' })).toBe(
      sectionFor({ ...base, packingTiming: 'anytime' }),
    )
    expect(sectionFor({ ...base, packingTiming: 'last_minute' })).toBe(
      sectionFor({ ...base, packingTiming: 'day_of' }),
    )
  })

  it('still reads as its replacement, for a row written before the change', () => {
    expect(readTiming('night_before')).toBe('anytime')
    expect(readTiming('last_minute')).toBe('day_of')
  })

  it('reads an unrecognised value as Anytime rather than showing nothing', () => {
    // Defensive: a blank chip row would be worse than a wrong-but-harmless one.
    expect(readTiming('something-else-entirely')).toBe('anytime')
    expect(readTiming('')).toBe('anytime')
  })

  it('survives a stored value the labels can no longer name', () => {
    // `PACKING_TIMING_LABELS[readTiming(x)]` must always produce a string.
    for (const stored of ['anytime', 'day_of', 'night_before', 'last_minute', 'nonsense']) {
      expect(PACKING_TIMING_LABELS[readTiming(stored)]).toBeTypeOf('string')
    }
  })
})
