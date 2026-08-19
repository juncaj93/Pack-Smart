import { describe, expect, it } from 'vitest'
import { contextForLevel, type DressinessContext } from '@shared/dressiness'
import { UNRECORDED_TRAITS, type Item } from '@shared/items'
import type { FieldProvenance } from '@shared/provenance'
import {
  REASON_RANK,
  REPEATEDLY,
  TOPIC_NAME,
  TOPIC_RATINGS,
  buildReviewQueue,
  disagreementTopic,
  duplicateTopic,
  findDisagreements,
  hasFeedback,
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
    ...UNRECORDED_TRAITS,
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

/**
 * A garment with nothing left to ASK about, and still IN the queue.
 *
 * The two halves pull against each other now, which is why this needs saying.
 * The ratings are filled in, so `ratingAsks` returns nothing; but none of them
 * is at `user_confirmed`, so `hasFeedback` is false and the garment can still
 * be asked about its name, its twin or a disagreement.
 *
 * That is a real state rather than a convenience: `createItem` stamps no
 * provenance at all, so a garment Alex typed into the Add sheet with a comfort
 * score arrives exactly like this. Confirming any of the three is what retires
 * it — see `confirmedContexts` below, which is now the fixture for a garment
 * that has LEFT the queue.
 */
const ANSWERED = {
  comfort: 3,
  versatility: 3,
  dressinessContexts: ['casual'] as DressinessContext[],
}

/**
 * A thing with nothing to RATE at all, which is how the cleanup cards are
 * reached now.
 *
 * Comfort, versatility and dressiness are questions about WEARING something, so
 * `ratingAsks` returns nothing for gear and `tieGroups` skips it — which is what
 * these fixtures need and what `ANSWERED` alone cannot give them. Two identical
 * garments TIE, a tie is evidence that promotes a guessed context set into a
 * real question, and the card then leads with dressiness rather than with the
 * duplicate the test is about. Two identical pouches simply have a duplicate.
 *
 * It is also the honest fixture: doc 09 §7 says gear reaches this queue only
 * through its name, a duplicate or a disagreement, which is exactly what each of
 * these tests is asserting.
 */
function gear(id: string, partial: Partial<Item> = {}): Item {
  return garment(id, {
    kind: 'gear',
    category: 'Travel Gear',
    subcategory: null,
    ...partial,
  })
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
    const noComfort = garment('c', { versatility: 3, dressinessContexts: ['casual'] })
    const noVersatility = garment('v', { comfort: 3, dressinessContexts: ['casual'] })
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
      // P3b, and it is above `often_packed` on purpose: every other reason here
      // says an answer would probably help, and this one has already simulated
      // that it changes where something goes on a trip Alex is taking.
      'bag_question',
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

/**
 * Alex's ruling: **feedback retires the garment, not just the field.**
 *
 * The per-field rule was the right answer to the wrong question. A card asks for
 * everything a row is missing, so rating comfort on a garment with three empty
 * fields left it qualifying for the other two — it came back with a new reason
 * line, and could come back again for a tidier name and again for a possible
 * duplicate. Four appearances, each technically a different question.
 *
 * Nothing here is stored. `hasFeedback` reads the provenance H1a already keeps,
 * which is what makes every row below a value rather than a fixture with a
 * decision table beside it.
 */
describe('a garment Alex has given feedback on does not come back', () => {
  it('retires it on one confirmed comfort rating, with the other two still empty', () => {
    const rated = garment('rated', {
      comfort: 4,
      fieldProvenance: { comfort: { source: 'user_confirmed', at: NOW } },
    })
    expect(hasFeedback(rated)).toBe(true)
    expect(queue([rated]).cards).toHaveLength(0)

    // The same garment, one field's authority lower, is still a question.
    expect(queue([garment('rated', { comfort: 4 })]).cards).toHaveLength(1)
  })

  it('retires it on a confirmed dressiness answer alone', () => {
    expect(queue([garment('dressed', confirmedContexts(['dressy']))]).cards).toHaveLength(0)
  })

  it('retires it whatever else the card had to ask — a name, a twin', () => {
    /*
     * The case the per-field rule could never cover. This garment repeats its
     * own brand and colour in its name AND has a twin, so it held three separate
     * claims on the queue. One rating settles all of them.
     */
    const shape = { displayName: 'Black Columbia Fleece', brand: 'Columbia', color: 'Black' }
    expect(queue([garment('a', shape), garment('b', shape)]).cards).toHaveLength(2)

    const answered = { ...shape, comfort: 4, ...confirmedContexts(['casual']) }
    expect(queue([garment('a', answered), garment('b', shape)]).cards.map((c) => c.item.id))
      .toEqual(['b'])
  })

  it('does not treat a CLEARED rating as an answer', () => {
    /*
     * `comfort: null` and an empty context set are Alex withdrawing an answer,
     * which H1b and H1c both treat as first-class. Retiring the garment on the
     * strength of an answer he has just taken back would be the feature
     * swallowing its own question — and a stored `reviewed` row could not have
     * noticed, which is half of why this is derived.
     */
    const cleared = garment('cleared', {
      comfort: null,
      dressinessContexts: [],
      fieldProvenance: {
        comfort: { source: 'user_confirmed', at: NOW },
        dressinessContexts: { source: 'user_confirmed', at: NOW },
      },
    })
    expect(hasFeedback(cleared)).toBe(false)
    expect(queue([cleared]).cards).toHaveLength(1)
  })

  it('does not treat a guess as an answer', () => {
    /*
     * Migration 0022 gave every imported garment the one context its guessed
     * dressiness meant, at `inferred`. Counting that as feedback would retire
     * ~85 garments nobody has ever been asked about — the same null-scan failure
     * `contextsWorthAsking` exists to avoid, arriving through the other door.
     */
    const guessed = garment('guessed', {
      dressinessContexts: ['casual'],
      fieldProvenance: { dressinessContexts: { source: 'inferred', at: NOW } },
    })
    expect(hasFeedback(guessed)).toBe(false)
  })

  it('does not treat a confirmed NAME as feedback', () => {
    // Renaming a shirt says nothing about how comfortable it is, and Alex's ask
    // named the ratings and the dressiness value specifically.
    const renamed = garment('renamed', {
      displayName: 'Fleece',
      fieldProvenance: { displayName: { source: 'user_confirmed', at: NOW } },
    })
    expect(hasFeedback(renamed)).toBe(false)
    expect(queue([renamed]).cards).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */

describe('an importer guess is a boost, not a summons', () => {
  /*
   * Alex's ruling, and the rule the first version broke. Migration 0022 gave
   * every imported garment the one context its guessed integer meant, so
   * treating "guessed" as sufficient turned all ~85 of them into questions —
   * the null-scan this queue exists to avoid, arriving as *nobody has blessed
   * this field* rather than *this field is empty*.
   */
  const guessed = (id: string, extra: Partial<Item> = {}) =>
    garment(id, {
      comfort: 3,
      versatility: 3,
      dressinessContexts: ['casual'],
      fieldProvenance: { dressinessContexts: { source: 'inferred', at: NOW } },
      ...extra,
    })

  it('leaves a low-use garment alone when the guess is all that is wrong', () => {
    expect(queue([guessed('quiet')]).cards).toHaveLength(0)
  })

  it('asks once he actually packs it', () => {
    const { cards } = queue([guessed('packed')], { packedTrips: { packed: REPEATEDLY } })
    expect(cards[0]?.asks).toEqual(['contexts'])
    expect(cards[0]?.reason).toBe('often_packed')
  })

  it('asks once he keeps choosing it himself', () => {
    const { cards } = queue([guessed('picked')], { manualSwaps: { picked: REPEATEDLY } })
    expect(cards[0]?.asks).toEqual(['contexts'])
  })

  it('asks once he keeps taking it off the list', () => {
    const { cards } = queue([guessed('dropped')], { removals: { dropped: REPEATEDLY } })
    expect(cards[0]?.asks).toEqual(['contexts'])
  })

  it('asks when the ranker cannot separate it from its rivals', () => {
    // Two identical garments tie, which is evidence in itself.
    const { cards } = queue([guessed('a'), guessed('b')])
    expect(cards.map((c) => c.item.id)).toEqual(['a', 'b'])
    expect(cards[0]?.asks).toEqual(['contexts'])
  })

  /*
   * The ruling lists "conflicting imported/user-confirmed evidence" as a reason
   * to ask, and it cannot happen: a disagreement exists only where Alex
   * CONFIRMED a value over an imported one, and a confirmed set is not a guess.
   * Written as a condition it would have read as thorough and never been true.
   * The case is served better by the disagreement card, which shows both values
   * instead of asking the question again from scratch — asserted here so the
   * condition does not get "restored" by someone reading the ruling literally.
   */
  it('never asks the dressiness question again once it has been answered', () => {
    /*
     * A confirmed-over-a-guess set used to reach the queue as a DISAGREEMENT
     * card — the right answer to "do not ask the same question twice", and now
     * a weaker one than the rule above it. Confirming the contexts is feedback,
     * so the garment leaves the queue outright: no fresh question and no card
     * at all.
     *
     * The disagreement itself is not lost, only unasked. It is still on the row
     * for anything that wants it, which is what the assertion below says.
     */
    const argued = garment('argued', {
      comfort: 3,
      versatility: 3,
      dressinessContexts: ['smart_casual', 'dressy'],
      fieldProvenance: {
        dressinessContexts: {
          source: 'user_confirmed', at: NOW, was: ['smart_casual'], wasSource: 'inferred',
        },
      },
    })

    expect(queue([argued]).cards).toHaveLength(0)
    expect(findDisagreements(argued).map((d) => d.field)).toEqual(['dressinessContexts'])
  })

  /*
   * The one case that needs no trip evidence, and it is a boundary rather than
   * a habit: `fitsContexts` is set intersection, so a single guess at an END of
   * the scale makes the garment ineligible for four occasions out of five. A
   * wrong guess there costs Alex the garment entirely.
   */
  it('asks about a guess that rules the garment out of almost everything', () => {
    for (const context of ['loungewear', 'formal'] as const) {
      const { cards } = queue([guessed('edge', { dressinessContexts: [context] })])
      expect(cards[0]?.asks, context).toEqual(['contexts'])
    }
  })

  it('still asks when nothing at all is recorded', () => {
    const { cards } = queue([guessed('blank', { dressinessContexts: [] })])
    expect(cards[0]?.asks).toEqual(['contexts'])
    expect(cards[0]?.reason).toBe('no_contexts')
  })

  it('never asks about a set Alex confirmed, however much he packs it', () => {
    const confirmed = garment('mine', {
      comfort: 3,
      versatility: 3,
      ...confirmedContexts(['casual']),
    })
    expect(queue([confirmed], { packedTrips: { mine: 9 } }).cards).toHaveLength(0)
  })
})

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
      // Guessed rather than confirmed, and it has to be: confirming the
      // contexts is feedback, and feedback takes the garment out of the queue
      // before it can be asked about its name (`hasFeedback`).
      dressinessContexts: ['casual'] as DressinessContext[],
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
    const { cards } = queue([
      gear('a', { displayName: 'Packing Cube' }),
      gear('b', { displayName: 'Packing Cube', brand: 'Patagonia' }),
    ])

    const vague = cards.find((c) => c.item.id === 'a')
    expect(vague?.reason).toBe('missing_detail')
    expect(vague?.why).toBe('You own 2 things called “Packing Cube”, and nothing tells this one apart.')
    // The one with a brand is already distinguishable, so it is not asked.
    expect(cards.find((c) => c.item.id === 'b')?.reason).not.toBe('missing_detail')
  })
})

/* ------------------------------------------------------------------ */

describe('possible duplicates, deliberately quiet', () => {
  it('asks when the name, the brand and the colours all overlap', () => {
    const { cards } = queue([
      gear('a', { displayName: 'Packing Cube', brand: 'Uniqlo', color: 'Black' }),
      gear('b', { displayName: 'Packing Cube', brand: 'Uniqlo', color: 'Black & Gray' }),
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
      gear('a', { displayName: 'Shinola', brand: 'Shinola', color: 'Black' }),
      gear('b', { displayName: 'Shinola', brand: 'Shinola', color: 'White' }),
    ])
    expect(cards).toHaveLength(0)
  })

  it('carries what each has been packed on, so keeping one is informed', () => {
    const { cards } = queue(
      [
        gear('a', { displayName: 'Pouch', brand: 'Uniqlo' }),
        gear('b', { displayName: 'Pouch', brand: 'Uniqlo' }),
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
    /*
     * The disagreement is on the COLOUR, not on the contexts, and that is now
     * forced rather than incidental: a dressiness disagreement only exists
     * where Alex confirmed the contexts, and confirming them retires the
     * garment. Colour is not one of the three feedback fields, so a garment can
     * disagree about it and still be worth a card.
     */
    const { cards } = queue([
      garment('shirt', {
        ...ANSWERED,
        color: 'Navy',
        fieldProvenance: {
          color: { source: 'user_confirmed', at: NOW, was: 'Blue', wasSource: 'imported' },
        },
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
    const items = [
      gear('a', { displayName: 'Pouch', brand: 'Uniqlo' }),
      gear('b', { displayName: 'Pouch', brand: 'Uniqlo' }),
      gear('c', { displayName: 'Pouch', brand: 'Uniqlo' }),
    ]
    const decisions: DecisionRow[] = [
      { itemId: 'a', topic: duplicateTopic('b'), decision: 'answered' },
    ]

    const { cards } = queue(items, {}, decisions)
    // `a` no longer asks about `b`; `b` and `c` still have their own question.
    expect(cards.map((c) => c.item.id)).toEqual(['b', 'c'])
  })

  it('settles one disagreeing field without settling the rest of the garment', () => {
    // Two fields neither of which is feedback, so the garment stays askable —
    // see the colour note in `is the last thing asked about`.
    const shirt = garment('shirt', {
      ...ANSWERED,
      color: 'Navy',
      brand: 'Uniqlo',
      fieldProvenance: {
        color: { source: 'user_confirmed', at: NOW, was: 'Blue', wasSource: 'imported' },
        brand: { source: 'user_confirmed', at: NOW, was: 'Uniglo', wasSource: 'imported' },
      },
    })

    const decisions: DecisionRow[] = [
      { itemId: 'shirt', topic: disagreementTopic('color'), decision: 'answered' },
    ]
    const { cards } = queue([shirt], {}, decisions)
    expect(cards[0]?.disagreements.map((d) => d.field)).toEqual(['brand'])
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
