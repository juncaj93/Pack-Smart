// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { SESSION_EXPIRED_EVENT } from '@/lib/api'

/**
 * A queued write dies with the session that made it (F2).
 *
 * The queue's own behaviour is `write-queue.test.ts`. This file asks the other
 * question: does the APP actually end it, on every path that ends a session?
 * There are four — a 401, a `false` session answer, Sign out on this device,
 * and Sign out in another tab — and they all converge on `lock()`, which is the
 * only reason one list of what-to-forget is enough.
 *
 * Written at the App level on purpose. Asserting that `clearQueue` works proves
 * nothing about whether anything calls it, and "the sign-out path quietly lost
 * a line" is exactly the defect this is standing in front of.
 */

const UNLOCKED_KEY = 'pack-smart:unlocked-before'
const SESSION_ID_KEY = 'pack-smart:session-id'
const QUEUE_KEY = 'pack-smart:pending-writes'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubFetch(session: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path.startsWith('/api/auth/session')) return jsonResponse(session, status)
      if (path.startsWith('/api/trips')) return jsonResponse({ trips: [] })
      return jsonResponse({})
    }),
  )
}

/** One record, exactly as `enqueue` writes it. */
function queueOneWrite(session = 'session-a') {
  window.localStorage.setItem(
    QUEUE_KEY,
    JSON.stringify([
      {
        key: 'e1:packedQty',
        tripId: 't1',
        entryId: 'e1',
        entryName: 'Sunscreen',
        field: 'packedQty',
        value: 1,
        at: 1_780_000_000_000,
        baseUpdatedAt: 100,
        session,
        attempts: 0,
        failure: null,
      },
    ]),
  )
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/trips']}>
      <App />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('ending a session takes the pending writes with it', () => {
  it('drops them when the server answers 401', async () => {
    window.localStorage.setItem(UNLOCKED_KEY, '1')
    window.localStorage.setItem(SESSION_ID_KEY, 'session-a')
    queueOneWrite()
    stubFetch({ authenticated: true })

    renderApp()
    await waitFor(() => expect(window.localStorage.getItem(UNLOCKED_KEY)).toBe('1'))

    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
    })

    await waitFor(() => expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull())
    // And the marker, so nothing left behind by any other means is eligible either.
    expect(window.localStorage.getItem(SESSION_ID_KEY)).toBeNull()
    expect(window.localStorage.getItem(UNLOCKED_KEY)).toBeNull()
  })

  it('drops them when the session check says no', async () => {
    window.localStorage.setItem(UNLOCKED_KEY, '1')
    window.localStorage.setItem(SESSION_ID_KEY, 'session-a')
    queueOneWrite()
    stubFetch({ authenticated: false })

    renderApp()

    await waitFor(() => expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull())
    expect(window.localStorage.getItem(SESSION_ID_KEY)).toBeNull()
  })

  it('drops them when another tab signs out', async () => {
    window.localStorage.setItem(UNLOCKED_KEY, '1')
    window.localStorage.setItem(SESSION_ID_KEY, 'session-a')
    queueOneWrite()
    stubFetch({ authenticated: true })

    renderApp()
    await waitFor(() => expect(window.localStorage.getItem(UNLOCKED_KEY)).toBe('1'))

    /*
     * `storage` is what one tab hears when another one signs out. Without this
     * the second tab kept a valid-looking session AND a queue, and would have
     * gone on replaying writes on behalf of a session Alex had closed on the
     * device.
     */
    act(() => {
      window.localStorage.removeItem(UNLOCKED_KEY)
      window.dispatchEvent(
        new StorageEvent('storage', { key: UNLOCKED_KEY, newValue: null }),
      )
    })

    await waitFor(() => expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull())
  })

  it('does not replay anything at all after the session ends', async () => {
    window.localStorage.setItem(UNLOCKED_KEY, '1')
    window.localStorage.setItem(SESSION_ID_KEY, 'session-a')
    queueOneWrite()

    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = typeof input === 'string' ? input : input.toString()
        calls.push(`${init?.method ?? 'GET'} ${path}`)
        if (path.startsWith('/api/auth/session')) return jsonResponse({ authenticated: false })
        return jsonResponse({})
      }),
    )

    renderApp()
    await waitFor(() => expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull())

    expect(calls.some((call) => call.startsWith('PATCH'))).toBe(false)
  })
})

describe('a new session is a new session', () => {
  it('will not inherit a queue left by the previous one', async () => {
    // Signed out: no flag, no marker, and — because a real sign-out clears it —
    // no queue either. This is the belt-and-braces case where one survived.
    queueOneWrite('session-a')
    stubFetch({ authenticated: false })

    renderApp()
    await waitFor(() => expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull())
  })
})
