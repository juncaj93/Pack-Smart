import { describe, expect, it } from 'vitest'
import { CRITERIA, explainOutfit } from '@shared/outfits'

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
 *
 * ## And it has to read as English
 *
 * The second half of this file exists because it did not. The clauses were a mix
 * of verb phrases, noun phrases and one bare adjective, each defensible on its
 * own, and joined they produced *Chosen for suits the forecast, things you reach
 * for and comfortable.* Nothing was wrong with any fragment; the sentence was
 * still broken. So the grammar is asserted on the RENDERED string, over every
 * combination the planner can produce, rather than on the fragments.
 */

const slot = (reason: string | null, filledBy?: string) => ({ reason, filledBy })

describe('what the outfit sentence is built from', () => {
  it('says nothing when nothing decided anything', () => {
    expect(explainOutfit([])).toBeNull()
    expect(explainOutfit([slot(null), slot(null)])).toBeNull()
  })

  it('names the criterion that actually decided a slot', () => {
    expect(explainOutfit([slot('Suits the conditions')])).toBe(
      'Chosen because it suits the forecast.',
    )
  })

  /*
   * The load-bearing one. A criterion that said nothing is absent from
   * `decidedBy` entirely, and must not appear because some other slot mentioned
   * it — this is the difference between aggregating reasons and collecting
   * adjectives.
   */
  it('never mentions a criterion no slot was decided by', () => {
    const sentence = explainOutfit([slot('Comfortable to wear'), slot(null)])

    expect(sentence).toBe('Chosen because it is more comfortable.')
    expect(sentence).not.toMatch(/forecast|often|reach for|several days/)
  })

  it('aggregates several slots into one sentence', () => {
    expect(
      explainOutfit([
        slot('Suits the conditions'),
        slot('Comfortable to wear'),
        slot('You wear it often'),
      ]),
    ).toBe(
      'Chosen because it suits the forecast, includes things you reach for, and is more comfortable.',
    )
  })

  /* "Comfortable, comfortable, comfortable" is the failure this prevents. */
  it('says a repeated reason once', () => {
    expect(
      explainOutfit([
        slot('Comfortable to wear'),
        slot('Comfortable to wear'),
        slot('Comfortable to wear'),
      ]),
    ).toBe('Chosen because it is more comfortable.')
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

    expect(sentence.indexOf('forecast')).toBeLessThan(sentence.indexOf('comfort'))
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
    expect(sentence).not.toContain('comfort')
  })

  it('reads a pairing as the relationship it is, not the partner s name', () => {
    expect(explainOutfit([slot('You approved this with the Field Shell before')])).toBe(
      'Chosen because it pairs pieces you wear together.',
    )
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
    expect(sentence).not.toMatch(/comfort|forecast|reach for/)
  })

  it('is unaffected by a slot the planner filled normally', () => {
    expect(explainOutfit([slot('Suits the conditions', 'generated')])).toBe(
      'Chosen because it suits the forecast.',
    )
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

/* ------------------------------------------------------------------ */
/* the sentence as Alex reads it                                       */
/* ------------------------------------------------------------------ */

/** Every criterion that can appear in the sentence, in priority order. */
const CLAUSED = CRITERIA.filter((criterion) => criterion.clause)

/**
 * The exact copy, one criterion at a time.
 *
 * Written out rather than derived, because these ARE the words — a test that
 * rebuilt them from `clause` would agree with any wording, including
 * *Chosen because it comfortable.* The keys are criterion names, and the
 * exhaustiveness check below means a seventh criterion cannot be added without
 * someone reading its sentence aloud.
 */
const SENTENCES: Record<string, string> = {
  'Suits the conditions': 'Chosen because it suits the forecast.',
  'You wear these together': 'Chosen because it pairs pieces you wear together.',
  'You wear it often': 'Chosen because it includes things you reach for.',
  'Works for several days': 'Chosen because it works across several days.',
  'Already packed for another day': 'Chosen because it is already in the bag for another day.',
  'Comfortable to wear': 'Chosen because it is more comfortable.',
}

describe('every reason, on its own', () => {
  it('covers every criterion that can be explained', () => {
    expect(CLAUSED.map((criterion) => criterion.name).sort()).toEqual(Object.keys(SENTENCES).sort())
  })

  for (const [name, expected] of Object.entries(SENTENCES)) {
    it(`reads "${expected}"`, () => {
      expect(explainOutfit([slot(name)])).toBe(expected)
    })
  }

  /*
   * The two criteria that deliberately have no clause. *You asked for it* is
   * answered by "You chose this one" instead, and *Something different* is a
   * tie-breaker about spreading wear rather than a reason Alex would recognise.
   */
  it('stays silent for the criteria that are not reasons', () => {
    expect(explainOutfit([slot('You asked for it')])).toBeNull()
    expect(explainOutfit([slot('Something different')])).toBeNull()
  })
})

/** Every combination of up to three reasons, in the order the planner emits them. */
function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]]
  return items.flatMap((item, index) =>
    combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]),
  )
}

