import { storedSpelling } from './items'

/**
 * One way of deciding whether typed text matches something on screen.
 *
 * ## The problem this replaces
 *
 * Every search in Pack Smart was `field.toLowerCase().includes(needle)`, and
 * substring matching fails on exactly the inputs a phone produces. `T-Shirt`
 * was invisible to `tshirt`; `Levi's` was invisible to `levis`; `jaket` and
 * `colombia` found nothing at all. None of those reads as a near miss from the
 * other side — the screen says *Nothing matches*, which is the app claiming Alex
 * does not own a garment he is holding.
 *
 * Autocorrect makes it worse rather than better: the fields are
 * `autoCapitalize="none"` and mostly `autoCorrect` off, precisely because a
 * corrected `Shell` is worse than a typed `shel` — so the typo reaches the
 * filter intact and the filter has to cope.
 *
 * ## The rule, stated once
 *
 * **Fold the difference away where it is punctuation or accent. Forgive wrong
 * characters only when forgiving nothing would have shown an empty screen.**
 * Nothing here scores, ranks or learns; the same query returns the same rows in
 * the same order every time, which is what `CLAUDE.md` means by deterministic
 * and explainable.
 *
 * The second half of that rule is the one that took measuring — see
 * `searchPredicate`. A search that forgives a typo on every row does not find
 * more of what Alex meant; it finds shirts when he typed `shorts`.
 *
 * Three tiers, narrowest first, and the narrowest one that finds ANYTHING is
 * the one Alex gets — see `searchPredicate`:
 *
 * | tier | what it forgives | example |
 * |---|---|---|
 * | the whole query as one phrase | punctuation, apostrophes, accents, spelling | `tshirt` and `t-shirt` both find `T-Shirt`; `levis` finds `Levi's` |
 * | every word, anywhere in the row | which column each word lives in | `black jacket` finds a `Jacket` whose colour is `Black` |
 * | every word, a typo allowed | a thumb landing next to the right key | `jaket`, `sweter`, `runing shoes` |
 *
 * The first tier is a strict superset of the substring rule this replaces, so
 * nothing that used to be found can stop being found — and because the tiers
 * are nested and evaluated in order, nothing that used to be found gains
 * company either.
 *
 * ## Why every word has to match, and any field may match it
 *
 * A query is split into words, and each word must find a home somewhere in the
 * row — but not all in the SAME field. That is what makes `blue jacket` work at
 * all: `blue` is in the colour column and `jacket` is in the subcategory, and
 * after G6 the name carries neither. Under the old substring rule that query
 * matched nothing, so the natural way to describe a garment was the one way of
 * searching that could not work.
 *
 * Requiring every word (rather than any) is what keeps typing MORE from finding
 * MORE, which is the one behaviour a filter may never have.
 */

/* ------------------------------------------------------------------ */
/* folding                                                             */
/* ------------------------------------------------------------------ */

/** Everything that is neither a letter nor a digit, in any script. */
const SEPARATORS = /[^\p{L}\p{N}]+/gu

/**
 * Apostrophes, in the four shapes a phone actually produces.
 *
 * Removed rather than turned into a space, which is the whole difference
 * between `levis` finding `Levi's` and not: spacing it would give the words
 * `levi` and `s`, and `levis` is neither of them. Every other separator becomes
 * a space, because `Zip-Up` genuinely is two words and `zip up` should find it.
 */
