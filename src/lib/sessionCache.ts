/**
 * What a screen already knew, so tapping back to it is instant (P1c).
 *
 * Every tab refetched everything on every mount. Tapping Home → Trips → Home
 * cost the full waterfall three times, and Alex is doing that beside an open
 * suitcase, one-handed, repeatedly. The data almost never changed between two
 * of those taps.
 *
 * **In memory only.** Nothing here is written to `localStorage`, IndexedDB or
 * any cache the browser keeps. It lives in the JavaScript heap of one page and
 * dies when that page does, which is what makes "private data must not outlive
 * the session" true by construction rather than by remembering to tidy up.
 * (The service worker's on-disk cache is a different thing with a different
 * lifetime; `privateCache.ts` owns clearing that.)
 *
 * **Stale is shown, never trusted.** A cached snapshot paints immediately and
 * the screen refetches behind it every single time — this is not a read-through
 * cache and no request is ever skipped. The worst case is one paint of data
 * that is a few seconds old, replaced before Alex has finished looking at it.
 *
 * **Any write empties it.** `apiFetch` calls `forgetSessionCache()` on every
 * non-GET, so packing an item, deleting a trip or approving an outfit cannot
 * leave a screen showing what was true before. That is deliberately blunt: a
 * per-key invalidation map is a second model of what depends on what, and
 * getting it subtly wrong shows Alex a trip he just deleted.
 */

const store = new Map<string, unknown>()

export function remember<T>(key: string, value: T): void {
  store.set(key, value)
}

export function recall<T>(key: string): T | undefined {
  return store.get(key) as T | undefined
}

/**
 * Emptied on any write, on sign-out, on a `false` session answer, and on any
 * 401 — so nothing cached can outlive the session it was fetched under.
 */
export function forgetSessionCache(): void {
  store.clear()
}
