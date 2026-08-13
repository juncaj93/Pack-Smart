import { describe, expect, it } from 'vitest'
import { colorFit, familiesOf, isNeutral, swatchesFor } from '@shared/colors'
import { rank, type RankContext } from '@shared/outfits'
import { UNRECORDED_TRAITS, type Item } from '@shared/items'

/** A garment with nothing recorded but the fields a test is about. */
function garment(partial: Partial<Item> = {}): Item {
  return {
    id: 'g1', kind: 'clothing', displayName: 'Garment', category: 'Tops & Outerwear',
    subcategory: 'T-Shirt', color: null, pattern: null, brand: null, notes: null,
    usageFrequency: 'sometimes', warmth: null, dressiness: null,
    weatherTags: [], typicalUses: [], reuseCapacity: null, ownedQuantity: null,
    ...UNRECORDED_TRAITS,
    isCritical: false, requiresFinalCheck: false, defaultPackingTiming: 'anytime',
    alwaysInclude: false, neverInclude: false, archivedAt: null, source: 'manual',
    comfort: null, versatility: null,
    fieldProvenance: {},
    createdAt: 0, updatedAt: 0,
    dressinessContexts: [],
    ...partial,
  }
}

/**
 * Colour words, as the wardrobe actually spells them.
 *
 * The fixtures here are not invented: every string in the first block is a
 * real value from the `color` column of the seeded database, taken from the
 * import of Alex's spreadsheet. Thirty-one distinct strings, eleven of which
 * are not colours at all — which is the whole reason this reads words out of a
 * string rather than looking one up in a table.
 */

describe('reading a colour out of what was typed', () => {
  it('reads the plain ones', () => {
    expect(swatchesFor('Navy')[0]).toMatchObject({ label: 'Navy', family: 'blue' })
    expect(swatchesFor('White')[0]).toMatchObject({ label: 'White', family: 'white' })
    expect(swatchesFor('Bone')[0]).toMatchObject({ label: 'Bone', family: 'cream' })
  })

  /*
   * The ordering rule, and the only subtle thing in the module: a shorter word
   * inside a longer one must not win, or every dark green garment renders
   * mid-green.
   */
  it('prefers the longer word where one contains another', () => {
    expect(swatchesFor('Dark Green')).toHaveLength(1)
    expect(swatchesFor('Dark Green')[0]!.hex).not.toBe(swatchesFor('Green')[0]!.hex)

    expect(swatchesFor('Light Blue')[0]!.hex).not.toBe(swatchesFor('Blue')[0]!.hex)
    expect(swatchesFor('Dark Blue')[0]!.hex).not.toBe(swatchesFor('Blue')[0]!.hex)
  })

  it('finds the colour inside a phrase somebody half-finished', () => {
    // Real values from the wardrobe.
    expect(familiesOf('Navy w')).toEqual(['blue'])
    expect(familiesOf('Heather Gray')).toEqual(['grey'])
    expect(familiesOf('Gray Heather')).toEqual(['grey'])
    expect(familiesOf('Standard Blue')).toEqual(['blue'])
  })

  it('reads both spellings of grey, because the column and the screen disagree', () => {
    expect(familiesOf('Gray')).toEqual(['grey'])
    expect(familiesOf('Grey')).toEqual(['grey'])
    // And says it back the way it was written, since the row already spells it.
    expect(swatchesFor('Grey')[0]!.label).toBe('Grey')
  })

  /*
   * Two swatches, never three. `Gray, Navy, Short Gray` is a real value and it
   * is two colours — the second grey is the same fact again.
   */
  it('shows at most two colours, one per family', () => {
    const swatches = swatchesFor('Gray, Navy, Short Gray')
    expect(swatches).toHaveLength(2)
    expect(swatches.map((s) => s.family)).toEqual(['grey', 'blue'])
  })

  it('never returns more than two however many colours are listed', () => {
    expect(swatchesFor('Red, White, Blue, Green, Black')).toHaveLength(2)
  })

  /*
   * Unknown is allowed. Eleven of the thirty-one strings in the wardrobe are
   * not colours, and a row with no dot is the correct rendering of all of them
   * — a grey placeholder would be the swatch claiming knowledge nobody has.
   */
  it('says nothing about a string that is not a colour', () => {
    for (const value of [
      'Custom Printed',
      'Various Colors',
      'Patterned',
      'Plaid',
      'Suede',
      'Multi',
      'Brooklyn Design',
      'NY vs NY Pattern',
      'Neutral Tones',
      'Neutral',
    ]) {
      expect(swatchesFor(value), `${value} produced a swatch`).toEqual([])
    }
  })

  it('says nothing about nothing', () => {
    expect(swatchesFor(null)).toEqual([])
    expect(swatchesFor(undefined)).toEqual([])
    expect(swatchesFor('')).toEqual([])
    expect(swatchesFor('   ')).toEqual([])
  })

  /*
   * Word-anchored. `Brooklyn Design` must not match `brown` inside `Brooklyn`
   * and `Greyhound` must not be grey.
   */
  it('matches whole words only', () => {
    expect(swatchesFor('Greyhound')).toEqual([])
    expect(swatchesFor('Blackberry')).toEqual([])
  })

  it('marks the colours that would vanish into a light page', () => {
    expect(swatchesFor('White')[0]!.pale).toBe(true)
    expect(swatchesFor('Bone')[0]!.pale).toBe(true)
    expect(swatchesFor('Navy')[0]!.pale).toBe(false)
  })

  /* The same string must always produce the same swatch, or the UI flickers. */
  it('is deterministic', () => {
    const once = swatchesFor('Gray, Navy, Short Gray')
    const twice = swatchesFor('Gray, Navy, Short Gray')
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice))
  })
})