const APOSTROPHES = /['‘’ʼ`´]/g

/** Combining marks left behind by NFD, so `Hermès` folds to `hermes`. */
const MARKS = /[\u0300-\u036f]/g

/**
 * Text reduced to what a search should compare.
 *
 * Applied identically to the query and to the fields, which is the only reason
 * any of this is symmetrical. A rule applied to one side only is how a search
 * comes to find things it cannot find again.
 *
 * `storedSpelling` is in here rather than left to the typo pass on purpose. The
 * colour column really does hold both spellings — `greySpelling` maps them on
 * the way to the screen and the column is deliberately never canonicalised on
 * write — so `grey` and `gray` finding each other is a guarantee this product
 * owes, not a near miss it can afford to leave to an edit-distance budget that
 * a shorter word would not get.
 */
export function foldForSearch(value: string): string {
  return storedSpelling(value)
    .normalize('NFD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(SEPARATORS, ' ')
    .trim()
}

/** The folded text with its spaces taken out, for the substring pass. */
function squash(folded: string): string {
  return folded.replace(/ /g, '')
}

/* ------------------------------------------------------------------ */
/* how wrong a word may be                                             */
/* ------------------------------------------------------------------ */

/**
 * How many wrong characters a word of this length may have.
 *
 * Length-scaled because a fixed budget is wrong at both ends. One edit on a
 * three-letter word is a different word — `tee` would find `the`, `sea` and
 * `top` — while one edit on `windbreaker` is a thumb landing next to the right
 * key. So short words are matched exactly and only longer ones are forgiven,
 * which also means the noisy case is the cheap case: most queries are short and
 * never reach the distance calculation at all.
 */
export function typoBudget(word: string): number {
  if (word.length <= 3) return 0
  if (word.length <= 7) return 1
  return 2
}

/**
 * Whether two words are within `max` edits of each other.
 *
 * Damerau–Levenshtein in its restricted form, so a TRANSPOSITION costs one
 * rather than two. That is not a refinement — swapped adjacent letters are the
 * single most common typo a thumb produces, and under plain Levenshtein `jakcet`
 * is two edits from `jacket` and therefore just outside a six-letter word's
 * budget. The commonest mistake would have been the one this did not forgive.
 *
 * Two early exits keep it cheap: a length difference greater than the budget is
 * decided before any work, and a row whose best cell already exceeds the budget
 * can only get worse.
 */
export function withinEdits(a: string, b: string, max: number): boolean {
  if (a === b) return true
  if (max <= 0) return false
  if (Math.abs(a.length - b.length) > max) return false

  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return Math.max(n, m) <= max

  let beforePrevious: number[] = []
  let previous = new Array<number>(m + 1)
  for (let j = 0; j <= m; j += 1) previous[j] = j

  for (let i = 1; i <= n; i += 1) {
    const current = new Array<number>(m + 1)
    current[0] = i
    let best = i

    for (let j = 1; j <= m; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost)

      // The transposition. `i > 1 && j > 1` is what makes `beforePrevious` safe
      // to read — it is a real row by the time this can fire.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, beforePrevious[j - 2]! + 1)
      }

      current[j] = value
      if (value < best) best = value
    }

    if (best > max) return false
    beforePrevious = previous
    previous = current
  }

  return previous[m]! <= max
}

/* ------------------------------------------------------------------ */
/* the matcher — three tiers, each a superset of the one before        */
/* ------------------------------------------------------------------ */

export interface SearchMatcher {
  /** False when nothing was typed — the caller should show everything. */
  readonly active: boolean
  /**
   * The whole query, as one run of characters, inside one field.
   *
   * The tightest tier and the one that answers most searches. It is a strict
   * superset of the substring rule this replaced — punctuation, accents and the
   * grey spelling are folded on BOTH sides, so anything the old
   * `toLowerCase().includes()` found, this finds — and it is what keeps typing
   * the hyphen in `T-Shirt` from being looser than leaving it out.
   */
  matchesPhrase(...fields: Array<string | null | undefined>): boolean
  /**
   * Every typed word somewhere in the row, each spelled correctly.
   *
   * Words may land in DIFFERENT fields, which is the whole point: after G6 the
   * name carries neither the brand nor the colour, so `black jacket` has to
   * reach the colour column and the subcategory at once or the natural way to
   * describe a garment is the one that cannot work.
   */
  matchesExactly(...fields: Array<string | null | undefined>): boolean
  /** The same, with a small typo budget per word. */
  matchesLoosely(...fields: Array<string | null | undefined>): boolean
}

/** A matcher that lets everything through. */
const MATCH_ALL: SearchMatcher = {
  active: false,
  matchesPhrase: () => true,
  matchesExactly: () => true,
  matchesLoosely: () => true,
}

type Tier = 'phrase' | 'exact' | 'loose'

/**
 * A reusable matcher for one query.
 *
 * Built once per query rather than once per row, because the folding and the
 * splitting are the same work every time and a wardrobe search would otherwise
 * redo them a hundred and nineteen times for no answer that could differ.
 *
 * Most callers want `searchPredicate` instead — the tiers only mean anything
 * when something decides between them.
 */
