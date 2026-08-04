// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('clearPrivateCaches', () => {
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
