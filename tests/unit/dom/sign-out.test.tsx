// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '@/routes/Settings'

/**
 * A sign-out that did not happen says so.
 *
 * This was a `finally`: whatever the request did, forget the device, empty both
 * caches, drop to Unlock. That looks like signing out and is not one. The
 * session is a cookie the SERVER clears, so a POST that never arrived leaves it
 * valid — and the next launch with signal answers `authenticated: true` and
 * walks straight back in, having in the meantime deleted the offline copy of
 * the trip Alex was relying on.
 *
 * The wrong half of that trade is obvious written down: what ended was his
 * packing list on the plane; what survived was the credential.
 */

const UNLOCKED_KEY = 'pack-smart:unlocked-before'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderSettings(onSignedOut: () => void) {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Settings onSignedOut={onSignedOut} />
    </MemoryRouter>,
  )
}

describe('signing out', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(UNLOCKED_KEY, '1')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ends the session when the server confirms it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = typeof input === 'string' ? input : input.toString()
        if (path.startsWith('/api/auth/logout')) return jsonResponse({ authenticated: false })
        return jsonResponse({})
      }),
    )
    const onSignedOut = vi.fn()
    renderSettings(onSignedOut)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(onSignedOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says so, and stays signed in, when the request never reached the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network')
      }),
    )
    const onSignedOut = vi.fn()
    renderSettings(onSignedOut)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/still signed in/i)
    expect(onSignedOut).not.toHaveBeenCalled()
    // The device is NOT forgotten: the cookie is still valid, so pretending
    // otherwise would only cost Alex the offline copy of his trip.
    expect(window.localStorage.getItem(UNLOCKED_KEY)).toBe('1')
  })

  it('says so when the server refuses, rather than locking on a 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { code: 'internal', message: 'no' } }, 500)),
    )
    const onSignedOut = vi.fn()
    renderSettings(onSignedOut)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(onSignedOut).not.toHaveBeenCalled()
  })

  it('clears the message when a retry succeeds', async () => {
    let failing = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = typeof input === 'string' ? input : input.toString()
        if (path.startsWith('/api/auth/logout')) {
          if (failing) throw new TypeError('network')
          return jsonResponse({ authenticated: false })
        }
        return jsonResponse({})
      }),
    )
    const onSignedOut = vi.fn()
    renderSettings(onSignedOut)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toBeVisible()

    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(onSignedOut).toHaveBeenCalledTimes(1)
  })
})
