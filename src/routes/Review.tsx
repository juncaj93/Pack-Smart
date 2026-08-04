import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BottomSheet } from '@/components/BottomSheet'
import { Screen } from '@/components/Screen'
import { CATEGORY_EMOJI } from '@/lib/items'
import { recall, remember } from '@/lib/sessionCache'
import {
  addReviewAnswer,
  fetchReview,
  finishReview,
  removeReviewAnswer,
  resolveReviewAnswer,
  type Review as ReviewData,
  type ReviewChoice,
} from '@/lib/review'
import { formatDateRange } from '@/routes/Trips'
import type { ReviewAnswerKind, ReviewProposal } from '@shared/review'
import './Review.css'

/**
 * The post-trip review (F1, doc 09 §16).
 *
 * Short on purpose. The trip is over, Alex is unpacking, and the value of this
 * screen is entirely in how little of it there is — a review that feels like
 * homework is one he does once.
 *
 * So it is three blocks, in this order and no other:
 *
 *   1. **What Pack Smart saw.** Sentences, not questions. This is the half that
 *      earns the second half: seeing that the app already knows what was worn
 *      and what came off the list is what makes four optional questions read as
 *      short rather than partial.
 *   2. **Anything to add.** Five collapsed rows. Nothing is required, nothing
 *      is expanded, and nothing asks about something the app can already see —
 *      *what did you pack but never use* is answered in block 1 and is
 *      deliberately not a question here.
 *   3. **What that changes.** One proposal per answer, in Alex's words, with
 *      the effect stated before it happens and an explicit yes.
 *
 * `Finish` is available from the first frame and is never gated on answering
 * anything. A finish button that appears only once every proposal is decided is
 * a block wearing a friendlier word, and F1 must not block.
 */

interface QuestionSpec {
  kind: ReviewAnswerKind
  /** The row, as Alex reads it. */
  label: string
  /** The sheet's title, which is the same question asked directly. */
  sheet: string
  /** Which picker it opens, or `note` for the one question with no list. */
  source: 'notPacked' | 'packed' | 'outfits' | 'note'
  /** The empty state, when the trip has nothing to offer for this question. */
  empty: string
  /** Whether "it was something else" is a legitimate answer here. */
  allowsOther: boolean
}

const QUESTIONS: QuestionSpec[] = [
  {
    kind: 'forgot',
    label: 'Did you forget anything?',
    sheet: 'What did you forget?',
    /*
     * Things that were NOT on this trip's list, and that filter is a product
     * rule rather than a tidy default: offering something that WAS on the list
     * invites an answer the review then has to talk him out of.
     */
    source: 'notPacked',
    empty: 'Everything you own was on this trip’s list.',
    allowsOther: true,
  },
  {
    kind: 'ran_out',
    label: 'Did you run out of anything?',
    sheet: 'What did you run out of?',
    source: 'packed',
    empty: 'Nothing was ticked as packed on this trip.',
    allowsOther: true,
  },
  {
    kind: 'too_many',
    label: 'Was there too much of anything?',
    sheet: 'What did you have too much of?',
    source: 'packed',
    empty: 'Nothing was ticked as packed on this trip.',
    allowsOther: false,
  },
  {
    kind: 'outfit_wrong',
    label: 'Was an outfit wrong?',
    sheet: 'Which outfit was wrong?',
    source: 'outfits',
    empty: 'No outfits were approved for this trip.',
    allowsOther: false,
  },
  {
    kind: 'missing_from_screen',
    label: 'Was something missing from Today or Before you go?',
    sheet: 'What was missing?',
    source: 'note',
    empty: '',
    allowsOther: true,
  },
]