describe('which colours behave as ground rather than figure', () => {
  it('counts the obvious neutrals', () => {
    for (const value of ['Black', 'White', 'Bone', 'Gray', 'Tan', 'Brown']) {
      expect(isNeutral(swatchesFor(value)[0]!), `${value} is not neutral`).toBe(true)
    }
  })

  /*
   * Navy behaves as a neutral and `Standard Blue` does not, which is finer than
   * the family model — so it is tested, because it is the one place the module
   * looks below the family and a refactor could quietly lose it.
   */
  it('counts navy but not every blue', () => {
    expect(isNeutral(swatchesFor('Navy')[0]!)).toBe(true)
    expect(isNeutral(swatchesFor('Turquoise')[0]!)).toBe(false)
  })
})

/**
 * The soft signal, and the two things it must never do: speak when it has
 * nothing to say, and outrank anything Alex actually decided.
 */
describe('how a colour sits with the rest of an outfit', () => {
  const NEUTRAL_OUTFIT = ['Gray', 'White']

  it('says nothing when either side has no recorded colour', () => {
    expect(colorFit('Custom Printed', NEUTRAL_OUTFIT)).toBeNull()
    expect(colorFit('Navy', ['Patterned', 'Various Colors'])).toBeNull()
    expect(colorFit(null, NEUTRAL_OUTFIT)).toBeNull()
    expect(colorFit('Navy', [])).toBeNull()
  })

  /*
   * `null` rather than `0` is load-bearing: `rank` skips a criterion where
   * either side is null, so an unrecorded colour costs a garment nothing. A
   * zero would sort it below every garment that happens to have a colour
   * written down, which is punishing missing data (doc 05 §4).
   */
  it('returns null, not zero, so an unrecorded colour is never a penalty', () => {
    expect(colorFit('Suede', NEUTRAL_OUTFIT)).not.toBe(0)
    expect(colorFit('Suede', NEUTRAL_OUTFIT)).toBeNull()
  })

  it('likes a neutral against anything', () => {
    expect(colorFit('White', ['Navy', 'Olive'])).toBe(1)
    expect(colorFit('Gray', ['Turquoise'])).toBe(1)
  })

  /*
   * A neutral outfit ALLOWS a colour; it does not make one good. Scoring this 1
   * alongside a navy candidate — which is neutral, and genuinely does go with
   * everything — meant the criterion could not separate the two in the single
   * commonest case on this screen.
   */
  it('has no objection to one colour against a neutral outfit, and no opinion either', () => {
    expect(colorFit('Dark Green', NEUTRAL_OUTFIT)).toBe(0)
    // …and still prefers the one that goes with anything.
    expect(colorFit('Navy', NEUTRAL_OUTFIT)).toBe(1)
  })

  it('likes a colour that is already in the outfit somewhere', () => {
    expect(colorFit('Light Blue', ['Navy', 'Olive'])).toBe(1)
  })

  /*
   * Not wrong, and not something to recommend on a colour signal alone. If Alex
   * wants head-to-toe green he has the pairing history to say so — and that
   * criterion sits above this one.
   */
  it('does not push an outfit into one single colour', () => {
    expect(colorFit('Green', ['Dark Green', 'Olive'])).toBe(-1)
    // Including when that colour is a neutral — head-to-toe grey is the same
    // observation as head-to-toe green.
    expect(colorFit('Gray', ['Gray', 'Charcoal'])).toBe(-1)
  })

  it('is neutral about a colour it can neither tie in nor object to', () => {
    expect(colorFit('Yellow', ['Turquoise', 'Purple'])).toBe(0)
  })

  it('is deterministic', () => {
    expect(colorFit('Navy', NEUTRAL_OUTFIT)).toBe(colorFit('Navy', NEUTRAL_OUTFIT))
  })
})

