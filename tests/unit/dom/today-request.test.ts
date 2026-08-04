// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_DATE_HEADER, fetchToday, recordWear, swapForToday } from '@/lib/trips'

/**
 * What Today asks the server for, and what the service worker will make of it.
 *
 * `sw.js` caches `GET /api/*` keyed on the **full URL**, honouring the query
 * string. So the phone's own date — which E1 sends so the server can answer
 * "what day is it" without falling back to UTC — cannot ride in a query
 * parameter: it would mint a fresh cache entry every midnight, and miss the
 * previous day's entry entirely on precisely the day an offline read is worth
 * having.
 *
 * This is a caching contract rather than a style preference, and it is asserted
 * here because nothing else can see it: the URL looks perfectly reasonable
 * either way, and the failure only shows up offline, the day after.
 */

function mockResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the Today request', () => {
  it('asks for the same URL whatever day it is', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(mockResponse({ date: '2026-08-04' })),
    )

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T12:00:00'))
    await fetchToday('trip-1')
    vi.setSystemTime(new Date('2026-08-05T12:00:00'))
    await fetchToday('trip-1')

    const [first, second] = spy.mock.calls.map((call) => String(call[0]))
    expect(first).toBe('/api/trips/trip-1/today')
    expect(second).toBe(first)
  })

  it('carries the phone’s date in a header, where the cache key cannot see it', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(mockResponse({ date: '2026-08-04' })),
    )

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T12:00:00'))
    await fetchToday('trip-1')

    expect(headersOf(spy.mock.calls[0]?.[1])[CLIENT_DATE_HEADER]).toBe('2026-08-04')
  })

  it('still lets Alex page to a chosen day, which is a different URL on purpose', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(mockResponse({ date: '2026-08-06' })),
    )

    await fetchToday('trip-1', '2026-08-06')
    expect(String(spy.mock.calls[0]?.[0])).toBe('/api/trips/trip-1/today?date=2026-08-06')
  })

  it('sends the same header on the writes, so they resolve the same day', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(mockResponse({ date: '2026-08-04' })),
    )

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T12:00:00'))

    await recordWear('trip-1', '2026-08-04', 'item-1', 'will_wear')
    await swapForToday('trip-1', '2026-08-04', 'item-1', 'item-2')

    for (const call of spy.mock.calls) {
      expect(headersOf(call[1])[CLIENT_DATE_HEADER]).toBe('2026-08-04')
      // And never in the body, where the two would drift.
      expect(String(call[1]?.body ?? '')).not.toContain('"today"')
    }
  })
})
