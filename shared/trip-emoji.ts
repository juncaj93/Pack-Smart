/**
 * The one emoji a trip is recognised by (product doc 02 §9a).
 *
 * Deterministic and ordered, so the same trip always gets the same icon. The
 * order is the specificity order in doc 03 §2: a specific activity beats a
 * destination signal, and a destination signal beats the neutral fallback.
 *
 * "Most specific wins" is the whole rule. A safari trip involves a flight, but
 * every trip involves a flight and only some involve lions — so ✈️ is what you
 * get when nothing better is true, never a competitor to something that is.
 */

export const FALLBACK_EMOJI = '✈️'

/**
 * Activity tag to emoji, in priority order.
 *
 * An array rather than a record because the ORDER is the tie-break. Two
 * activities on one trip resolve to whichever appears first here, so the answer
 * does not depend on the order Alex happened to tap the chips.
 */
const ACTIVITY_EMOJI: Array<{ tag: string; emoji: string }> = [
  { tag: 'wedding', emoji: '💍' },
  { tag: 'safari', emoji: '🦁' },
  { tag: 'beach', emoji: '🏖️' },
  { tag: 'swimming', emoji: '🏖️' },
  { tag: 'hiking', emoji: '🥾' },
  { tag: 'winery', emoji: '🍷' },
  { tag: 'business', emoji: '💼' },
  { tag: 'road_trip', emoji: '🚗' },
  { tag: 'gym', emoji: '🏋️' },
  { tag: 'nice_dinner', emoji: '🍽️' },
  { tag: 'sightseeing', emoji: '🏙️' },
]

/**
 * Destination words strong enough to name a trip on their own.
 *
 * Deliberately short. These fire only when no activity matched, and a weak
 * guess here is worse than the neutral fallback — a wrong-but-specific icon is
 * a claim about the trip, while ✈️ claims nothing.
 *
 * Word-boundary matched, so "Alps" does not fire on "Palps" and "ski" does not
 * fire on "Helsinki".
 */
const DESTINATION_EMOJI: Array<{ pattern: RegExp; emoji: string }> = [
  { pattern: /\b(ski|skiing|snowboard|alps|aspen|whistler|zermatt|chamonix)\b/i, emoji: '⛷️' },
  { pattern: /\b(cruise|cruising)\b/i, emoji: '🚢' },
  { pattern: /\b(camp|camping|campground|yosemite|yellowstone)\b/i, emoji: '🏕️' },
  { pattern: /\b(safari|serengeti|kruger|maasai\s*mara|okavango)\b/i, emoji: '🦁' },
  { pattern: /\b(beach|maldives|maui|cancun|bali|hawaii|ibiza|seychelles)\b/i, emoji: '🏖️' },
  { pattern: /\b(vineyard|napa|bordeaux|tuscany)\b/i, emoji: '🍷' },
]

export interface EmojiSignals {
  destination?: string | null
  activities?: string[]
  /** The trip name, which often carries the only real signal ("Ski trip"). */
  name?: string | null
  /**
   * Icons already in use by other trips.
   *
   * The emoji exists so a trip is recognisable in a list, and two trips wearing
   * the same one defeats that — which is not hypothetical: a weekend with nice
   * dinners and a city break with sightseeing AND nice dinners both resolved to
   * 🍽️ (UX-12). When the first choice is taken, the next TRUE signal is used
   * instead. A duplicate is still returned rather than a wrong icon if every
   * matching signal is taken: sharing 🍽️ is a smaller lie than claiming a lion.
   */
  taken?: string[]
}

/**
 * Suggests the emoji for a trip. Never returns empty.
 *
 * A suggestion only — it is written once when the trip is created and is not
 * recalculated afterwards, because an icon Alex recognises a trip by must not
 * move when he edits the dates.
 */
export function suggestTripEmoji(signals: EmojiSignals): string {
  const activities = new Set(signals.activities ?? [])
  const taken = new Set(signals.taken ?? [])
  const text = `${signals.destination ?? ''} ${signals.name ?? ''}`

  /* Every icon this trip could honestly wear, most specific first. */
  const candidates = [
    ...ACTIVITY_EMOJI.filter((entry) => activities.has(entry.tag)).map((entry) => entry.emoji),
    ...DESTINATION_EMOJI.filter((entry) => entry.pattern.test(text)).map((entry) => entry.emoji),
  ]

  const free = candidates.find((emoji) => !taken.has(emoji))
  if (free) return free

  // Nothing free: the most specific true signal, duplicate and all. The fallback
  // is not a candidate here — ✈️ claims nothing, but it also says nothing, and a
  // shared 🍷 on two wine trips is more use in a list than two aeroplanes.
  return candidates[0] ?? FALLBACK_EMOJI
}

/**
 * The choices offered when Alex wants a different one.
 *
 * A short curated list rather than a full emoji keyboard: the point is a
 * recognisable icon in a list of trips, and a picker with two thousand options
 * is a decision he did not ask to make. The suggestion is always included, so
 * the currently chosen icon is never missing from its own picker.
 */
export const EMOJI_CHOICES = [
  '✈️', '🦁', '🏖️', '⛷️', '🏙️', '🏕️', '🚢', '💍',
  '🥾', '🍷', '💼', '🚗', '🏋️', '🍽️', '🎿', '🏝️',
  '🗻', '🎡', '🎄', '🎉',
] as const

/** True for exactly one emoji — not a sentence, not a letter, not five glyphs. */
export function isValidTripEmoji(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 8) return false

  /*
   * Counted by grapheme, not by code unit.
   *
   * "🏖️" is three code units — a base emoji, a variation selector, and a
   * surrogate pair — so a length check in characters rejects most of the list
   * above. Intl.Segmenter counts what a person would call one symbol.
   */
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const graphemes = [...segmenter.segment(trimmed)]
  if (graphemes.length !== 1) return false

  // Rejects letters, digits and punctuation. An "A" is one grapheme too.
  return /\p{Extended_Pictographic}/u.test(trimmed)
}
