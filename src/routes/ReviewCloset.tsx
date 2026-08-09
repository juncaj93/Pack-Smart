import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DressinessContexts } from '@/components/DressinessContexts'
import { RatingChoice } from '@/components/RatingChoice'
import { EmptyState, Screen } from '@/components/Screen'
import { useOptimisticWrite } from '@/lib/optimistic'
import {
  archiveDuplicate,
  confirmItemFields,
  fetchReviewQueue,
  patchItemFields,
  recordReviewDecision,
  reopenNotSure,
  revertItemField,
  type ReviewCard,
  type ReviewQueue,
} from '@/lib/closetReview'
import {
  TOPIC_NAME,
  TOPIC_RATINGS,
  disagreementTopic,
  duplicateTopic,
  sourceLabel,
  type ReviewDecision,
} from '@shared/closet-review'
import type { DressinessContext } from '@shared/dressiness'
import { COMFORT_LABELS, VERSATILITY_LABELS, garmentDetail, type Item } from '@shared/items'
import type { ProvenancedField } from '@shared/provenance'
import './ReviewCloset.css'

type Status = 'loading' | 'ready' | 'error'

/**
 * Review Closet Items (H1d).
 *
 * **A review queue, not a form.** The distinction decides every choice on this
 * screen: one garment at a time, the highest-value question first, and every
 * answer already saved by the time Alex looks away from it. A grid of every
 * unrated garment would be the same information and would be homework — which
 * doc 09 §7 rules out by name, and which is the only way this feature can fail
 * while technically working.
 *
 * ## Nothing waits for the database
 *
 * Tapping a star updates the screen and returns control immediately; the write
 * goes out behind it through `useOptimisticWrite`, the guard P1A proved on the
 * outfit picker. So *Next* is not a save button — the save already happened —
 * and moving through twenty garments costs no round trips at all beyond the one
 * that fetched the queue.
 *
 * The ticket is keyed **per garment and per field**, which matters more here
 * than in the picker: comfort, versatility and dressiness are three independent
 * answers, and a failed comfort write must roll back comfort alone. Undoing a
 * versatility rating Alex gave a second later would be the stale-reply defect
 * in miniature.
 *
 * ## Why the whole queue arrives at once
 *
 * A card-at-a-time endpoint would put a round trip between every answer and the
 * next question. The wardrobe is ~119 rows and the queue is the same order of
 * payload My Stuff already fetches, so *Next* is a local index change and
 * nothing else.
 *
 * ## Coming back
 *
 * There is no stored cursor, deliberately. An answered garment stops qualifying
 * — its rating is no longer missing — so it leaves the queue on its own and the
 * next open resumes where the work actually is. A cursor would be a second,
 * weaker record of the same fact, and one that goes wrong the moment Alex edits
 * something in My Stuff instead.
 */
