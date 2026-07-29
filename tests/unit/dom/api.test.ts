// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, SESSION_EXPIRED_EVENT, apiFetch } from '@/lib/api'

function mockResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('apiFetch', () => {
  it('returns the parsed body on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, { authenticated: true }))
    await expect(apiFetch('/api/auth/session')).resolves.toEqual({ authenticated: true })
  })

  it('sends cookies same-origin so the HttpOnly session rides along', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockResponse(200, { ok: true }))

    await apiFetch('/api/health')

    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin' })
  })

  it('throws a typed error carrying the API error code', async () => {
    // A fresh Response per call: a body can only be read once, so a shared
    // mock would hand the second call an already-consumed stream.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        mockResponse(401, { error: { code: 'invalid_passphrase', message: 'Nope.' } }),
      ),
    )

    await expect(apiFetch('/api/auth/login')).rejects.toBeInstanceOf(ApiRequestError)
    await expect(apiFetch('/api/auth/login')).rejects.toMatchObject({
      code: 'invalid_passphrase',
      status: 401,
      message: 'Nope.',
    })
  })

  // This is what lets any 401, from any screen, drop straight back to Unlock
  // without every call site handling it.
  it('announces session expiry on a 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(401, { error: { code: 'unauthorized', message: 'Sign in to continue.' } }),
    )

    const onExpired = vi.fn()
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)

    await expect(apiFetch('/api/whatever')).rejects.toThrow()
    expect(onExpired).toHaveBeenCalledTimes(1)

    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  })

  it('does not announce expiry for other failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(429, { error: { code: 'rate_limited', message: 'Slow down.' } }),
    )

    const onExpired = vi.fn()
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)

    await expect(apiFetch('/api/auth/login')).rejects.toMatchObject({ code: 'rate_limited' })
    expect(onExpired).not.toHaveBeenCalled()

    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  })

  it('falls back to a usable message when the error body is not the expected shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>gateway error</html>', { status: 502 }),
    )

    await expect(apiFetch('/api/health')).rejects.toMatchObject({
      code: 'internal',
      status: 502,
    })
  })
})
