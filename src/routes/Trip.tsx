import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EntrySheet } from '@/components/EntrySheet'
import { LastLookSheet } from '@/components/LastLookSheet'
import { Screen } from '@/components/Screen'
import { SwipeRow, type SwipeAction } from '@/components/SwipeRow'
import { SwapSheet, type SwapTarget } from '@/components/SwapSheet'
import { TripSheet } from '@/components/TripSheet'
import { CATEGORY_EMOJI } from '@/lib/items'
import {
  addTripOnlyItem,
  archiveTrip as archiveTripApi,
  deleteTrip as deleteTripApi,
  excludeEntry,
  fetchChecklist,
  fetchOutfits,
  updateTrip,
  fetchWeather,
  restoreEntry,
  restoreTrip as restoreTripApi,
  type AffectedOutfit,
  type OutfitConflict,
  type TripWeather,
} from '@/lib/trips'
import { joinNames } from '@shared/outfits'
import { daysBetween, readiness, todayISO } from '@shared/readiness'
import { routeFor } from '@/lib/readinessRoute'
import { TripQuestion } from '@/components/TripQuestion'
import { formatDateRange } from '@/routes/Trips'
import {
  CHECKLIST_FILTERS,
  SECTION_HINTS,
  SECTION_LABELS,
  applyOrder,
  checklistProgress,
  filterChecklist,
  groupChecklist,
  orderSection,
  outstandingEssentialsLine,
  rowSecondaryParts,
  type ChecklistEntry,
  type ChecklistFilter,
} from '@shared/checklist'
import { isOffline } from '@/lib/offline'
import { SyncIssues } from '@/components/SyncIssues'
import {
  QUEUE_EVENT,
  REPLAYED_EVENT,
  applyPending,
  patchEntryOrQueue,
  pendingEntryIds,
} from '@/lib/writeQueue'
import type { CoverageGap } from '@shared/essentials'
import { dayOfPlan, isDepartureImminent } from '@shared/day-of'
import { isPacked } from '@shared/rules'
import { tripDays, type Trip as TripModel } from '@shared/trips'
import './Trip.css'

interface Undoable {
  message: string
  undo: () => Promise<void>
  /**
   * The slot a removed garment has left empty, when an approved outfit was using
   * it (doc 04 §8: offer to replace it). Absent for everything else, which is
   * most of the list.
   */
  replace?: SwapTarget
}

/**
 * The weather, or an honest account of why there is none.
 *
 * Reads what is stored rather than fetching, so it works offline and costs
 * nothing on a screen Alex opens constantly. The fetch happens when outfits are
 * planned, which is the moment the forecast actually changes a decision.
 *
 * Renders nothing at all when there is no forecast AND nothing useful to say
 * about why — an empty weather box on every trip would be noise.
 */
/**
 * How long the list waits before it reorders.
 *
 * Long enough that a run of adjacent items checked quickly settles once, at the
 * end; short enough that it still feels like a consequence of what Alex did
 * rather than something the screen decided later on its own. Restarted by every
 * change, so the clock measures quiet, not elapsed time.
 */
const SETTLE_MS = 900

function TripWeatherLine({ tripId }: { tripId: string }) {
  const [weather, setWeather] = useState<TripWeather | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchWeather(tripId)
      .then((result) => {
        if (!cancelled) setWeather(result)
      })
      .catch(() => {
        // Offline, or the trip has no weather. Neither is worth a message here.
      })
    return () => {
      cancelled = true
    }
  }, [tripId])

  if (!weather) return null
  if (weather.summary) return <p className="trip-weather">{weather.summary}</p>
  if (weather.status === 'too_far_out') return <p className="trip-weather is-quiet">{weather.note}</p>
  return null
}

