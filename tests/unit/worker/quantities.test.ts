import { describe, expect, it } from 'vitest'
import {
  MAX_QUANTITY,
  MIN_QUANTITY,
  QUANTITY_RANGE_MESSAGE,
  readQuantity,
} from '@shared/quantities'

/**
 * How many of something a rule may ask for.
 *
 * These matter because the number here is the number that ends up on a packing
 * list. The value came from three separate constants before — 10 in the screen,
 * 10 in the Worker, 99 inline in the rules endpoint — all writing one
 * `packing_rule.quantity_value` column. A test that the three agreed would have
 * caught the drift; one constant means they cannot drift, and these pin the
 * parsing around it.
 */

describe('the range', () => {
  it('runs from 1 to 99', () => {
    expect(MIN_QUANTITY).toBe(1)
    expect(MAX_QUANTITY).toBe(99)
  })

  it('says the range in the message, so the two cannot disagree', () => {
    // The sentence is built from the constants rather than typed out, which is
    // the failure this replaces: an error saying "between 1 and 10" after the
    // ceiling had moved.
    expect(QUANTITY_RANGE_MESSAGE).toContain(String(MIN_QUANTITY))
    expect(QUANTITY_RANGE_MESSAGE).toContain(String(MAX_QUANTITY))
  })
})

describe('what counts as a quantity', () => {
  it.each([1, 3, 12, 99])('accepts %i', (value) => {
    expect(readQuantity(value)).toBe(value)
    expect(readQuantity(String(value))).toBe(value)
  })

  it.each([0, -1, 100, 1000])('rejects %i', (value) => {
    expect(readQuantity(value)).toBeNull()
    expect(readQuantity(String(value))).toBeNull()
  })

  it('accepts a number with spaces around it, because paste has spaces', () => {
    expect(readQuantity('  12  ')).toBe(12)
  })

  it.each(['', '   ', '7.7', '7kg', 'twelve', '1e3', '٣', null, undefined, {}, []])(
    'rejects %p',
    (value) => {
      expect(readQuantity(value)).toBeNull()
    },
  )

  it('does not take the number out of something that is not one', () => {
    /*
     * The reason this is a regex and not `parseInt`. `parseInt('77kg')` is 77,
     * so a pasted "77kg" would be stored as a quantity Alex never typed — and
     * `Number('')` is 0, which would silently become a rule asking for none.
     */
    expect(readQuantity('77kg')).toBeNull()
    expect(readQuantity('12 socks')).toBeNull()
  })

  it('rejects a non-integer rather than rounding it', () => {
    // Rounding would store a number that was never typed, which is the same
    // class of mistake as coercing a unit off the end.
    expect(readQuantity(2.5)).toBeNull()
    expect(readQuantity('2.5')).toBeNull()
  })
})
