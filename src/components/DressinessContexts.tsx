import {
  DRESSINESS_CONTEXTS,
  DRESSINESS_CONTEXT_HINTS,
  DRESSINESS_CONTEXT_LABELS,
  type DressinessContext,
} from '@shared/dressiness'
import './DressinessContexts.css'

/**
 * Where a garment works — any combination of the five contexts (H1c).
 *
 * **Checkboxes, and the choice of control is the product decision.** A radio
 * group, a `<select>`, a segmented control and a star rating were all ruled out
 * by Alex's brief, and each for the same reason: they say *pick the one that is
 * most true*, and an Oxford shirt is honestly Smart casual AND Dressy. Only a
 * multi-select can say that, and only checkbox semantics tell VoiceOver that
 * ticking one leaves the others alone.
 *
 * `role="group"` rather than `radiogroup`: the options are independent, so
 * there is nothing here for arrow keys to cycle. Each is a real
 * `<input type="checkbox">` so it arrives with the platform's own state,
 * announcement and keyboard behaviour rather than an ARIA impersonation of one.
 *
 * **This is not a ladder.** The five are listed least to most formal because
 * that is how formality is conventionally written down, not because the last
 * one is best. Nothing in the control implies an order of quality — no
 * progress bar, no filling stars, no "up to" language — and unticking Casual
 * while leaving Dressy on is an ordinary thing to do here.
 *
 * Empty is a real state and it means **not recorded**, not "least formal".
 * `Clear all` returns to it, and the summary line says so in words rather than
 * leaving five empty boxes to be interpreted.
 */
export interface DressinessContextsProps {
  value: readonly DressinessContext[]
  onChange: (value: DressinessContext[]) => void
  id?: string
}

export function DressinessContexts({ value, onChange, id = 'dressiness' }: DressinessContextsProps) {
  const chosen = new Set(value)

  /*
   * Toggling one leaves every other alone, and the result is rebuilt from
   * `DRESSINESS_CONTEXTS` so it is always in canonical order.
   *
   * Order matters more than it looks: the stored set is compared by value, and
   * a set that serialised differently depending on the order Alex happened to
   * tap would make H1a read an identical save as a change.
   */
  const toggle = (context: DressinessContext) => {
    const next = new Set(chosen)
    if (next.has(context)) next.delete(context)
    else next.add(context)
    onChange(DRESSINESS_CONTEXTS.filter((c) => next.has(c)))
  }

  return (
    <div className="dressiness-contexts">
      <span className="dressiness-label" id={`${id}-label`}>
        Where it works
      </span>
      <p className="dressiness-help">Pick every situation this suits — not just the dressiest.</p>

      <div className="dressiness-options" role="group" aria-labelledby={`${id}-label`}>
        {DRESSINESS_CONTEXTS.map((context) => (
          <label key={context} className="dressiness-option" htmlFor={`${id}-${context}`}>
            <input
              id={`${id}-${context}`}
              type="checkbox"
              checked={chosen.has(context)}
              onChange={() => toggle(context)}
              /*
               * The NAME is the context; the hint is a DESCRIPTION.
               *
               * Wrapping the input in the label made the accessible name the
               * label's whole text content, and the two spans have no
               * whitespace between them — so VoiceOver announced
               * "CasualEveryday, nothing to dress up for" as one run-on word.
               * The brief asks for "Casual, selected", and doc 09 §7 already
               * records this exact lesson from C1: two facts joined without a
               * spoken separator run together.
               *
               * `aria-labelledby` wins over the wrapping label, so the name is
               * one word and the hint arrives after it as a description, with
               * the pause a description gets.
               */
              aria-labelledby={`${id}-${context}-name`}
              aria-describedby={`${id}-${context}-hint`}
            />
            <span className="dressiness-option-text">
              <span className="dressiness-option-name" id={`${id}-${context}-name`}>
                {DRESSINESS_CONTEXT_LABELS[context]}
              </span>
              <span className="dressiness-option-hint" id={`${id}-${context}-hint`}>
                {DRESSINESS_CONTEXT_HINTS[context]}
              </span>
            </span>
          </label>
        ))}
      </div>

      {/*
        * What is currently recorded, announced without moving focus.
        *
        * A checkbox already announces its own state on tap; this is for the
        * whole answer, which is what Alex is actually deciding — and it is what
        * makes "nothing chosen" a state he can hear rather than infer from five
        * silent boxes.
        */}
      <p className="dressiness-summary" aria-live="polite">
        {value.length === 0
          ? 'Not set — this will not be ruled out anywhere'
          : `Works for ${value.map((c) => DRESSINESS_CONTEXT_LABELS[c]).join(', ')}`}
      </p>

      {value.length > 0 ? (
        <button type="button" className="dressiness-clear" onClick={() => onChange([])}>
          Clear all
        </button>
      ) : null}
    </div>
  )
}