export default function Trip() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const [trip, setTrip] = useState<TripModel | null>(null)
  const [entries, setEntries] = useState<ChecklistEntry[]>([])

  /**
   * The order Alex is currently looking at, by row id, **per section**.
   *
   * Per section rather than one flat list because a row that needs a final check
   * appears in TWO of them — `groupChecklist` puts a passport under Pack later
   * and under Final check — so one list gives it two positions, and whichever
   * came last silently won for both. It made a packed row sort into the middle
   * of Pack now instead of the bottom, which the e2e test caught.
   *
   * Empty lists mean "no snapshot yet", and `applyOrder` then computes the real
   * order — which is what happens on first load.
   */
  const [settledOrder, setSettledOrder] = useState<Record<string, string[]>>({})
  /*
   * What this trip knows it is not covering (doc 02 §9c).
   *
   * Separate from `criticalOutstanding`: that reports rows that exist and are
   * unpacked, this reports essentials no rule will ever place and universal ones
   * missing entirely. The second is the failure that used to be silent.
   */
  const [coverage, setCoverage] = useState<CoverageGap[]>([])
  /*
   * Approved outfits standing on a garment this trip is not bringing (doc 04 §8).
   *
   * Stays on screen until it is resolved, unlike the undo bar that announced it.
   * A conflict that only ever appeared for six seconds is one Alex can be left
   * holding without knowing.
   */
  const [conflicts, setConflicts] = useState<OutfitConflict[]>([])
  /*
   * The outfit groups, fetched for readiness rather than for display.
   *
   * `readiness()` cannot answer "review two outfits" without them, and Home
   * already fetches them for the same reason. Letting this screen guess instead
   * is precisely how the two would come to disagree about one trip.
   */
  const [outfitGroups, setOutfitGroups] = useState<Array<{ status: 'draft' | 'approved' | 'incomplete' }>>([])
  /*
   * Questions deferred in this sitting, by fact.
   *
   * Deliberately NOT stored. Doc 09 §5 asks for deferrable, not dismissible:
   * the trip still does not know the answer, so the question is still worth
   * asking next time. Persisting "he said not now" would be a stored preference
   * Alex never expressed, and the sort of thing that quietly stops the app ever
   * asking again.
   */
  const [deferred, setDeferred] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [editing, setEditing] = useState(false)
  const [detail, setDetail] = useState<ChecklistEntry | null>(null)
  const [showFacts, setShowFacts] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [lastLook, setLastLook] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ChecklistFilter>('all')
  const [undoable, setUndoable] = useState<Undoable | null>(null)
  const [swapping, setSwapping] = useState<SwapTarget | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busyAnswer, setBusyAnswer] = useState(false)
  /** Rows whose last change is still on this phone only (F2). */
  const [pending, setPending] = useState<Set<string>>(() => pendingEntryIds())
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await fetchChecklist(id)
      setTrip(result.trip)
      /*
       * The queue goes over the top of what the server said (F2).
       *
       * Offline this response comes from the service worker's cache, which is
       * the list as it was BEFORE Alex started packing on the plane — so
       * without the overlay, closing the app and opening it again would show
       * every tick he made undone. Applied here rather than at render, so the
       * ordering snapshot and the progress count see the same list he does.
       */
      setEntries(applyPending(result.entries))
      setCoverage(result.coverage ?? [])
      setConflicts(result.conflicts ?? [])
      // Never fatal: a trip whose outfits cannot be read is still a packing
      // list, and readiness treats "no groups" as "no outfit work", which is
      // the safe reading rather than an invented one.
      setOutfitGroups((await fetchOutfits(id).catch(() => ({ groups: [] }))).groups)
      setError(null)
    } catch {
      setError('Could not load that trip.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  /*
   * Once the queue has drained, the list is refetched from the server (F2).
   *
   * The optimistic rows are already right, so this is not about the ticks — it
   * is about everything derived from them that only the server knows: the
   * conflicts an approved outfit now has, the coverage gaps, and the row
   * versions the next conditional write will be made against.
   */
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

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
  }, [])

  /**
   * Writes an answer through the same endpoint the trip sheet uses.
   *
   * Not a narrower "answer this fact" route, deliberately: `updateTrip` already
   * regenerates the checklist, so an answer given here has exactly the effect an
   * answer given in the sheet has. A second write path is how two answers to one
   * question come to mean different things.
   */
  async function answerQuestion(fact: string, value: boolean | number) {
    if (!trip || busyAnswer) return
    setBusyAnswer(true)
    try {
      await updateTrip(trip.id, {
        name: trip.name,
        startDate: trip.startDate,
        endDate: trip.endDate,
        emoji: trip.emoji,
        destinations: trip.destinations.map((d) => ({ name: d.name, country: d.country })),
        activities: trip.activities,
        notes: trip.notes,
        luggageMode: trip.luggageMode as 'carry_on' | 'checked' | 'unknown' | null,
        laundryAvailable: fact === 'laundry_available' ? Boolean(value) : trip.laundryAvailable,
        maxDressiness: trip.maxDressiness,
        flightHours: fact === 'flight_hours' ? Number(value) : trip.flightHours,
        international: fact === 'international' ? Boolean(value) : trip.international,
      })
      await load()
    } catch {
      setError('Could not save that answer.')
    } finally {
      setBusyAnswer(false)
    }
  }

  function replace(entry: ChecklistEntry) {
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? entry : e)))
  }

  /*
   * Take a fresh snapshot of the order once the tapping stops.
   *
   * The timer restarts on every change, so a run of adjacent items checked
   * quickly settles ONCE, at the end — which is the §4.2 requirement that
   * matters most, because that run is exactly when row-jumping is worst.
   *
   * Keyed on the packed state of every row rather than on `entries` itself: a
   * quantity edit or a rename is not a reason to reorder, and re-running this
   * for one would move rows for something that did not change their position.
   */
  const packedShape = entries
    .map((entry) => `${entry.id}:${isPacked(entry) ? 1 : 0}:${entry.excludedAt ? 1 : 0}`)
    .join(',')

  const hasSnapshot = settledOrder.packNow !== undefined

  useEffect(() => {
    if (entries.length === 0) return

    const take = () => {
      const grouped = groupChecklist(entries)
      setSettledOrder({
        packNow: orderSection(grouped.packNow).map((entry) => entry.id),
        packLater: orderSection(grouped.packLater).map((entry) => entry.id),
        finalCheck: orderSection(grouped.finalCheck).map((entry) => entry.id),
      })
    }

    /*
     * The FIRST order is taken immediately; only later ones wait.
     *
     * Deferring the first one leaves a window — the whole of `SETTLE_MS` after
     * the list loads — with no snapshot to hold, and in that window the fallback
     * order applies live, so a row tapped straight away jumps exactly as it
     * would have without any of this. The e2e test found it by tapping faster
     * than the timer, which is what Alex does when he already knows what he is
     * looking for.
     *
     * There is nothing to steady on first load anyway: no row is under a thumb
     * yet, and the list should arrive in the right order rather than settle into
     * it a second later.
     */
    if (!hasSnapshot) {
      take()
      return
    }

    const settle = setTimeout(take, SETTLE_MS)
    return () => clearTimeout(settle)
    // `packedShape` is the dependency that matters; `entries` is read inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packedShape, hasSnapshot])

  /**
   * Undo instead of "are you sure?".
   *
   * Doc 02 §2 prefers undo over confirmation dialogs. A confirm step taxes every
   * correct action to protect against the rare wrong one; undo taxes only the
   * mistake.
   */
  function offerUndo(message: string, undo: () => Promise<void>, replace?: SwapTarget) {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoable({ message, undo, replace })
    undoTimer.current = setTimeout(() => setUndoable(null), 6000)
  }

  function dismissUndo() {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoable(null)
  }

  /**
   * One tap on a row: everything in, or everything back out.
   *
   * Offline this now STAYS ticked (F2). `packedQty` is an absolute value on one
   * row, so a change made on a plane can be replayed at the gate without any
   * risk of reproducing a sequence Alex has moved past — and a tick that
   * springs back beside an open suitcase is the failure the queue exists to
   * end. The row says it is saved on this phone until it lands.
   *
   * A server that ANSWERED is still obeyed. Only a request that never arrived
   * is queued; a refusal is shown, because retrying it later behind his back is
   * how a checklist quietly stops matching the bag.
   */
  async function togglePacked(entry: ChecklistEntry) {
    const next = isPacked(entry) ? 0 : entry.requiredQty
    replace({ ...entry, packedQty: next })
    try {
      const saved = await patchEntryOrQueue(entry, { packedQty: next })
      replace(saved.entry)
      if (saved.queued) setPending(pendingEntryIds())
      setError(null)
    } catch {
      /*
       * Say why the tick sprang back.
       *
       * Reached only when the queue could not take it — the server refused, or
       * this browser has no storage to remember it in. The row itself has to
       * account for what happened; a banner at the top of the screen is not an
       * answer to "I just tapped this".
       */
      setError(
        isOffline()
          ? 'Not saved — you are offline. Tick it off again once you have signal.'
          : 'That did not save. Try again.',
      )
      void load()
    }
  }

  async function addItem() {
    const name = newName.trim()
    if (!name) return
    const entry = await addTripOnlyItem(id, name, 'Travel Gear', 1)
    setEntries((prev) => [...prev, entry])
    setNewName('')
    setAdding(false)
  }

  /**
   * Taking a row off the trip, from wherever it was asked for.
   *
   * The sheet's "Not bringing this" and the swipe tray's ✕ have to do exactly the
   * same thing — including naming the outfits that were wearing it and offering
   * the replacement (doc 04 §8). Two copies of this would have drifted the first
   * time one of them changed, and the half that drifted would be the gesture,
   * because it is the one nobody reads.
   */
  function handleExcluded(entry: ChecklistEntry, affected: AffectedOutfit[]) {
    replace(entry)

          /*
           * Says what the removal costs the plan, in the same breath as the
           * removal (doc 04 §8). Outfits are named, never counted — "2 outfits
           * use this" only makes Alex go and look for which.
           */
          // Counted by outfit, not by slot: one garment can fill two slots of the
          // same outfit, and "Safari were wearing it" is not a sentence.
          const outfits = [...new Set(affected.map((outfit) => outfit.name))]
          const message = outfits.length
            ? `${entry.name} moved to Not bringing · ${joinNames(outfits)} ${
                outfits.length === 1 ? 'was' : 'were'
              } wearing it`
            : `${entry.name} moved to Not bringing`

          const first = affected[0]
          offerUndo(
            message,
            async () => {
              replace(await restoreEntry(id, entry.id))
              // The outfit's marking is derived from this row, so putting it back
              // clears the conflict — but only a reload can see that.
              if (affected.length > 0) await load()
            },
            first
              ? {
                  groupId: first.groupId,
                  slotId: first.slotId,
                  roleLabel: first.roleLabel,
                  itemId: entry.itemId,
                }
              : undefined,
          )

          // The standing line has to appear now, not at the next visit: the undo
          // bar is gone in six seconds and the conflict is not.
          if (affected.length > 0) void load()
  }


  /** Edit and Remove, for the row's left-swipe tray. */
  function leftActionsFor(entry: ChecklistEntry): SwipeAction[] {
    return [
      { label: 'Edit', glyph: '✎', onSelect: () => setDetail(entry) },
      {
        label: 'Remove',
        glyph: '✕',
        destructive: true,
        onSelect: () => void removeFromTrip(entry),
      },
    ]
  }


  /**
   * Archive and restore, which are the same button in two states.
   *
   * Reversible either way, so there is nothing to confirm and nothing to undo —
   * the control itself is the undo.
   */
  async function toggleArchive() {
    if (!trip) return
    try {
      setTrip(trip.archivedAt ? await restoreTripApi(id) : await archiveTripApi(id))
      setError(null)
    } catch {
      setError(
        isOffline()
          ? 'Not saved — you are offline. Try again once you have signal.'
          : 'That did not save. Try again.',
      )
    }
  }

  /**
   * Permanent. Leaves for the trips list, because there is no trip left to be on.
   */
  async function removeTrip() {
    if (deleting) return
    setDeleting(true)
    try {
      await deleteTripApi(id)
      navigate('/trips')
    } catch {
      setDeleting(false)
      setConfirmingDelete(false)
      setError(
        isOffline()
          ? 'Not deleted — you are offline. Try again once you have signal.'
          : 'That did not delete. Try again.',
      )
    }
  }

  /** The swipe tray's ✕, which goes through the same path as the sheet's button. */
  async function removeFromTrip(entry: ChecklistEntry) {
    try {
      const { affectedOutfits, ...excluded } = await excludeEntry(id, entry.id)
      handleExcluded(excluded, affectedOutfits)
    } catch {
      setError(
        isOffline()
          ? 'Not saved — you are offline. Try again once you have signal.'
          : 'That did not save. Try again.',
      )
    }
  }


  /*
   * The shape of what is coming, not an empty page.
   *
   * This screen used to render a bare heading and nothing else while it loaded —
   * on a hotel connection that is several seconds of a blank page on the screen
   * Alex opens most, and it is indistinguishable from the app having failed. The
   * `.skeleton` primitive was written for exactly this and had no callers; the
   * blocks below are the trip header, the alert and the first rows, so the
   * content lands in place instead of pushing a false layout out of the way.
   */
  if (loading) {
    return (
      <Screen title="Trip">
        <div className="trip-loading" aria-busy="true" aria-label="Loading this trip">
          <div className="skeleton skeleton-progress" />
          <div className="skeleton skeleton-banner" />
          <div className="skeleton skeleton-rows" />
        </div>
      </Screen>
    )
  }

  if (error || !trip) {
    /*
     * A load that failed and a trip that is gone are different situations and had
     * been sharing one dead end: a red sentence, a single button that navigates
     * away, and a page of nothing under it. A network blip on the packing list
     * meant leaving the screen and coming back to retry it, which is the app
     * making its own failure the user's problem.
     */
    const failedToLoad = Boolean(error)
    return (
      <Screen title="Trip">
        <div className="empty-state">
          <p className="empty-state-title">
            {failedToLoad ? 'Could not load this trip' : 'That trip is gone'}
          </p>
          <p className="empty-state-body">
            {failedToLoad
              ? 'Pack Smart could not reach the server. Your packing list is safe — nothing was changed.'
              : 'It may have been deleted on another device.'}
          </p>
          {failedToLoad ? (
            <button type="button" className="button-primary" onClick={() => void load()}>
              Try again
            </button>
          ) : null}
          <button type="button" className="button-quiet" onClick={() => navigate('/trips')}>
            Back to trips
          </button>
        </div>
      </Screen>
    )
  }

  /*
   * Search and the filter change what is SHOWN, never what is counted. Progress
   * and the essentials warning stay about the whole trip — a filtered list that
   * also filtered "12 of 31 packed" would quietly tell Alex he is further along
   * than he is, and `Still to pack` would show "0 of 0" the moment it emptied,
   * which is the exact opposite of what it means.
   */
  const needle = search.trim().toLowerCase()
  const searched = needle
    ? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : entries
  const visible = filterChecklist(searched, filter)

  const grouped = groupChecklist(visible)
  const days = tripDays(trip.startDate, trip.endDate)

  /*
   * Completed rows sink — but not while Alex's thumb is on the row (doc 09 §4.2).
   *
   * Reordering the instant a box is ticked makes the row under the thumb jump
   * away mid-tap, and doing it four times while he works down a run of adjacent
   * items turns the list into a slot machine. So the order is a SNAPSHOT, held
   * until the tapping stops: `settledOrder` holds the ids in display order, and
   * it is only recomputed once nothing has changed for `SETTLE_MS`.
   *
   * A snapshot rather than an animation because the requirement is steadiness,
   * not smoothness — §4.2 asks for no disorienting motion and prefers a deferred
   * reorder to a restrained one, and a deferred reorder cannot be disorienting
   * because nothing moves until Alex has stopped.
   */
  const ordered = {
    packNow: applyOrder(grouped.packNow, settledOrder.packNow ?? []),
    packLater: applyOrder(grouped.packLater, settledOrder.packLater ?? []),
    finalCheck: applyOrder(grouped.finalCheck, settledOrder.finalCheck ?? []),
    // Not bringing is a shelf, not a queue. Nothing there is packed or unpacked,
    // so there is nothing to sink and reordering it would only move rows Alex
    // put there on purpose.
    notBringing: grouped.notBringing,
  }

  /*
   * The same derived answer Home reads, not this screen's own reading of it.
   *
   * Trip Details used to compute its own progress and decide for itself whether
   * an unpacked essential was worth a red panel, while Home decided separately.
   * Two screens, one trip, two opinions — which is the contradiction doc 09 §4
   * exists to remove. `readiness()` is now the only thing that answers, here and
   * on Home, from the same inputs.
   */
  const ready = readiness({ trip, entries, outfits: outfitGroups, today: todayISO() })
  const progress = checklistProgress(entries)

  /*
   * How close departure is, and what the departure screen would still ask for.
   *
   * Both derived here rather than in the JSX so the button and its number come
   * from one reading of the same list the screen below it is rendering.
   */
  const daysUntilDeparture = daysBetween(todayISO(), trip.startDate)
  const departure = dayOfPlan(entries)

  /*
   * The essentials line stays on this screen unconditionally, and that is not an
   * inconsistency with Home dropping it.
   *
   * Doc 09 §4.1 names the packing list as a place essentials belong: this is
   * where they are ACTIONABLE, because the rows are right here. What changed is
   * that Home no longer repeats it — the same warning on several screens is the
   * §4.1 failure, not the warning itself.
   */
  const essentialsLine = outstandingEssentialsLine(entries)

  /** The head of the model's list, minus anything put off in this sitting. */
  const nextQuestion = ready.openQuestions.find((q) => !deferred.includes(q.fact)) ?? null

  const sections = [
    { key: 'pack_now' as const, rows: ordered.packNow },
    { key: 'pack_later' as const, rows: ordered.packLater },
    { key: 'final_check' as const, rows: ordered.finalCheck },
    { key: 'not_bringing' as const, rows: ordered.notBringing },
  ]
    .filter((section) => section.rows.length > 0)
    // Whether the "Essential" tag says anything in this section, or every row
    // carries it and it says nothing (UX-04).
    .map((section) => ({ ...section, allEssential: section.rows.every((row) => row.isCritical) }))

  return (
    <Screen
      title={`${trip.emoji} ${trip.name}`}
      subtitle={`${formatDateRange(trip.startDate, trip.endDate)} · ${days} days`}
    >
      {/*
        * The state of the trip, in one block, above everything else.
        *
        * This screen used to open with a progress bar, two warning panels, three
        * text links and three full-width actions each carrying its own paragraph —
        * so the packing list, which is the entire point of the screen, began below
        * the first viewport (UX-01). What Alex needs at a glance is how far along
        * he is and whether anything is wrong. Everything that plans the trip rather
        * than packs it now sits behind one disclosure.
        */}
      <div className="trip-summary">
        {/*
          * The readiness headline, in the same words Home uses for this trip.
          *
          * Not decoration: it is the visible proof that the two screens agree.
          * Before this they each derived their own view of how far along the
          * trip was, so "3 days to go" on Home could sit beside a trip screen
          * leading with something else entirely.
          */}
        <p className="trip-summary-state">{ready.headline}</p>
        <p className="trip-summary-progress">
          <span className="stat-value">{progress.packed}</span>
          <span className="stat-label">of {progress.total} packed</span>
        </p>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${progress.total ? (progress.packed / progress.total) * 100 : 0}%` }}
          />
        </div>
        <TripWeatherLine tripId={id} />
      </div>

      {/*
        * The way to the departure screen, and only while it is the right screen
        * to be on (D4, doc 09 §12).
        *
        * `isDepartureImminent` rather than a date check here: the same function
        * decides whether the readiness model recommends it, so the button and
        * the recommendation cannot start disagreeing about when "before you go"
        * begins. Two whole days, because a trip that leaves at six in the
        * morning is packed the night before.
        *
        * Not shown once the trip has started — from then on the question is
        * Today's outfit — and not shown when nothing is left, because a button
        * to a screen that says "nothing left" is a trip to find that out.
        */}
      {/*
        * The way to the post-trip review, and the only way to it (F1).
        *
        * Home features the trip Alex is working on, which is never a finished
        * one, so a finished trip's recommended action has nowhere else to
        * appear. It comes from `ready.next` rather than from a date check here
        * for the reason the Before you go button does: the model decides when a
        * review is worth offering — once, until it has been done — and a second
        * opinion on this screen is how the two start disagreeing.
        */}
      {ready.stage === 'finished' && ready.next ? (
        <button
          type="button"
          className="button-primary trip-day-of"
          onClick={() => navigate(routeFor(id, ready.next!.route))}
        >
          {ready.next.label}
        </button>
      ) : null}

      {isDepartureImminent(daysUntilDeparture) && departure.remaining > 0 ? (
        <button
          type="button"
          className="button-primary trip-day-of"
          onClick={() => navigate(`/trips/${id}/day-of`)}
        >
          Before you go · {departure.remaining}{' '}
          {departure.remaining === 1 ? 'thing' : 'things'} left
        </button>
      ) : null}

      {/*
        * One question, and only one, above the list it would change.
        *
        * The readiness model has already decided which is worth asking first
        * (doc 09 §5), so this screen does not choose — it renders the head of
        * that list, minus anything deferred in this sitting. Above the list
        * because answering can ADD to it, and finding that out after packing is
        * the wasted work the whole model exists to prevent.
        */}
      {nextQuestion ? (
        <TripQuestion
          question={nextQuestion}
          busy={busyAnswer}
          onAnswer={answerQuestion}
          onDefer={() => setDeferred((prev) => [...prev, nextQuestion.fact])}
        />
      ) : null}

      {/*
        * One alert at most, and proportionate to what is actually wrong.
        *
        * The old line named every outstanding essential, so on a trip where
        * nothing was packed yet it listed eleven items in a red panel and read as
        * an alarm about nothing.
        */}
      {essentialsLine ? (
        <p className="banner banner-alert" role="status">
          <span className="banner-text">{essentialsLine}</span>
        </p>
      ) : null}

      {/*
        * Silent unless a queued change genuinely needs Alex (F2). Below the
        * essentials line, because an essential still in the wardrobe outranks a
        * tick that has to be reconciled.
        */}
      <SyncIssues />

      {/*
        * An approved outfit that is short a garment, and the one tap that fixes
        * it (doc 04 §8).
        *
        * Names the outfit and the garment rather than counting them, and offers
        * the same swap sheet the Outfits screen uses — the point is to end the
        * disagreement here, beside the list, rather than send Alex to another
        * screen to work out what broke.
        */}
      {conflicts.length > 0 ? (
        <div className="banner-stack outfit-conflicts" role="status">
          {conflicts.map((conflict) => (
            /* The shared banner for the look; the name is what identifies this
               particular statement, to a reader and to the tests. */
            <p key={conflict.slotId} className="banner outfit-conflict">
              <span className="banner-text">
                {/*
                  * Two sentences, because they are two different facts and only
                  * one is true at a time. "You are not bringing it" is a
                  * decision about this trip, undone by restoring the row. A
                  * garment that has left the wardrobe is not a decision Alex can
                  * take back from here, and saying he chose not to bring it
                  * would be plainly wrong.
                  */}
                {conflict.why === 'archived'
                  ? `${conflict.groupName} needs the ${conflict.itemName}, which is no longer in your wardrobe.`
                  : `${conflict.groupName} needs the ${conflict.itemName}, which you are not bringing.`}
              </span>
              <button
                type="button"
                className="button-secondary button-compact"
                onClick={() =>
                  setSwapping({
                    groupId: conflict.groupId,
                    slotId: conflict.slotId,
                    roleLabel: conflict.roleLabel,
                    itemId: conflict.itemId,
                  })
                }
              >
                Replace it
              </button>
            </p>
          ))}
        </div>
      ) : null}

      {/*
        * Quiet, specific, and silent when there is nothing to say (doc 02 §9c).
        *
        * Each line names a fact and the one action that fixes it. Pack Smart does
        * not perform the fix: adding a rule or an item is Alex's call.
        */}
      {coverage.length > 0 ? (
        <div className="banner-stack" role="status">
          {coverage.map((gap) => (
            <p key={gap.message} className="banner banner-quiet">
              <span className="banner-text">
                {gap.message} <span className="coverage-gap-fix">{gap.fix}</span>
              </span>
            </p>
          ))}
        </div>
      ) : null}

      {/* The two screens this one leads to. Everything else is setup. */}
      <div className="trip-actions button-row">
        <button
          type="button"
          className="button-secondary"
          onClick={() => navigate(`/trips/${id}/outfits`)}
        >
          Outfits
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() => navigate(`/trips/${id}/today`)}
        >
          Today
        </button>
      </div>

      {/*
        * Progressive disclosure, and the reason the list now starts on screen.
        *
        * These five actions are each used once or twice per trip — planning it, not
        * packing it. Collapsed they cost one row; expanded they are exactly as
        * reachable as before.
        */}
      <button
        type="button"
        className="disclosure"
        aria-expanded={setupOpen}
        onClick={() => setSetupOpen((open) => !open)}
      >
        <span>Trip setup</span>
        <span className="disclosure-mark" aria-hidden="true">
          {setupOpen ? '⌃' : '⌄'}
        </span>
      </button>

      {setupOpen ? (
        <div className="disclosure-body">
          <button
            type="button"
            className="button-secondary"
            onClick={() => navigate(`/trips/${id}/itinerary`)}
          >
            Add an itinerary
          </button>
          <p className="hint">Paste it, link it, or upload a PDF — nothing is added until you say so.</p>

          {trip.activities.length > 0 ? (
            <>
              <button
                type="button"
                className="button-secondary"
                onClick={() => navigate(`/trips/${id}/days`)}
              >
                {trip.days.length > 0
                  ? `Say which days are what · ${trip.days.length} named`
                  : 'Say which days are what'}
              </button>
              <p className="hint">
                {trip.days.length > 0
                  ? 'Pack Smart plans an outfit for each day you have named.'
                  : 'Without this, one outfit is planned per activity, however many days it runs.'}
              </p>
            </>
          ) : null}

          <button type="button" className="button-secondary" onClick={() => setLastLook(true)}>
            One last look
          </button>
          <p className="hint">A check for anything you meant to bring, before you fill the bag.</p>

          <button type="button" className="button-secondary" onClick={() => setEditing(true)}>
            Edit trip
          </button>

          {/*
            * Archive is the easy one, and deliberately so.
            *
            * It is the answer to almost every "I do not want to see this any
            * more": reversible, changes nothing inside the trip, and the trip is
            * still there to read. Deletion sits below it behind a confirmation
            * because it is the only thing in Pack Smart that destroys anything.
            */}
          <button type="button" className="button-secondary" onClick={() => void toggleArchive()}>
            {trip.archivedAt ? 'Restore to my trips' : 'Archive this trip'}
          </button>
          <p className="hint">
            {trip.archivedAt
              ? 'Archived trips stay complete — this puts it back in the list.'
              : 'Hides it from your trips. Nothing inside it changes, and you can put it back.'}
          </p>

          {/*
            * The one confirmation in the product.
            *
            * Doc 02 §2 prefers undo to "are you sure?", and this is the single
            * case where undo cannot exist — so the confirmation earns its place
            * rather than being a reflex. It names the trip and says what survives,
            * because "this cannot be undone" tells Alex nothing about what he is
            * actually losing.
            */}
          {confirmingDelete ? (
            <div className="banner banner-alert delete-confirm" role="alert">
              <span className="banner-text">
                Delete <strong>{trip.name}</strong> for good? Its packing list, outfits and
                notes go with it. Your wardrobe and what Pack Smart has learned are not touched.
              </span>
            </div>
          ) : null}

          {confirmingDelete ? (
            <div className="button-row">
              <button
                type="button"
                className="button-secondary"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                Keep it
              </button>
              <button
                type="button"
                className="button-danger"
                onClick={() => void removeTrip()}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete for good'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button-danger"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete this trip
            </button>
          )}

          <button
            type="button"
            className="button-quiet"
            onClick={() => setShowFacts((v) => !v)}
            aria-expanded={showFacts}
          >
            {showFacts ? 'Hide what Pack Smart understood' : 'What Pack Smart understood'}
          </button>

          {showFacts ? (
            <ul className="facts">
              {trip.facts.map((fact) => (
                <li key={fact.factKey}>{fact.explanation}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/*
        * Search and one filter, on a row.
        *
        * The filter is the half that earns its place: search answers "where is
        * the thing I am thinking of", and the question in front of an open
        * suitcase is "what is left" — which Alex cannot type, because he does not
        * know the names of the things he has not packed.
        *
        * A native `<select>`, matching My Stuff. iOS renders it as the system
        * wheel, which is better than anything worth building and costs one line.
        */}
      {entries.length > 8 ? (
        <div className="checklist-controls">
          <label className="field checklist-search">
            <span className="visually-hidden">Search this list</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search this list"
              autoCapitalize="none"
            />
          </label>

          <label className="select-field">
            <span className="visually-hidden">Show</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as ChecklistFilter)}
            >
              {CHECKLIST_FILTERS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {/*
        * An empty result says which control emptied it, and offers the way back.
        *
        * "Nothing matches" beside a filter Alex set three taps ago is a dead end;
        * `Still to pack` going empty is the best news of the evening and should
        * say so rather than reading as a failure.
        */}
      {visible.length === 0 && entries.length > 0 ? (
        <p className="hint checklist-empty">
          {needle ? (
            <>Nothing on this list matches “{search.trim()}”.</>
          ) : filter === 'unpacked' ? (
            <>Everything you are bringing is packed.</>
          ) : (
            <>
              Nothing here under {CHECKLIST_FILTERS.find((f) => f.key === filter)?.label ?? 'that'}.{' '}
              <button type="button" className="link-button" onClick={() => setFilter('all')}>
                Show everything
              </button>
            </>
          )}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">Nothing to pack yet</p>
          <p className="empty-state-body">
            Pack Smart builds this list from what you own and the rules attached to it. Add some gear
            in My Stuff, or add something to this trip below.
          </p>
        </div>
      ) : null}

      {sections.map((section) => (
        <section key={section.key} className="checklist-section">
          <h2 className="section-heading">
            {SECTION_LABELS[section.key]}
            <span className="section-count">{section.rows.length}</span>
          </h2>
          <p className="section-hint">{SECTION_HINTS[section.key]}</p>

          <ul className="checklist row-list">
            {section.rows.map((entry) => (
              <li key={`${section.key}-${entry.id}`}>
                <SwipeRow
                  actionGlyph="✓"
                  actionLabel="Pack"
                  completed={isPacked(entry)}
                  onComplete={() => void togglePacked(entry)}
                  /*
                    * Swiping the other way offers the two things you would
                    * otherwise open the ⋯ sheet for. Both still live in that
                    * sheet — the gesture is the shortcut, never the only door,
                    * which is what keeps the row usable with VoiceOver and a
                    * keyboard.
                    *
                    * "Remove" rather than "Delete": nothing is destroyed. It
                    * moves to Not bringing, stays on the trip, and comes back
                    * with one tap of the Undo that follows. Doc 02 §2 prefers
                    * undo to a confirmation, and a red ✕ that quietly meant
                    * "reversible" would be the wrong promise if it did not.
                    */
                  leftActions={leftActionsFor(entry)}
                  className={isPacked(entry) ? 'is-packed-row' : ''}
                >
                  <div className={`check-row ${isPacked(entry) ? 'is-packed' : ''}`}>
                    {/*
                      * The name NAMES the control; the reason DESCRIBES it.
                      *
                      * Without this split the button's accessible name is
                      * computed from its contents, which since C1 includes the
                      * whole explanation — so VoiceOver announced eighty-odd
                      * characters of prose before the role and the pressed
                      * state, on every one of thirty-two rows, with no way to
                      * skip it. A name says what activating a control does; a
                      * description is the extra, and the rotor can mute it.
                      */}
                    <button
                      type="button"
                      className="check-main"
                      onClick={() => void togglePacked(entry)}
                      aria-pressed={isPacked(entry)}
                      /*
                       * Keyed by SECTION as well as by entry, exactly as the
                       * `<li>` above is, and for the same reason: a row that
                       * needs a final check appears in TWO sections at once
                       * (see `groupChecklist`). Keyed by entry alone these ids
                       * were emitted twice, and an IDREF resolves to the first
                       * in document order — so the Final check row took its
                       * name from the Pack-now copy, which silently defeated
                       * the `section.allEssential` suppression below.
                       */
                      aria-labelledby={`check-name-${section.key}-${entry.id}`}
                      aria-describedby={
                        rowSecondaryParts(entry).length > 0
                          ? `check-why-${section.key}-${entry.id}`
                          : undefined
                      }
                    >
                      <span className={`check-box ${isPacked(entry) ? 'is-on' : ''}`} aria-hidden="true">
                        {isPacked(entry) ? '✓' : ''}
                      </span>
                      <span className="check-text">
                        <span className="check-name" id={`check-name-${section.key}-${entry.id}`}>
                          {CATEGORY_EMOJI[entry.category] ? (
                            <span className="check-emoji" aria-hidden="true">
                              {CATEGORY_EMOJI[entry.category]}
                            </span>
                          ) : null}
                          {entry.name}
                          {/*
                            * The essential marker earns its place only where it
                            * distinguishes. In Final check every row is an
                            * essential, and tagging all of them made the tag
                            * meaningless exactly where it appears most (UX-04).
                            */}
                          {entry.isCritical && !section.allEssential ? (
                            <span className="check-critical">
                              {/* Same split as the meta line: a middot for the
                                * eye, a comma for the ear. Joined by whitespace
                                * alone the accessible name read
                                * "Contact lenses· Essential", because name
                                * computation trims each text node before it
                                * joins them. */}
                              <span aria-hidden="true"> · </span>
                              <span className="visually-hidden">, </span>
                              Essential
                            </span>
                          ) : null}
                        </span>
                        {/*
                          * The arithmetic stays on the row, not behind a tap.
                          *
                          * It costs some evenness — a row carrying a breakdown is
                          * taller than its neighbours (UX-14) — but "12 days × 2 =
                          * 24" IS the explanation for the number beside it (doc 03
                          * §8), and moving it into a sheet would trade a real
                          * answer for a tidier list.
                          */}
                        {rowSecondaryParts(entry).length > 0 ? (
                          <span className="check-meta" id={`check-why-${section.key}-${entry.id}`}>
                            {rowSecondaryParts(entry).map((part, index) => (
                              <span key={part}>
                                {index > 0 ? (
                                  <>
                                    {/*
                                      * A middot for the eye, a comma for the
                                      * ear. `·` is not spoken at VoiceOver's
                                      * default punctuation level, so joined
                                      * with it the facts run together with no
                                      * pause between them.
                                      */}
                                    <span aria-hidden="true"> · </span>
                                    <span className="visually-hidden">, </span>
                                  </>
                                ) : null}
                                {part}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        {/*
                          * Pending is distinguished from confirmed by WORDS,
                          * not by a colour or a dot (F2).
                          *
                          * A greyed tick would be invisible to VoiceOver and
                          * ambiguous to everyone else — "did that not
                          * register?" is exactly the doubt the queue exists to
                          * remove. `Saved on this phone` is true, calm, and
                          * says what the state is rather than what went wrong,
                          * because nothing has.
                          */}
                        {pending.has(entry.id) ? (
                          <span className="check-pending">Saved on this phone</span>
                        ) : null}
                      </span>
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
        </section>
      ))}

      {progress.finalCheckOutstanding > 0 ? (
        <p className="hint final-check-note">
          {progress.finalCheckOutstanding}{' '}
          {progress.finalCheckOutstanding === 1 ? 'item needs' : 'items need'} a final look before you
          leave.
        </p>
      ) : null}

      {adding ? (
        <div className="add-row">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            /*
             * "Unique item for this trip", not "Something for this trip".
             *
             * This field adds a row that belongs to this trip alone and never
             * enters the wardrobe — a corkscrew for one rental, a costume for one
             * evening. "Something" said nothing about that; "unique to this trip"
             * is the whole distinction, and it is the difference between this and
             * the Add in My Stuff.
             *
             * It carries a name of its own as well as a placeholder: a
             * placeholder disappears the moment anything is typed, so on its own
             * it leaves a screen reader with an unlabelled field.
             */
            aria-label="Unique item for this trip"
            placeholder="Unique item for this trip"
            autoFocus
            enterKeyHint="done"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addItem()
            }}
          />
          <button type="button" className="button-primary" onClick={() => void addItem()}>
            Add
          </button>
        </div>
      ) : (
        /*
         * "A unique item", not "something to this trip" (D5, doc 09 §4.3).
         *
         * The field this opens is labelled `Unique item for this trip`, and a
         * button that says one thing opening a field that says another is the
         * inconsistency §4.3 is about. "Something" also said nothing about the
         * distinction that matters here — this row belongs to this trip alone
         * and never enters the wardrobe, which is the entire difference between
         * it and the Add in My Stuff.
         */
        <button type="button" className="button-secondary" onClick={() => setAdding(true)}>
          Add a unique item
        </button>
      )}

      {/* Only while it is relevant, rather than as a standing paragraph. */}
      {adding ? (
        <p className="hint">Stays with this trip. My Stuff is not changed.</p>
      ) : null}

      {undoable ? (
        <div className="undo-bar" role="status">
          <span>{undoable.message}</span>
          <span className="undo-actions">
            {/*
              * Doc 04 §8's "offer to replace it", where the removal happened.
              * Only when an approved outfit actually loses something — the rest
              * of the list gets the plain undo bar it always had.
              */}
            {undoable.replace ? (
              <button type="button" onClick={() => setSwapping(undoable.replace ?? null)}>
                Replace it
              </button>
            ) : null}
            <button
              type="button"
              onClick={async () => {
                await undoable.undo()
                setUndoable(null)
              }}
            >
              Undo
            </button>
          </span>
        </div>
      ) : null}

      <TripSheet
        open={editing}
        trip={trip}
        onClose={() => setEditing(false)}
        onSaved={() => void load()}
      />

      <LastLookSheet
        open={lastLook}
        tripId={id}
        onClose={() => setLastLook(false)}
        onAdded={() => void load()}
      />

      <EntrySheet
        open={detail !== null}
        tripId={id}
        entry={detail}
        onClose={() => setDetail(null)}
        onChanged={(entry) => {
          replace(entry)
          setDetail(entry)
        }}
        onExcluded={handleExcluded}
      />

      {/*
        * The same swap sheet the Outfits screen uses, opened from here so a
        * replacement is one tap from the removal (doc 04 §8).
        */}
      <SwapSheet
        open={swapping !== null}
        tripId={id}
        target={swapping}
        onClose={() => setSwapping(null)}
        onChanged={() => {
          setSwapping(null)
          dismissUndo()
          void load()
        }}
      />
    </Screen>
  )
}
