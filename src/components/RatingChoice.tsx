import { RATING_VALUES } from '@shared/items'
import './RatingChoice.css'

/**
 * A 1–5 rating Alex can give, skip, or take back (H1b).
 *
 * Used for comfort and versatility, which are the same shape and the same
 * question — *how much of this does this garment have* — so they are one
 * control rather than two that drift apart.
 *
 * **A radio group, not five buttons that happen to be exclusive.** `AppearanceChoice`
 * settled that argument for this codebase and the reasoning carries: exactly one
 * value is chosen at a time, that is a fact about the data rather than a
 * convention the screen keeps, and the semantics are what tell VoiceOver that
 * picking one un-picks the others. They are free.
 *
 * **Stars are the label, never the meaning.** `1` and `5` are not
 * self-explanatory and a row of glyphs is worse — "3, button" tells Alex
 * nothing about what he just agreed to. So every option carries its sentence in
 * `aria-label`, the chosen one prints that sentence underneath in plain sight,
 * and the star glyphs are `aria-hidden`. That also keeps them decorative for
 * contrast purposes, which is the one thing `--color-text-tertiary` is still
 * allowed to be (doc 09 §7, A11-1).
 *
 * **Not rated is a state, not a zero.** There is no sixth chip for it: the
 * absence of a selection IS the state, `Clear rating` is how Alex gets back to
 * it, and the note says so out loud rather than leaving an unlit row of stars to
 * be read as "one star, badly".
 */
export interface RatingChoiceProps {
  /** What is being rated, e.g. `Comfort`. Also the group's accessible name. */
  label: string
  /** 1–5, or null for not rated. */
  value: number | null
  /** Index 0 unused, so `labels[value]` is the meaning of `value`. */
  labels: readonly string[]
  onChange: (value: number | null) => void
  /** Distinct per instance, because two of these sit on one sheet. */
  id: string
  /** One line under the control, when the field needs it. */
  hint?: string
  /**
   * The review queue's layout: the name and the five stars share a row, and
   * everything below collapses to one line.
   *
   * Same control, same semantics, same accessible names — this changes where
   * things sit, never what they say. The item editor keeps the stacked version,
   * where a rating is one field among many inside a form and lining it up with
   * `.field` above it is what makes the sheet read as a form at all.
   *
   * Measured: an ordinary three-question review card was about 2,700px tall at
   * 390 wide — four screens on the 664px viewport Safari actually gives — and
   * two of these were most of it. Alex's ruling is that one garment stays one
   * card, so the height had to come out of the controls rather than out of the
   * questions.
   */
  compact?: boolean
}

export function RatingChoice({
  label,
  value,
  labels,
  onChange,
  id,
  hint,
  compact = false,
}: RatingChoiceProps) {
  const chosen = value !== null ? labels[value] : null

  return (
    <div className={`rating-choice ${compact ? 'is-compact' : ''}`}>
      <span className="rating-label" id={`${id}-label`}>
        {label}
      </span>

      <div className="rating-stars" role="radiogroup" aria-labelledby={`${id}-label`}>
        {RATING_VALUES.map((rating) => {
          const on = value !== null && rating <= value
          return (
            <button
              key={rating}
              type="button"
              role="radio"
              aria-checked={value === rating}
              /*
               * The number AND what it means, because the number alone is not a
               * rating anybody can calibrate. This is the whole accessibility
               * argument for the component.
               */
              aria-label={`${rating} of 5 — ${labels[rating]}`}
              className={`rating-star ${on ? 'is-on' : ''}`}
              onClick={() => onChange(rating)}
            >
              <span aria-hidden="true">{on ? '★' : '☆'}</span>
            </button>
          )
        })}
      </div>

      {/*
        * What the chosen value means, in Alex's own words, in plain sight.
        *
        * `aria-live` so changing the rating is announced without moving focus —
        * he is tapping stars, and the meaning changing under his thumb is the
        * feedback. When nothing is rated it says so, rather than leaving five
        * empty stars to be interpreted.
        */}
      <p className="rating-meaning" aria-live="polite">
        {chosen ?? 'Not rated'}
      </p>

      {/*
        * The hint, and in compact mode only while it is still true.
        *
        * "Left alone, Pack Smart works this out from what you use it for" is
        * advice about NOT answering. Once Alex has answered it is two lines
        * describing a road not taken, on the screen with the least room for
        * them.
        */}
      {hint && (!compact || value === null) ? <p className="rating-hint">{hint}</p> : null}

      {/*
        * Only offered when there is something to clear. A disabled control that
        * is always there is one more thing to read past on a phone, and *Not
        * sure* is already what leaving it alone means.
        */}
      {value !== null ? (
        <button type="button" className="rating-clear" onClick={() => onChange(null)}>
          Clear rating
        </button>
      ) : null}
    </div>
  )
}
