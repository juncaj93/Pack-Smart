import { useEffect, useState } from 'react'
import { describeTodayWeather } from '@shared/today'
import type { HomeStatusData } from '@/lib/trips'
import './HomeStatus.css'

/**
 * Where Alex is, what day it is, what time it is, and what it is like outside.
 *
 * ## Why this is its own component
 *
 * The clock. A tick that lived in `Home` would re-render the trip card, both
 * trip lists, the sheets and the briefing once a minute for four spans that
 * changed. Here a tick re-renders four spans.
 *
 * ## Why there is no `aria-live` on it
 *
 * The place line it replaces carried `role="status"`, which was right when it
 * changed once on arrival. It is wrong now: a live region wrapped around a
 * ticking clock announces the time to a screen-reader user every sixty seconds,
 * for ever. The row is read when the screen is read, like the rest of the page.
 */

/**
 * The current minute, and only the current minute.
 *
 * Chained `setTimeout` to the next minute BOUNDARY rather than `setInterval` at
 * 60s from mount: an interval started at :30 shows every minute half a minute
 * late, and drifts further the longer the tab stays open.
 *
 * Re-synced on `visibilitychange` and `focus` because iOS suspends timers in a
 * backgrounded tab — a phone taken out of a pocket must not show the time it was
 * put away at.
 */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    const schedule = () => {
      setNow(new Date())
      // +250ms so a timer that fires a hair early does not land on the previous
      // minute and then have to wait a whole one to correct itself.
      timer = setTimeout(schedule, 60_000 - (Date.now() % 60_000) + 250)
    }

    timer = setTimeout(schedule, 60_000 - (Date.now() % 60_000) + 250)

    const resync = () => {
      setNow(new Date())
      clearTimeout(timer)
      timer = setTimeout(schedule, 60_000 - (Date.now() % 60_000) + 250)
    }

    document.addEventListener('visibilitychange', resync)
    window.addEventListener('focus', resync)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', resync)
      window.removeEventListener('focus', resync)
    }
  }, [])

  return now
}

/**
 * The date and the time, in the zone of the place the row is about.
 *
 * Deliberately the DEVICE's locale (`undefined`), so the phone decides 12-hour
 * against 24-hour rather than this file deciding for it — and deliberately not
 * the `en-GB` pin `formatHeroDate` uses. That function spells a `YYYY-MM-DD`
 * that is already a calendar day and must not be shifted by a zone; this formats
 * a live instant and must be shifted, into the zone of wherever Alex is standing.
 */
function parts(now: Date, timeZone: string | null): { date: string; time: string } {
  const zone = timeZone ?? undefined
  return {
    date: now.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: zone,
    }),
    time: now.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone,
    }),
  }
}

export function HomeStatus({ status }: { status: HomeStatusData | null }) {
  const now = useMinuteClock()
  const { date, time } = parts(now, status?.place.timezone ?? null)

  /*
   * The same function the briefing calls, so one forecast cannot be worded two
   * ways on one screen.
   */
  const weather = status?.weather
    ? describeTodayWeather(
        status.weather,
        status.freshness,
        status.fetchedAt,
        Math.floor(now.getTime() / 1000),
      )
    : null

  return (
    <p className="home-status">
      {/*
        * The place is named in BOTH states, not only while travelling.
        *
        * Naming it only on a trip is what would turn this row into a lie the
        * rest of the time: an unlabelled temperature is read as "here", and the
        * whole point of the row is that "here" changes.
        */}
      {status ? <span className="home-status-place">{status.place.name}</span> : null}
      <span className="home-status-date">{date}</span>
      <span className="home-status-time">{time}</span>
      {/*
        * Absent rather than empty when there is no forecast. Open-Meteo is
        * unreachable from the build environment, so this is the state every
        * screenshot and every end-to-end run sees — it has to be a row that
        * still reads correctly with the weather missing, not a gap where one
        * should be.
        */}
      {weather ? <span className="home-status-weather">{weather.text}</span> : null}
    </p>
  )
}
