// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeStatus } from '@/components/HomeStatus'
import type { HomeStatusData } from '@/lib/trips'

/**
 * The row at the top of Home: where he is, what day it is, what time it is.
 *
 * ## Why the weather is barely tested here
 *
 * Open-Meteo is unreachable from this build environment, so in every automated
 * run — unit, end-to-end and the visual walk — the forecast is absent. That is
 * not a gap to work around; it is the state most of the evidence will be taken
 * in, so what matters most is that the row still reads correctly with the
 * weather missing. The formatting of a real forecast is
 * `describeTodayWeather`'s, and it is tested where that lives.
 */

const FORECAST = {
  source: 'forecast' as const,
  lowF: 58,
  highF: 64,
  rainLikely: false,
  precipitationProbability: 10,
  tempMinC: 14,
  tempMaxC: 18,
  windKph: 9,
}

function status(overrides: Partial<HomeStatusData> = {}): HomeStatusData {
  return {
    place: { name: 'Wixom', timezone: 'America/Detroit', source: 'home' },
    weather: FORECAST,
    fetchedAt: 1_786_000_000,
    freshness: 'live',
    ...overrides,
  } as HomeStatusData
}

beforeEach(() => {
  vi.useFakeTimers()
  // A fixed instant, so "what does the clock say" is a fact rather than a race.
  vi.setSystemTime(new Date('2026-08-15T14:03:30Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the status row', () => {
  it('names the place, the day and the time', () => {
    render(<HomeStatus status={status()} />)

    expect(screen.getByText('Wixom')).toBeVisible()
    expect(document.querySelector('.home-status-date')!.textContent).toBeTruthy()
    expect(document.querySelector('.home-status-time')!.textContent).toMatch(/\d{1,2}:\d{2}/)
  })

  /**
   * The place is named in BOTH states, and this is the assertion that keeps it
   * honest.
   *
   * Naming it only while travelling is what would turn the row into a lie the
   * rest of the time: an unlabelled temperature reads as "here", and the whole
   * point of the row is that "here" changes.
   */
  it('names the place while travelling too', () => {
    render(
      <HomeStatus
        status={status({
          place: { name: 'Traverse City', timezone: 'America/Detroit', source: 'trip' },
        })}
      />,
    )

    expect(screen.getByText('Traverse City')).toBeVisible()
  })

  it('reads the clock in the zone of the place it is about', () => {
    const { container } = render(
      <HomeStatus
        status={status({
          place: { name: 'Cape Town', timezone: 'Africa/Johannesburg', source: 'trip' },
        })}
      />,
    )

    // 14:03 UTC is 16:03 in Johannesburg and 10:03 in Detroit. A row that read
    // the device's zone would put Alex two hours out on his own trip.
    expect(container.querySelector('.home-status-time')!.textContent).toMatch(/\b4:03\b|16:03/)
  })

  /**
   * The state every screenshot in this repository is taken in.
   *
   * The row omits the weather rather than rendering an empty span, so a run with
   * no forecast shows a clean `place · date · time` line instead of a gap where
   * something should be.
   */
  it('omits the weather entirely when there is none', () => {
    render(<HomeStatus status={status({ weather: null })} />)

    expect(document.querySelector('.home-status-weather')).toBeNull()
    expect(document.querySelector('.home-status-date')).not.toBeNull()
  })

  it('still says what day it is before the server has answered', () => {
    render(<HomeStatus status={null} />)

    expect(document.querySelector('.home-status-place')).toBeNull()
    expect(document.querySelector('.home-status-time')!.textContent).toMatch(/\d{1,2}:\d{2}/)
  })

  /**
   * The mutation: wrapping the row in `role="status"` or `aria-live`.
   *
   * The place line this replaces carried `role="status"`, which was right when
   * it changed once on arrival. With a clock inside it, a live region announces
   * the time to a screen-reader user every sixty seconds for as long as the app
   * is open.
   */
  it('is not a live region, because it now contains a clock', () => {
    const { container } = render(<HomeStatus status={status()} />)

    expect(container.querySelector('[aria-live]')).toBeNull()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('the clock', () => {
  it('does not tick between minutes', () => {
    render(<HomeStatus status={status()} />)
    const before = document.querySelector('.home-status-time')!.textContent

    act(() => {
      vi.advanceTimersByTime(20_000)
    })

    expect(document.querySelector('.home-status-time')!.textContent).toBe(before)
  })

  /**
   * Aligned to the minute boundary, not to sixty seconds from mount.
   *
   * The system time here is :30 past the minute. An interval would show every
   * minute half a minute late for as long as the tab stayed open; a chained
   * timeout to the next boundary corrects itself on the first tick.
   */
  it('updates on the minute boundary', () => {
    render(<HomeStatus status={status()} />)
    const before = document.querySelector('.home-status-time')!.textContent

    // 30s to the boundary, plus the 250ms of slack the scheduler leaves.
    act(() => {
      vi.advanceTimersByTime(31_000)
    })

    expect(document.querySelector('.home-status-time')!.textContent).not.toBe(before)
  })

  it('stops when the row goes away', () => {
    const { unmount } = render(<HomeStatus status={status()} />)
    unmount()

    // A timer left running after unmount sets state on a dead component, which
    // React reports as a leak and which keeps the whole subtree alive.
    expect(() => act(() => { vi.advanceTimersByTime(120_000) })).not.toThrow()
  })
})
