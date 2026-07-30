import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, Screen } from '@/components/Screen'
import { fetchChecklist, fetchTrips } from '@/lib/trips'
import { formatDateRange } from '@/routes/Trips'
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
  /* How many other trips are waiting, so "All trips" says what is behind it. */
  const [otherTrips, setOtherTrips] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { trips } = await fetchTrips()
        const next =
          trips
            .filter((t) => t.status !== 'completed' && daysUntil(t.endDate) >= 0)
            .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null

        if (cancelled) return
        setTrip(next)
        setOtherTrips(Math.max(0, trips.length - 1))

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

        {underway ? (
          <span className="home-progress">See what to wear today</span>
        ) : progress ? (
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
        * One primary action, and it changes with the trip rather than sitting
        * there as a menu. Before departure the job is packing; once the trip has
        * started it is what to wear (doc 04 §11).
        */}
      <button type="button" className="button-primary" onClick={() => navigate(destination)}>
        {underway ? 'See what to wear today' : 'Open the packing list'}
      </button>

      {underway ? (
        <button
          type="button"
          className="button-secondary"
          onClick={() => navigate(`/trips/${trip.id}`)}
        >
          Packing list
        </button>
      ) : null}

      <button type="button" className="button-quiet home-all-trips" onClick={() => navigate('/trips')}>
        All trips{otherTrips > 0 ? ` · ${otherTrips} more` : ''}
      </button>
    </Screen>
  )
}
