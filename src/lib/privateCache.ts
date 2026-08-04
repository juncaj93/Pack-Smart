/**
 * Everything on this device that belongs to a signed-in session, and the one
 * function that gets rid of it.
 *
 * The service worker caches every successful `GET /api/*` so the trip is
 * readable on a plane (`public/sw.js`). That cache is Alex's packing list,
 * his wardrobe and his itinerary, and it survived sign-out — nothing ever
 * deleted it. It was not *reachable* while signed out, because the app shows
 * Unlock and the guarded endpoints answer 401, so this was never an exposure.
 * It was, however, private data left on the device after the user asked for it
 * to be over, which is a different promise and one worth keeping.
 *
 * Named by prefix rather than by exact key so a `VERSION` bump in the worker
 * cannot quietly leave a generation behind.
 */
const DATA_CACHE_PREFIX = 'pack-smart-data-'

/**
 * Drops every cached response belonging to the session that is ending.
 *
 * The SHELL cache is deliberately kept: it holds `index.html` and the hashed
 * JavaScript, which are the same bytes for every visitor and are what makes the
 * app open at all offline. Deleting it would mean a signed-out phone with no
 * signal could not even reach the Unlock screen.
 *
 * Never throws and never blocks the caller. Sign-out has to complete whatever
 * the Cache API does — being unable to tidy up is not a reason to strand Alex in
 * a half-authenticated shell.
 */
export async function clearPrivateCaches(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return
    const keys = await caches.keys()
    await Promise.all(
      keys.filter((key) => key.startsWith(DATA_CACHE_PREFIX)).map((key) => caches.delete(key)),
    )
  } catch {
    /* No Cache API, or storage denied. There is nothing to fall back to. */
  }
}
