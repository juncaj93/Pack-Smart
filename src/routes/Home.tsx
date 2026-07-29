import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, Screen } from '@/components/Screen'
import { fetchChecklist, fetchTrips } from '@/lib/trips'
import { formatDateRange } from '@/routes/Trips'
import { checklistProgress, progressLabel, type ChecklistProgress } from '@shared/checklist'
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

        if (next) {
          const { entries } = await fetchChecklist(next.id)
          if (!cancelled) setProgress(checklistProgress(entries))
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

  return (
    <Screen title="Pack Smart">
      <button type="button" className="home-card" onClick={() => navigate(destination)}>
        <span className="home-countdown">{countdown(trip)}</span>
        <span className="home-trip-name">{trip.name}</span>
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

      {progress && progress.criticalOutstanding.length > 0 ? (
        <p className="critical-warning">
          Still not packed: {progress.criticalOutstanding.map((e) => e.name).join(', ')}.
        </p>
      ) : null}

      {underway ? (
        <button
          type="button"
          className="button-secondary"
          onClick={() => navigate(`/trips/${trip.id}`)}
        >
          Packing list
        </button>
      ) : null}

      <button type="button" className="button-secondary" onClick={() => navigate('/trips')}>
        All trips
      </button>
    </Screen>
  )
}