export default function ReviewCloset() {
  const navigate = useNavigate()
  const write = useOptimisticWrite()

  const [status, setStatus] = useState<Status>('loading')
  const [queue, setQueue] = useState<ReviewQueue | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await fetchReviewQueue()
      setQueue(data)
      setIndex(0)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const cards = queue?.cards ?? []
  const card = cards[index] ?? null

  /* ---------------------------------------------------------------- */
  /* the local half of every write                                     */
  /* ---------------------------------------------------------------- */

  /** Replaces one garment in the queue, wherever it sits. */
  const patchCard = useCallback((itemId: string, next: (item: Item) => Item) => {
    setQueue((current) => {
      if (current === null) return current
      return {
        ...current,
        cards: current.cards.map((entry) =>
          entry.item.id === itemId ? { ...entry, item: next(entry.item) } : entry,
        ),
      }
    })
  }, [])

  /** Drops a card from the queue entirely, once its question is settled. */
  const dropCard = useCallback((itemId: string) => {
    setQueue((current) =>
      current === null
        ? current
        : { ...current, cards: current.cards.filter((entry) => entry.item.id !== itemId) },
    )
  }, [])

  /**
   * One rating, saved the moment it is tapped.
   *
   * `settle` copies back only THIS field and only this field's provenance
   * entry, never the whole row the server returned. The row is a snapshot from
   * before the request; applying all of it would silently undo any other rating
   * Alex gave while it was in flight — which is exactly the class of bug the
   * ticket exists to prevent, arriving through the success path instead of the
   * stale one.
   */
  function rate<K extends 'comfort' | 'versatility'>(item: Item, field: K, value: number | null) {
    const before = item[field]
    setError(null)

    write(`${item.id}:${field}`, {
      apply: () => patchCard(item.id, (current) => ({ ...current, [field]: value })),
      persist: () => patchItemFields(item.id, { [field]: value }),
      settle: (result) =>
        patchCard(item.id, (current) => ({
          ...current,
          [field]: result.item[field],
          fieldProvenance: {
            ...current.fieldProvenance,
            [field]: result.item.fieldProvenance[field],
          },
        })),
      rollback: () => patchCard(item.id, (current) => ({ ...current, [field]: before })),
      onError: () => setError('Could not save that rating.'),
    })
  }

  function setContexts(item: Item, contexts: DressinessContext[]) {
    const before = item.dressinessContexts
    setError(null)

    write(`${item.id}:dressinessContexts`, {
      apply: () => patchCard(item.id, (current) => ({ ...current, dressinessContexts: contexts })),
      persist: () => patchItemFields(item.id, { dressinessContexts: contexts }),
      settle: (result) =>
        patchCard(item.id, (current) => ({
          ...current,
          dressinessContexts: result.item.dressinessContexts,
          fieldProvenance: {
            ...current.fieldProvenance,
            dressinessContexts: result.item.fieldProvenance.dressinessContexts,
          },
        })),
      rollback: () =>
        patchCard(item.id, (current) => ({ ...current, dressinessContexts: before })),
      onError: () => setError('Could not save that.'),
    })
  }

  /* ---------------------------------------------------------------- */
  /* moving through the queue                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Advance. Deliberately does not clamp to the end by stopping — running past
   * the last card is how the finished state is reached, and `card === null` is
   * what renders it.
   */
  function next() {
    setError(null)
    setEditing(null)
    setIndex((current) => current + 1)
  }

  /**
   * Skip and Not sure — both recorded, both advancing without waiting.
   *
   * They are genuinely different and treated differently. *Skip* is "not now":
   * the decision moves the card behind everything else on the next open, and it
   * never disappears. *Not sure* is "I cannot answer this": the question leaves
   * the queue until Alex asks for it back from the finished state. Treating
   * them the same is how a queue starts feeling like it is not listening.
   */
  function decide(entry: ReviewCard, decision: ReviewDecision) {
    /*
     * Fire-and-forget on purpose, and safe because of what it is: a preference
     * about a QUESTION, not a change to the closet. A failure costs Alex seeing
     * the same card again, which is the same thing that happens if he closes
     * the app a moment earlier — so blocking the advance on it would trade a
     * real cost for an imaginary one.
     */
    void recordReviewDecision(entry.item.id, topicOf(entry), decision).catch(() => {})
    if (decision === 'not_sure') dropCard(entry.item.id)
    else next()
  }

  /* ---------------------------------------------------------------- */
  /* the cleanup answers                                               */
  /* ---------------------------------------------------------------- */

  function applyName(entry: ReviewCard, name: string) {
    const item = entry.item
    const before = item.displayName
    setError(null)
    setEditing(null)

    write(`${item.id}:displayName`, {
      apply: () => patchCard(item.id, (current) => ({ ...current, displayName: name })),
      persist: async () => {
        await patchItemFields(item.id, { displayName: name })
        return recordReviewDecision(item.id, TOPIC_NAME, 'answered')
      },
      settle: () => clearSuggestion(item.id),
      rollback: () => patchCard(item.id, (current) => ({ ...current, displayName: before })),
      onError: () => setError('Could not rename that.'),
    })
  }

  /**
   * *Keep as is* — and it is not a no-op, which is the point.
   *
   * The name does not change; its AUTHORITY does. `confirmFields` stamps it
   * `user_confirmed`, and from then on no import may write it. One tap, nothing
   * visibly happens, and the spreadsheet permanently stops being able to
   * rename it.
   */
  function keepName(entry: ReviewCard) {
    const item = entry.item
    setError(null)

    write(`${item.id}:displayName`, {
      apply: () => clearSuggestion(item.id),
      persist: async () => {
        await confirmItemFields(item.id, nameFields(item))
        return recordReviewDecision(item.id, TOPIC_NAME, 'answered')
      },
      rollback: () => void load(),
      onError: () => setError('Could not save that.'),
    })
  }

  const clearSuggestion = useCallback((itemId: string) => {
    setQueue((current) =>
      current === null
        ? current
        : {
            ...current,
            cards: current.cards.map((entry) =>
              entry.item.id === itemId ? { ...entry, nameSuggestion: null } : entry,
            ),
          },
    )
  }, [])

  const clearDuplicate = useCallback((itemId: string) => {
    setQueue((current) =>
      current === null
        ? current
        : {
            ...current,
            cards: current.cards.map((entry) =>
              entry.item.id === itemId ? { ...entry, duplicate: null } : entry,
            ),
          },
    )
  }, [])

  const clearDisagreement = useCallback((itemId: string, field: ProvenancedField) => {
    setQueue((current) =>
      current === null
        ? current
        : {
            ...current,
            cards: current.cards.map((entry) =>
              entry.item.id === itemId
                ? { ...entry, disagreements: entry.disagreements.filter((d) => d.field !== field) }
                : entry,
            ),
          },
    )
  }, [])

  /**
   * *Not sure* about a duplicate — recorded, not merely dismissed.
   *
   * Clearing it locally would put the same pair back on the next open, which is
   * the queue not listening. `not_sure` withdraws the question and stays
   * reversible from the empty state, exactly as it does for a rating.
   */
  function unsureAboutDuplicate(entry: ReviewCard) {
    const item = entry.item
    const otherId = entry.duplicate?.itemId
    if (!otherId) return
    setError(null)

    write(`${item.id}:duplicate`, {
      apply: () => clearDuplicate(item.id),
      persist: () => recordReviewDecision(item.id, duplicateTopic(otherId), 'not_sure'),
      rollback: () => void load(),
      onError: () => setError('Could not save that.'),
    })
  }

  function keepBoth(entry: ReviewCard) {
    const item = entry.item
    const otherId = entry.duplicate?.itemId
    if (!otherId) return
    setError(null)

    write(`${item.id}:duplicate`, {
      apply: () => clearDuplicate(item.id),
      persist: () => recordReviewDecision(item.id, duplicateTopic(otherId), 'answered'),
      rollback: () => void load(),
      onError: () => setError('Could not save that.'),
    })
  }

  /**
   * *Same item* — archive the copy Alex did not keep.
   *
   * Merging two rows is H1e and is not proven safe: doc 09 §7 requires a merge
   * to preserve packing history, outfit history, checklist references,
   * provenance, ratings, learning evidence and archive state, and none of that
   * is demonstrated yet. Its ruling is explicit — do not delete either record
   * until merge is proven, and an explicit deferral is an acceptable outcome.
   *
   * Archiving is the strongest thing that IS safe, and it is the retirement
   * path this schema was built around: both rows survive, every trip and outfit
   * pointing at either still resolves, past trips still show both, and Restore
   * in My Stuff undoes it entirely. The card says so rather than implying a
   * merge happened.
   */
  function keepThisOne(entry: ReviewCard, keepId: string, archiveId: string) {
    setError(null)

    write(`${entry.item.id}:duplicate`, {
      apply: () => {
        clearDuplicate(entry.item.id)
        if (archiveId === entry.item.id) dropCard(entry.item.id)
      },
      persist: () => archiveDuplicate(keepId, archiveId),
      rollback: () => void load(),
      onError: () => setError('Could not archive that.'),
    })
  }

  function keepMine(entry: ReviewCard, field: ProvenancedField) {
    const item = entry.item
    setError(null)

    write(`${item.id}:${field}`, {
      apply: () => clearDisagreement(item.id, field),
      persist: async () => {
        await confirmItemFields(item.id, [field])
        return recordReviewDecision(item.id, disagreementTopic(field), 'answered')
      },
      rollback: () => void load(),
      onError: () => setError('Could not save that.'),
    })
  }

  function takeSpreadsheetValue(entry: ReviewCard, field: ProvenancedField) {
    const item = entry.item
    setError(null)

    write(`${item.id}:${field}`, {
      apply: () => clearDisagreement(item.id, field),
      persist: () => revertItemField(item.id, field),
      settle: (restored) => patchCard(item.id, () => restored),
      rollback: () => void load(),
      onError: () => setError('Could not put that back.'),
    })
  }

  /* ---------------------------------------------------------------- */
  /* render                                                            */
  /* ---------------------------------------------------------------- */

  if (status === 'loading') {
    return (
      <Screen title="Review closet items">
        <p className="review-status">Working out what is worth asking…</p>
      </Screen>
    )
  }

  if (status === 'error') {
    return (
      <Screen title="Review closet items">
        <EmptyState
          title="Could not load your closet"
          body="Something went wrong reaching Pack Smart. Check your connection."
          action={{ label: 'Try again', onClick: () => void load() }}
        />
      </Screen>
    )
  }

  if (card === null) {
    const answered = cards.length
    return (
      <Screen title="Review closet items">
        <EmptyState
          title={answered > 0 ? 'That is everything for now' : 'Nothing worth asking'}
          body={
            answered > 0
              ? 'Pack Smart has what it needs from this pass. Come back whenever — new questions appear as you take more trips.'
              : 'Your closet already tells Pack Smart what it needs. Nothing here is worth your time right now.'
          }
          action={{ label: 'Back to My Stuff', onClick: () => navigate('/my-stuff') }}
        />

        {/*
          * The way back from *Not sure*, and the reason it is safe to offer.
          *
          * Without this, one uncertain tap retires a question permanently — and
          * a queue that can lose a question is not one to trust with a closet.
          * Only shown when there is something to restore.
          */}
        {(queue?.notSure ?? 0) > 0 ? (
          <button
            type="button"
            className="button-secondary review-reopen"
            onClick={() => {
              void reopenNotSure().then(() => load())
            }}
          >
            Ask me again about the {queue!.notSure} I was not sure about
          </button>
        ) : null}
      </Screen>
    )
  }

  const item = card.item
  const detail = garmentDetail(item)
  const suggestion = card.nameSuggestion
  const duplicate = card.duplicate

  return (
    <Screen title="Review closet items">
      {/*
        * Position, not a progress bar.
        *
        * A bar implies a finish line Alex is expected to reach, and the whole
        * closet never has to be reviewed — doc 09 §7's words. "3 of 24" says
        * where he is without suggesting he owes the other 21.
        */}
      <p className="review-progress" aria-live="polite">
        {index + 1} of {cards.length}
      </p>

      {/*
        * Constant control ids, NOT ids derived from the garment.
        *
        * They were `review-comfort-${item.id}` at first, which is the habit of
        * making everything unique — and it is wrong twice here. Only one card is
        * ever on screen, so there is nothing to collide with; and the id is
        * spent on `aria-labelledby`, whose value is a SPACE-SEPARATED LIST of
        * ids. Any id containing a space silently breaks the accessible name,
        * which is exactly what a screen reader needs and exactly what no visual
        * check would catch.
        */}
      <article className="review-card">
        <h2 className="review-name">{item.displayName}</h2>
        {detail ? <p className="review-detail">{detail}</p> : null}
        <p className="review-why">{card.why}</p>

        {/*
          * Only what the card ASKS for, never a control that is merely
          * answerable.
          *
          * These read `item.x !== null` as well at first, so a garment with a
          * comfort rating still showed the comfort control "in case". Measured
          * on the seeded wardrobe that made an ordinary card 2,700px tall — four
          * screens on the 664px viewport Safari actually gives — most of it
          * spent re-presenting answers nobody had asked about. A queue whose
          * cards take four screens is a queue Alex stops working through.
          *
          * `asks` is computed once, when the queue is fetched, so a control does
          * not vanish from under his thumb the moment he answers it.
          */}
        {card.asks.includes('comfort') ? (
          <RatingChoice
            id="review-comfort"
            label="Comfort"
            value={item.comfort}
            labels={COMFORT_LABELS}
            onChange={(value) => rate(item, 'comfort', value)}
          />
        ) : null}

        {card.asks.includes('versatility') ? (
          <RatingChoice
            id="review-versatility"
            label="Versatility"
            value={item.versatility}
            labels={VERSATILITY_LABELS}
            onChange={(value) => rate(item, 'versatility', value)}
            hint="Left alone, Pack Smart works this out from what you use it for."
          />
        ) : null}

        {card.asks.includes('contexts') ? (
          <DressinessContexts
            id="review-dressiness"
            value={item.dressinessContexts}
            onChange={(contexts) => setContexts(item, contexts)}
          />
        ) : null}

        {/* ---- the name suggestion — never applied silently ---- */}
        {suggestion ? (
          <section className="review-block">
            <h3 className="review-block-title">A tidier name</h3>
            <p className="review-block-body">
              <span className="review-was">{item.displayName}</span>
              <span className="review-arrow" aria-hidden="true">
                →
              </span>
              <span className="review-now">{suggestion.displayName}</span>
            </p>
            <p className="review-block-hint">
              {suggestion.removed.join(' and ')} {suggestion.removed.length === 1 ? 'is' : 'are'}{' '}
              already the {suggestion.keptAs.toLowerCase()} on this item, so the name does not need
              to repeat {suggestion.removed.length === 1 ? 'it' : 'them'}.
            </p>

            {editing === item.id ? (
              <div className="review-edit">
                <label className="field">
                  <span className="field-label">Name</span>
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    autoCapitalize="words"
                    enterKeyHint="done"
                    aria-label="Name"
                  />
                </label>
                <button
                  type="button"
                  className="button-primary"
                  onClick={() => applyName(card, draftName.trim())}
                  disabled={draftName.trim().length === 0}
                >
                  Save this name
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="review-actions-row">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => applyName(card, suggestion.displayName)}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => {
                    setDraftName(suggestion.displayName)
                    setEditing(item.id)
                  }}
                >
                  Edit
                </button>
                <button type="button" className="button-secondary" onClick={() => keepName(card)}>
                  Keep as is
                </button>
              </div>
            )}
          </section>
        ) : null}

        {/* ---- a possible duplicate, side by side ---- */}
        {duplicate ? (
          <section className="review-block">
            <h3 className="review-block-title">You may own this twice</h3>
            <p className="review-block-hint">{duplicate.why}</p>

            <ul className="review-pair">
              <li className="review-pair-item">
                <span className="review-pair-name">{item.displayName}</span>
                <span className="review-pair-detail">{detail ?? 'No brand or colour recorded'}</span>
                <span className="review-pair-trips">{trips(duplicate.packedTrips)}</span>
                <button
                  type="button"
                  className="button-secondary"
                  /*
                   * Two buttons reading "Keep this one" are one button as far
                   * as a screen reader's control list is concerned, and this is
                   * the one card where the two things genuinely might be
                   * identical. The label carries what actually separates them —
                   * the detail line and the packing history — because that is
                   * what Alex is deciding on.
                   */
                  aria-label={`Keep ${item.displayName}, ${detail ?? 'no brand or colour recorded'}, ${trips(duplicate.packedTrips).toLowerCase()}`}
                  onClick={() => keepThisOne(card, item.id, duplicate.itemId)}
                >
                  Keep this one
                </button>
              </li>
              <li className="review-pair-item">
                <span className="review-pair-name">{duplicate.displayName}</span>
                <span className="review-pair-detail">
                  {duplicate.detail ?? 'No brand or colour recorded'}
                </span>
                <span className="review-pair-trips">{trips(duplicate.otherPackedTrips)}</span>
                <button
                  type="button"
                  className="button-secondary"
                  aria-label={`Keep ${duplicate.displayName}, ${duplicate.detail ?? 'no brand or colour recorded'}, ${trips(duplicate.otherPackedTrips).toLowerCase()}`}
                  onClick={() => keepThisOne(card, duplicate.itemId, item.id)}
                >
                  Keep this one
                </button>
              </li>
            </ul>

            {/*
              * Says what "keep this one" does, because archiving is not
              * merging and pretending otherwise would be the silent data loss
              * H1e exists to avoid.
              */}
            <p className="review-block-hint">
              Keeping one archives the other. Nothing is deleted, trips you have already taken
              still show both, and you can restore it from My Stuff at any time.
            </p>

            <div className="review-actions-row">
              <button type="button" className="button-secondary" onClick={() => keepBoth(card)}>
                Keep both
              </button>
              <button
                type="button"
                className="button-secondary"
                /*
                 * The word Alex reads is the brief's word. The NAME is longer,
                 * because the card-level *Not sure* is also on screen and two
                 * controls with one name doing two different things is a
                 * control list nobody can navigate.
                 */
                aria-label="Not sure whether these are the same item"
                onClick={() => unsureAboutDuplicate(card)}
              >
                Not sure
              </button>
            </div>
          </section>
        ) : null}

        {/* ---- the spreadsheet disagreeing with a confirmation ---- */}
        {card.disagreements.map((disagreement) => (
          <section className="review-block" key={disagreement.field}>
            <h3 className="review-block-title">Your spreadsheet disagrees</h3>
            <p className="review-block-body">
              Your spreadsheet says {disagreement.label.toLowerCase()} is{' '}
              <strong>{disagreement.theirs}</strong>. You confirmed{' '}
              <strong>{disagreement.mine}</strong>.
            </p>
            <p className="review-block-hint">
              The stored value is {sourceLabel('user_confirmed')}, so no import has changed it.
            </p>
            <div className="review-actions-row">
              <button
                type="button"
                className="button-secondary"
                onClick={() => keepMine(card, disagreement.field)}
              >
                Keep my choice
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => takeSpreadsheetValue(card, disagreement.field)}
              >
                Use spreadsheet value
              </button>
            </div>
          </section>
        ))}
      </article>

      {error ? (
        <p className="field-error review-error" role="alert">
          {error}
        </p>
      ) : null}

      {/*
        * One obvious primary action, and it does not say Save.
        *
        * Every rating on this card was written the moment it was tapped, so a
        * Save button would be a control that either does nothing or implies the
        * previous taps had not counted. *Next* is the truth.
        */}
      <div className="review-actions">
        <button type="button" className="button-primary" onClick={next}>
          Next
        </button>
        <div className="review-actions-row">
          <button type="button" className="button-secondary" onClick={() => decide(card, 'skipped')}>
            Skip
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => decide(card, 'not_sure')}
          >
            Not sure
          </button>
        </div>
        <button type="button" className="button-quiet" onClick={() => navigate('/my-stuff')}>
          Finish for now
        </button>
      </div>
    </Screen>
  )
}

