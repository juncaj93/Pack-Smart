import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Screen } from '@/components/Screen'
import { fetchTrip, saveTripDays } from '@/lib/trips'
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  tripDateRange,
  type Trip as TripModel,
  type TripDay,
} from '@shared/trips'
import './Days.css'

/**
 * Which days are what.
 *
 * This exists because the planner used to give every activity exactly one
 * outfit however many days it ran. Four safari days got one safari outfit, and
 * the other three quietly became casual days. The count has to come from the
 * calendar, and only Alex knows the calendar.
 *
 * A row per date, chips for the activities he already chose for the trip, one
 * tap each. No typing, no date pickers, and nothing to fill in for the ordinary
 * days — leaving a day blank is the common case and costs nothing.
 *
 * Its own screen rather than more of the trip sheet: twelve rows inside a sheet
 * capped at 86% of the viewport would be a scroll within a scroll, which is
 * exactly the desktop-dashboard feel doc 02 rules out.
 */
export default function Days() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const [trip, setTrip] = useState<TripModel | null>(null)
  const [chosen, setChosen] = useState<Map<string, string | null>>(new Map())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await fetchTrip(id)
      setTrip(result)
      setChosen(new Map(result.days.map((d) => [d.date, d.activityTag])))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  function choose(date: string, tag: string | null) {
    setChosen((prev) => {
      const next = new Map(prev)
      // Tapping the chosen chip again clears the day, the same gesture as the
      // yes/no answers on the trip sheet.
      if (tag === null || next.get(date) === tag) next.delete(date)
      else next.set(date, tag)
      return next
    })
  }

  async function save() {
    if (saving || !trip) return
    setSaving(true)
    setError(null)

    const days: TripDay[] = [...chosen.entries()].map(([date, activityTag]) => ({
      date,
      activityTag,
    }))

    try {
      await saveTripDays(trip.id, days)
      navigate(`/trips/${trip.id}/outfits`)
    } catch {
      setError('Could not save that. Check your connection and try again.')
      setSaving(false)
    }
  }

  if (status === 'loading') return <Screen title="Which days?" />

  if (status === 'error' || !trip) {
    return (
      <Screen title="Which days?">
        <p className="field-error">Could not load that trip.</p>
        <button type="button" className="button-secondary" onClick={() => navigate('/trips')}>
          Back to trips
        </button>
      </Screen>
    )
  }

  const dates = tripDateRange(trip.startDate, trip.endDate)

  /*
   * Only the activities Alex picked for this trip.
   *
   * Showing all eleven on every row would be a wall of chips and would invite
   * planning a wedding he never mentioned. If he wants another one it belongs on
   * the trip itself, which is where the packing rules read it from too.
   */
  const available = ACTIVITIES.filter((a) => trip.activities.includes(a.tag))

  if (available.length === 0) {
    return (
      <Screen title="Which days?" subtitle={trip.name}>
        <div className="empty-state">
          <p className="empty-state-title">Nothing to spread across the days yet</p>
          <p className="empty-state-body">
            Add what you are doing on this trip first — safari, nice dinners, whatever it is — and
            then you can say which days each one falls on.
          </p>
          <button
            type="button"
            className="button-primary"
            onClick={() => navigate(`/trips/${trip.id}`)}
          >
            Back to the trip
          </button>
        </div>
      </Screen>
    )
  }

  const planned = [...chosen.values()].filter(Boolean).length

  return (
    <Screen title="Which days?" subtitle={trip.name}>
      <p className="hint days-intro">
        Tap what you are doing each day. Pack Smart plans one outfit for every day you name, and
        treats the rest as ordinary days. You can leave any day blank.
      </p>

      {error ? <p className="field-error">{error}</p> : null}

      <ul className="day-list">
        {dates.map((date) => (
          <li key={date} className="day-row">
            <span className="day-date">{formatDay(date)}</span>
            <div className="chips" role="group" aria-label={`What are you doing on ${formatDay(date)}?`}>
              {available.map((activity) => (
                <button
                  key={activity.tag}
                  type="button"
                  className={`chip ${chosen.get(date) === activity.tag ? 'is-on' : ''}`}
                  aria-pressed={chosen.get(date) === activity.tag}
                  onClick={() => choose(date, activity.tag)}
                >
                  {activity.label}
                </button>
              ))}
            </div>
            {chosen.get(date) ? (
              <span className="day-chosen">{ACTIVITY_LABELS[chosen.get(date)!]}</span>
            ) : (
              <span className="day-chosen is-quiet">An ordinary day</span>
            )}
          </li>
        ))}
      </ul>

      <p className="hint">
        {planned === 0
          ? 'Nothing named yet. Pack Smart will plan one outfit per activity.'
          : `${planned} of ${dates.length} days named.`}
      </p>

      <button type="button" className="button-primary days-save" onClick={() => void save()} disabled={saving}>
        {saving ? 'Saving…' : 'Save and replan outfits'}
      </button>

      <p className="hint">
        Outfits you have already approved are left alone. Only the plan you have not signed off is
        redone.
      </p>
    </Screen>
  )
}

/** "Sat 1 Aug" — short enough for a phone row, unambiguous enough to trust. */
function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}
