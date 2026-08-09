import { describe, expect, it } from 'vitest'
import { contextForLevel, type DressinessContext } from '@shared/dressiness'
import type { Item } from '@shared/items'
import type { FieldProvenance } from '@shared/provenance'
import {
  REASON_RANK,
  TOPIC_NAME,
  TOPIC_RATINGS,
  buildReviewQueue,
  disagreementTopic,
  duplicateTopic,
  findDisagreements,
  ratingAsks,
  suggestName,
  tieGroups,
  type DecisionRow,
  type ReviewSignals,
} from '@shared/closet-review'

/**
 * Which question is worth asking, and in what order (H1d).
 *
 * The whole feature turns on one rule — **do not ask low-value questions merely
 * because a field is empty** — and that rule is arithmetic over plain values,
 * so this is where it is proved. `tests/integration/closet-review.test.ts`
 * proves the counts these read come out of the right tables; nothing here
 * touches a database.
 */

const NOW = 1_780_000_000

function garment(id: string, partial: Partial<Item> = {}): Item {
  const dressiness = partial.dressiness === undefined ? 1 : partial.dressiness
  return {
    id,
    kind: 'clothing',
    displayName: partial.displayName ?? id,
    category: 'Tops & Outerwear',
    subcategory: 'T-Shirt',
    color: null,
    pattern: null,
    brand: null,
    notes: null,
    usageFrequency: 'sometimes',
    warmth: null,
    dressiness,
    dressinessContexts: contextsFor(dressiness),
    weatherTags: [],
    typicalUses: [],
    reuseCapacity: null,
    ownedQuantity: null,
    comfort: null,
    versatility: null,
    isCritical: false,
    requiresFinalCheck: false,
    defaultPackingTiming: 'anytime',
    alwaysInclude: false,
    neverInclude: false,
    archivedAt: null,
    source: 'manual',
    fieldProvenance: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  }
}

function contextsFor(level: number | null): DressinessContext[] {
  const context = contextForLevel(level)
  return context === null ? [] : [context]
}

const NO_SIGNALS: ReviewSignals = { packedTrips: {}, manualSwaps: {}, removals: {} }

/**
 * Contexts Alex has actually CONFIRMED, not ones the importer guessed.
 *
 * The distinction is the whole of `onlyEverGuessed`, and a fixture that ignores
 * it is a fixture describing a state the real database almost never holds:
 * migration 0022 gave every imported garment the one context its guessed
 * dressiness meant, so a bare `dressinessContexts: ['casual']` is a GUESS and
 * the queue is right to keep asking about it. These tests mean "answered", so
 * they say so.
 */
function confirmedContexts(contexts: DressinessContext[]) {
  return {
    dressinessContexts: contexts,
    fieldProvenance: {
      dressinessContexts: { source: 'user_confirmed' as const, at: NOW },
    },
  }
}

/** A garment with nothing left to ask about. */
const ANSWERED = {
  comfort: 3,
  versatility: 3,
  ...confirmedContexts(['casual']),
}

function queue(items: Item[], signals: Partial<ReviewSignals> = {}, decisions: DecisionRow[] = []) {
  return buildReviewQueue({ items, signals: { ...NO_SIGNALS, ...signals }, decisions })
}

/* ------------------------------------------------------------------ */

