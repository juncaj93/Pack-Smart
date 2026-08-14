import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EntrySheet } from '@/components/EntrySheet'
import { Screen } from '@/components/Screen'
import { SwipeRow } from '@/components/SwipeRow'
import { SyncIssues } from '@/components/SyncIssues'
import { CATEGORY_EMOJI } from '@/lib/items'
import { isOffline } from '@/lib/offline'
import { recall, remember } from '@/lib/sessionCache'
import { fetchChecklist } from '@/lib/trips'
import { useViewState } from '@/lib/viewState'
import {
  QUEUE_EVENT,
  REPLAYED_EVENT,
  applyPending,
  patchEntryOrQueue,
  pendingEntryIds,
} from '@/lib/writeQueue'
import { planBags } from '@shared/bags'
import {
  checklistProgress,
  progressLabel,
  rowQuantityLabel,
  type ChecklistEntry,
} from '@shared/checklist'
import { nextBagWithWork, packByBag, type BagGroupKey } from '@shared/pack-by-bag'
import { isPacked } from '@shared/rules'
import type { Trip } from '@shared/trips'
import './PackByBag.css'

/**
 * One bag at a time (P4a).
 *
 * ## What this is, and what it deliberately is not
 *
 * It is the packing list with one cut applied: the bag in front of Alex. It is
 * NOT a second packing list — every row here is a row on `/trips/:id`, ticking
 * one writes the same `packedQty` on the same row through the same
 * `patchEntryOrQueue`, and closing this screen leaves nothing behind. There is
 * no per-bag state, no per-bag persistence and no per-bag progress stored
 * anywhere; the counts are derived from the rows on every render.
 *
 * The grouping itself is `packByBag`, which reads the trip's ONE `planBags`
 * result. So this screen cannot hold a different opinion about where a garment
 * goes than the packing list, the entry sheet or the crowding warning — that
 * was the constraint, and it is met by not having a second planner rather than
 * by keeping two of them in step.
 *
 * ## Why a chooser rather than a wizard
 *
 * Doc 02 asks for one obvious action per screen and no forced sequences. Alex
 * packs the bag that is open, in whatever order the bags happen to be open, so
 * the bags are chips he taps. When a bag is finished — and only then — a quiet
 * offer appears to move to the next one with work left in it. That is the
 * *light sequential progression* in the brief, and it is an offer rather than a
 * step, because the wizard version would be wrong the first time he does the
 * carry-on before the hold.
 */