/**
 * Which question Skip and Not sure are about.
 *
 * Read from the card's REASON, not from whether it happens to carry ratings.
 * The first version read `asks.length > 0 ? ratings : name`, so *Not sure* on a
 * card whose question was a possible duplicate withdrew the NAME question
 * instead — suppressing something Alex was never asked and leaving the thing he
 * could not answer in the queue. Both halves wrong, from one convenient guess.
 */
function topicOf(card: ReviewCard): string {
  switch (card.reason) {
    case 'repetitive_name':
    case 'missing_detail':
      return TOPIC_NAME
    case 'possible_duplicate':
      return card.duplicate ? duplicateTopic(card.duplicate.itemId) : TOPIC_NAME
    case 'disagreement':
      return card.disagreements[0]
        ? disagreementTopic(card.disagreements[0].field)
        : TOPIC_RATINGS
    default:
      return TOPIC_RATINGS
  }
}

function trips(count: number): string {
  if (count === 0) return 'Never packed'
  return `Packed on ${count} ${count === 1 ? 'trip' : 'trips'}`
}

/**
 * What *Keep as is* confirms on a name card.
 *
 * The name AND the fields the suggestion would have moved out of it, because
 * "this name is right" is a statement about the whole arrangement: confirming
 * the name alone would leave the brand and colour still importable, and the
 * next import could reintroduce exactly the repetition Alex just declined to
 * remove. Only fields the row actually has — claiming a confirmed brand on a
 * garment with no brand would be the empty-value stamp `insertItemStatement`
 * already refuses to make.
 */
function nameFields(item: Item): ProvenancedField[] {
  const fields: ProvenancedField[] = ['displayName']
  if (item.brand) fields.push('brand')
  if (item.color) fields.push('color')
  if (item.pattern) fields.push('pattern')
  return fields
}
