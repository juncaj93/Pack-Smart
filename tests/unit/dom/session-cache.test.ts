// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '@/lib/api'
import { forgetSessionCache, recall, remember } from '@/lib/sessionCache'

/**
 * The in-memory snapshots, and the one rule that keeps them honest (P1c).
 *
 * A screen that has been open once this session paints from its last answer
 * instead of an empty frame. That is only safe because **any write empties the
 * whole store** — otherwise packing an item or deleting a trip would leave the
 * next tab showing what was true before, which is worse than the slow screen it
 * replaced.
 *
 * Blunt on purpose. A per-key invalidation map is a second model of what
 * depends on what, and getting it subtly wrong shows Alex a trip he just
 * deleted.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('the session cache', () => {
  beforeEach(() => {
    forgetSessionCache()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hands back what it was given', () => {
    remember('trips', [{ id: 'a' }])
    expect(recall<Array<{ id: string }>>('trips')).toEqual([{ id: 'a' }])
  })

  it('answers undefined for a key it has never seen', () => {
    expect(recall('nothing')).toBeUndefined()
  })

  it('survives a GET, which changes nothing', async () => {
    remember('trips', ['kept'])
    await apiFetch('/api/trips')
    expect(recall('trips')).toEqual(['kept'])
  })

  it('survives a request with no method at all, which is also a GET', async () => {
    remember('trips', ['kept'])
    await apiFetch('/api/trips', {})
    expect(recall('trips')).toEqual(['kept'])
  })

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'delete']) {
    it(`is emptied by a ${method}`, async () => {
      remember('trips', ['stale'])
      remember('home', { trip: 'stale' })
      await apiFetch('/api/trips/abc', { method })
      expect(recall('trips')).toBeUndefined()
      expect(recall('home')).toBeUndefined()
    })
  }

  it('is emptied by a write that FAILS, because a failed write may still have applied', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network')
      }),
    )
    remember('trips', ['stale'])

    await expect(apiFetch('/api/trips/abc', { method: 'DELETE' })).rejects.toThrow()

    expect(recall('trips')).toBeUndefined()
  })

  it('is emptied by a write the server REJECTS, for the same reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { code: 'internal', message: 'no' } }, 500)),
    )
    remember('trips', ['stale'])

    await expect(apiFetch('/api/trips/abc', { method: 'POST' })).rejects.toThrow()

    expect(recall('trips')).toBeUndefined()
  })
})
