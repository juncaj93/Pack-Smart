import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/Screen'
import { TripSheet } from '@/components/TripSheet'
import { recall, remember } from '@/lib/sessionCache'
import { fetchTripTemplate } from '@/lib/trips'
import type { TripTemplate } from '@shared/trips'
import { fetchTrips } from '@/lib/trips'
import { tripDays, type Trip } from '@shared/trips'
import { departureLabel, todayISO } from '@shared/readiness'
import './Trips.css'

const STATUS_LABEL: Record<Trip['status'], string> = {
  planning: 'Planning',
  packing: 'Packing',
  active: 'On the trip',
  completed: 'Completed',
}

/*
 * The badge reads "3 days", "Tomorrow", "Today", "On the trip" — replacing the
 * status pill, because `Planning` was true of every trip on the screen at once
 * and occupied the one spot that could carry the fact Alex is looking for
 * (UX-11).
 *
 * The third copy of the arithmetic behind it is gone.
 *
 * Home, Trip Details and this list each worked out how far away a trip was,
 * and they did not even agree on the words — "9 days to go" here, "9 days"
 * there. `departureLabel` is now the only thing that decides, in the short
 * register a list chip has room for.
 */

/** "31 Jul – 11 Aug 2026", or the year on both ends when they differ. */
export function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' }

  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  const left = start.toLocaleDateString('en-GB', sameYear ? opts : { ...opts, year: 'numeric' })
  const right = end.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })
  return `${left} – ${right}`
}

/**
 * One trip, as a row.
 *
 * Exported so Home renders the same row rather than a second one that drifts.
 * Doc 02 §4 puts upcoming and recent trips on Home, and two hand-written trip
 * rows in one product is precisely the duplication `UX_AUDIT.md` UX-15 was about.
 * Importing it also pulls `Trips.css` in, so the styles travel with the markup.
 */
export function TripRow({ trip, onOpen }: { trip: Trip; onOpen: (trip: Trip) => void }) {
  return (
    <button type="button" className="trip-row" onClick={() => onOpen(trip)}>
      <span className="trip-text">
        <span className="trip-name">
          <span className="trip-emoji" aria-hidden="true">
            {trip.emoji}
          </span>
          {trip.name}
        </span>
        <span className="trip-meta">
          {formatDateRange(trip.startDate, trip.endDate)} ·{' '}
          {tripDays(trip.startDate, trip.endDate)} days
        </span>
      </span>
      <span className={`trip-status is-${trip.status}`}>
        {trip.status === 'completed'
          ? STATUS_LABEL[trip.status]
          : departureLabel(trip, todayISO(), 'short')}
      </span>
    </button>
  )
}

/** What Trips knew last time, so tapping back to it paints at once (P1c). */
const SNAPSHOT_KEY = 'trips'

export default function Trips() {
  const navigate = useNavigate()
  /*
   * `null` is "not known yet" and drives the loading state, so a snapshot goes
   * straight in as the initial value. The load below still runs every time —
   * this paints while it does, it does not replace it.
   */
  const [trips, setTrips] = useState<Trip[] | null>(() => recall<Trip[]>(SNAPSHOT_KEY) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  /** Last trip's answers, when this sheet was opened by "Plan again". */
  const [prefill, setPrefill] = useState<TripTemplate | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await fetchTrips()
      setTrips(result.trips)
      remember<Trip[]>(SNAPSHOT_KEY, result.trips)
      setError(null)
    } catch {
      setError('Could not load your trips.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /*
   * Past trips stay visible, and their archived items with them (CLAUDE.md).
   * A finished trip is a record of what Alex actually took, which is the only
   * thing that makes the next one better.
   */
  const today = new Date().toISOString().slice(0, 10)
  /*
   * Archived is a state of its own, and it comes FIRST in the filter.
   *
   * The upcoming/past split is derived from the dates; archiving is a decision
   * Alex made. A trip he has put away should not reappear in "Coming up" just
   * because its dates have not passed yet, so archived is subtracted from both
   * before either is worked out.
   */
  const live = (trips ?? []).filter((t) => !t.archivedAt)
  const archived = (trips ?? []).filter((t) => t.archivedAt)
  const upcoming = live.filter((t) => t.endDate >= today && t.status !== 'completed')
  const past = live.filter((t) => t.endDate < today || t.status === 'completed')

  const sections = [
    { title: 'Coming up', trips: [...upcoming].reverse() },
    { title: 'Past trips', trips: past },
    /*
     * Last, and only when there is something in it. An empty "Archived" heading
     * on a screen that has never archived anything is a filing cabinet nobody
     * asked for.
     */
    ...(showArchived ? [{ title: 'Archived', trips: archived }] : []),
  ].filter((section) => section.trips.length > 0)

  /**
   * Opens the trip sheet with last time's answers already in it.
   *
   * The dates are left EMPTY on purpose. Every other field describes a trip
   * Alex has taken and is worth reusing; the dates are the one thing that is
   * certainly wrong, and prefilling them with last year's would invite saving
   * a trip in the past.
   */
  async function planAgain(trip: Trip) {
    if (busy) return
    setBusy(true)
    try {
      const { template } = await fetchTripTemplate(trip.id)
      setPrefill(template)
      setSheetOpen(true)
    } catch {
      setError('Could not open that trip as a starting point.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      title="Trips"
      action={{
        label: 'Plan a Trip',
        glyph: '+',
        onClick: () => {
          setPrefill(null)
          setSheetOpen(true)
        },
      }}
    >
      {error ? <p className="field-error">{error}</p> : null}

      {trips === null ? null : trips.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">Nothing planned</p>
          <p className="empty-state-body">
            Add where you are going and when. Pack Smart works out the rest from what you own.
          </p>
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              setPrefill(null)
              setSheetOpen(true)
            }}
          >
            Plan a Trip
          </button>
        </div>
      ) : (
        <>
          {sections.map((section) => (
            <section key={section.title} className="trip-section">
              <h2 className="section-heading">{section.title}</h2>
              <ul className="trip-list">
                {section.trips.map((trip) => (
                  <li key={trip.id} className="trip-item">
                    <TripRow trip={trip} onOpen={(t) => navigate(`/trips/${t.id}`)} />

                    {/*
                      * Only on a finished trip, and compact.
                      *
                      * A trip that is still coming up is edited, not duplicated;
                      * offering both would be two ways to do one thing. This
                      * opens the trip sheet prefilled — nothing is created until
                      * Alex saves it.
                      */}
                    {trip.status === 'completed' ? (
                      <button
                        type="button"
                        className="trip-again"
                        onClick={() => void planAgain(trip)}
                        disabled={busy}
                      >
                        Plan again
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {/*
            * An administrative action, and correctly out of the way (doc 02 §2) —
            * the same treatment archived items get in My Stuff, for the same
            * reason. It counts, so the row says what is behind it.
            */}
          {archived.length > 0 ? (
            <button
              type="button"
              className="button-quiet trips-archived-toggle"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? 'Hide archived' : `Show archived (${archived.length})`}
            </button>
          ) : null}
        </>
      )}

      <TripSheet
        open={sheetOpen}
        trip={null}
        template={prefill}
        onClose={() => {
          setSheetOpen(false)
          setPrefill(null)
        }}
        onSaved={(trip) => navigate(`/trips/${trip.id}`)}
      />
    </Screen>
  )
}
