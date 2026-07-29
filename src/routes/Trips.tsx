import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/Screen'
import { TripSheet } from '@/components/TripSheet'
import { fetchTrips } from '@/lib/trips'
import { tripDays, type Trip } from '@shared/trips'
import './Trips.css'

const STATUS_LABEL: Record<Trip['status'], string> = {
  planning: 'Planning',
  packing: 'Packing',
  active: 'On the trip',
  completed: 'Completed',
}

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

export default function Trips() {
  const navigate = useNavigate()
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await fetchTrips()
      setTrips(result.trips)
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
  const upcoming = (trips ?? []).filter((t) => t.endDate >= today && t.status !== 'completed')
  const past = (trips ?? []).filter((t) => t.endDate < today || t.status === 'completed')

  const sections = [
    { title: 'Coming up', trips: [...upcoming].reverse() },
    { title: 'Past trips', trips: past },
  ].filter((section) => section.trips.length > 0)

  return (
    <Screen title="Trips">
      {error ? <p className="field-error">{error}</p> : null}

      {trips === null ? null : trips.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">Nothing planned</p>
          <p className="empty-state-body">
            Add where you are going and when. Pack Smart works out the rest from what you own.
          </p>
          <button type="button" className="button-primary" onClick={() => setSheetOpen(true)}>
            Plan a Trip
          </button>
        </div>
      ) : (
        <>
          {sections.map((section) => (
            <section key={section.title} className="trip-section">
              <h2 className="section-title">{section.title}</h2>
              <ul className="trip-list">
                {section.trips.map((trip) => (
                  <li key={trip.id}>
                    <button
                      type="button"
                      className="trip-row"
                      onClick={() => navigate(`/trips/${trip.id}`)}
                    >
                      <span className="trip-text">
                        <span className="trip-name">{trip.name}</span>
                        <span className="trip-meta">
                          {formatDateRange(trip.startDate, trip.endDate)} ·{' '}
                          {tripDays(trip.startDate, trip.endDate)} days
                        </span>
                      </span>
                      <span className={`trip-status is-${trip.status}`}>
                        {STATUS_LABEL[trip.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <button type="button" className="button-primary" onClick={() => setSheetOpen(true)}>
            Plan a Trip
          </button>
        </>
      )}

      <TripSheet
        open={sheetOpen}
        trip={null}
        onClose={() => setSheetOpen(false)}
        onSaved={(trip) => navigate(`/trips/${trip.id}`)}
      />
    </Screen>
  )
}
