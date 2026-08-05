import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The order `public/sw.js` decides a request in, asserted against the source.
 *
 * A source-level guard, like the one Q1 added for e2e ownership, and for the
 * same reason: the failure is silent, and no behavioural test in this
 * repository would notice it. A service worker cannot be imported and exercised
 * from Node, and the one browser that matters — WebKit — does not dispatch
 * `fetch` for `<a download>` at all, so an e2e that passed there would prove
 * nothing about the engines that do.
 *
 * What it guards: `Download a backup` in Settings is
 * `<a href="/api/settings/export" download>`, which Chromium dispatches with
 * `mode: 'navigate'`. With the navigate branch checked first, that request went
 * to `handleNavigation`, which caches what it gets under `'/'` in the SHELL
 * cache — so the complete data export, every trip and every medication name,
 * would be stored under the key the worker serves as the app shell offline.
 * Two failures in one: the shell breaks, and the copy lands in the one cache
 * `clearPrivateCaches()` deliberately spares.
 */

const source = readFileSync(
  fileURLToPath(new URL('../../public/sw.js', import.meta.url)),
  'utf8',
)

/** Where a branch begins in the fetch handler, by the condition it tests. */
function positionOf(marker: string): number {
  const at = source.indexOf(marker)
  expect(at, `sw.js no longer contains ${marker}`).toBeGreaterThan(-1)
  return at
}

describe('the service worker decides /api before it decides navigation', () => {
  it('checks the /api prefix before the navigate mode', () => {
    const fetchHandler = source.indexOf("self.addEventListener('fetch'")
    expect(fetchHandler).toBeGreaterThan(-1)

    const api = source.indexOf("url.pathname.startsWith('/api/')", fetchHandler)
    const navigate = source.indexOf("request.mode === 'navigate'", fetchHandler)

    expect(api).toBeGreaterThan(-1)
    expect(navigate).toBeGreaterThan(-1)
    expect(api, '/api must be decided before navigate').toBeLessThan(navigate)
  })

  it('sends the backup export straight to the network, cached nowhere', () => {
    expect(source).toContain("url.pathname === '/api/settings/export'")
  })

  it('still excludes auth and health from the data cache', () => {
    positionOf("url.pathname.startsWith('/api/auth/')")
    positionOf("url.pathname.startsWith('/api/health')")
  })

  it('drops a response fetched under a session that has since ended', () => {
    // The epoch is what makes clearing the cache from the page safe: without
    // it, a GET issued before sign-out can resolve after the delete, and
    // `caches.open` recreates the cache it was just deleted from.
    expect(source).toContain('let cacheEpoch = 0')
    expect(source).toContain('epoch === cacheEpoch')
    expect(source).toContain("event.data?.type !== 'pack-smart:clear-data'")
  })
})

/**
 * The service worker must never replay a queued write (F2).
 *
 * It would be the obvious place to put it — Background Sync exists precisely to
 * flush a queue when connectivity returns — and it is the wrong place, for a
 * reason no behavioural test could catch:
 *
 * A worker **outlives the page**. It keeps running after the last tab closes,
 * so it can fire long after Alex signed out, and it has no access to the state
 * that would tell it — `lock()` runs in the page, and the session marker lives
 * in `localStorage`, which a worker cannot read at all. A sync event that woke
 * up an hour later would send a signed-out session's packing to the server on
 * the strength of a cookie the browser attaches automatically.
 *
 * So replay lives in the app, behind `lock()`, and this guards the decision at
 * the source — the same technique, and for the same reason, as the `/api`
 * ordering above.
 */
describe('the service worker never sends a write of its own', () => {
  it('registers no sync or periodic-sync handler', () => {
    expect(source).not.toContain("addEventListener('sync'")
    expect(source).not.toContain("addEventListener('periodicsync'")
    expect(source).not.toMatch(/registration\.sync/)
  })

  it('answers nothing but GET, so no queued write can pass through it', () => {
    // The first line of the fetch handler, and the whole of the guarantee: a
    // PATCH is not intercepted, not cached, and not retried — it goes to the
    // network or it fails, and the app decides what that means.
    expect(source).toContain("if (request.method !== 'GET') return")
  })

  it('reads nothing from the write queue', () => {
    // Belt and braces against a future edit: the worker has no business
    // knowing this key exists, and a worker that reads it is a worker that is
    // about to act on it.
    expect(source).not.toContain('pending-writes')
  })
})
