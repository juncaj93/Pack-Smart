import { describe, expect, it } from 'vitest'
import {
  foldForSearch,
  matchesSearch,
  searchMatcher,
  searchPredicate,
  typoBudget,
  withinEdits,
} from '@shared/search'

/**
 * The forgiving search, over plain values.
 *
 * Every case below is a real failure of the substring rule this replaced, and
 * they are grouped by WHAT was forgiven rather than by which screen reported it
 * — the whole point of one shared matcher is that the wardrobe, the packing
 * list, the swap sheet and the rules list cannot disagree about any of this.
 *
 * The last group is the one that matters most, and it is the negative one: a
 * forgiving filter that forgives too much is worse than a strict one, because
 * it answers a specific question with a shrug.
 */

describe('folding', () => {
  it('takes apostrophes out rather than splitting on them', () => {
    // `levi s` would be two words, and `levis` is neither of them.
    expect(foldForSearch("Levi's")).toBe('levis')
    expect(foldForSearch('Levi’s')).toBe('levis')
  })

  it('turns every other separator into a space', () => {
    expect(foldForSearch('Zip-Up Jacket')).toBe('zip up jacket')
    expect(foldForSearch('  Quarter–Zip  ')).toBe('quarter zip')
  })

  it('strips accents', () => {
    expect(foldForSearch('Hermès')).toBe('hermes')
    expect(foldForSearch('Vêtement')).toBe('vetement')
  })

  it('canonicalises the grey spelling in both directions', () => {
    expect(foldForSearch('Heather Grey')).toBe(foldForSearch('Heather Gray'))
  })

  it('leaves letters of other scripts alone rather than deleting them', () => {
    // A query folded to nothing would match EVERYTHING, which is the one
    // failure mode worse than matching nothing.
    expect(foldForSearch('Пальто')).toBe('пальто')
  })
})

describe('edit distance', () => {
  it('charges one for a transposition, not two', () => {
    expect(withinEdits('jakcet', 'jacket', 1)).toBe(true)
  })

  it('charges one for a substitution, an insertion and a deletion', () => {
    expect(withinEdits('jaket', 'jacket', 1)).toBe(true)
    expect(withinEdits('jackett', 'jacket', 1)).toBe(true)
    expect(withinEdits('jocket', 'jacket', 1)).toBe(true)
  })

  it('refuses two errors on a one-edit budget', () => {
    expect(withinEdits('jokat', 'jacket', 1)).toBe(false)
  })

  it('scales the budget by length, so short words are matched exactly', () => {
    expect(typoBudget('tee')).toBe(0)
    expect(typoBudget('grey')).toBe(1)
    expect(typoBudget('windbreaker')).toBe(2)
  })
})

describe('what a search now finds', () => {
  const shirt = ['Layering T-Shirt', 'Uniqlo', 'Heather Gray', null, 'T-Shirt'] as const
  const jacket = ['Storm Shell', 'Columbia', 'Black', null, 'Jacket'] as const

  const finds = (query: string, fields: readonly (string | null)[]) =>
    matchesSearch(query, ...fields)

  it('finds a hyphenated name typed without the hyphen', () => {
    expect(finds('tshirt', shirt)).toBe(true)
    expect(finds('t shirt', shirt)).toBe(true)
    expect(finds('T-Shirt', shirt)).toBe(true)
  })

  it('finds a possessive brand typed without the apostrophe', () => {
    expect(matchesSearch('levis', "Levi's 501", null)).toBe(true)
  })

  it('forgives an ordinary typo in a longer word', () => {
    expect(finds('colombia', jacket)).toBe(true)
    expect(finds('jaket', jacket)).toBe(true)
    expect(finds('jakcet', jacket)).toBe(true)
  })

  it('finds either spelling of grey from either spelling', () => {
    expect(finds('grey', shirt)).toBe(true)
    expect(finds('gray', shirt)).toBe(true)
  })

  it('lets two words land in two different columns', () => {
    /*
     * The query nobody could type before. After G6 the name carries neither the
     * brand nor the colour, so `black jacket` had to reach two columns at once
     * or the natural way to describe a garment was the one that could not work.
     */
    expect(finds('black jacket', jacket)).toBe(true)
    expect(finds('columbia shell', jacket)).toBe(true)
  })

  it('still matches a plain substring, which is most of what anyone types', () => {
    expect(finds('storm', jacket)).toBe(true)
    expect(finds('shell', jacket)).toBe(true)
  })

  it('shows everything when nothing has been typed', () => {
    const matcher = searchMatcher('   ')
    expect(matcher.active).toBe(false)
    expect(matcher.matchesPhrase(null, null)).toBe(true)
    expect(matcher.matchesLoosely(null, null)).toBe(true)
  })

  it('folds punctuation without forgiving anything, so the tightest tier finds it', () => {
    const matcher = searchMatcher('tshirt')
    expect(matcher.matchesPhrase('Layering T-Shirt')).toBe(true)
    expect(matcher.matchesPhrase('Button-Up Shirt')).toBe(false)
  })

  it('nests the tiers, so widening can only ever add', () => {
    const matcher = searchMatcher('blue jaket')
    const fields = ['Zip-Up Jacket', 'Columbia', 'Blue'] as const
    expect(matcher.matchesPhrase(...fields)).toBe(false)
    expect(matcher.matchesExactly(...fields)).toBe(false)
    expect(matcher.matchesLoosely(...fields)).toBe(true)
  })
})

