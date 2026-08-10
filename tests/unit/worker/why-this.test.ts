import { describe, expect, it } from 'vitest'
import { explainOutfit } from '@shared/outfits'

/**
 * "Why did Pack Smart choose this outfit?"
 *
 * The rule that makes this an explanation rather than a description: every
 * clause comes from a slot's `decidedBy`, the criterion that actually separated
 * the chosen garment from its runner-up. A garment can be comfortable,
 * versatile and warm and have been chosen for none of those things, and saying
 * otherwise is the confident-but-unsupported behaviour doc 03 exists to prevent.
 *
 * `rank` already refuses to record a criterion where either side was null (H1b),
 * so "cannot claim comfort when comfort is unrated" is inherited here rather
 * than re-implemented — which is why the silence tests below pass a null reason
 * rather than an unrated garment.
 */

const slot = (reason: string | null, filledBy?: string) => ({ reason, filledBy })

describe('what the outfit sentence is built from', () => {
  it('says nothing when nothing decided anything', () => {
    expect(explainOutfit([])).toBeNull()
    expect(explainOutfit([slot(null), slot(null)])).toBeNull()
  })

  it('names the criterion that actually decided a slot', () => {
    expect(explainOutfit([slot('Suits the conditions')])).toBe('Chosen for suits the forecast.')
  })

  /*
   * The load-bearing one. A criterion that said nothing is absent from
   * `decidedBy` entirely, and must not appear because some other slot mentioned
   * it — this is the difference between aggregating reasons and collecting
   * adjectives.
   */
  it('never mentions a criterion no slot was decided by', () => {
    const sentence = explainOutfit([slot('Comfortable to wear'), slot(null)])

    expect(sentence).toBe('Chosen for comfortable.')
    expect(sentence).not.toMatch(/forecast|often|reach for|several days/)
  })

  it('aggregates several slots into one sentence', () => {
    expect(
      explainOutfit([
        slot('Suits the conditions'),
        slot('Comfortable to wear'),
        slot('You wear it often'),
      ]),
    ).toBe('Chosen for suits the forecast, things you reach for and comfortable.')
  })

  /* "Comfortable, comfortable, comfortable" is the failure this prevents. */
  it('says a repeated reason once', () => {
    expect(
      explainOutfit([
        slot('Comfortable to wear'),
        slot('Comfortable to wear'),
        slot('Comfortable to wear'),
      ]),
    ).toBe('Chosen for comfortable.')
  })

  /*
   * Ordered by the criteria list, which is a priority order — so three slots
   * agreeing on comfort cannot outrank the one decided by the forecast.
   */
  it('leads with the stronger reason, not the more common one', () => {
    const sentence = explainOutfit([
      slot('Comfortable to wear'),
      slot('Comfortable to wear'),
      slot('Suits the conditions'),
    ])!

    expect(sentence.indexOf('forecast')).toBeLessThan(sentence.indexOf('comfortable'))
  })

  it('stops at three, however many slots agree', () => {
    const sentence = explainOutfit([
      slot('Suits the conditions'),
      slot('You wear these together'),
      slot('You wear it often'),
      slot('Works for several days'),
      slot('Comfortable to wear'),
    ])!

    expect(sentence.split(',').length + 1).toBeLessThanOrEqual(4)
    expect(sentence).toContain('suits the forecast')
    expect(sentence).not.toContain('comfortable')
  })

  it('reads a pairing as the relationship it is, not the partner s name', () => {
    expect(explainOutfit([slot('You approved this with the Field Shell before')]))
      .toBe('Chosen for pieces you wear together.')
  })
})

describe('when the outfit is Alex own', () => {
  it('says so, and claims nothing else', () => {
    expect(explainOutfit([slot('Comfortable to wear'), slot('Suits the conditions', 'user_swap')]))
      .toBe('You chose this one.')
  })

  /*
   * The retro-justification the brief rules out: an approved outfit must not be
   * explained by signals that did not select it, and the strongest case of that
   * is explaining HIS choice back to him with the planner's reasons.
   */
  it('does not dress a chosen garment in planner reasons', () => {
    const sentence = explainOutfit([slot('Comfortable to wear', 'user_swap')])!
    expect(sentence).not.toMatch(/comfortable|forecast|reach for/)
  })

  it('is unaffected by a slot the planner filled normally', () => {
    expect(explainOutfit([slot('Suits the conditions', 'generated')]))
      .toBe('Chosen for suits the forecast.')
  })
})

describe('what it never says', () => {
  const everything = explainOutfit([
    slot('Suits the conditions'),
    slot('You wear it often'),
    slot('Comfortable to wear'),
  ])!

  it('carries no score, no criterion id and no debug vocabulary', () => {
    expect(everything).not.toMatch(/\d/)
    expect(everything).not.toMatch(/score|criterion|rank|decidedBy|signal|null|undefined/i)
  })

  it('is one sentence', () => {
    expect(everything.split('.').filter(Boolean)).toHaveLength(1)
  })
})