describe('every combination of reasons', () => {
  const all = [1, 2, 3].flatMap((size) => combinations(CLAUSED, size))

  it('is more than a handful of sentences', () => {
    // 6 + 15 + 20 today. Asserted so a table that quietly emptied — a filter
    // typo, a renamed field — could not make every case below vacuous.
    expect(all.length).toBeGreaterThanOrEqual(41)
  })

  for (const group of all) {
    const names = group.map((criterion) => criterion.name)

    it(`reads as English: ${names.join(' + ')}`, () => {
      const sentence = explainOutfit(names.map((name) => slot(name)))!
      expect(sentence).not.toBeNull()

      /*
       * One subject, one verb per clause. This is the constraint the old copy
       * broke: "Chosen for" took fragments of any shape, so a noun phrase and an
       * adjective could sit where a predicate belonged.
       */
      expect(sentence.startsWith('Chosen because it ')).toBe(true)

      const body = sentence.slice('Chosen because it '.length, -1)
      expect(sentence.endsWith('.')).toBe(true)
      expect(sentence.split('.').filter(Boolean)).toHaveLength(1)

      // Punctuation that only ever appears by accident.
      expect(body).not.toMatch(/\s{2,}|\s,|,,|,$/)

      /*
       * Serial comma, and exactly one "and". Without it the last two predicates
       * run together — "includes things you reach for and is more comfortable"
       * invites a reading where both belong to one garment.
       */
      const commas = body.match(/,/g)?.length ?? 0
      const ands = body.match(/\band\b/g)?.length ?? 0
      expect(commas).toBe(group.length - 1)
      expect(ands).toBe(group.length > 1 ? 1 : 0)
      if (group.length > 1) expect(body).toContain(', and ')

      /*
       * Every clause present, once, in criteria order — the priority order is
       * part of the sentence's meaning, not just its layout.
       */
      const positions = group.map((criterion) => body.indexOf(criterion.clause!))
      expect(positions.every((position) => position >= 0)).toBe(true)
      expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    })
  }

  /*
   * The brief's own example, pinned. Before this it read *Chosen for suits the
   * forecast, things you reach for and comfortable.*
   */
  it('renders the three-reason case the way it was asked for', () => {
    expect(
      explainOutfit([
        slot('Suits the conditions'),
        slot('You wear it often'),
        slot('Comfortable to wear'),
      ]),
    ).toBe(
      'Chosen because it suits the forecast, includes things you reach for, and is more comfortable.',
    )
  })

  /*
   * Truncation is a place broken English hides: cutting a list at three has to
   * leave a sentence, not a sentence with its tail removed.
   */
  it('still reads as English when more than three reasons are cut to three', () => {
    const sentence = explainOutfit(CLAUSED.map((criterion) => slot(criterion.name)))!

    expect(sentence).toBe(
      'Chosen because it suits the forecast, pairs pieces you wear together, and includes things you reach for.',
    )
  })
})