/* ------------------------------------------------------------------ */
/* colour as a ranking signal, and the two things it may never do      */
/* ------------------------------------------------------------------ */

/**
 * The rules from doc 03 §15, asserted through `rank` rather than through
 * `colorFit` — because the claim is about the criterion's PLACE in the list,
 * and a unit test of the scoring function cannot see that.
 */
describe('where colour sits among the reasons', () => {
  const OUTFIT = [
    { id: 'pants', displayName: 'Everyday Pants', color: 'Gray' },
    { id: 'shoes', displayName: 'White Sneakers', color: 'White' },
  ]

  function context(over: Partial<RankContext> = {}): RankContext {
    return {
      requestedItemIds: new Set<string>(),
      usedCount: new Map<string, number>(),
      chosenInGroup: OUTFIT,
      ...over,
    }
  }

  /*
   * The safety property, and the reason the criterion is last: colour can only
   * separate garments that are already equal on everything above it. Here one
   * garment is worn far more often — a criterion that outranks colour — so
   * colour must not overturn it however well it matches.
   */
  it('never outranks a reason Alex actually gave', () => {
    const reachedFor = garment({
      id: 'often',
      displayName: 'Old Favourite',
      color: 'Turquoise',
      usageFrequency: 'frequent',
    })
    const prettier = garment({
      id: 'rare',
      displayName: 'Navy Shirt',
      color: 'Navy',
      usageFrequency: 'rare',
    })

    const ranked = rank([prettier, reachedFor], context())
    expect(ranked[0]!.item.id).toBe('often')
  })

  /* All else equal, the colour that works with the outfit comes first. */
  it('separates two garments that are otherwise identical', () => {
    const clashing = garment({ id: 'clash', displayName: 'A', color: 'Turquoise' })
    const fitting = garment({ id: 'fits', displayName: 'B', color: 'Navy' })

    const ranked = rank([clashing, fitting], context())
    expect(ranked[0]!.item.id).toBe('fits')
  })

  /*
   * An unrecorded colour is not a penalty. `Suede` is a real value in the
   * wardrobe, and a garment carrying it must not sort below one whose colour
   * happens to have been written down.
   */
  it('does not penalise a garment whose colour was never recorded', () => {
    const unknown = garment({ id: 'unknown', displayName: 'A', color: 'Suede' })
    const known = garment({ id: 'known', displayName: 'B', color: 'Turquoise' })

    // Neither is preferred: the criterion is null for one and cannot separate.
    const ranked = rank([known, unknown], context())
    expect(ranked.map((c) => c.item.id).sort()).toEqual(['known', 'unknown'])
    // The tie falls to the stable id order rather than to the colour.
    expect(ranked[0]!.item.id).toBe('known')
  })

  it('says nothing about colour when the outfit has no recorded colours', () => {
    const a = garment({ id: 'a', displayName: 'A', color: 'Navy' })
    const b = garment({ id: 'b', displayName: 'B', color: 'Turquoise' })

    const ranked = rank(
      [a, b],
      context({
        chosenInGroup: [{ id: 'x', displayName: 'Mystery', color: 'Various Colors' }],
      }),
    )
    expect(ranked[0]!.decidedBy).toBeNull()
  })

  /* When colour IS the reason, it names the garments rather than itself. */
  it('names what it goes with', () => {
    const clashing = garment({ id: 'clash', displayName: 'A', color: 'Turquoise' })
    const fitting = garment({ id: 'fits', displayName: 'B', color: 'Navy' })

    const ranked = rank([clashing, fitting], context())
    expect(ranked[0]!.decidedBy).toBe('Works with the everyday pants and white sneakers')
  })

  it('is deterministic, and does not depend on the order it was given', () => {
    const a = garment({ id: 'a', displayName: 'A', color: 'Turquoise' })
    const b = garment({ id: 'b', displayName: 'B', color: 'Navy' })

    expect(rank([a, b], context()).map((c) => c.item.id)).toEqual(
      rank([b, a], context()).map((c) => c.item.id),
    )
  })
})
