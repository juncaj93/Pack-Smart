/**
 * Wardrobe colours, as something the eye can read.
 *
 * ## What this is for
 *
 * Pack Smart has no garment photos and is not getting any. What it does have is
 * a colour word on nearly every item — and a word is something you decode
 * rather than see. `Navy · Grey · White · Dark Green` is four things to read
 * before the palette arrives; four dots is the palette.
 *
 * ## What it is NOT
 *
 * Not a colour model, not colour science, and not a taxonomy project. There is
 * no hue arithmetic here, no distance metric and no score. The wardrobe holds
 * thirty-one distinct colour strings and eleven of them are not colours at all
 * — `Custom Printed`, `Various Colors`, `Suede`, `Brooklyn Design`. A lookup
 * that handles the words Alex actually wrote and says nothing about the rest is
 * the whole of what the data supports.
 *
 * **Presentation only.** Nothing here is stored, and no stored string is
 * rewritten to make a swatch render. The colour column keeps whatever the
 * import wrote; this reads it.
 */

/**
 * The families a colour word can belong to.
 *
 * Coarse on purpose. `Navy`, `Dark Blue` and `Standard Blue` are three swatches
 * and one family, and the family is the level at which anything can be said
 * about whether two garments go together.
 */
export type ColorFamily =
  | 'black'
  | 'white'
  | 'cream'
  | 'grey'
  | 'brown'
  | 'tan'
  | 'blue'
  | 'green'
  | 'red'
  | 'yellow'
  | 'purple'
  | 'pink'
  | 'orange'

export interface Swatch {
  /** The word that matched, as Alex spells it. */
  label: string
  family: ColorFamily
  /** The fill, in both themes. A garment's colour is not a theme decision. */
  hex: string
  /**
   * Whether the fill is close enough to a light page to vanish into it.
   *
   * Drives a stronger ring rather than a darkened fill: darkening `White` until
   * it is visible would be the swatch misrepresenting the garment, which is the
   * one thing it may not do.
   */
  pale: boolean
}

/*
 * The words, longest first.
 *
 * Order matters and is the only subtle thing in this file: `dark green` has to
 * be tried before `green` or every dark green garment renders mid-green, and
 * `light blue` before `blue`. Sorting by length at module load rather than by
 * hand means a word added carelessly in the middle still matches correctly.
 *
 * Both spellings of grey are present because the column holds `Gray` and the
 * screen says `Grey` — see `greySpelling` in `items.ts`.
 */