export function searchMatcher(query: string): SearchMatcher {
  const folded = foldForSearch(query)
  const words = folded.split(' ').filter(Boolean)
  if (words.length === 0) return MATCH_ALL

  const phrase = squash(folded)
  const terms = words.map((word) => ({ word, budget: typoBudget(word) }))

  const test = (fields: Array<string | null | undefined>, tier: Tier): boolean => {
    /*
     * Each field folded ONCE, then asked about every term.
     *
     * The obvious loop — for each term, for each field, fold — refolds the same
     * colour column once per typed word, which on a three-word query is three
     * times the string work for one row.
     */
    const haystack: FoldedField[] = []
    for (const field of fields) {
      if (!field) continue
      const value = foldForSearch(field)
      if (!value) continue
      haystack.push({ squashed: squash(value), words: value.split(' ') })
    }
    if (haystack.length === 0) return false

    if (tier === 'phrase') return haystack.some((field) => field.squashed.includes(phrase))

    for (const term of terms) {
      let found = false
      for (const field of haystack) {
        if (matchesField(term, field, tier === 'loose')) {
          found = true
          break
        }
      }
      if (!found) return false
    }
    return true
  }

  return {
    active: true,
    matchesPhrase: (...fields) => test(fields, 'phrase'),
    matchesExactly: (...fields) => test(fields, 'exact'),
    matchesLoosely: (...fields) => test(fields, 'loose'),
  }
}

interface FoldedField {
  squashed: string
  words: string[]
}

function matchesField(
  term: { word: string; budget: number },
  field: FoldedField,
  forgiving: boolean,
): boolean {
  if (field.squashed.includes(term.word)) return true
  if (!forgiving || term.budget === 0) return false

  /*
   * The whole field before its words, because a short field IS its content:
   * `chartruese` should find a colour column reading `Chartreuse` whether that
   * column holds one word or two. On a long field the length check throws this
   * out immediately, so it costs nothing where it cannot help.
   */
  if (withinEdits(term.word, field.squashed, term.budget)) return true

  for (const word of field.words) {
    if (withinEdits(term.word, word, term.budget)) return true
  }
  return false
}

/* ------------------------------------------------------------------ */
/* choosing a tier, once, for a whole list                             */
/* ------------------------------------------------------------------ */

/**
 * The filter every search in Pack Smart should use.
 *
 * **The narrowest tier that finds anything is the one Alex gets.** Each tier
 * contains the one before it, so this is a widening that stops as soon as it has
 * something to show — never a union, and never a per-row decision.
 *
 * That rule is not a refinement of the first design; it is what measuring the
 * first design against the real workbook forced. Two failures, both real:
 *
 *   * Forgiving one edit on every row turned `shorts` into a query that
 *     returned shirts — `shorts`/`shirts` and `shorts`/`sports` are each one
 *     edit apart, so seven right answers arrived buried among twelve, and Alex
 *     owns both kinds of garment.
 *   * Matching word-by-word first made `t-shirt` LOOSER than `tshirt`: split on
 *     the hyphen, `t` matches almost everything and the query collapses to
 *     `shirt`, so 13 t-shirts became 22 shirts. Typing the punctuation
 *     correctly cannot be the thing that costs precision.
 *
 * The widening costs nothing where it is not needed, because it only runs once
 * the tighter tier has come back empty ACROSS THE WHOLE LIST. `jaket`, `sweter`,
 * `hodie`, `colombia`, `runing shoes` and `blue jacket` each found nothing at
 * all before; each now finds exactly what it obviously meant. Every query that
 * used to work returns what it used to return.
 *
 * Callers with more than one list to filter (the swap sheet has two: what is in
 * the slot, and what `All items` would add) must pass the union as the
 * population, or the two halves of one screen answer at different tiers.
 */
export function searchPredicate<T>(
  query: string,
  population: readonly T[],
  fieldsOf: (row: T) => Array<string | null | undefined>,
): (row: T) => boolean {
  const matcher = searchMatcher(query)
  if (!matcher.active) return () => true

  const tiers = [
    (row: T) => matcher.matchesPhrase(...fieldsOf(row)),
    (row: T) => matcher.matchesExactly(...fieldsOf(row)),
    (row: T) => matcher.matchesLoosely(...fieldsOf(row)),
  ]

  for (const tier of tiers) {
    if (population.some(tier)) return tier
  }

  // Nothing matched at any tier. The last one is as good as any for saying so,
  // and returning it rather than `() => false` keeps one answer for one query
  // however the caller reuses the predicate.
  return tiers[tiers.length - 1]!
}

/**
 * One row, one query, typos forgiven — the tierless form.
 *
 * For a caller with no population to compare against. Prefer `searchPredicate`
 * anywhere there is a list, which is everywhere in the product.
 */
export function matchesSearch(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  return searchMatcher(query).matchesLoosely(...fields)
}
