import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AddToTripSheet } from '@/components/AddToTripSheet'
import { ColorDots } from '@/components/ColorDots'
import { EntrySheet } from '@/components/EntrySheet'
import { LastLookSheet } from '@/components/LastLookSheet'
import { Screen } from '@/components/Screen'
import { SwipeRow, type SwipeAction } from '@/components/SwipeRow'
import { SwapSheet, type SwapTarget } from '@/components/SwapSheet'
import { setSlotItem } from '@/lib/trips'
import { TripSheet } from '@/components/TripSheet'
import { CATEGORY_EMOJI } from '@/lib/items'
import {
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
import { planBags } from '@shared/bags'
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
  rowColorLabel,
  rowQuantityLabel,
  rowSecondaryParts,
  sectionIsSoleHome,
  sectionStage,
  type ChecklistEntry,
  type ChecklistFilter,
} from '@shared/checklist'
import { deltaLines, type PlanDelta } from '@shared/plan-delta'
import { isOffline } from '@/lib/offline'
import { useScrollRestore, useViewState } from '@/lib/viewState'
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
import { weatherHeadline } from '@shared/weather'
import { UndoBar, useUndoOffer } from '@/components/UndoBar'
import { SearchInput } from '@/components/SearchInput'
import './Trip.css'


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
  const [open, setOpen] = useState(false)

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

  /*
   * A metadata line, not a panel (§12).
   *
   * This used to be the full sentence inside a tinted box: three lines at
   * 390px, permanently, between the progress bar and the packing list. The
   * range and the rain are what could change what goes in the bag, so they stay
   * on the line; the sentence about a climate normal not being a forecast is
   * behind the ⓘ. Both halves come from `weatherHeadline`, so the distinction
   * cannot be lost by the presentation — `short` still leads with the word
   * "Typical" or "Forecast".
   */
  const headline = weatherHeadline(weather.days)
  if (headline) {
    return (
      <p className="trip-weather">
        <span className="trip-weather-short">{headline.short}</span>
        {headline.note ? (
          <>
            <button
              type="button"
              className="trip-weather-more"
              aria-expanded={open}
              aria-label="Where this weather comes from"
              onClick={() => setOpen((v) => !v)}
            >
              <span aria-hidden="true">ⓘ</span>
            </button>
            {open ? (
              <span className="trip-weather-note reveal">{headline.note}</span>
            ) : null}
          </>
        ) : null}
      </p>
    )
  }

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
  /** Days named, plan not yet built — one rung of the ladder, not nothing (P1B). */
  const [outfitsStale, setOutfitsStale] = useState(false)
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
  /** The delayed-bag set is a question asked once, so it opens on request (§0u). */
  const [backupOpen, setBackupOpen] = useState(false)
  const [lastLook, setLastLook] = useState(false)
  /** Whether the Add sheet is open (§6). */
  const [adding, setAdding] = useState(false)
  /*
   * Search and filter survive leaving the trip, and they are keyed BY trip (§7).
   *
   * Two trips are two different packing problems: "still to pack" on the
   * weekend away has nothing to say about the fortnight in August, and carrying
   * one screen's narrowing onto the other would be preserving the wrong
   * context rather than preserving context. Tapping through to Outfits and
   * back, or to Today and back, now returns to the list as it was left.
   */
  const [search, setSearch] = useViewState(`trip:${id}:search`, '')
  const [filter, setFilter] = useViewState<ChecklistFilter>(`trip:${id}:filter`, 'all')
  /**
   * Sections Alex has opened or closed himself, overriding the stage default.
   *
   * In `useViewState` rather than `useState` so tapping into a row's sheet and
   * back does not close what he just opened — and deliberately no further than
   * that. It is not stored: a section opened to check something once is not a
   * preference about how packing lists work.
   */
  const [sectionsOpen, setSectionsOpen] = useViewState<Record<string, boolean>>(
    `trip:${id}:sections`,
    {},
  )
  /**
   * What the Add sheet's wardrobe search was last narrowed to (§41).
   *
   * In `useViewState` so closing the sheet and opening it again returns Alex to
   * the search he was in the middle of — adding three things from the same
   * search should not mean typing it three times. Keyed by trip for the reason
   * the packing search is: two trips are two different packing problems.
   */
  const [addSearch, setAddSearch] = useViewState(`trip:${id}:add-search`, '')
  const undo = useUndoOffer()
  const [swapping, setSwapping] = useState<SwapTarget | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busyAnswer, setBusyAnswer] = useState(false)
  /** Rows whose last change is still on this phone only (F2). */
  const [pending, setPending] = useState<Set<string>>(() => pendingEntryIds())
  /**
   * What the last trip edit actually changed about the plan (P4f).
   *
   * Transient by construction. It is set from the save's own reply and cleared
   * by the next load, so it can never become a change-history panel — the same
   * shape and the same reasoning as the replan lines on Outfits. Empty when the
   * edit moved nothing, which is most edits, and the screen then says nothing.
   */
  const [editDeltas, setEditDeltas] = useState<PlanDelta[]>([])

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
      const outfitResult = await fetchOutfits(id).catch(() => ({ groups: [], stale: false }))
      setOutfitGroups(outfitResult.groups)
      setOutfitsStale(outfitResult.stale)
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
  function offerUndo(message: string, revert: () => Promise<void>, replace?: SwapTarget) {
    undo.offer({
      message,
      undo: revert,
      /*
       * Doc 04 §8's "offer to replace it", where the removal happened. Only when
       * an approved outfit actually loses something — the rest of the list gets
       * the plain bar. This is the one caller that needs a second control, and
       * why `Undoable.extra` exists at all.
       */
      extra: replace ? { label: 'Replace it', onClick: () => setSwapping(replace) } : undefined,
    })
  }

  function dismissUndo() {
    undo.dismiss()
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

  /**
   * A row the Add sheet has just created, applied to the list behind it.
   *
   * Replaces rather than appends when the row already exists: adding a garment
   * that is on `Not bringing` RESTORES its row (see
   * `POST /checklist/from-wardrobe`), and appending the reply would put the
   * same row on the screen twice while the database held one.
   */
  function addedToTrip(entry: ChecklistEntry) {
    setEntries((prev) =>
      prev.some((existing) => existing.id === entry.id)
        ? prev.map((existing) => (existing.id === entry.id ? entry : existing))
        : [...prev, entry],
    )
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
  /*
   * The trip's bag plan, worked out ONCE (P3c).
   *
   * One resolver for the whole screen: the row sheet's answer, the conflict
   * banner and the crowding warning all read this. Two of them used to work it
   * out separately, and `EntrySheet` did it without the resilience set — so the
   * sheet and the planner could disagree about the same garment and neither was
   * obviously wrong.
   *
   * Above the loading and error returns because a hook cannot be called
   * conditionally, and over the UNFILTERED entries because crowding counts what
   * is in a bag rather than what survived a search box — a conflict is not
   * resolved by filtering the row that caused it off the screen.
   */
  const bagPlan = useMemo(() => (trip ? planBags(trip, entries) : null), [trip, entries])

  /*
   * Where the list was, restored once there is a list (§7).
   *
   * Keyed by trip for the same reason the search is: 40 rows down the August
   * trip is not a position on the weekend away. `!loading && entries.length`
   * rather than mount, because this screen paints a skeleton first and
   * scrolling a skeleton clamps to the top.
   */
  useScrollRestore(`trip:${id}`, !loading && entries.length > 0)

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
  /*
   * The rows the delayed-bag set is protecting, in the order they appear on the
   * list. Read off the plan rather than recomputed, so this cannot disagree
   * with the reason each row gives for itself.
   */
  const backup = bagPlan ? entries.filter((entry) => bagPlan.resilience.has(entry.id)) : []

  const needle = search.trim().toLowerCase()
  const searched = needle
    ? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : entries
  const visible = filterChecklist(searched, filter)

  const grouped = groupChecklist(visible)
  const days = tripDays(trip.startDate, trip.endDate)
  /*
   * The trip's length is no longer read here.
   *
   * It was passed to every `rowSecondaryParts` call so a surprising quantity
   * could carry its arithmetic on the row. §4 takes that off the list: the row
   * says `24 needed`, and where the 24 came from is in the row's own sheet
   * under *Why this many*. `quantityIsSurprising` still exists and still means
   * what it meant — nothing on this screen asks it any more.
   */

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
  const ready = readiness({
    trip,
    entries,
    outfits: outfitGroups,
    outfitsStale,
    today: todayISO(),
    /*
     * The authoritative results, handed over rather than re-derived.
     *
     * Both are already on this screen — `coverage` from the checklist GET and
     * `bagPlan.problems` from the one bag plan the rest of the screen is built
     * on. Readiness counts them; it does not know what swimwear is, and when
     * those rules change it inherits the new truth without being touched.
     */
    coverage,
    bagProblems: bagPlan?.problems,
  })
  const progress = checklistProgress(entries)

  /*
   * How close departure is, and what the departure screen would still ask for.
   *
   * Both derived here rather than in the JSX so the button and its number come
   * from one reading of the same list the screen below it is rendering.
   */
  const daysUntilDeparture = daysBetween(todayISO(), trip.startDate)
  const departure = dayOfPlan(entries)

  /** The head of the model's list, minus anything put off in this sitting. */
  const nextQuestion = ready.openQuestions.find((q) => !deferred.includes(q.fact)) ?? null

  /*
   * What Alex can actually act on today, and what is waiting (P4b).
   *
   * `sectionStage` is shared and reads `isDepartureImminent` — the same
   * function the `Before you go` button and the readiness model use — so the
   * screen cannot come to a different view of when the morning begins than the
   * button sitting above it.
   *
   * `sectionsOpen` is Alex overriding that, per section, for as long as he is
   * in the app. Deliberately not stored: a section he opened to check something
   * on Tuesday is not a preference about how his packing lists work, and
   * persisting it would quietly turn the screen back into all four expanded.
   */
  const departureImminent = isDepartureImminent(daysUntilDeparture)

  /*
   * A narrowed list opens everything, and this is not a detail.
   *
   * Search and the bag filters cut across all four sections. With the waiting
   * ones closed, searching for something that only exists in `Pack later` would
   * show `Pack later 1` collapsed and nothing else — which reads exactly like
   * "no matches", on the one screen where believing that means going to look for
   * something that is not missing. Alex has already said what he wants to see;
   * the stage default is for the list he did not narrow.
   */
  const narrowed = needle.length > 0 || filter !== 'all'

  const sections = [
    { key: 'pack_now' as const, rows: ordered.packNow },
    { key: 'pack_later' as const, rows: ordered.packLater },
    { key: 'final_check' as const, rows: ordered.finalCheck },
    { key: 'not_bringing' as const, rows: ordered.notBringing },
  ]
    .filter((section) => section.rows.length > 0)
    .map((section) => {
      const stage = sectionStage(section.key, { departureImminent })
      return {
        ...section,
        stage,
        // Whether the "Essential" tag says anything in this section, or every
        // row carries it and it says nothing (UX-04).
        allEssential: section.rows.every((row) => row.isCritical),
        /*
         * A narrowed list wins over BOTH the stage default and Alex's own
         * collapse, and that ordering is the point. If he closed `Pack later`
         * and then searches for something that only lives in it, an honoured
         * collapse would show `Pack later 1` shut and nothing else — which is
         * indistinguishable from "no matches". His collapse was a statement
         * about the unnarrowed list; the search is a statement about this one.
         *
         * `Final check` is excluded, and that is the one exception: it cannot
         * hide a match, because every row in it is also in the section above.
         * Opening it here would show the same passport twice under
         * `Still to pack` — see `sectionIsSoleHome`.
         */
        open:
          (narrowed && sectionIsSoleHome(section.key)) ||
          (sectionsOpen[section.key] ?? stage === 'now'),
      }
    })

  return (
    <Screen
      title={`${trip.emoji} ${trip.name}`}
      subtitle={`${formatDateRange(trip.startDate, trip.endDate)} · ${days} days`}
      /*
       * Add, in the header's one action slot (§6, §7).
       *
       * The slot held the way into the bag-by-bag lens, which is a LENS over
       * this list rather than something you do to it — and the thing Alex could
       * not do from this screen at all was add to it. Putting something in the
       * bag is the screen's own verb; looking at the same rows a different way
       * is navigation, and it has moved to the row of destinations below, where
       * Outfits and Today already are.
       *
       * Unconditional, unlike the lens it replaced. `availableBags` returns
       * nothing for a trip with no flight, so that control came and went; Add
       * is the answer to an empty list as much as to a full one, and a header
       * action that is sometimes absent is one Alex has to look for.
       */
      action={{
        label: 'Add to this trip',
        onClick: () => setAdding(true),
      }}
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
          * The state of the trip and how far along it is, on ONE line.
          *
          * They were three stacked full-width rows — an accent overline, a
          * count, and a bar — which is 70px of the first viewport for two
          * numbers that belong together. The headline is still in the same
          * words Home uses for this trip, which is not decoration: it is the
          * visible proof that the two screens agree. Before the readiness model
          * they each derived their own view of how far along the trip was, so
          * "3 days to go" on Home could sit beside a trip screen leading with
          * something else entirely.
          */}
        <p className="trip-summary-line">
          <span className="trip-summary-state">{ready.headline}</span>
          <span className="trip-summary-progress">
            <span className="stat-value">{progress.packed}</span>
            <span className="stat-label">of {progress.total} packed</span>
          </span>
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
        * "Am I basically ready?" — answered in three words and a short list.
        *
        * The list REPORTS; it does not compete with the one recommended action.
        * Every line is counted from a result computed elsewhere — coverage, the
        * bag plan, the outfit rows, the checklist — so this cannot disagree with
        * the banners further down the same screen, and it inherits new rules
        * without being edited.
        *
        * Nothing about the closet appears here. An unrated garment or an
        * unreviewed duplicate is a fact about the wardrobe, and waiting on them
        * would tell Alex he is not ready for a trip he has finished packing.
        */}
      {ready.stage !== 'finished' && ready.issues.length > 0 ? (
        <section className="trip-readiness" aria-labelledby="trip-readiness-heading">
          <h2 className="trip-readiness-summary" id="trip-readiness-heading">
            {ready.summary}
          </h2>
          <ul className="trip-readiness-issues row-list">
            {ready.issues.map((issue) => (
              <li key={issue.label}>
                <button type="button" onClick={() => navigate(routeFor(id, issue.route))}>
                  {issue.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
        * The essentials banner that used to sit here is gone, and nothing
        * replaced it.
        *
        * "10 essentials still to pack — Bite Guard, Deodorant and Glasses, and 7
        * more." named rows that are a short scroll below in Pack Now, floated to
        * the top of that list precisely because they are essentials. It spent the
        * first screenful of an iPhone on the fact that Alex has not finished
        * packing — which is not something wrong, it is why he opened the trip.
        *
        * The essentials still lead the list, still carry the Essential tag, still
        * drive "Pack the essentials" when the model judges them urgent, and are
        * still named on the departure screen. What was removed is only the panel
        * (doc 09 §0q).
        */}

      {/*
        * What the luggage cannot safely hold, and what is getting full (P3c).
        *
        * `no_safe_bag` is the one case §5 names: the hold is the only bag and
        * something must not go in it. The planner has already refused to name a
        * bag for those rows — this is where that refusal becomes something Alex
        * can act on, with the two ways out in the sentence.
        *
        * Tinted for the safety conflict and plain for crowding, because they are
        * not the same kind of news: one is a plan that cannot work, the other is
        * an observation. Crowding in `banner-alert` would be the eleven-item red
        * panel this screen already learned not to show.
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
        * What the last trip edit did to the plan (P4f).
        *
        * Reported rather than predicted: these come from `planDelta` over two
        * authoritative snapshots taken either side of the regeneration, so a
        * laundry answer that changed nothing produces no lines at all. Changing
        * `laundryAvailable` alone can take a row from 24 to 5, and before this
        * nothing on the screen Alex came back to would have said so.
        *
        * The same shape the Outfits replan uses, deliberately — one way of
        * saying "here is what changed" in the product, not two.
        */}
      {deltaLines(editDeltas).length > 0 ? (
        <ul className="outfit-deltas trip-deltas" role="status">
          {deltaLines(editDeltas).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
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

      {/*
        * The two screens this one leads to, and the way into setup — one row,
        * three controls (§13, §14).
        *
        * This was two 48px buttons on their own row, then a 44px disclosure on
        * another, then 16px of margin under each: about 110px of a 664px screen
        * for three things that are not the packing list. Three compact controls
        * on one row is 44px, and the touch targets are unchanged.
        *
        * Three buttons rather than a segmented control, deliberately: Outfits
        * and Today are separate destinations, not two states of one thing, and
        * a segment that looks like a state would be lying about what tapping
        * does. Trip setup is the odd one out — it opens in place rather than
        * navigating — so it carries the chevron that says so.
        */}
      <div className="trip-toolbar">
        <button
          type="button"
          className="button-secondary button-compact"
          onClick={() => navigate(`/trips/${id}/outfits`)}
        >
          Outfits
        </button>
        <button
          type="button"
          className="button-secondary button-compact"
          onClick={() => navigate(`/trips/${id}/today`)}
        >
          Today
        </button>
        {/*
          * The bag-by-bag lens, moved off the header action slot (§6).
          *
          * It belongs here rather than there: Outfits, Today and Bags are three
          * ways of looking at the same trip, and the header slot is now the
          * screen's own verb. `Bags` rather than `Pack by bag` because the
          * label sits in a row of four at 360px and the two words beside
          * `Outfits` and `Today` say the same thing — the screen it opens is
          * still titled `Pack by bag`.
          *
          * Still offered only when the trip is carrying bags. `availableBags`
          * returns none for a trip Alex has said has no flight and named no bag
          * for, and a lens with nothing to look through is not worth a control.
          */}
        {bagPlan && bagPlan.context.bags.length > 0 && entries.length > 0 ? (
          <button
            type="button"
            className="button-secondary button-compact"
            onClick={() => navigate(`/trips/${id}/bags`)}
          >
            Bags
          </button>
        ) : null}
        {/*
          * Progressive disclosure, and the reason the list starts on screen.
          *
          * These actions are each used once or twice per trip — planning it,
          * not packing it. Collapsed this costs a third of one row; expanded it
          * is exactly as reachable as it ever was.
          */}
        <button
          type="button"
          className="button-secondary button-compact trip-setup-toggle"
          aria-expanded={setupOpen}
          onClick={() => setSetupOpen((open) => !open)}
        >
          Trip setup
          <span className="disclosure-mark" aria-hidden="true">
            {setupOpen ? '⌃' : '⌄'}
          </span>
        </button>
      </div>

      {setupOpen ? (
        <div className="disclosure-body reveal">
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
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search this list"
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
        * "Clear filters", and only while a filter is set (§6).
        *
        * Not for a search on its own — the field's own `×` already clears that,
        * and two controls undoing one thing is a duplicated affordance. Set
        * alongside a search it clears both, because leaving the search behind
        * would be a reset that does not reset.
        */}
      {filter !== 'all' ? (
        <button
          type="button"
          className="filter-reset"
          onClick={() => {
            setFilter('all')
            setSearch('')
          }}
        >
          Clear filters
        </button>
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
          {/*
            * "Add" is where the one-off used to be, so the sentence says so.
            *
            * The old copy ended "or add something to this trip below", which
            * pointed at a control that is now in the header — an empty state
            * whose one instruction sends Alex to the bottom of a page with
            * nothing on it is worse than no instruction at all.
            *
            * It NAMES the header action rather than repeating it. Doc 02 §11
            * wants one obvious next action here, and it is already on screen a
            * few points above this paragraph; a second button carrying the same
            * label to the same sheet is the UX-18 defect — two controls, one
            * destination, identical labels — in the state where the screen has
            * least else on it to tell them apart.
            */}
          <p className="empty-state-title">Nothing to pack yet</p>
          <p className="empty-state-body">
            Pack Smart builds this list from what you own and the rules attached to it. Add some gear
            in My Stuff, or use <strong>Add</strong> at the top of this screen.
          </p>
        </div>
      ) : null}

      {sections.map((section) => (
        <section key={section.key} className="checklist-section">
          {/*
            * The stage Alex is on keeps a plain heading; the ones waiting
            * become a disclosure (P4b).
            *
            * Not a uniform accordion, deliberately. Making Pack now collapsible
            * too would offer to hide the work, and a screen where every section
            * looks the same says nothing about which one is the answer to *what
            * do I pack next*. The waiting sections keep their heading, their
            * count and one tap — nothing is hidden, it is just not opened for
            * him on a day he cannot act on it.
            */}
          {section.stage === 'now' ? (
            <>
              <h2 className="section-heading">
                {SECTION_LABELS[section.key]}
                <span className="section-count">{section.rows.length}</span>
              </h2>
              <p className="section-hint">{SECTION_HINTS[section.key]}</p>
            </>
          ) : (
            <h2 className="section-heading-wrap">
              <button
                type="button"
                className="disclosure section-disclosure"
                aria-expanded={section.open}
                onClick={() =>
                  setSectionsOpen({ ...sectionsOpen, [section.key]: !section.open })
                }
              >
                <span className="section-disclosure-name">{SECTION_LABELS[section.key]}</span>
                <span className="section-count">{section.rows.length}</span>
                <span className="disclosure-mark" aria-hidden="true">
                  {section.open ? '⌃' : '⌄'}
                </span>
              </button>
            </h2>
          )}

          {section.stage !== 'now' && section.open ? (
            <p className="section-hint">{SECTION_HINTS[section.key]}</p>
          ) : null}

          {/*
            * Not rendered at all, rather than `hidden`.
            *
            * `hidden` was the first version and WebKit found the flaw: a hidden
            * element still HAS a bounding box, of zero, so `finishing.spec.ts`'s
            * "the counts line up" gate measured a `.check-qty` inside a
            * collapsed section at right = 0 and reported a 321px spread. That
            * gate is not wrong — it measures a real property of the visible
            * list — and any future measurement over `.checklist` would have hit
            * the same thing.
            *
            * Nothing is lost. A collapsed section is out of the accessibility
            * tree either way, and the tests that care about its rows expand it
            * first, which is what Alex does.
            */}
          {section.open ? (
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
                      /*
                       * Both descriptions, in the order they are on screen.
                       *
                       * `aria-labelledby` above means the button's name comes
                       * from the name span ALONE — the fix that stopped
                       * VoiceOver reading eighty characters of prose before the
                       * role on every one of thirty-two rows. So anything else
                       * on the row has to be in THIS list or it is visible and
                       * silent, which is the one outcome moving a fact to the
                       * right of the row must not produce.
                       *
                       * The metadata comes first because it is first on the
                       * row, and because it carries the colour NAME (§14): the
                       * swatch beside it is `aria-hidden`, so this is the only
                       * place a listener is told the shirt is dark green. Space
                       * separated ids are read in the order given, so the row
                       * announces "Athletic T-Shirt, Vuori, Dark Green, 5
                       * needed".
                       */
                      aria-describedby={
                        [
                          rowSecondaryParts(entry).length > 0 || rowColorLabel(entry)
                            ? `check-side-${section.key}-${entry.id}`
                            : null,
                          rowQuantityLabel(entry) ? `check-qty-${section.key}-${entry.id}` : null,
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined
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
                          <span className="check-name-text">{entry.name}</span>
                          {/*
                            * The essential marker earns its place only where it
                            * distinguishes. In Final check every row is an
                            * essential, and tagging all of them made the tag
                            * meaningless exactly where it appears most (UX-04).
                            */}
                          {entry.isCritical && !section.allEssential ? (
                            <span className="check-critical">
                              {/*
                                * The comma stays; the middot is gone (§8d).
                                *
                                * The separator was there because the marker sat
                                * on the name line at the name's own size and
                                * needed something to say it was a different
                                * fact. It is a smaller, spaced, uppercase label
                                * now, which says that by itself — and a middot
                                * between an item and its own label read as part
                                * of the item.
                                *
                                * The visually-hidden comma is NOT decoration
                                * and does not go with it: name computation
                                * trims each text node before joining, so
                                * without it the accessible name runs together
                                * as "Contact lensesEssential".
                                */}
                              <span className="visually-hidden">, </span>
                              Essential
                            </span>
                          ) : null}
                        </span>
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

                      {/*
                        * Who made it and what colour it is, on the right of the
                        * row rather than on a line of its own (§12, §13).
                        *
                        * `Vuori · Dark Green` under the name was the commonest
                        * reason a packing row was two lines tall, and on a list
                        * of forty that is most of the scrolling. The brand is
                        * the half that tells two quarter-zips apart in words,
                        * so it stays as text; the colour becomes a dot, because
                        * a colour word is something you decode and a dot is
                        * something you see — and the dots line up down the
                        * right edge as a palette, which is the thing a
                        * photograph would have given.
                        *
                        * The colour NAME is here too, for a listener. The
                        * swatch is `aria-hidden` — it is a second rendering of
                        * this string — so removing the visible word without
                        * this would be taking a fact away from exactly the
                        * person who cannot see the dot (§14).
                        */}
                      {rowSecondaryParts(entry).length > 0 || rowColorLabel(entry) ? (
                        <span className="check-side" id={`check-side-${section.key}-${entry.id}`}>
                          {rowSecondaryParts(entry).map((part, index) => (
                            <span key={part} className="check-side-text">
                              {index > 0 ? (
                                <>
                                  {/*
                                    * A middot for the eye, a comma for the ear.
                                    * `·` is not spoken at VoiceOver's default
                                    * punctuation level, so joined with it the
                                    * facts run together with no pause.
                                    */}
                                  <span aria-hidden="true"> · </span>
                                  <span className="visually-hidden">, </span>
                                </>
                              ) : null}
                              {part}
                            </span>
                          ))}
                          {rowColorLabel(entry) ? (
                            <>
                              <span className="visually-hidden">
                                {rowSecondaryParts(entry).length > 0 ? ', ' : ''}
                                {rowColorLabel(entry)}
                              </span>
                              <ColorDots color={entry.color} className="check-colors" />
                            </>
                          ) : null}
                        </span>
                      ) : null}

                      {/*
                        * How many, beside the item rather than beneath it.
                        *
                        * `5 needed` was the commonest reason a row grew a
                        * second line, and on a list where most rows have no
                        * brand, colour or bag it was making the list uneven for
                        * eight characters. Out here it costs no height at all:
                        * the row is already `--touch-target-min` tall and this
                        * sits in the space to the right of a name that is
                        * rarely as wide as the row.
                        *
                        * Last, and never allowed to shrink, so the counts form
                        * a column that can be read down (§17).
                        */}
                      {rowQuantityLabel(entry) ? (
                        <span className="check-qty" id={`check-qty-${section.key}-${entry.id}`}>
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
          ) : null}
        </section>
      ))}

      {/*
        * The small set kept out of the hold, when there is a hold to lose (P3c).
        *
        * `resilienceSet` is bounded and only exists on a flight with a checked
        * bag, so this section cannot appear on a drive and cannot grow into a
        * second copy of the packing list. Rendered only when it chose something:
        * an empty "24-hour backup" heading would be decoration claiming a plan
        * that does not exist.
        *
        * Names only. The rows themselves are below with everything they can do;
        * this answers one question — if the checked bag is late, what did Pack
        * Smart protect?
        *
        * Behind a disclosure, and BELOW the list rather than above it.
        *
        * That question is asked once. Collapsed the disclosure still cost 60
        * points of the first viewport on every visit for the whole trip, above
        * the packing list this screen exists for — and it is reassurance, not
        * an action: the answer has not changed since the last time he read it
        * and there is nothing to do about it. Under the list it is exactly as
        * findable and costs the packing workspace nothing (§10).
        *
        * The same disclosure idiom as Trip setup, deliberately: one shape on a
        * screen, not two things that look almost alike.
        */}
      {backup.length > 0 ? (
        <section className="trip-backup">
          <button
            type="button"
            className="disclosure"
            aria-expanded={backupOpen}
            onClick={() => setBackupOpen((open) => !open)}
          >
            <span>24-hour backup · {backup.length}</span>
            <span className="disclosure-mark" aria-hidden="true">
              {backupOpen ? '⌃' : '⌄'}
            </span>
          </button>

          {backupOpen ? (
            <div className="disclosure-body reveal">
              <p className="section-hint">
                These stay with you in case your checked bag is delayed.
              </p>
              <p className="trip-backup-names">{joinNames(backup.map((entry) => entry.name))}</p>
            </div>
          ) : null}
        </section>
      ) : null}


      {progress.finalCheckOutstanding > 0 ? (
        <p className="hint final-check-note">
          {progress.finalCheckOutstanding}{' '}
          {progress.finalCheckOutstanding === 1 ? 'item needs' : 'items need'} a final look before you
          leave.
        </p>
      ) : null}

      {/*
        * The `Add a unique item` button that used to sit here is gone, and its
        * capability moved rather than being removed (§9).
        *
        * It was the last control on the page, below every packing row — so
        * reaching the one-off route meant scrolling the whole list, and adding
        * something Alex already OWNS was not offered on this screen at all.
        * Both now live in the header's Add sheet, and the unique-item path
        * inside it calls exactly the same endpoint with exactly the same
        * arguments, which is what §9 asks to be confirmed before an old control
        * is deleted.
        *
        * Nothing else routed through this button: it opened an inline field and
        * called `addTripOnlyItem`, and `unique-item.spec.ts` follows the new
        * path end to end.
        */}


      {/*
        * The one way to put something on this list (§40).
        *
        * Opened from the header, so it is reachable from the top of the screen
        * rather than from the end of it, and it holds both answers to *add
        * what* — the wardrobe and a one-off for this trip.
        */}
      <AddToTripSheet
        open={adding}
        tripId={id}
        entries={entries}
        search={addSearch}
        onSearch={setAddSearch}
        onClose={() => setAdding(false)}
        onAdded={addedToTrip}
      />

      <UndoBar offer={undo} />

      <TripSheet
        open={editing}
        trip={trip}
        onClose={() => setEditing(false)}
        onSaved={(_saved, deltas) => {
          /*
           * Set BEFORE the reload, and the reload does not clear it.
           *
           * `load()` refetches the rows the deltas are about, so clearing there
           * would wipe the lines the moment they were earned. They go instead on
           * the next visit to the screen, because `editDeltas` starts empty on
           * mount — which is exactly "transient" without a timer to get wrong.
           */
          setEditDeltas(deltas ?? [])
          void load()
        }}
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
        /* The trip's ONE bag plan decides this row, so the sheet cannot reach
         * a different answer than the rest of the screen (P3c). */
        resolution={detail ? bagPlan?.advice.get(detail.id) : undefined}
        onClose={() => setDetail(null)}
        onChanged={(entry) => {
          replace(entry)
          /*
           * Refresh the sheet's own copy of the row, but only while the sheet
           * is still open on that row.
           *
           * A chip in this sheet fires its PATCH and does not wait for it, and
           * `Done` closes the sheet at once. When the reply landed after the
           * close, this line used to put `detail` back — and the sheet reopened
           * by itself, over the checklist, swallowing every later tap. That is
           * the whole of the `bags.spec.ts` failure doc 09 §0a could not
           * explain: the sheet really had closed, which is exactly why waiting
           * for it to close cured nothing.
           *
           * The updater reads the CURRENT value rather than the one captured
           * when the request went out, so a sheet dismissed mid-flight stays
           * dismissed, and a different row opened in the meantime is not
           * overwritten by the old row's reply.
           */
          setDetail((current) => (current?.id === entry.id ? entry : current))
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
        onChoose={(itemId, _option) => {
          /*
           * This screen holds a checklist, not outfit groups, so it cannot apply
           * the choice to a slot the way Outfits and the review can. What it CAN
           * stop doing is making Alex watch the reload (P1A).
           *
           * The sheet is already closed by the time this runs. The write and the
           * reload both happen behind it, and `load()` is the narrowest thing
           * that is still correct here: a replacement changes the checklist rows,
           * the outfit that needed the garment and the Not-bringing list at once,
           * and this screen renders all three. Narrowing it further belongs with
           * P1B's checklist work, where the same measurement can be taken.
           */
          dismissUndo()
          void setSlotItem(id, swapping!.groupId, swapping!.slotId, itemId)
            .then(() => load())
            .catch(() => load())
        }}
      />
    </Screen>
  )
}
