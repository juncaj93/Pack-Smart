import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DressinessContexts } from '@/components/DressinessContexts'
import { RatingChoice } from '@/components/RatingChoice'
import { EmptyState, Screen } from '@/components/Screen'
import { UndoBar, useUndoOffer } from '@/components/UndoBar'
import { restoreItem } from '@/lib/items'
import { useOptimisticWrite } from '@/lib/optimistic'
import {
  archiveDuplicate,
  confirmItemFields,
  fetchReviewQueue,
  patchItemFields,
  patchItemTraits,
  recordReviewDecision,
  reopenNotSure,
  revertItemField,
  type ReviewCard,
  type ReviewQueue,
} from '@/lib/closetReview'
import {
  TOPIC_NAME,
  TOPIC_RATINGS,
  bagTopic,
  disagreementTopic,
  duplicateTopic,
  sourceLabel,
  type ReviewDecision,
} from '@shared/closet-review'
import type { BagAnswer, BagQuestion } from '@shared/bag-questions'
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
  const undo = useUndoOffer()

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

  /**
   * A bag answer, saved on the tap and gone from the card immediately.
   *
   * The question disappears because it stops QUALIFYING, not because the screen
   * hides it: the trait is no longer null, so `unanswered` is false and the gate
   * would not ask again. Removing it locally is the same conclusion reached
   * without a round trip, and the rollback puts the question back rather than
   * merely restoring a value — a question whose answer failed to save is a
   * question that has not been answered.
   */
  function answerBag(entry: ReviewCard, question: BagQuestion, answer: BagAnswer) {
    const item = entry.item
    setError(null)

    write(`${item.id}:bag:${question.key}`, {
      apply: () => dropBagQuestion(item.id, question.key),
      persist: () => patchItemTraits(item.id, answer.traits),
      settle: (result) => patchCard(item.id, () => result.item),
      rollback: () => restoreBagQuestion(item.id, question),
      onError: () => setError('Could not save that answer.'),
    })
  }

  /**
   * *Not sure* about ONE bag question, rather than about the card.
   *
   * The card-level *Not sure* withdraws whatever `topicOf` says the card is
   * about. A card carrying two bag questions is about both, and answering one
   * of them "I do not know" must not retire the other — so each question
   * carries its own, on its own topic.
   */
  function unsureAboutBag(entry: ReviewCard, question: BagQuestion) {
    const item = entry.item
    setError(null)

    write(`${item.id}:bag:${question.key}`, {
      apply: () => dropBagQuestion(item.id, question.key),
      persist: () => recordReviewDecision(item.id, bagTopic(question.key), 'not_sure'),
      rollback: () => restoreBagQuestion(item.id, question),
      onError: () => setError('Could not save that.'),
    })
  }

  const dropBagQuestion = useCallback((itemId: string, key: string) => {
    setQueue((current) =>
      current === null
        ? current
        : {
            ...current,
            cards: current.cards.map((entry) =>
              entry.item.id === itemId
                ? { ...entry, bagQuestions: entry.bagQuestions.filter((q) => q.key !== key) }
                : entry,
            ),
          },
    )
  }, [])

  const restoreBagQuestion = useCallback((itemId: string, question: BagQuestion) => {
    setQueue((current) =>
      current === null
        ? current
        : {
            ...current,
            cards: current.cards.map((entry) =>
              entry.item.id === itemId && !entry.bagQuestions.some((q) => q.key === question.key)
                ? { ...entry, bagQuestions: [...entry.bagQuestions, question] }
                : entry,
            ),
          },
    )
  }, [])

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
   * The card before this one — and it is BACK, not undo.
   *
   * The distinction is the whole design. Every answer on this screen is written
   * the moment it is tapped, which is why the primary action says *Next* rather
   * than *Save*; so stepping backwards must show Alex what he saved, not take it
   * away. He gets the previous garment with his rating on it, and can change it
   * or leave it.
   *
   * A local index change, with no fetch. `patchCard` has already put every
   * answer into the queue in memory, so the previous card is correct without
   * asking the server — and asking would be worse than pointless: a reload could
   * reorder the queue underneath him, which is the one thing going back must not
   * do.
   *
   * Available from the finished screen too. Running past the last card is how
   * that screen is reached, so "I have just answered that, take me back" is
   * exactly the moment this is for.
   */
  function back() {
    setError(null)
    setEditing(null)
    setIndex((current) => Math.max(0, current - 1))
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
  /**
   * The one mutation key both halves of the duplicate decision use.
   *
   * Stated once rather than typed twice, because the whole correctness argument
   * for the Undo is that it shares the archive's ticket — and two string
   * literals that must match are two string literals that eventually will not.
   */
  function duplicateKey(entry: ReviewCard) {
    return `${entry.item.id}:duplicate`
  }

  function keepThisOne(entry: ReviewCard, keepId: string, archiveId: string) {
    setError(null)

    write(duplicateKey(entry), {
      apply: () => {
        clearDuplicate(entry.item.id)
        if (archiveId === entry.item.id) dropCard(entry.item.id)
      },
      persist: () => archiveDuplicate(keepId, archiveId),
      rollback: () => void load(),
      onError: () => setError('Could not archive that.'),
    })

    /*
     * The way back, offered where the mistake happens.
     *
     * The card already says the copy can be restored from My Stuff, and that
     * remains true for an archive Alex finds a week later. This is for the other
     * case — the tap he did not mean, ten seconds ago — where sending him to
     * another screen to fix it is the dead end doc 02 §2 prefers undo over.
     *
     * It does not claim a merge was undone, because none happened.
     */
    undo.offer({
      message: 'Other copy hidden from My Stuff',
      undo: async () => {
        await new Promise<void>((resolve) => {
          /*
           * The SAME key as the archive it reverses, which is what makes this
           * safe rather than merely quick.
           *
           * `useOptimisticWrite` keeps one ticket per key and only lets the
           * newest edit settle or roll back. So a late reply from the archive
           * cannot re-hide the copy after this restore, and a late FAILURE from
           * the archive cannot roll this restore back — the archive is no longer
           * current the moment the restore is issued. A separate key would give
           * the two writes independent timelines and let the loser win.
           */
          write(duplicateKey(entry), {
            apply: () => {},
            persist: () => restoreItem(archiveId),
            settle: () => {
              void load()
              resolve()
            },
            rollback: () => resolve(),
            onError: () => setError('Could not put that back.'),
          })
        })
      },
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
        {/*
          * The way back from the last card, and the case that motivated all of
          * this: he answers the final garment, the screen becomes a summary,
          * and the thing he wanted to change is one tap behind a wall.
          */}
        {index > 0 ? (
          <div className="review-position">
            <button type="button" className="review-back" onClick={back}>
              Back to the last one
            </button>
          </div>
        ) : null}
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
      <div className="review-position">
        {/*
          * Back sits with the position rather than in the sticky action row.
          *
          * That row is the three forward answers — Next, Skip, Not sure — and
          * doc 06 §2 asks for one obvious primary action; a fourth button
          * beside them at 390px both crowds the row and competes with Next for
          * the thumb. Up here it reads as navigation, which is what it is, and
          * it is out of the way of the answer Alex actually came to give.
          */}
        {index > 0 ? (
          <button type="button" className="review-back" onClick={back}>
            Back
          </button>
        ) : null}
        <p className="review-progress" aria-live="polite">
          {index + 1} of {cards.length}
        </p>
      </div>

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
        {/*
          * The bag questions, above the ratings.
          *
          * They are first because they are the only questions on this screen
          * whose answer Pack Smart is about to ACT on — the gate that produced
          * them simulated every answer against a trip Alex has not taken yet
          * and found they land in different bags. A comfort rating improves a
          * future ranking; this one changes a list he is looking at.
          */}
        {card.bagQuestions.map((question) => (
          <section className="review-block review-bag" key={question.key}>
            <h3 className="review-block-title">{question.prompt}</h3>
            {/*
              * The hint, unless the card already said exactly this.
              *
              * A `bag_question` card takes its reason line FROM its first
              * question, so rendering both put the same sentence on screen
              * twice, stacked — which is how it looked on a phone, and it read
              * as a bug rather than as emphasis. The second question keeps its
              * own hint, because that one genuinely says something new.
              */}
            {question.because === card.why ? null : (
              <p className="review-block-hint">{question.because}</p>
            )}
            <div className="review-bag-answers">
              {question.answers.map((answer) => (
                <button
                  key={answer.label}
                  type="button"
                  className="button-secondary"
                  /*
                   * Three cards can be on screen across a session, each with a
                   * "Yes". The accessible name carries the question so a
                   * control list is navigable, while the visible label stays
                   * one word — WCAG 2.5.3's way round, since the name contains
                   * the label.
                   */
                  aria-label={`${answer.label} — ${question.prompt}`}
                  onClick={() => answerBag(card, question, answer)}
                >
                  {answer.label}
                </button>
              ))}
              <button
                type="button"
                className="button-secondary"
                aria-label={`Not sure — ${question.prompt}`}
                onClick={() => unsureAboutBag(card, question)}
              >
                Not sure
              </button>
            </div>
          </section>
        ))}

        {card.asks.includes('comfort') ? (
          <RatingChoice
            id="review-comfort"
            compact
            label="Comfort"
            value={item.comfort}
            labels={COMFORT_LABELS}
            onChange={(value) => rate(item, 'comfort', value)}
          />
        ) : null}

        {card.asks.includes('versatility') ? (
          <RatingChoice
            id="review-versatility"
            compact
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
            compact
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
              * The sentence that keeps this honest.
              *
              * Nothing here merges two records — that is H1e and it is deferred
              * until preserving packing history, outfit history, checklist
              * references, provenance, ratings, learning evidence and archive
              * state is PROVEN. So the copy says what actually happens, in the
              * order Alex needs it: one is hidden, history is untouched, and it
              * can be undone. The action is named `Keep this one` rather than
              * `Same item` for the same reason — "same item" is what a merge
              * would be called.
              */}
            <p className="review-block-hint">
              Keeping one hides the other from your active closet. Past trips and history stay
              unchanged, and you can restore it from My Stuff at any time.
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
      <UndoBar offer={undo} />

      <div className="review-actions">
        <button type="button" className="button-primary" onClick={next}>
          Next
        </button>
        <div className="review-actions-row">
          <button
            type="button"
            className="button-secondary"
            onClick={() => decide(card, 'skipped')}
          >
            Skip
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => decide(card, 'not_sure')}
          >
            Not sure
          </button>
          {/*
            * "Finish", not "Finish for now" — three across 390px, and the long
            * form wraps to two lines and drags the whole sticky row taller.
            *
            * The accessible name keeps the full phrase, which is the way round
            * WCAG 2.5.3 requires: the name must CONTAIN the visible label, so
            * "Finish for now" containing "Finish" is fine and the reverse would
            * not be. Anyone driving this by voice can still say either.
            */}
          <button
            type="button"
            className="button-secondary"
            aria-label="Finish for now"
            onClick={() => navigate('/my-stuff')}
          >
            Finish
          </button>
        </div>
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
    /*
     * Skip on a bag card is "not this card", so it records against the FIRST
     * question rather than all of them — which is what skip already means
     * everywhere else here: the card moves to the back, nothing is withdrawn,
     * and every question on it is still asked when it comes round again.
     */
    case 'bag_question':
      return card.bagQuestions[0] ? bagTopic(card.bagQuestions[0].key) : TOPIC_RATINGS
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
