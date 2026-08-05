import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Screen } from '@/components/Screen'
import { SwipeRow } from '@/components/SwipeRow'
import { CATEGORY_EMOJI } from '@/lib/items'
import { recall, remember } from '@/lib/sessionCache'
import { fetchChecklist } from '@/lib/trips'
import { SyncIssues } from '@/components/SyncIssues'
import {
  QUEUE_EVENT,
  REPLAYED_EVENT,
  applyPending,
  patchEntryOrQueue,
  pendingEntryIds,
} from '@/lib/writeQueue'
import { BAG_SENTENCE, BAG_SHORT, bagFor, type ChecklistEntry } from '@shared/checklist'
import { dayOfPlan, type DayOfPlan } from '@shared/day-of'
import { isPacked } from '@shared/rules'
import { formatDateRange } from '@/routes/Trips'
import type { Trip } from '@shared/trips'
import './DayOf.css'

/**
 * The morning you leave (doc 09 §12).
 *
 * Everything else in Pack Smart answers "what am I taking". This answers a much
 * narrower question, asked in a hallway with a coat half on: **what is still
 * not in the bag, and what do I put on.**
 *
 * So it is deliberately not the packing list with a filter over it. A filter
 * still leaves Alex a forty-row screen to read, and the point of a departure
 * view is that there is almost nothing to read — three short sections in the
 * order he will act on them, and then it is empty.
 *
 * Every row comes from something he or the rules already recorded: the packing
 * timing, the final-check flag, the bag, the essential flag. Nothing is
 * inferred from a name, and no row appears here that is not on the packing list.
 */

interface SectionSpec {
  key: keyof Pick<DayOfPlan, 'wear' | 'grab' | 'confirm'>
  title: string
  hint: string
  /** What the tick means in this section, for the swipe label and the button. */
  action: string
}

const SECTIONS: SectionSpec[] = [
  {
    key: 'wear',
    title: 'Wearing it',
    hint: 'Put these on rather than packing them.',
    action: 'Wearing',
  },
  {
    key: 'grab',
    title: 'Grab these now',
    /*
     * Two reasons a thing is legitimately still out on the morning — it is in
     * use until he leaves, or it needs a final look and is not in the bag at
     * all — so the hint states the fact they share rather than one of the two
     * stories. "Still out because you have been using them" is untrue of half
     * of them.
     */
    hint: 'Not in the bag yet.',
    action: 'Packed',
  },
  {
    key: 'confirm',
    title: 'Check it is really in there',
    hint: 'Packed a while ago. Worth a look before the door.',
    action: 'Checked',
  },
]