describe('the order is the value of the answer, not the emptiness of the field', () => {
  /*
   * The four evidence ranks, each proved against a garment that is identical
   * except for the evidence. Without that control the test would be measuring
   * the id tiebreak.
   */
  it('asks first about something Alex keeps packing', () => {
    const { cards } = queue(
      [garment('plain'), garment('packed')],
      { packedTrips: { packed: 6 } },
    )
    expect(cards[0]?.item.id).toBe('packed')
    expect(cards[0]?.reason).toBe('often_packed')
    expect(cards[0]?.why).toBe('You have packed this on 6 trips.')
  })

  it('asks next about something the ranker cannot separate', () => {
    /*
     * Two garments identical on every criterion above comfort. `swapped` also
     * carries swap evidence, which sits BELOW ties — so if the order were
     * anything other than the documented one, `swapped` would lead.
     */
    const { cards } = queue(
      [garment('tied-a'), garment('tied-b'), garment('swapped', { subcategory: 'Pants' })],
      { manualSwaps: { swapped: 9 } },
    )
    expect(cards[0]?.reason).toBe('ties')
    expect(cards[0]?.why).toBe('Pack Smart cannot tell this from 1 other top you own.')
    expect(cards.find((c) => c.item.id === 'swapped')?.reason).toBe('swapped_in')
  })

  it('asks about what he picks himself before what he merely has not rated', () => {
    const { cards } = queue(
      [garment('plain', { subcategory: 'Pants' }), garment('picked', { subcategory: 'Shoes' })],
      { manualSwaps: { picked: 3 } },
    )
    expect(cards[0]?.item.id).toBe('picked')
    expect(cards[0]?.why).toBe('You have chosen this yourself 3 times, over what was suggested.')
    expect(cards[1]?.reason).toBe('no_comfort')
  })

  it('asks about what he keeps taking off the list', () => {
    const { cards } = queue(
      [garment('plain', { subcategory: 'Pants' }), garment('dropped', { subcategory: 'Shoes' })],
      { removals: { dropped: 4 } },
    )
    expect(cards[0]?.item.id).toBe('dropped')
    expect(cards[0]?.why).toBe('You have taken this off 4 packing lists.')
  })

  /*
   * The rule that keeps the top of the queue honest. Evidence alone is not a
   * question — a garment packed on nine trips with every rating already given
   * is a garment Alex has already told us about.
   */
  it('does not put a fully rated garment at the top just because it travels', () => {
    const rated = garment('rated', {
      comfort: 4,
      versatility: 3,
      ...confirmedContexts(['casual', 'smart_casual']),
    })
    const { cards } = queue([rated, garment('unrated', { subcategory: 'Pants' })], {
      packedTrips: { rated: 9 },
    })

    expect(cards.map((c) => c.item.id)).toEqual(['unrated'])
  })

  it('falls back to the bare gaps, comfort before versatility before dressiness', () => {
    const noComfort = garment('c', { versatility: 3, ...confirmedContexts(['casual']) })
    const noVersatility = garment('v', { comfort: 3, ...confirmedContexts(['casual']) })
    const noContexts = garment('d', { comfort: 3, versatility: 3, dressinessContexts: [] })

    const { cards } = queue([noContexts, noVersatility, noComfort])
    expect(cards.map((c) => c.reason)).toEqual(['no_comfort', 'no_versatility', 'no_contexts'])
  })

  it('is stable, so reopening the queue does not reshuffle it', () => {
    const items = [garment('bbb', { subcategory: 'Pants' }), garment('aaa', { subcategory: 'Shoes' })]
    expect(queue(items).cards.map((c) => c.item.id)).toEqual(['aaa', 'bbb'])
    expect(queue([...items].reverse()).cards.map((c) => c.item.id)).toEqual(['aaa', 'bbb'])
  })

  it('keeps the reason ranks in the order the brief set them', () => {
    // The list is the product decision; this is the guard against reordering it
    // by accident while editing the switch that reads it.
    const ordered = Object.entries(REASON_RANK)
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name)
    expect(ordered).toEqual([
      'often_packed',
      'ties',
      'swapped_in',
      'removed',
      'no_comfort',
      'no_versatility',
      'no_contexts',
      'repetitive_name',
      'missing_detail',
      'possible_duplicate',
      'disagreement',
    ])
  })
})

