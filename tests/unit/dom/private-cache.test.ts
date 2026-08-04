// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPrivateCaches } from '@/lib/privateCache'

/**
 * Signing out takes the cached trip with it.
 *
 * The service worker caches every successful `GET /api/*` so the packing list
 * is readable on a plane. Nothing ever deleted it, so the wardrobe, the
 * itinerary and the checklist stayed on the device after Alex signed out. Not
 * an exposure — the app shows Unlock and the endpoints answer 401 — but private
 * data outliving the session that owned it.
 *
 * The shell cache staying is not an oversight. It holds `index.html` and the
 * hashed JavaScript, which are identical for every visitor and are the reason
 * the app opens at all without signal; deleting it would leave a signed-out
 * phone on a plane unable to reach even the Unlock screen.
 */

function stubCaches(keys: string[]) {
  const deleted: string[] = []
  vi.stubGlobal('caches', {
    keys: () => Promise.resolve(keys),
    delete: (key: string) => {
      deleted.push(key)
      return Promise.resolve(true)
    },
  })
  return deleted
}

/** No worker controlling the page, so the fallback path is the one under test. */
function withoutWorker() {
  vi.stubGlobal('navigator', { serviceWorker: { controller: null } })
}

describe('clearPrivateCaches', () => {
  beforeEach(() => {
    withoutWorker()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deletes the data caches and keeps the shell', async () => {
    const deleted = stubCaches([
      'pack-smart-shell-v2',
      'pack-smart-data-v2',
      'pack-smart-data-v1',
    ])

    await clearPrivateCaches()

    expect(deleted.sort()).toEqual(['pack-smart-data-v1', 'pack-smart-data-v2'])
  })

  it('matches every generation, so a VERSION bump cannot strand one', async () => {
    const deleted = stubCaches(['pack-smart-data-v9', 'something-else'])

    await clearPrivateCaches()

    expect(deleted).toEqual(['pack-smart-data-v9'])
  })

  it('resolves quietly where the Cache API does not exist', async () => {
    vi.stubGlobal('caches', undefined)
    await expect(clearPrivateCaches()).resolves.toBeUndefined()
  })

  it('resolves quietly when storage refuses', async () => {
    vi.stubGlobal('caches', {
      keys: () => Promise.reject(new Error('storage denied')),
      delete: () => Promise.resolve(true),
    })
    await expect(clearPrivateCaches()).resolves.toBeUndefined()
  })
})

/**
 * When a worker IS in charge, it does the deleting.
 *
 * Not a delegation for tidiness. The worker does not await its own `cache.put`,
 * so a delete issued from the page races every response still in the air — and
 * `caches.open` on a name that has just been deleted creates it again, writing
 * the signed-out session's data back to disk. Only the worker can exclude the
 * requests already in flight before it deletes anything.
 */
describe('clearPrivateCaches, with a service worker in charge', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubController(reply: { ok: boolean } | 'silent') {
    const posted: unknown[] = []
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {
          postMessage: (message: unknown, transfer: MessagePort[]) => {
            posted.push(message)
            if (reply === 'silent') return
            // The worker answers on the port it was handed.
            transfer[0]?.postMessage(reply)
          },
        },
      },
    })
    return posted
  }

  it('asks the worker, and does not touch the caches itself', async () => {
    const posted = stubController({ ok: true })
    const deleted = stubCaches(['pack-smart-data-v2'])

    await clearPrivateCaches()

    expect(posted).toEqual([{ type: 'pack-smart:clear-data' }])
    expect(deleted).toEqual([])
  })

  it('falls back to deleting from here when the worker says it could not', async () => {
    stubController({ ok: false })
    const deleted = stubCaches(['pack-smart-data-v2', 'pack-smart-shell-v2'])

    await clearPrivateCaches()

    expect(deleted).toEqual(['pack-smart-data-v2'])
  })

  it('falls back when the worker never answers, rather than hanging sign-out', async () => {
    vi.useFakeTimers()
    stubController('silent')
    const deleted = stubCaches(['pack-smart-data-v2'])

    const clearing = clearPrivateCaches()
    await vi.advanceTimersByTimeAsync(2100)
    await clearing

    expect(deleted).toEqual(['pack-smart-data-v2'])
    vi.useRealTimers()
  })
})