export default function DayOf() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const cached = recall<{ trip: Trip; entries: ChecklistEntry[] }>(`day-of:${id}`)
  const [trip, setTrip] = useState<Trip | null>(cached?.trip ?? null)
  const [entries, setEntries] = useState<ChecklistEntry[] | null>(cached?.entries ?? null)
  const [error, setError] = useState(false)
  /** Rows whose last tick is still on this phone only (F2). */
  const [pending, setPending] = useState<Set<string>>(() => pendingEntryIds())

  const load = useCallback(async () => {
    try {
      const result = await fetchChecklist(id)
      // Offline this response is the service worker's copy, taken before Alex
      // started ticking. The queue is laid over it so the morning he leaves
      // does not show last night's state (F2).
      const entries = applyPending(result.entries)
      setTrip(result.trip)
      setEntries(entries)
      remember(`day-of:${id}`, { trip: result.trip, entries })
      setError(false)
    } catch {
      setError(true)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  // The queue drained, so the rows are worth refetching — and the pending
  // markers are worth recomputing whenever it changes at all (F2).
  useEffect(() => {
    const onReplayed = () => void load()
    const onQueueChanged = () => setPending(pendingEntryIds())
    window.addEventListener(REPLAYED_EVENT, onReplayed)
    window.addEventListener(QUEUE_EVENT, onQueueChanged)
    return () => {
      window.removeEventListener(REPLAYED_EVENT, onReplayed)
      window.removeEventListener(QUEUE_EVENT, onQueueChanged)
    }
  }, [load])

  /**
   * Ticking a row, whichever section it is in.
   *
   * `confirm` is a different column from the other two — packed and
   * *confirmed packed* are separate facts, which is the whole reason
   * `requires_final_check` exists — so this is one function with two writes
   * rather than two functions that would drift.
   *
   * Optimistic, and reconciled from the server's answer. A tick on departure
   * morning that waits for a round trip before it moves is a tick Alex taps
   * twice.
   */
  async function tick(entry: ChecklistEntry, section: SectionSpec['key']) {
    if (!entries) return

    const patch =
      section === 'confirm'
        ? { finalChecked: entry.finalCheckedAt === null }
        : { packedQty: isPacked(entry) ? 0 : entry.requiredQty }

    const optimistic = entries.map((row) =>
      row.id === entry.id
        ? {
            ...row,
            ...(section === 'confirm'
              ? { finalCheckedAt: entry.finalCheckedAt === null ? Date.now() : null }
              : { packedQty: patch.packedQty as number }),
          }
        : row,
    )
    setEntries(optimistic)

    try {
      /*
       * Offline the tick STAYS (F2).
       *
       * Both writes here are absolute values on one row, so a change made in a
       * taxi with no signal replays safely once there is some. Reverting it
       * was the more dangerous behaviour on this screen of all of them: the
       * whole point of `Before you go` is that an empty section means nothing
       * is left, and a tick that sprang back makes it say the opposite.
       */
      const saved = await patchEntryOrQueue(entry, patch)
      setEntries((current) =>
        (current ?? []).map((row) => (row.id === entry.id ? saved.entry : row)),
      )
      if (saved.queued) setPending(pendingEntryIds())
    } catch {
      // Put it back. A row that silently stays ticked after a failed save is
      // how something gets left behind.
      setEntries(entries)
      setError(true)
    }
  }

  if (!entries || !trip) {
    return (
      <Screen title="Before you go">
        {error ? (
          <p className="field-error" role="alert">
            Could not load this trip. Check your connection.
          </p>
        ) : null}
      </Screen>
    )
  }

  const plan = dayOfPlan(entries)
  const sections = SECTIONS.map((spec) => {
    const rows = plan[spec.key]
    /*
     * The bag, said once, when every row in the section shares it.
     *
     * The first version put it on every row and half the screen read
     * "Personal item · Personal item · Personal item". That is UX-04 again —
     * the packing list already learned that a tag on every row in a section
     * distinguishes nothing — and it matters more here, where the point of the
     * screen is that there is almost nothing to read.
     *
     * When they genuinely differ the chips come back, because then the chip is
     * the answer to "which bag does THIS one go in".
     */
    const bags = new Set(rows.map((entry) => bagFor(entry).bag ?? ''))
    const sharedBag = bags.size === 1 ? (rows[0] ? bagFor(rows[0]).bag : null) : null
    return { spec, rows, sharedBag }
  }).filter((section) => section.rows.length > 0)

  return (
    <Screen
      title="Before you go"
      subtitle={`${trip.emoji} ${trip.name} · ${formatDateRange(trip.startDate, trip.endDate)}`}
    >
      {error ? (
        <p className="field-error" role="alert">
          That did not save. Check your connection and try again.
        </p>
      ) : null}

      {/* Silent unless a queued tick genuinely needs Alex (F2). */}
      <SyncIssues />

      {/*
        * One sentence, and it is the answer to the only question being asked.
        *
        * `role="status"` rather than a heading: the number changes as Alex ticks
        * rows, and it is the change that is worth announcing.
        */}
      <p className="dayof-count" role="status">
        {plan.remaining === 0
          ? 'Nothing left. Have a good trip.'
          : `${plan.remaining} ${plan.remaining === 1 ? 'thing' : 'things'} left before you leave.`}
      </p>

      {sections.map(({ spec, rows, sharedBag }) => (
        <section key={spec.key} className="dayof-section">
          <h2 className="section-heading">{spec.title}</h2>
          <p className="section-hint">
            {spec.hint}
            {sharedBag && spec.key !== 'wear' ? ` All of it goes in your ${BAG_SENTENCE[sharedBag]}.` : ''}
          </p>

          <ul className="dayof-list row-list">
            {rows.map((entry) => {
              const done = spec.key === 'confirm' ? entry.finalCheckedAt !== null : isPacked(entry)
              const bag = bagFor(entry).bag

              return (
                <li key={entry.id}>
                  <SwipeRow
                    actionGlyph="✓"
                    actionLabel={spec.action}
                    completed={done}
                    onComplete={() => void tick(entry, spec.key)}
                    className={done ? 'is-packed-row' : ''}
                  >
                    {/*
                      * No ⋯ and no left-swipe tray, which every other list in
                      * the app has.
                      *
                      * Quantities, timing, bags and Not bringing are packing-
                      * night decisions. On the morning the only verb is tick,
                      * and a row that offers four other things to do is four
                      * things to think about in the one place there is no time
                      * to think. The packing list is one tap away and still has
                      * all of it.
                      */}
                    <button
                      type="button"
                      className={`dayof-row ${done ? 'is-done' : ''}`}
                      onClick={() => void tick(entry, spec.key)}
                      aria-pressed={done}
                      aria-labelledby={`dayof-name-${spec.key}-${entry.id}`}
                    >
                      <span className={`check-box ${done ? 'is-on' : ''}`} aria-hidden="true">
                        {done ? '✓' : ''}
                      </span>
                      <span className="dayof-text">
                        <span className="dayof-name" id={`dayof-name-${spec.key}-${entry.id}`}>
                          {CATEGORY_EMOJI[entry.category] ? (
                            <span className="dayof-emoji" aria-hidden="true">
                              {CATEGORY_EMOJI[entry.category]}
                            </span>
                          ) : null}
                          {entry.name}
                          {entry.requiredQty > 1 ? (
                            <span className="dayof-qty"> ×{entry.requiredQty}</span>
                          ) : null}
                        </span>
                        {/*
                          * Where it goes, on every row that has an answer —
                          * including a recommendation.
                          *
                          * The packing list deliberately shows only Alex's OWN
                          * bag choices, because a suggestion beside half of
                          * forty rows says nothing. Here the list is short and
                          * the question is literally "where does this go", so
                          * the recommendation is the useful half.
                          */}
                        {bag && !sharedBag && spec.key !== 'wear' ? (
                          <span className="dayof-bag">{BAG_SHORT[bag]}</span>
                        ) : null}
                        {/* Words, not a colour — the same statement the packing
                          * list makes, for the same reason (F2). */}
                        {pending.has(entry.id) ? (
                          <span className="dayof-pending">Saved on this phone</span>
                        ) : null}
                      </span>
                    </button>
                  </SwipeRow>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {/*
        * Everything else that is not packed, as a count rather than as rows.
        *
        * §12 is explicit that this screen is not the packing list again. But
        * "nothing left before you leave" while nine things are still unpacked
        * would be the confident-and-wrong answer, so the number is here and the
        * essentials among them are named — "9 things still to pack" and "9
        * things still to pack, one of which is your medication" are different
        * sentences and only one of them is worth reading at the door.
        */}
      {plan.outstanding.total > 0 ? (
        <section className="dayof-section dayof-rest">
          <h2 className="section-heading">Not packed yet</h2>
          <p className="dayof-rest-line">
            {plan.outstanding.total}{' '}
            {plan.outstanding.total === 1 ? 'other thing is' : 'other things are'} still on the
            packing list.
          </p>
          {plan.outstanding.essentials.length > 0 ? (
            <p className="dayof-rest-essentials">
              Including{' '}
              {plan.outstanding.essentials.map((entry) => entry.name).join(', ')}.
            </p>
          ) : null}
        </section>
      ) : null}

      <button
        type="button"
        className="button-secondary dayof-list-link"
        onClick={() => navigate(`/trips/${id}`)}
      >
        Full packing list
      </button>
    </Screen>
  )
}