/**
 * The rule that makes the rest of it safe: the NARROWEST tier that finds
 * anything is the one Alex gets.
 *
 * Both cases below are failures measured against the real workbook, not
 * hypotheticals. Forgiving one edit on every row turned `shorts` into a query
 * that returned shirts; matching word-by-word before phrase made `t-shirt`
 * looser than `tshirt`, so typing the punctuation correctly cost precision.
 */
describe('the narrowest tier that finds anything', () => {
  const closet = [
    { name: 'Athletic Shorts', color: 'Black' },
    { name: 'Casual Shorts', color: 'Blue' },
    { name: 'Sleep Shirts', color: 'Grey' },
    { name: 'Sports Cap', color: 'Black' },
    { name: 'Crewneck Sweater', color: 'Blue' },
    { name: 'Layering T-Shirt', color: 'Grey' },
  ]

  const find = (query: string) =>
    closet
      .filter(searchPredicate(query, closet, (row) => [row.name, row.color]))
      .map((row) => row.name)

  it('returns only the exact answers when there are any', () => {
    // Not `Sleep Shirts` (one edit) and not `Sports Cap` (one edit).
    expect(find('shorts')).toEqual(['Athletic Shorts', 'Casual Shorts'])
  })

  it('does not let a typed hyphen widen the query', () => {
    expect(find('t-shirt')).toEqual(['Layering T-Shirt'])
    expect(find('tshirt')).toEqual(['Layering T-Shirt'])
  })

  it('spreads words across columns only when the phrase itself found nothing', () => {
    expect(find('blue sweater')).toEqual(['Crewneck Sweater'])
  })

  it('forgives a typo only when the tiers above it are empty', () => {
    expect(find('sweter')).toEqual(['Crewneck Sweater'])
    expect(find('blue sweter')).toEqual(['Crewneck Sweater'])
  })

  it('still finds nothing when there is nothing to find', () => {
    expect(find('kayak')).toEqual([])
  })

  it('lets everything through when nothing was typed', () => {
    expect(find('  ')).toHaveLength(closet.length)
  })
})

describe('what it still refuses, which is the half that keeps it useful', () => {
  const jacket = ['Storm Shell', 'Columbia', 'Black', null, 'Jacket'] as const

  it('does not forgive a short word, where one edit is a different word', () => {
    // `tee` must not find `the`, `sea` or `top`.
    expect(matchesSearch('tee', 'The Sea Top', null)).toBe(false)
  })

  it('requires every typed word to land somewhere', () => {
    // Typing MORE may never find MORE.
    expect(matchesSearch('black jacket', ...jacket)).toBe(true)
    expect(matchesSearch('black jacket linen', ...jacket)).toBe(false)
  })

  it('does not match an unrelated word that merely shares some letters', () => {
    expect(matchesSearch('chartreuse', ...jacket)).toBe(false)
    expect(matchesSearch('trousers', ...jacket)).toBe(false)
  })

  it('says no when every field is empty', () => {
    expect(matchesSearch('anything', null, undefined, '')).toBe(false)
  })
})
