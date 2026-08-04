// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'

/**
 * A device that has unlocked before does not wait for the session check (P1b).
 *
 * These are the tests that stand between "Home opens immediately" and "Home
 * opens immediately for people who are not signed in", so most of them are
 * about the second half. The mechanism is one line — the initial `AuthState` —
 * and everything that makes it safe is somewhere else: `requireSession` on the
 * server, the 401 handler, and sign-out clearing the flag.
 *
 * What is deliberately NOT asserted here: that a request without a valid cookie
 * is refused. That is the server's job and `tests/integration` owns it. This
 * file only proves the client never decides it.
 */

const UNLOCKED_KEY = 'pack-smart:unlocked-before'

/** Resolves when the test says so, so the optimistic window can be inspected. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Answers the session check when told to, and every other endpoint with an
 * empty-but-valid body so the routes can mount without exploding.
 */
function stubFetch(session: Promise<Response>) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = typeof input === 'string' ? input : input.toString()
    calls.push(path)
    if (path.startsWith('/api/auth/session')) return session
    if (path.startsWith('/api/trips')) return jsonResponse({ trips: [] })
    if (path.startsWith('/api/items')) return jsonResponse({ items: [] })
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('the session check no longer gates the first render', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('mounts the route and asks for its data BEFORE the session check answers', async () => {
    window.localStorage.setItem(UNLOCKED_KEY, '1')
    const session = deferred<Response>()
    const calls = stubFetch(session.promise)

    renderApp('/trips')

    // The screen is on the page and its own request is already out, with the
    // session check still unanswered. This is the whole point of the slice:
    // before it, both of these were impossible until the session resolved.
    await screen.findByRole('heading', { name: /Trips/i })
    await waitFor(() => expect(calls).toContain('/api/trips'))

    session.resolve(jsonResponse({ authenticated: true }))
  })

  it('waits, and shows nothing, on a device that has never unlocked', async () => {
    const session = deferred<Response>()
    const calls = stubFetch(session.promise)

    const { container } = renderApp('/trips')

    // No heading, no route, and — the part that matters — no data request.
    expect(screen.queryByRole('heading', { name: /Trips/i })).toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(calls.filter((c) => c.startsWith('/api/trips'))).toEqual([])

    session.resolve(jsonResponse({ authenticated: true }))
    await screen.findByRole('heading', { name: /Trips/i })
  })

  it('drops to Unlock when the server says the session is not valid', async () => {
    window.localStorage.setItem(UNLOCKED_KEY, '1')
    const session = deferred<Response>()
    stubFetch(session.promise)

    renderApp('/trips')
    await screen.findByRole('heading', { name: /Trips/i })

    session.resolve(jsonResponse({ authenticated: false }))

    await screen.findByLabelText(/Passphrase/i)
    // And the optimism is not repeated on the next launch.
    expect(window.localStorage.getItem(UNLOCKED_KEY)).toBeNull()
  })

  it('drops to Unlock when a guarded endpoint answers 401', async () => {
    window.localStorage.setItem(UNLOCKED_KEY, '1')
    // The session check never answers at all — a 401 from the screen's own
    // request has to be enough on its own, because on a slow connection it
    // will often arrive first.
    const never = new Promise<Response>(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = typeof input === 'string' ? input : input.toString()
        if (path.startsWith('/api/auth/session')) return never
        return jsonResponse({ error: { code: 'unauthorized', message: 'Sign in.' } }, 401)
      }),
    )

    renderApp('/trips')

    await screen.findByLabelText(/Passphrase/i)
    expect(window.localStorage.getItem(UNLOCKED_KEY)).toBeNull()
  })
})
