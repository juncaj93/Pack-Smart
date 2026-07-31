import { useState } from 'react'
import { readQuantity } from '@shared/quantities'
import type { OpenQuestion } from '@shared/readiness'
import './TripQuestion.css'

/**
 * One unanswered question, asked where it changes something.
 *
 * Doc 09 §5: *one concise question at a time, only when it materially changes
 * recommendations, deferrable without blocking.* All three constraints are
 * structural here rather than matters of restraint —
 *
 *   - **One.** This renders a single question. The readiness model has already
 *     decided which one is worth asking first; a screen that showed all three
 *     would be a form, and a form is what doc 09 §5 is written against.
 *   - **Materially.** The question carries its own `because`, and
 *     `readiness-questions.test.ts` proves every fact offered is one a real
 *     rule reads. A question that changed nothing could not reach this
 *     component.
 *   - **Deferrable.** `Not now` is a peer of the answers, not a dismissal
 *     hidden in a corner, and deferring stores nothing: the question comes back
 *     next time because it is still true that the trip does not know. What must
 *     never happen is the answer being demanded before the list can be used,
 *     and the list is right underneath this card the whole time.
 *
 * The answer is not stored here. This raises it, and the trip screen writes it
 * through the same `updateTrip` the trip sheet uses — so an answer given here
 * and one given there cannot diverge.
 */

export interface TripQuestionProps {
  question: OpenQuestion
  /** Writes the answer. `null` is never sent — that is what deferring means. */
  onAnswer: (fact: string, value: boolean | number) => Promise<void>
  onDefer: () => void
  busy?: boolean
}

export function TripQuestion({ question, onAnswer, onDefer, busy = false }: TripQuestionProps) {
  const [hours, setHours] = useState('')
  const [invalid, setInvalid] = useState(false)

  /*
   * `flight_hours` is the one question with a number in it, so it is the one
   * that needs a field. Everything else in the list is a yes or a no, and
   * offering a text box for those would turn a two-tap answer into typing —
   * which `CLAUDE.md` asks the whole product to avoid.
   */
  const numeric = question.fact === 'flight_hours'

  async function submitHours() {
    const typed = readQuantity(hours)
    if (typed === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    await onAnswer(question.fact, typed)
  }

  return (
    <section className="trip-question" aria-labelledby="trip-question-text">
      <p className="trip-question-text" id="trip-question-text">
        {question.question}
      </p>
      {/*
        * What the answer changes, not that it helps. Doc 09 §25 rules out
        * confident language the data does not support, and "improves your
        * recommendations" is the purest example of it.
        */}
      <p className="trip-question-why">{question.because}</p>

      {numeric ? (
        <div className="trip-question-answer">
          <label className="trip-question-field">
            <span className="visually-hidden">{question.question}</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={hours}
              placeholder="Hours"
              disabled={busy}
              onChange={(e) => {
                setHours(e.target.value)
                setInvalid(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitHours()
              }}
            />
          </label>
          <button
            type="button"
            className="button-primary trip-question-save"
            onClick={() => void submitHours()}
            disabled={busy || hours.trim() === ''}
          >
            Save
          </button>
        </div>
      ) : (
        <div className="trip-question-answer">
          <button
            type="button"
            className="button-primary"
            onClick={() => void onAnswer(question.fact, true)}
            disabled={busy}
          >
            Yes
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void onAnswer(question.fact, false)}
            disabled={busy}
          >
            No
          </button>
        </div>
      )}

      {invalid ? <p className="field-error">Give a whole number of hours.</p> : null}

      {/*
        * Deferring is a real answer to "not right now", so it looks like one.
        * Nothing is stored: the question returns next time because the trip
        * still does not know, and pretending otherwise would be a stored
        * preference Alex never expressed.
        */}
      <button type="button" className="button-quiet trip-question-defer" onClick={onDefer}>
        Not now
      </button>
    </section>
  )
}