describe('what never reaches the queue', () => {
  it('excludes archived garments', () => {
    expect(queue([garment('gone', { archivedAt: NOW })]).cards).toHaveLength(0)
  })

  it('asks gear nothing about comfort, versatility or dressiness', () => {
    const passport = garment('passport', {
      kind: 'gear',
      category: 'Documents',
      subcategory: null,
      displayName: 'Passport',
    })
    expect(ratingAsks(passport)).toEqual([])
    expect(queue([passport]).cards).toHaveLength(0)
  })

  it('offers no card for a garment with nothing worth asking', () => {
    const complete = garment('done', {
      comfort: 5,
      versatility: 2,
      ...confirmedContexts(['casual', 'smart_casual']),
    })
    expect(queue([complete]).cards).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */

describe('ties are read off the ranking criteria, not guessed at', () => {
  it('groups garments identical on every criterion above comfort', () => {
    const rivals = tieGroups([garment('a'), garment('b'), garment('c')])
    expect(rivals.get('a')).toBe(2)
  })

  it('does not tie garments that suit different occasions', () => {
    const casual = garment('casual', { dressiness: 1 })
    const dressy = garment('dressy', { dressiness: 3 })
    expect(tieGroups([casual, dressy]).size).toBe(0)
  })

  it('does not tie garments one of which is worn more often', () => {
    const often = garment('often', { usageFrequency: 'frequent' })
    expect(tieGroups([often, garment('rarely', { usageFrequency: 'rare' })]).size).toBe(0)
  })

  it('does not tie garments with different weather capabilities', () => {
    const shell = garment('shell', { weatherTags: ['rain'] })
    expect(tieGroups([shell, garment('tee')]).size).toBe(0)
  })

  it('does not tie garments that fill different slots', () => {
    expect(tieGroups([garment('top'), garment('shoes', { subcategory: 'Shoes' })]).size).toBe(0)
  })

  /*
   * The tie only MATTERS while comfort is unknown, because comfort is the next
   * criterion. Two garments that tie and are both rated need no question.
   */
  it('does not ask about a tie comfort already breaks', () => {
    const a = garment('a', { comfort: 4, versatility: 2, ...confirmedContexts(['casual']) })
    const b = garment('b', { comfort: 2, versatility: 2, ...confirmedContexts(['casual']) })
    expect(queue([a, b]).cards).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */

describe('a name suggestion is subtraction, never invention', () => {
  it('takes out the words the row already stores beside it', () => {
    const briefs = garment('briefs', {
      displayName: 'Various colors Pair of Thieves boxer briefs',
      brand: 'Pair of Thieves',
      color: 'Various colors',
    })

    expect(suggestName(briefs)).toEqual({
      displayName: 'Boxer briefs',
      removed: ['Various colors', 'Pair of Thieves'],
      keptAs: 'Color and Brand',
    })
  })

  it('says nothing about a name that does not repeat itself', () => {
    const jacket = garment('jacket', {
      displayName: 'Storm Shell',
      brand: 'Arc’teryx',
      color: 'Black',
    })
    expect(suggestName(jacket)).toBeNull()
  })

  /*
   * G6's rule, unchanged: correct against the row's structured data, never
   * against a pattern. A brand inside a name the row does not record is what
   * Alex wrote, and it stands.
   */
  it('never guesses at a brand the row does not record', () => {
    const jacket = garment('jacket', { displayName: 'The North Face Shirt Jacket', brand: null })
    expect(suggestName(jacket)).toBeNull()
  })

  it('matches whole words only, so a colour cannot cut a name in half', () => {
    const denim = garment('denim', { displayName: 'Shredded Denim', color: 'Red' })
    expect(suggestName(denim)).toBeNull()
  })

  it('refuses a suggestion that would leave nothing behind', () => {
    const bare = garment('bare', { displayName: 'Columbia', brand: 'Columbia' })
    expect(suggestName(bare)).toBeNull()
  })

  it('offers the card once the ratings are done, never before', () => {
    const messy = {
      displayName: 'Black Columbia Fleece',
      brand: 'Columbia',
      color: 'Black',
      comfort: 3,
      versatility: 3,
      ...confirmedContexts(['casual']),
    }
    expect(queue([garment('messy', messy)]).cards[0]?.reason).toBe('repetitive_name')

    // With a rating still missing, the rating is the higher-value question and
    // the suggestion rides along on the same card rather than jumping the line.
    const unrated = queue([garment('messy', { ...messy, comfort: null })]).cards[0]
    expect(unrated?.reason).toBe('no_comfort')
    expect(unrated?.nameSuggestion?.displayName).toBe('Fleece')
  })
})

describe('two things called the same thing', () => {
  it('says so when nothing tells them apart', () => {
    const rated = ANSWERED
    const { cards } = queue([
      garment('a', { displayName: 'Quarter-Zip', ...rated }),
      garment('b', { displayName: 'Quarter-Zip', ...rated, brand: 'Patagonia' }),
    ])

    const vague = cards.find((c) => c.item.id === 'a')
    expect(vague?.reason).toBe('missing_detail')
    expect(vague?.why).toBe('You own 2 things called “Quarter-Zip”, and nothing tells this one apart.')
    // The one with a brand is already distinguishable, so it is not asked.
    expect(cards.find((c) => c.item.id === 'b')?.reason).not.toBe('missing_detail')
  })
})

/* ------------------------------------------------------------------ */

describe('possible duplicates, deliberately quiet', () => {
  const rated = ANSWERED

  it('asks when the name, the brand and the colours all overlap', () => {
    const { cards } = queue([
      garment('a', { displayName: 'Grey Tee', brand: 'Uniqlo', color: 'Black', ...rated }),
      garment('b', { displayName: 'Grey Tee', brand: 'Uniqlo', color: 'Black & Gray', ...rated }),
    ])

    expect(cards[0]?.reason).toBe('possible_duplicate')
    expect(cards[0]?.duplicate?.itemId).toBe('b')
    expect(cards[1]?.duplicate?.itemId).toBe('a')
  })

  /*
   * The clause that stops this becoming the cry-wolf queue doc 09 warns about:
   * a naive "same name and brand" rule flagged 13 groups covering ~30 rows of
   * the real workbook.
   */
  it('says nothing about two garments in genuinely different colours', () => {
    const { cards } = queue([
      garment('a', { displayName: 'Shinola', brand: 'Shinola', color: 'Black', ...rated }),
      garment('b', { displayName: 'Shinola', brand: 'Shinola', color: 'White', ...rated }),
    ])
    expect(cards).toHaveLength(0)
  })

  it('carries what each has been packed on, so keeping one is informed', () => {
    const { cards } = queue(
      [
        garment('a', { displayName: 'Tee', brand: 'Uniqlo', ...rated }),
        garment('b', { displayName: 'Tee', brand: 'Uniqlo', ...rated }),
      ],
      { packedTrips: { a: 5, b: 0 } },
    )
    expect(cards[0]?.duplicate).toMatchObject({ packedTrips: 5, otherPackedTrips: 0 })
  })
})

/* ------------------------------------------------------------------ */

describe('a disagreement is read straight out of provenance', () => {
  const confirmedOver = (was: unknown, wasSource: 'imported' | 'inferred'): FieldProvenance => ({
    dressinessContexts: { source: 'user_confirmed', at: NOW, was, wasSource },
  })

  it('finds a confirmed value the spreadsheet still disagrees with', () => {
    const shirt = garment('shirt', {
      dressinessContexts: ['smart_casual', 'dressy'],
      fieldProvenance: confirmedOver(['smart_casual'], 'inferred'),
    })

    expect(findDisagreements(shirt)).toEqual([
      {
        field: 'dressinessContexts',
        label: 'Where it works',
        mine: 'Smart casual + Dressy',
        theirs: 'Smart casual',
        theirsSource: 'inferred',
      },
    ])
  })

  it('says nothing when the confirmation agreed with the spreadsheet', () => {
    const shirt = garment('shirt', {
      dressinessContexts: ['smart_casual'],
      fieldProvenance: confirmedOver(['smart_casual'], 'imported'),
    })
    expect(findDisagreements(shirt)).toEqual([])
  })

  it('says nothing about a value no importer ever wrote', () => {
    const shirt = garment('shirt', {
      comfort: 5,
      fieldProvenance: { comfort: { source: 'user_confirmed', at: NOW } },
    })
    expect(findDisagreements(shirt)).toEqual([])
  })

  it('is the last thing asked about, behind every rating', () => {
    const { cards } = queue([
      garment('shirt', {
        comfort: 3,
        versatility: 3,
        dressinessContexts: ['smart_casual', 'dressy'],
        fieldProvenance: confirmedOver(['smart_casual'], 'inferred'),
      }),
    ])
    expect(cards[0]?.reason).toBe('disagreement')
    expect(cards[0]?.disagreements).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */

describe('what Alex has already decided', () => {
  const unrated = () => garment('tee')

  it('stops asking a question he answered', () => {
    const decisions: DecisionRow[] = [
      { itemId: 'tee', topic: TOPIC_RATINGS, decision: 'answered' },
    ]
    expect(queue([unrated()], {}, decisions).cards).toHaveLength(0)
  })

  it('withdraws a question he was not sure about, and offers it back', () => {
    const decisions: DecisionRow[] = [
      { itemId: 'tee', topic: TOPIC_RATINGS, decision: 'not_sure' },
    ]
    const result = queue([unrated()], {}, decisions)
    expect(result.cards).toHaveLength(0)
    expect(result.notSure).toBe(1)
  })

  /*
   * Skip is NOT withdrawal, and the difference is the whole reason both exist.
   * A skipped card stays in the queue, behind everything unskipped — so nothing
   * is lost, and Alex reaches it again once the better questions are done.
   */
  it('moves a skipped card to the back rather than removing it', () => {
    const decisions: DecisionRow[] = [
      { itemId: 'skipped', topic: TOPIC_RATINGS, decision: 'skipped' },
    ]
    const { cards } = queue(
      [garment('skipped'), garment('fresh', { subcategory: 'Pants' })],
      // The skipped one would otherwise LEAD, on the strongest evidence there is.
      { packedTrips: { skipped: 9 } },
      decisions,
    )

    expect(cards.map((c) => c.item.id)).toEqual(['fresh', 'skipped'])
    expect(cards[1]?.skipped).toBe(true)
  })

  it('settles one duplicate pair without settling another', () => {
    /*
     * A brand on all three, so `garmentDetail` is not empty and the
     * `missing_detail` reason does not fire — which it otherwise would, for
     * three things called "Tee" with nothing telling them apart, and the test
     * would be measuring that instead of the duplicate decision.
     */
    const rated = { ...ANSWERED, brand: 'Uniqlo' }
    const items = [
      garment('a', { displayName: 'Tee', ...rated }),
      garment('b', { displayName: 'Tee', ...rated }),
      garment('c', { displayName: 'Tee', ...rated }),
    ]
    const decisions: DecisionRow[] = [
      { itemId: 'a', topic: duplicateTopic('b'), decision: 'answered' },
    ]

    const { cards } = queue(items, {}, decisions)
    // `a` no longer asks about `b`; `b` and `c` still have their own question.
    expect(cards.map((c) => c.item.id)).toEqual(['b', 'c'])
  })

  it('settles one disagreeing field without settling the rest of the garment', () => {
    const shirt = garment('shirt', {
      comfort: 3,
      versatility: 3,
      dressinessContexts: ['smart_casual', 'dressy'],
      color: 'Navy',
      fieldProvenance: {
        dressinessContexts: {
          source: 'user_confirmed', at: NOW, was: ['smart_casual'], wasSource: 'inferred',
        },
        color: { source: 'user_confirmed', at: NOW, was: 'Blue', wasSource: 'imported' },
      },
    })

    const decisions: DecisionRow[] = [
      { itemId: 'shirt', topic: disagreementTopic('color'), decision: 'answered' },
    ]
    const { cards } = queue([shirt], {}, decisions)
    expect(cards[0]?.disagreements.map((d) => d.field)).toEqual(['dressinessContexts'])
  })

  it('keeps a name question separate from a ratings question', () => {
    const messy = garment('messy', {
      displayName: 'Black Columbia Fleece',
      brand: 'Columbia',
      color: 'Black',
    })
    const decisions: DecisionRow[] = [{ itemId: 'messy', topic: TOPIC_NAME, decision: 'answered' }]

    const { cards } = queue([messy], {}, decisions)
    expect(cards[0]?.reason).toBe('no_comfort')
    expect(cards[0]?.nameSuggestion).toBeNull()
  })
})
