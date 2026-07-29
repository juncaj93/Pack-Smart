import { describe, expect, it } from 'vitest'
import {
  EMOJI_CHOICES,
  FALLBACK_EMOJI,
  isValidTripEmoji,
  suggestTripEmoji,
} from '../../../shared/trip-emoji'

/**
 * The trip's icon (product doc 02 §9a).
 *
 * Two properties matter more than any individual mapping: the same trip must
 * always get the same icon, and a weak signal must lose to the neutral fallback.
 * A wrong-but-specific icon is a claim about the trip; ✈️ claims nothing.
 */

describe('suggesting an icon', () => {
  it('uses the activity when there is one', () => {
    expect(suggestTripEmoji({ activities: ['safari'] })).toBe('🦁')
    expect(suggestTripEmoji({ activities: ['beach'] })).toBe('🏖️')
    expect(suggestTripEmoji({ activities: ['wedding'] })).toBe('💍')
    expect(suggestTripEmoji({ activities: ['hiking'] })).toBe('🥾')
  })

  /*
   * The tie-break has to be the approved order, not the order Alex happened to
   * tap the chips — otherwise the same trip gets a different icon depending on
   * which button he pressed first.
   */
  it('gives the same answer whatever order the activities arrive in', () => {
    const one = suggestTripEmoji({ activities: ['sightseeing', 'wedding', 'safari'] })
    const two = suggestTripEmoji({ activities: ['safari', 'sightseeing', 'wedding'] })

    expect(one).toBe(two)
    expect(one).toBe('💍')
  })

  it('falls back to the destination when no activity was chosen', () => {
    expect(suggestTripEmoji({ destination: 'Zermatt' })).toBe('⛷️')
    expect(suggestTripEmoji({ destination: 'Serengeti National Park' })).toBe('🦁')
    expect(suggestTripEmoji({ name: 'Alaska cruise' })).toBe('🚢')
  })

  it('lets an activity beat a destination word', () => {
    // Every trip involves a flight; only some involve lions.
    expect(suggestTripEmoji({ destination: 'Maldives', activities: ['wedding'] })).toBe('💍')
  })

  it('takes the neutral icon rather than a weak guess', () => {
    expect(suggestTripEmoji({})).toBe(FALLBACK_EMOJI)
    expect(suggestTripEmoji({ destination: 'Frankfurt', name: 'Work thing' })).toBe(FALLBACK_EMOJI)
  })

  /*
   * Without word boundaries "ski" fires on "Helsinki" — a city break wearing a
   * ski icon, and a wrong claim about the trip.
   */
  it('does not match a destination word inside another word', () => {
    expect(suggestTripEmoji({ destination: 'Helsinki' })).toBe(FALLBACK_EMOJI)
    expect(suggestTripEmoji({ destination: 'Campania' })).toBe(FALLBACK_EMOJI)
  })

  it('never returns nothing', () => {
    for (const input of [{}, { destination: '' }, { name: '' }, { activities: [] }]) {
      expect(suggestTripEmoji(input).length).toBeGreaterThan(0)
    }
  })
})

describe('validating an override', () => {
  it('accepts every icon in the picker', () => {
    for (const emoji of EMOJI_CHOICES) {
      expect(isValidTripEmoji(emoji), emoji).toBe(true)
    }
  })

  /*
   * Counted by grapheme. "🏖️" is three UTF-16 code units — a base emoji, a
   * variation selector and a surrogate pair — so a plain length check rejects
   * most of the list above.
   */
  it('accepts a multi-code-unit emoji as one symbol', () => {
    expect(isValidTripEmoji('🏖️')).toBe(true)
    expect(isValidTripEmoji('⛷️')).toBe(true)
  })

  it('refuses anything that is not exactly one emoji', () => {
    for (const value of ['', ' ', 'A', 'ab', '🦁🏖️', 'safari', '1', null, undefined, 42, {}]) {
      expect(isValidTripEmoji(value), String(value)).toBe(false)
    }
  })
})