export default function Review() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const cached = recall<ReviewData>(`review:${id}`)
  const [review, setReview] = useState<ReviewData | null>(cached ?? null)
  const [asking, setAsking] = useState<QuestionSpec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await fetchReview(id)
      setReview(result)
      remember(`review:${id}`, result)
      setError(null)
    } catch {
      setError('Could not load this trip’s review. Check your connection.')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  /** Every write answers with the whole view, so there is one way to accept one. */
  const apply = useCallback(
    async (work: () => Promise<ReviewData>, failure: string) => {
      setBusy(true)
      try {
        const result = await work()
        setReview(result)
        remember(`review:${id}`, result)
        setError(null)
        return true
      } catch (cause) {
        setError(cause instanceof Error && cause.message ? cause.message : failure)
        return false
      } finally {
        setBusy(false)
      }
    },
    [id],
  )

  /*
   * What each question can still be asked about.
   *
   * Anything already answered is removed from its own picker, because two
   * `ran out` answers about the same socks would produce two proposals to add a
   * spare and accepting both would add two — which is not what saying it twice
   * meant. The endpoint refuses the duplicate as well; this is the half Alex
   * never sees fail.
   */
  const answered = useMemo(() => {
    const map = new Map<ReviewAnswerKind, Set<string>>()
    for (const proposal of review?.proposals ?? []) {
      const subject = proposal.itemId ?? proposal.outfitGroupId
      if (!subject) continue
      const seen = map.get(proposal.kind) ?? new Set<string>()
      seen.add(subject)
      map.set(proposal.kind, seen)
    }
    return map
  }, [review])

  if (!review) {
    return (
      <Screen title="Trip review">
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </Screen>
    )
  }

  const pending = review.proposals.filter((p) => p.resolution === 'pending')
  const decided = review.proposals.filter((p) => p.resolution !== 'pending')

  async function ask(spec: QuestionSpec, answer: { itemId?: string; outfitGroupId?: string; note?: string }) {
    const ok = await apply(
      () => addReviewAnswer(id, { kind: spec.kind, ...answer }),
      'Could not save that.',
    )
    if (ok) setAsking(null)
  }

  return (
    <Screen title="Trip review" subtitle={`${review.tripName} · ${formatDateRange(review.startDate, review.endDate)}`}>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      {/*
        * Block one: what the app already saw.
        *
        * Above the questions because it is what makes them short. It is also
        * the answer to the question F1 refuses to ask — "what did you pack but
        * never use" is a line here, not a form field.
        */}
      <section className="trip-review-section">
        <h2 className="section-heading">What Pack Smart saw</h2>
        {review.summary.length > 0 ? (
          <ul className="trip-review-summary">
            {review.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="hint">There was nothing on this trip’s list.</p>
        )}
      </section>

      {/*
        * Block two: the four things only Alex knows, and one that only he can
        * report. Collapsed, optional, and in the order they are worth asking.
        */}
      <section className="trip-review-section">
        <h2 className="section-heading">Anything to add?</h2>
        <p className="section-hint">All optional. You can finish without answering any of them.</p>
        <ul className="trip-review-questions row-list">
          {QUESTIONS.map((spec) => (
            <li key={spec.kind}>
              <button type="button" className="trip-review-question" onClick={() => setAsking(spec)}>
                <span className="trip-review-question-label">{spec.label}</span>
                <span className="trip-review-question-mark" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/*
        * Block three: what any of it changes.
        *
        * Only rendered once there is something in it. An empty "what Pack Smart
        * suggests" panel above four unanswered questions would read as a thing
        * that failed to load.
        */}
      {pending.length > 0 ? (
        <section className="trip-review-section">
          <h2 className="section-heading">What that changes</h2>
          {pending.map((proposal) => (
            <ProposalCard
              key={proposal.answerId}
              proposal={proposal}
              busy={busy}
              onAccept={() =>
                void apply(
                  () => resolveReviewAnswer(id, proposal.answerId, 'accepted'),
                  'Could not save that.',
                )
              }
              onDecline={() =>
                void apply(
                  () => resolveReviewAnswer(id, proposal.answerId, 'declined'),
                  'Could not save that.',
                )
              }
              onRemove={() =>
                void apply(() => removeReviewAnswer(id, proposal.answerId), 'Could not remove that.')
              }
            />
          ))}
        </section>
      ) : null}

      {decided.length > 0 ? (
        <section className="trip-review-section">
          <h2 className="section-heading">Already decided</h2>
          {decided.map((proposal) => (
            <p key={proposal.answerId} className="trip-review-decided">
              <span className="trip-review-decided-mark" aria-hidden="true">
                {proposal.resolution === 'accepted' ? '✓' : '—'}
              </span>
              {proposal.message}{' '}
              <span className="hint">
                {proposal.resolution === 'accepted'
                  ? 'Saved. You can change it in Packing rules.'
                  : 'Left as it was.'}
              </span>
            </p>
          ))}
        </section>
      ) : null}

      {/*
        * The one primary action, and it is available immediately.
        *
        * After the review has been finished it becomes the way back rather than
        * disappearing: a screen whose only button vanishes once it is used is a
        * dead end, which is the exact failure E1 existed to remove from Today.
        */}
      {review.reviewedAt ? (
        <>
          <p className="trip-review-done" role="status">
            Review saved. Pack Smart will use it when you plan a trip like this one.
          </p>
          <button
            type="button"
            className="button-primary"
            onClick={() => navigate(`/trips/${id}`)}
          >
            Back to the trip
          </button>
        </>
      ) : (
        <button
          type="button"
          className="button-primary"
          disabled={busy}
          onClick={() => void apply(() => finishReview(id), 'Could not finish the review.')}
        >
          Finish
        </button>
      )}

      <AnswerSheet
        spec={asking}
        review={review}
        answered={answered}
        busy={busy}
        onClose={() => setAsking(null)}
        onAnswer={ask}
      />
    </Screen>
  )
}

/* ------------------------------------------------------------------ */

/**
 * One proposal, and the two taps that decide it.
 *
 * The order on screen is what Alex said, then what accepting would do, then any
 * conflict — the effect BEFORE the button, every time, because a permanent
 * preference change has to be explicit and an explicit change is one whose
 * consequence was on screen before the tap (CLAUDE.md).
 */
function ProposalCard({
  proposal,
  busy,
  onAccept,
  onDecline,
  onRemove,
}: {
  proposal: ReviewProposal
  busy: boolean
  onAccept: () => void
  onDecline: () => void
  onRemove: () => void
}) {
  return (
    <div className="trip-review-proposal">
      <p className="trip-review-proposal-what">{proposal.message}</p>

      {proposal.effect ? <p className="hint">{proposal.effect}</p> : null}

      {/*
        * A rule Alex wrote himself, named rather than silently overwritten.
        *
        * `11_RULE_PRECEDENCE.md` puts an explicit user rule above anything
        * learned. Refusing outright would make his own setting unreachable from
        * the screen that has just been told it is wrong; naming it, and keeping
        * the accept a separate deliberate tap, protects the rule and the person.
        */}
      {proposal.conflict ? (
        <p className="trip-review-conflict" role="note">
          {proposal.conflict}
        </p>
      ) : null}

      {proposal.limitation ? <p className="hint">{proposal.limitation}</p> : null}

      {proposal.change ? (
        <div className="trip-review-actions">
          <button type="button" className="button-secondary" disabled={busy} onClick={onAccept}>
            Do that
          </button>
          <button type="button" className="button-quiet" disabled={busy} onClick={onDecline}>
            No thanks
          </button>
        </div>
      ) : (
        /*
         * Nothing to accept, so nothing pretends to be acceptable.
         *
         * The row is still here — it is what Alex said, and deleting it for him
         * would be the app deciding his answer was not worth keeping — but the
         * only control is the one that removes it.
         */
        <div className="trip-review-actions">
          <button type="button" className="button-quiet" disabled={busy} onClick={onRemove}>
            Remove this
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * The picker, which is the same sheet for all five questions.
 *
 * A search field and a list, or a text field for the one question that has no
 * list. Search is optional and never the only way through: the wardrobe picker
 * can be scrolled, which is what matters when Alex does not know what the thing
 * is called, and typing is the last resort rather than the first step (doc 02:
 * minimise typing).
 */
function AnswerSheet({
  spec,
  review,
  answered,
  busy,
  onClose,
  onAnswer,
}: {
  spec: QuestionSpec | null
  review: ReviewData
  answered: Map<ReviewAnswerKind, Set<string>>
  busy: boolean
  onClose: () => void
  onAnswer: (spec: QuestionSpec, answer: { itemId?: string; outfitGroupId?: string; note?: string }) => void
}) {
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    setQuery('')
    setNote('')
  }, [spec])

  if (!spec) return <BottomSheet open={false} onClose={onClose} title="" children={null} />

  const alreadySaid = answered.get(spec.kind) ?? new Set<string>()
  const choices: ReviewChoice[] = (spec.source === 'note' ? [] : review.choices[spec.source]).filter(
    (choice) => !alreadySaid.has(choice.id),
  )

  const needle = query.trim().toLowerCase()
  const shown = needle
    ? choices.filter((choice) => choice.name.toLowerCase().includes(needle))
    : choices

  const canSubmitNote = note.trim().length > 0

  return (
    <BottomSheet open onClose={onClose} title={spec.sheet}>
      {spec.source === 'note' ? (
        <>
          <label className="field">
            <span className="field-label">What was missing?</span>
            <textarea
              className="trip-review-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Anything Today or Before you go should have said"
            />
          </label>
          <p className="hint">
            Pack Smart cannot change a screen on its own. This is written down so it is not lost.
          </p>
          <button
            type="button"
            className="button-primary"
            disabled={busy || !canSubmitNote}
            onClick={() => onAnswer(spec, { note: note.trim() })}
          >
            Save this
          </button>
        </>
      ) : (
        <>
          {choices.length === 0 ? (
            <p className="hint">{spec.empty}</p>
          ) : (
            <>
              <label className="field">
                <span className="field-label visually-hidden">Search</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                  autoComplete="off"
                />
              </label>

              <ul className="trip-review-choices row-list">
                {shown.map((choice) => (
                  <li key={choice.id}>
                    <button
                      type="button"
                      className="trip-review-choice"
                      disabled={busy}
                      onClick={() =>
                        onAnswer(
                          spec,
                          spec.source === 'outfits'
                            ? { outfitGroupId: choice.id }
                            : { itemId: choice.id },
                        )
                      }
                    >
                      {choice.category && CATEGORY_EMOJI[choice.category] ? (
                        <span className="trip-review-choice-emoji" aria-hidden="true">
                          {CATEGORY_EMOJI[choice.category]}
                        </span>
                      ) : null}
                      <span>{choice.name}</span>
                    </button>
                  </li>
                ))}
              </ul>

              {shown.length === 0 ? <p className="hint">Nothing matches “{query}”.</p> : null}
            </>
          )}

          {/*
            * The escape hatch for a thing he does not own.
            *
            * "I forgot a European plug adapter" is a real answer about a real
            * shortfall, and refusing it because there is no row for it would be
            * the app declining evidence for its own convenience. It produces no
            * rule and says so.
            */}
          {spec.allowsOther ? (
            <div className="trip-review-other">
              <label className="field">
                <span className="field-label">Something else</span>
                <input
                  
                  type="text"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Type what it was"
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                className="button-secondary"
                disabled={busy || !canSubmitNote}
                onClick={() => onAnswer(spec, { note: note.trim() })}
              >
                Add it
              </button>
            </div>
          ) : null}
        </>
      )}
    </BottomSheet>
  )
}
