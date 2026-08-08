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
  /**
   * A LIST per date, not one activity (G2).
   *
   * This was `Map<date, activityTag>`, which made one-activity-per-day true by
   * construction — a beach afternoon and a formal dinner could not both be
   * said, however the rest of the app was built. Each entry keeps the
   * `trip_event` id it came from so saving edits that row rather than
   * recreating it, which is what stops an edit here throwing away the outfit
   * the activity is already dressed by.
   */
  const [chosen, setChosen] = useState<Map<string, TripDay[]>>(new Map())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await fetchTrip(id)
      setTrip(result)
      const byDate = new Map<string, TripDay[]>()
      for (const day of result.days) {
        if (!day.activityTag) continue
        byDate.set(day.date, [...(byDate.get(day.date) ?? []), day])
      }
      setChosen(byDate)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * One tap adds an activity to the day; tapping it again takes it off.
   *
   * The same gesture as before, and it now composes: two taps on one row say
   * "both of these happen today", which is exactly how *Add another activity*
   * reads when the control is already a set of chips. A separate button would
   * be a second way to do the thing the chip already does.
   *
   * Tap order is the day's order, because it is the only sequence Alex actually
   * states. `trip_event.start_time` exists and nothing he enters supplies one,
   * so rendering a clock time would be inventing a fact.
   */
  function choose(date: string, tag: string) {
    setChosen((prev) => {
      const next = new Map(prev)
      const current = next.get(date) ?? []
      const already = current.find((day) => day.activityTag === tag)

      const updated = already
        ? current.filter((day) => day.activityTag !== tag)
        : [...current, { date, activityTag: tag }]

      if (updated.length === 0) next.delete(date)
      else next.set(date, updated)
      return next
    })
  }

  async function save() {
    if (saving || !trip) return
    setSaving(true)
    setError(null)

    /*
     * Flattened in date order, and in each day's own order within that.
     *
     * The server takes the position in this list as `sort_order`, so the
     * sequence Alex arranged is the sequence Today shows. An entry that still
     * carries its id is UPDATED rather than recreated.
     */
    const days: TripDay[] = [...chosen.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([, entries]) => entries)

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

  const planned = [...chosen.values()].filter((entries) => entries.length > 0).length
  const activityCount = [...chosen.values()].reduce((sum, entries) => sum + entries.length, 0)

  return (
    <Screen title="Which days?" subtitle={trip.name}>
      <p className="hint days-intro">
        Tap what you are doing each day — tap more than one if the day holds more than one, and
        Pack Smart plans an outfit for each. The rest are treated as ordinary days, and you can
        leave any day blank.
      </p>

      {error ? <p className="field-error">{error}</p> : null}

      <ul className="day-list">
        {dates.map((date) => (
          <li key={date} className="day-row">
            <span className="day-date">{formatDay(date)}</span>
            <div className="chips" role="group" aria-label={`What are you doing on ${formatDay(date)}?`}>
              {available.map((activity) => {
                const on = (chosen.get(date) ?? []).some((day) => day.activityTag === activity.tag)
                return (
                  <button
                    key={activity.tag}
                    type="button"
                    className={`chip ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => choose(date, activity.tag)}
                  >
                    {activity.label}
                  </button>
                )
              })}
            </div>
            {/*
              * The day read back in the order it happens (G2).
              *
              * Joined with an arrow rather than a middot, because these are a
              * SEQUENCE and not a set — "Beach → Nice dinners" says which comes
              * first, which is the whole reason a day may hold two.
              */}
            {(chosen.get(date) ?? []).length > 0 ? (
              <span className="day-chosen">
                {(chosen.get(date) ?? [])
                  .map((day) => ACTIVITY_LABELS[day.activityTag!] ?? day.activityTag)
                  .join(' → ')}
              </span>
            ) : (
              <span className="day-chosen is-quiet">An ordinary day</span>
            )}
          </li>
        ))}
      </ul>

      <p className="hint">
        {planned === 0
          ? 'Nothing named yet. Pack Smart will plan one outfit per activity.'
          : activityCount > planned
            ? `${planned} of ${dates.length} days named, ${activityCount} activities in all.`
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