const WORDS: Array<{ word: string; family: ColorFamily; hex: string; pale?: boolean }> = [
  // Neutrals
  { word: 'black', family: 'black', hex: '#1c1c1e' },
  { word: 'charcoal', family: 'grey', hex: '#3a3a3e' },
  { word: 'heather gray', family: 'grey', hex: '#a8a8ad' },
  { word: 'heather grey', family: 'grey', hex: '#a8a8ad' },
  { word: 'gray heather', family: 'grey', hex: '#a8a8ad' },
  { word: 'grey heather', family: 'grey', hex: '#a8a8ad' },
  { word: 'light gray', family: 'grey', hex: '#c9c9ce' },
  { word: 'light grey', family: 'grey', hex: '#c9c9ce' },
  { word: 'dark gray', family: 'grey', hex: '#5a5a60' },
  { word: 'dark grey', family: 'grey', hex: '#5a5a60' },
  { word: 'gray', family: 'grey', hex: '#8e8e93' },
  { word: 'grey', family: 'grey', hex: '#8e8e93' },
  { word: 'silver', family: 'grey', hex: '#bfc0c4' },
  { word: 'heather white', family: 'white', hex: '#f2f2f0', pale: true },
  { word: 'off-white', family: 'cream', hex: '#f0ece3', pale: true },
  { word: 'off white', family: 'cream', hex: '#f0ece3', pale: true },
  { word: 'white', family: 'white', hex: '#fbfbfd', pale: true },
  { word: 'ivory', family: 'cream', hex: '#f4efe2', pale: true },
  { word: 'cream', family: 'cream', hex: '#efe7d6', pale: true },
  { word: 'bone', family: 'cream', hex: '#e8dfcd', pale: true },
  { word: 'ecru', family: 'cream', hex: '#e5dbc5', pale: true },
  { word: 'oatmeal', family: 'cream', hex: '#e3d9c6', pale: true },

  // Browns and tans
  { word: 'khaki', family: 'tan', hex: '#b9a77e' },
  { word: 'camel', family: 'tan', hex: '#bd9a68' },
  { word: 'beige', family: 'tan', hex: '#cbbb9c' },
  { word: 'sand', family: 'tan', hex: '#cfbf9d' },
  { word: 'tan', family: 'tan', hex: '#c2a173' },
  { word: 'chocolate', family: 'brown', hex: '#4a352a' },
  { word: 'brown', family: 'brown', hex: '#6b4f3a' },

  // Blues
  { word: 'light blue', family: 'blue', hex: '#7fb4dd' },
  { word: 'sky blue', family: 'blue', hex: '#8cc0e4' },
  { word: 'dark blue', family: 'blue', hex: '#1f3557' },
  { word: 'standard blue', family: 'blue', hex: '#3b6ea8' },
  { word: 'royal blue', family: 'blue', hex: '#2b52a8' },
  { word: 'navy', family: 'blue', hex: '#1b2b4b' },
  { word: 'indigo', family: 'blue', hex: '#2d3b63' },
  { word: 'denim', family: 'blue', hex: '#4a6b90' },
  { word: 'teal', family: 'blue', hex: '#2c6e70' },
  { word: 'turquoise', family: 'blue', hex: '#3fb0ae' },
  { word: 'blue', family: 'blue', hex: '#3b6ea8' },

  // Greens
  { word: 'dark green', family: 'green', hex: '#2f5d47' },
  { word: 'forest green', family: 'green', hex: '#2c5240' },
  { word: 'olive', family: 'green', hex: '#6b6b3a' },
  { word: 'sage', family: 'green', hex: '#9fae95' },
  { word: 'mint', family: 'green', hex: '#a9d5bd' },
  { word: 'green', family: 'green', hex: '#3d7a55' },

  // The rest, thin on purpose — see the note on taxonomy above.
  { word: 'burgundy', family: 'red', hex: '#5e2230' },
  { word: 'maroon', family: 'red', hex: '#5f2733' },
  { word: 'red', family: 'red', hex: '#b3352f' },
  { word: 'orange', family: 'orange', hex: '#c86a2c' },
  { word: 'rust', family: 'orange', hex: '#a55a34' },
  { word: 'mustard', family: 'yellow', hex: '#c9a13b' },
  { word: 'yellow', family: 'yellow', hex: '#d9b93c' },
  { word: 'purple', family: 'purple', hex: '#5b3f7a' },
  { word: 'lavender', family: 'purple', hex: '#9d8fc0' },
  { word: 'pink', family: 'pink', hex: '#d18ba0' },
]

const BY_LENGTH = [...WORDS].sort((a, b) => b.word.length - a.word.length)

/**
 * Capitalised the way the screen already spells it.
 *
 * Reads the ORIGINAL string rather than the matched word, so `Dark Green`
 * stays `Dark Green` and a lowercase `navy` in the column comes out `Navy`.
 */