export default function PackByBag() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const cached = recall<{ trip: Trip; entries: ChecklistEntry[] }>(`bags:${id}`)
  const [trip, setTrip] = useState<Trip | null>(cached?.trip ?? null)
  const [entries, setEntries] = useState<ChecklistEntry[] | null>(cached?.entries ?? null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ChecklistEntry | null>(null)
  const [pending, setPending] = useState<Set<string>>(() => pendingEntryIds())

  /*
   * Which bag he is standing over, kept per trip and across leaving the screen.
   *
   * The same `useViewState` the packing list uses for its search and filter, for
   * the same reason: opening a row's sheet and coming back must come back to the
   * bag he was filling, not to the first one.
   */
  const [chosen, setChosen] = useViewState<BagGroupKey | 'none' | null>(`trip:${id}:bag`, null)

  const load = useCallback(async () => {
    try {
      const result = await fetchChecklist(id)
      // The queue goes over the top of the server's answer, so a bag packed on
      // a plane still reads as packed after the app is reopened (F2).
      const rows = applyPending(result.entries)
      setTrip(result.trip)
      setEntries(rows)
      remember(`bags:${id}`, { trip: result.trip, entries: rows })
      setError(null)
    } catch {
      setError('Could not load that trip.')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

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

  /*
   * The trip's one bag plan, over the UNFILTERED rows.
   *
   * Crowding counts what is in a bag rather than what is on screen, and the
   * safety conflict is about the trip rather than about the bag being looked at
   * — so both are computed from every row, exactly as the packing list does it.
   */
  const bagPlan = useMemo(
    () => (trip && entries ? planBags(trip, entries) : null),
    [trip, entries],
  )

  const groups = useMemo(
    () => (bagPlan && entries ? packByBag(bagPlan, entries) : []),
    [bagPlan, entries],
  )

  /**
   * One tap, the same write the packing list makes.
   *
   * Optimistic and then reconciled from the server's reply, and queued rather
   * than reverted when there is no signal — `packedQty` is an absolute value on
   * one row, so replaying it later cannot reproduce a state Alex has moved past.
   */
  async function togglePacked(entry: ChecklistEntry) {
    if (!entries) return
    const next = isPacked(entry) ? 0 : entry.requiredQty
    const before = entries
    setEntries(entries.map((row) => (row.id === entry.id ? { ...row, packedQty: next } : row)))

    try {
      const saved = await patchEntryOrQueue(entry, { packedQty: next })
      setEntries((current) =>
        (current ?? []).map((row) => (row.id === entry.id ? saved.entry : row)),
      )
      if (saved.queued) setPending(pendingEntryIds())
      setError(null)
    } catch {
      setEntries(before)
      setError(
        isOffline()
          ? 'Not saved — you are offline. Tick it off again once you have signal.'
          : 'That did not save. Try again.',
      )
    }
  }

  if (!trip || !entries) {
    return (
      <Screen title="Pack by bag">
        {error ? (
          <p className="field-error" role="alert">
            Could not load this trip. Check your connection.
          </p>
        ) : (
          <div className="trip-loading" aria-busy="true" aria-label="Loading this trip">
            <div className="skeleton skeleton-progress" />
            <div className="skeleton skeleton-rows" />
          </div>
        )}
      </Screen>
    )
  }

  /*
   * A trip carrying no bags has nothing to pack by.
   *
   * `availableBags` returns none when Alex has said outright that there is no
   * flight and has not named a bag — which is the honest answer, because all
   * three names are aviation words. Rather than invent a suitcase, this says so
   * and points at the one screen where the answer is given.
   */
  if (groups.filter((group) => group.key !== 'unplaced' && group.key !== 'wear').length === 0) {
    return (
      <Screen title="Pack by bag" subtitle={`${trip.emoji} ${trip.name}`}>
        <div className="empty-state">
          <p className="empty-state-title">No bags on this trip yet</p>
          <p className="empty-state-body">
            Say which bags you are taking in Trip setup, and this screen will fill one at a time.
          </p>
          <button type="button" className="button-primary" onClick={() => navigate(`/trips/${id}`)}>
            Back to the packing list
          </button>
        </div>
      </Screen>
    )
  }

  /*
   * Which bag is open, and the two states that are not "a bag".
   *
   * `null` is *he has not chosen yet*, and opens the first bag with work left in
   * it — the honest guess at what he came here to do. `'none'` is *he closed the
   * one that was open*, which is a real answer and leaves every heading on
   * screen as an overview of the whole trip's bags. Collapsing back to the
   * default the moment he closed something would be the screen overruling him.
   */
  const openKey =
    chosen === 'none'
      ? null
      : (groups.find((group) => group.key === chosen)?.key ??
        (groups.find((group) => group.packed < group.total) ?? groups[0]!).key)

  const active = groups.find((group) => group.key === openKey) ?? null
  const next = active ? nextBagWithWork(groups, active.key) : null
  const progress = checklistProgress(entries)

  return (
    <Screen title="Pack by bag" subtitle={`${trip.emoji} ${trip.name}`}>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <SyncIssues />

      {/*
        * The whole trip's progress, above the one bag's.
        *
        * Counted from `checklistProgress` over every row rather than by adding
        * the groups up — a row Alex has set to `Either cabin bag` appears under
        * both cabin bags on purpose, and summing the chips would report it
        * twice. One list, one count.
        */}
      <p className="bags-progress">{progressLabel(progress)}</p>

      {/*
        * What the luggage cannot safely hold, said here as well as on the
        * packing list.
        *
        * The same `bagProblems` result, not a second reading of it. A safety
        * conflict is precisely the thing a bag-by-bag view must not hide:
        * standing over the only bag on the trip is the moment Alex would
        * otherwise put a passport in it.
        */}
      {bagPlan && bagPlan.problems.length > 0 ? (
        <div className="banner-stack" role="status">
          {bagPlan.problems.map((problem) => (
            <p
              key={`${problem.kind}:${problem.message}`}
              className={`banner ${problem.kind === 'no_safe_bag' ? 'banner-alert' : ''}`}
            >
              <span className="banner-text">{problem.message}</span>
            </p>
          ))}
        </div>
      ) : null}

      {/*
        * Every bag as a heading, one of them open.
        *
        * A segmented control was the first shape and it does not fit: four or
        * five bags with a count each is 366px of chips inside a 360px phone, and
        * the mechanical gate caught it. Headings solve the width problem by
        * stacking, and they are better than the chips were anyway — collapsed,
        * the screen is a legible overview of every bag at once, which is a
        * question Alex genuinely has ("is the carry-on done?") and a row of
        * chips could only answer in six characters.
        *
        * Direct selection, never a sequence: he taps the bag that is open on the
        * bed, in whatever order the bags are open. Tapping the open one closes
        * it, which is what leaves the overview on screen.
        */}
      {groups.map((group) => {
        const open = group.key === openKey
        return (
          <section key={group.key} className="bags-section">
            <h2 className="bags-heading-wrap">
              <button
                type="button"
                className="disclosure bags-heading"
                aria-expanded={open}
                onClick={() => setChosen(open ? 'none' : group.key)}
              >
                <span className="bags-heading-name">{group.label}</span>
                <span className="bags-heading-count">
                  {group.packed} of {group.total} packed
                </span>
                <span className="disclosure-mark" aria-hidden="true">
                  {open ? '⌃' : '⌄'}
                </span>
              </button>
            </h2>

            {open ? (
              <div className="reveal">
                {group.hint ? <p className="section-hint">{group.hint}</p> : null}

                {group.entries.length === 0 ? (
                  <p className="hint bags-empty">
                    Nothing goes in here yet. Open a row&apos;s ⋯ to put something in it.
                  </p>
                ) : null}

                <ul className="bags-list row-list">
                  {group.entries.map((entry) => (
                    <li key={entry.id}>
                      <SwipeRow
                        actionGlyph="✓"
                        actionLabel="Pack"
                        completed={isPacked(entry)}
                        onComplete={() => void togglePacked(entry)}
                        className={isPacked(entry) ? 'is-packed-row' : ''}
                      >
                        <div className={`check-row ${isPacked(entry) ? 'is-packed' : ''}`}>
                          <button
                            type="button"
                            className="check-main"
                            onClick={() => void togglePacked(entry)}
                            aria-pressed={isPacked(entry)}
                            aria-labelledby={`bags-name-${entry.id}`}
                            aria-describedby={
                              rowQuantityLabel(entry) ? `bags-qty-${entry.id}` : undefined
                            }
                          >
                            <span
                              className={`check-box ${isPacked(entry) ? 'is-on' : ''}`}
                              aria-hidden="true"
                            >
                              {isPacked(entry) ? '✓' : ''}
                            </span>
                            <span className="check-text">
                              <span className="check-name" id={`bags-name-${entry.id}`}>
                                {CATEGORY_EMOJI[entry.category] ? (
                                  <span className="check-emoji" aria-hidden="true">
                                    {CATEGORY_EMOJI[entry.category]}
                                  </span>
                                ) : null}
                                <span className="check-name-text">{entry.name}</span>
                                {entry.isCritical ? (
                                  <span className="check-critical">
                                    <span className="visually-hidden">, </span>
                                    Essential
                                  </span>
                                ) : null}
                              </span>
                              {pending.has(entry.id) ? (
                                <span className="check-pending">Saved on this phone</span>
                              ) : null}
                            </span>

                            {rowQuantityLabel(entry) ? (
                              <span className="check-qty" id={`bags-qty-${entry.id}`}>
                                {rowQuantityLabel(entry)}
                              </span>
                            ) : null}
                          </button>

                          <button
                            type="button"
                            className="check-more"
                            onClick={() => setDetail(entry)}
                            aria-label={`Options for ${entry.name}`}
                          >
                            ⋯
                          </button>
                        </div>
                      </SwipeRow>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        )
      })}

      {/*
        * The offer, only once this bag is done and only while another has work.
        *
        * Not a step counter and not a "3 of 4 bags" banner: Alex chose this bag
        * and may well choose the next one himself. This saves a tap when he has
        * finished one and there is an obvious next.
        */}
      {active && active.total > 0 && active.packed === active.total && next ? (
        <button
          type="button"
          className="button-primary bags-next"
          onClick={() => setChosen(next.key)}
        >
          {active.label} is done · next, {next.label}
        </button>
      ) : null}

      <button
        type="button"
        className="button-secondary bags-list-link"
        onClick={() => navigate(`/trips/${id}`)}
      >
        Full packing list
      </button>

      {/*
        * The same sheet the packing list opens, so where a thing goes is
        * changed in one place in the product rather than two. Nothing about the
        * bag lives on this screen: the sheet writes `bag` and `bag_source` on
        * the row, the plan is recomputed from it, and the row moves group.
        */}
      <EntrySheet
        open={detail !== null}
        tripId={id}
        entry={detail}
        bagContext={bagPlan?.context}
        resolution={detail ? bagPlan?.advice.get(detail.id) : undefined}
        onClose={() => setDetail(null)}
        onChanged={(entry) => {
          setEntries((current) =>
            (current ?? []).map((row) => (row.id === entry.id ? entry : row)),
          )
          setDetail((current) => (current?.id === entry.id ? entry : current))
        }}
        onExcluded={(entry) => {
          setEntries((current) =>
            (current ?? []).map((row) => (row.id === entry.id ? entry : row)),
          )
        }}
      />
    </Screen>
  )
}
