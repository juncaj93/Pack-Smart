import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EntrySheet } from '@/components/EntrySheet'
import { LastLookSheet } from '@/components/LastLookSheet'
import { Screen } from '@/components/Screen'
import { SwipeRow } from '@/components/SwipeRow'
import { SwapSheet, type SwapTarget } from '@/components/SwapSheet'
import { TripSheet } from '@/components/TripSheet'
import { CATEGORY_EMOJI } from '@/lib/items'
import {
  addTripOnlyItem,
  fetchChecklist,
  fetchWeather,
  patchEntry,
  restoreEntry,
  type OutfitConflict,
  type TripWeather,
} from '@/lib/trips'
import { joinNames } from '@shared/outfits'
import { formatDateRange } from '@/routes/Trips'
import {
  SECTION_HINTS,
  SECTION_LABELS,
  checklistProgress,
  groupChecklist,
  outstandingEssentialsLine,
  type ChecklistEntry,
} from '@shared/checklist'
import { isOffline } from '@/lib/offline'
import type { CoverageGap } from '@shared/essentials'
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
  const [undoable, setUndoable] = useState<Undoable | null>(null)
  const [swapping, setSwapping] = useState<SwapTarget | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await fetchChecklist(id)
      setTrip(result.trip)
      setEntries(result.entries)
      setCoverage(result.coverage ?? [])
      setConflicts(result.conflicts ?? [])
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

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
  }, [])

  function replace(entry: ChecklistEntry) {
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? entry : e)))
  }

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

  /** One tap on a row: everything in, or everything back out. */
  async function togglePacked(entry: ChecklistEntry) {
    const next = isPacked(entry) ? 0 : entry.requiredQty
    replace({ ...entry, packedQty: next })
    try {
      replace(await patchEntry(id, entry.id, { packedQty: next }))
      setError(null)
    } catch {
      /*
       * Say why the tick sprang back.
       *
       * Offline the row reverts, which on its own looks like the tap missed.
       * The banner already warns that changes will not save, but a warning at
       * the top of the screen is not an answer to "I just tapped this" — the
       * row itself has to account for what happened.
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

  if (loading) return <Screen title="Trip" />

  if (error || !trip) {
    return (
      <Screen title="Trip">
        <p className="field-error">{error ?? 'That trip is gone.'}</p>
        <button type="button" className="button-secondary" onClick={() => navigate('/trips')}>
          Back to trips
        </button>
      </Screen>
    )
  }

  /*
   * Search filters what is SHOWN, never what is counted. Progress and the
   * essentials warning stay about the whole trip — a filtered list that also
   * filtered "12 of 31 packed" would quietly tell Alex he is further along than
   * he is.
   */
  const needle = search.trim().toLowerCase()
  const visible = needle
    ? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : entries

  const grouped = groupChecklist(visible)
  const progress = checklistProgress(entries)
  const days = tripDays(trip.startDate, trip.endDate)

  const essentialsLine = outstandingEssentialsLine(entries)

  const sections = [
    { key: 'pack_now' as const, rows: grouped.packNow },
    { key: 'pack_later' as const, rows: grouped.packLater },
    { key: 'final_check' as const, rows: grouped.finalCheck },
    { key: 'not_bringing' as const, rows: grouped.notBringing },
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
                {conflict.groupName} needs the {conflict.itemName}, which you are not bringing.
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

      {entries.length > 8 ? (
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
      ) : null}

      {needle && visible.length === 0 ? (
        <p className="hint">Nothing on this list matches “{search.trim()}”.</p>
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
                  className={isPacked(entry) ? 'is-packed-row' : ''}
                >
                  <div className={`check-row ${isPacked(entry) ? 'is-packed' : ''}`}>
                    <button
                      type="button"
                      className="check-main"
                      onClick={() => void togglePacked(entry)}
                      aria-pressed={isPacked(entry)}
                    >
                      <span className={`check-box ${isPacked(entry) ? 'is-on' : ''}`} aria-hidden="true">
                        {isPacked(entry) ? '✓' : ''}
                      </span>
                      <span className="check-text">
                        <span className="check-name">
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
                            <span className="check-critical"> · Essential</span>
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
                        {entry.requiredQty > 1 || entry.qtyBreakdown ? (
                          <span className="check-meta">
                            {entry.packedQty > 0 && !isPacked(entry)
                              ? `${entry.packedQty} of ${entry.requiredQty} packed`
                              : entry.requiredQty > 1
                                ? `${entry.requiredQty} needed`
                                : null}
                            {entry.qtyBreakdown ? ` · ${entry.qtyBreakdown}` : ''}
                          </span>
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
            placeholder="Something for this trip"
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
        <button type="button" className="button-secondary" onClick={() => setAdding(true)}>
          Add something to this trip
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
        onExcluded={(entry, affected) => {
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
        }}
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