function labelFor(source: string, word: string): string {
  const at = source.toLowerCase().indexOf(word)
  const exact = at >= 0 ? source.slice(at, at + word.length) : word
  // Already capitalised by whoever wrote it, or capitalise it ourselves.
  return /[A-Z]/.test(exact)
    ? exact
    : exact.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

/**
 * The swatches a colour string is worth, at most two.
 *
 * ## Why word matching rather than a lookup table
 *
 * The column is free text written by whoever filled in the spreadsheet:
 * `Gray, Navy, Short Gray`, `Navy w`, `Heather Gray`. An exact-match table
 * would render nothing for any of those, and a table big enough to hold every
 * phrasing is the taxonomy project §23 rules out. Matching the colour WORDS
 * inside the string handles all three and degrades to silence on the strings
 * that are not colours at all.
 *
 * Word-anchored, so `Brooklyn Design` matches nothing (`design` is not a colour
 * and `bro` is not a word boundary) and a brand like `Gray Malin` would still
 * find its grey — correctly, since it is in a colour column.
 *
 * ## Why at most two
 *
 * Doc §6: two swatches say "this garment is two colours", which is the whole
 * fact. A row of five is a palette strip, and the row it sits on is 49px.
 *
 * Returns EMPTY for anything unrecognised, which is most of the odd strings in
 * the wardrobe. Unknown is allowed — a row simply has no dot, and no
 * placeholder implies knowledge nobody has.
 */
export function swatchesFor(color: string | null | undefined): Swatch[] {
  if (!color) return []

  const haystack = color.toLowerCase()
  const found: Swatch[] = []
  /*
   * Positions already consumed, so `dark green` cannot also match `green` and
   * produce two swatches for one word. Tracked as a character range rather than
   * by deleting from the string, because deleting would join the characters on
   * either side and could invent a word that was never written.
   */
  const taken: Array<[number, number]> = []

  for (const entry of BY_LENGTH) {
    if (found.length >= 2) break

    const pattern = new RegExp(`\\b${entry.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(haystack)) !== null) {
      const start = match.index
      const end = start + entry.word.length
      if (taken.some(([from, to]) => start < to && end > from)) continue

      // One swatch per family: `Gray, Navy, Short Gray` is two colours, not three.
      if (found.some((swatch) => swatch.family === entry.family)) {
        taken.push([start, end])
        continue
      }

      taken.push([start, end])
      found.push({
        label: labelFor(color, entry.word),
        family: entry.family,
        hex: entry.hex,
        pale: entry.pale ?? false,
      })
      break
    }
  }

  return found
}

/** The families a garment contributes, for the compatibility signal below. */
export function familiesOf(color: string | null | undefined): ColorFamily[] {
  return swatchesFor(color).map((swatch) => swatch.family)
}

/**
 * The families that go with anything.
 *
 * Not a fashion claim — an observation about what a neutral IS. These are the
 * colours a wardrobe uses as ground rather than as figure, and the reason a
 * grey trouser is in every third outfit.
 *
 * Navy is in the list and blue is not. Navy behaves as a neutral in menswear
 * and `Standard Blue` does not, but the family model is coarser than that
 * distinction — so the test is on the WORD for this one case, which is the only
 * place in this file that looks below the family.
 */
const NEUTRAL_FAMILIES: ReadonlySet<ColorFamily> = new Set<ColorFamily>([
  'black',
  'white',
  'cream',
  'grey',
  'tan',
  'brown',
])

const NEUTRAL_WORDS: ReadonlySet<string> = new Set(['navy', 'denim', 'indigo'])

export function isNeutral(swatch: Swatch): boolean {
  return NEUTRAL_FAMILIES.has(swatch.family) || NEUTRAL_WORDS.has(swatch.label.toLowerCase())
}

/**
 * How well a candidate's colour sits with the colours already in the outfit.
 *
 * Returns `null` — not zero — when nothing can be said: the candidate has no
 * recognised colour, or the outfit has none. `rank` skips a criterion where
 * either side is null (H1b), so an unrecorded colour cannot cost a garment its
 * place. That is the same rule comfort follows and for the same reason:
 * punishing missing data is not a judgement, it is an absence.
 *
 * The scale is deliberately tiny — `-1`, `0`, `1`. This is the last criterion
 * in the list, it breaks ties between garments that are already equal on
 * everything Alex has actually told the app, and a wider range would only
 * create the illusion of precision that §17 rules out.
 */
export function colorFit(
  candidate: string | null | undefined,
  outfit: Array<string | null | undefined>,
): number | null {
  const mine = swatchesFor(candidate)
  if (mine.length === 0) return null

  const theirs = outfit.flatMap((color) => swatchesFor(color))
  if (theirs.length === 0) return null

  const families = new Set(theirs.map((swatch) => swatch.family))

  /*
   * Every other piece is already this colour, and only this colour.
   *
   * Checked FIRST, so it applies to neutrals too: head-to-toe grey is the same
   * observation as head-to-toe green. Not wrong, and not something to
   * recommend on a colour heuristic — if Alex wants it he has the pairing
   * history to say so, and that criterion sits above this one.
   */
  if (families.size === 1 && mine.every((swatch) => families.has(swatch.family))) return -1

  // A neutral goes with what is already there, whatever that is.
  if (mine.some(isNeutral)) return 1

  // A colour already somewhere in the outfit ties the two pieces together.
  if (mine.some((swatch) => families.has(swatch.family))) return 1

  /*
   * Everything else is 0 — no opinion — and that is the honest answer rather
   * than a placeholder.
   *
   * An earlier version returned 1 for any colour against a neutral-anchored
   * outfit, reading §16's "an outfit containing strong neutrals should allow
   * more candidate colours" as a reward. It is a permission: grey trousers and
   * white shoes do not make a turquoise shirt GOOD, they make it unobjectionable
   * — and scoring it 1 alongside a navy shirt meant the criterion could not
   * separate them in the single commonest case on this screen.
   *
   * The permission is expressed by the absence of a negative. Nothing here
   * scores below 0 except an outfit collapsing into one colour, so a candidate
   * that simply does not tie in is never pushed down for it.
   */
  return 0
}
