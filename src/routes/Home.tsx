import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, Screen } from '@/components/Screen'
import { TripSheet } from '@/components/TripSheet'
import { fetchChecklist, fetchTrips } from '@/lib/trips'
import { formatDateRange, TripRow } from '@/routes/Trips'
import {
  checklistProgress,
  outstandingEssentialsLine,
  progressLabel,
  type ChecklistEntry,
  type ChecklistProgress,
} from '@shared/checklist'
import { tripDays, type Trip } from '@shared/trips'
import './Home.css'

/** Whole days until departure. Negative once the date has passed. */
function daysUntil(date: string): number {
  const today = new Date()
  const target = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  )
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((target - now) / 86_400_000)
}

function countdown(trip: Trip): string {
  const until = daysUntil(trip.startDate)
  if (until > 1) return `${until} days to go`
  if (until === 1) return 'Leaving tomorrow'
  if (until === 0) return 'Leaving today'
  return 'On the trip'
}

/**
 * Home is the trip you are actually working on.
 *
 * Product doc 02 §3: opening the app during a trip should land on that trip's
 * state rather than a dashboard. The soonest trip that has not finished is the
 * one Alex means, so it is chosen for him instead of presented as a menu.
 */
export default function Home() {
  const navigate = useNavigate()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [progress, setProgress] = useState<ChecklistProgress | null>(null)
  const [entries, setEntries] = useState<ChecklistEntry[]>([])
  /*
   * Everything else Alex has planned or taken.
   *
   * Doc 02 §4 asks Home for the featured trip AND "upcoming trips, New Trip,
   * recent trips" beneath it. All three had collapsed into one text link reading
   * "All trips · 4 more", which is why the screen answered its question in the
   * top third and left the rest of the viewport empty — the space was not calm,
   * it was three missing sections.
   */
  const [others, setOthers] = useState<Trip[]>([])
  const [recent, setRecent] = useState<Trip[]>([])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { trips } = await fetchTrips()
        /*
         * Archived first, before anything else is decided.
         *
         * A trip Alex has put away must not come back as the FEATURED one just
         * because its dates have not passed — that would make archiving look
         * broken on the screen he opens most.
         */
        const active = trips.filter((t) => !t.archivedAt)
        const live = active
          .filter((t) => t.status !== 'completed' && daysUntil(t.endDate) >= 0)
          .sort((a, b) => a.startDate.localeCompare(b.startDate))
        const next = live[0] ?? null

        if (cancelled) return
        setTrip(next)
        /*
         * Three, not all of them.
         *
         * Home is the trip Alex is working on (doc 02 §3); the section beneath it
         * is context, and context that scrolls is a second Trips screen. `All
         * trips` below carries the rest, which is what it is for.
         *
         * Uncapped was also a real hazard rather than a tidiness point: a database
         * with a few hundred trips in it rendered a few hundred rows here, and the
         * screen that is supposed to open instantly became the slowest in the app.
         */
        setOthers(live.slice(1, 4))
        /*
         * Most recently finished first. A finished trip is on Home to be reused,
         * and the one Alex just took is the one worth reusing — so this is not the
         * same order as the Trips screen's history, and should not be.
         */
        setRecent(
          active
            .filter((t) => t.status === 'completed' || daysUntil(t.endDate) < 0)
            .sort((a, b) => b.startDate.localeCompare(a.startDate))
            .slice(0, 2),
        )

        if (next) {
          const { entries: rows } = await fetchChecklist(next.id)
          if (!cancelled) {
            setEntries(rows)
            setProgress(checklistProgress(rows))
          }
        }
      } catch {
        /* Home stays quiet on failure; Trips reports it properly. */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <Screen title="Pack Smart" />

  if (!trip) {
    return (
      <Screen title="Pack Smart">
        <EmptyState
          title="No trips yet"
          body="Tell Pack Smart where you are going and when. It builds the packing list from what you already own."
          action={{ label: 'Plan a Trip', onClick: () => navigate('/trips') }}
        />
      </Screen>
    )
  }

  const percent = progress && progress.total > 0 ? (progress.packed / progress.total) * 100 : 0

  /*
   * Once the trip has started, the app's job changes from "help me pack" to
   * "what do I wear today" (product doc 04 §11), so the card leads somewhere
   * else. It is the same card, pointed at what actually matters right now.
   */
  const underway = daysUntil(trip.startDate) <= 0
  const destination = underway ? `/trips/${trip.id}/today` : `/trips/${trip.id}`
  const essentialsLine = outstandingEssentialsLine(entries)

  return (
    <Screen title="Pack Smart">
      <button type="button" className="home-card" onClick={() => navigate(destination)}>
        <span className="home-countdown">{countdown(trip)}</span>
        <span className="home-trip-name">
          <span className="trip-emoji" aria-hidden="true">{trip.emoji}</span>
          {trip.name}
        </span>
        <span className="home-dates">
          {formatDateRange(trip.startDate, trip.endDate)} ·{' '}
          {tripDays(trip.startDate, trip.endDate)} days
        </span>

        {/*
          * Nothing here restates the button below it.
          *
          * While the trip is underway the card used to end with the words "See
          * what to wear today", and the primary action two hundred pixels lower
          * said the same seven words and went to the same screen. Two controls,
          * one destination, identical labels — `VISUAL_ACCEPTANCE.md` §2's
          * competing actions. The card carries the trip; the button carries the
          * action.
          */}
        {underway ? null : progress ? (
          <>
            <span className="progress-track home-track">
              <span className="progress-fill" style={{ width: `${percent}%` }} />
            </span>
            <span className="home-progress">{progressLabel(progress)}</span>
          </>
        ) : null}
      </button>

      {/*
        * Proportionate rather than exhaustive (UX-05). The old line named every
        * outstanding essential, which on the first day of a trip meant eleven
        * items in a red panel — an alarm about nothing.
        */}
      {essentialsLine ? (
        <p className="banner banner-alert" role="status">
          <span className="banner-text">{essentialsLine}</span>
        </p>
      ) : null}

      {/*
        * Two actions on one line, and which one leads changes with the trip.
        *
        * Before departure the job is packing; once the trip has started it is what
        * to wear (doc 04 §11), so the primary weight moves rather than the
        * buttons. Stacked full-width they took two rows and read as a menu; side
        * by side they read as a choice, which is what they are.
        *
        * "Today's outfit" rather than "See what to wear today": at half the width
        * the longer label wrapped to two lines at 360px, and the short one is the
        * same promise.
        */}
      <div className="button-row home-actions">
        {underway ? (
          <>
            <button
              type="button"
              className="button-primary"
              onClick={() => navigate(`/trips/${trip.id}/today`)}
            >
              Today&rsquo;s outfit
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => navigate(`/trips/${trip.id}`)}
            >
              Packing list
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="button-primary"
              onClick={() => navigate(`/trips/${trip.id}`)}
            >
              Packing list
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => navigate(`/trips/${trip.id}/outfits`)}
            >
              Outfits
            </button>
          </>
        )}
      </div>

      {/* Doc 02 §4, in its order: upcoming trips, New Trip, recent trips. */}
      {others.length > 0 ? (
        <section className="home-section">
          <h2 className="section-heading">Also coming up</h2>
          <ul className="trip-list">
            {others.map((other) => (
              <li key={other.id} className="trip-item">
                <TripRow trip={other} onOpen={(t) => navigate(`/trips/${t.id}`)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        * The sheet lives here as well as on Trips.
        *
        * Sending Alex to another screen to find the button that opens it would
        * make "New Trip" a signpost rather than an action, and it is the same
        * self-contained component either way — there is no second implementation
        * to keep in step.
        */}
      <button type="button" className="button-secondary" onClick={() => setSheetOpen(true)}>
        Plan a Trip
      </button>

      {recent.length > 0 ? (
        <section className="home-section">
          <h2 className="section-heading">Recent trips</h2>
          <ul className="trip-list">
            {recent.map((old) => (
              <li key={old.id} className="trip-item">
                <TripRow trip={old} onOpen={(t) => navigate(`/trips/${t.id}`)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <button
        type="button"
        className="button-quiet home-all-trips"
        onClick={() => navigate('/trips')}
      >
        All trips
      </button>

      <TripSheet
        open={sheetOpen}
        trip={null}
        template={null}
        onClose={() => setSheetOpen(false)}
        onSaved={(saved) => navigate(`/trips/${saved.id}`)}
      />
    </Screen>
  )
}
