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

/** Long enough for a disk delete, short enough not to hold up sign-out. */
const WORKER_REPLY_TIMEOUT_MS = 2000

/**
 * Asks the service worker to empty its own data cache.
 *
 * **The worker has to be the one to do it**, because deleting from out here is
 * a race the page cannot win. `handleApiRead` deliberately does not await its
 * `cache.put` — making every read wait on a disk write would be worse than the
 * problem — so a request issued a moment before sign-out can resolve a moment
 * after the delete, and `caches.open` on a name that has just been deleted
 * **creates it again**. The response would be written back into a cache nothing
 * would clear until the next sign-out.
 *
 * Inside the worker there is an epoch counter and a set of in-flight writes, so
 * it can exclude everything already in the air before it deletes anything. That
 * ordering is not expressible from here.
 */
async function askWorkerToClear(): Promise<boolean> {
  const controller =
    typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : undefined
  if (!controller || typeof MessageChannel === 'undefined') return false

  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(false), WORKER_REPLY_TIMEOUT_MS)
    channel.port1.onmessage = (event: MessageEvent<{ ok?: boolean }>) => {
      clearTimeout(timer)
      resolve(event.data?.ok === true)
    }
    try {
      controller.postMessage({ type: 'pack-smart:clear-data' }, [channel.port2])
    } catch {
      clearTimeout(timer)
      resolve(false)
    }
  })
}

/**
 * Drops every cached response belonging to the session that is ending.
 *
 * The SHELL cache is deliberately kept: it holds `index.html` and the hashed
 * JavaScript, which are the same bytes for every visitor and are what makes the
 * app open at all offline. Deleting it would mean a signed-out phone with no
 * signal could not even reach the Unlock screen.
 *
 * Never throws and never blocks the caller for long. Sign-out has to complete
 * whatever the Cache API does — being unable to tidy up is not a reason to
 * strand Alex in a half-authenticated shell.
 */
export async function clearPrivateCaches(): Promise<void> {
  try {
    if (await askWorkerToClear()) return

    /*
     * No worker controlling this page — a first load before it activates, a
     * dev build, or a browser with one disabled. Then there is no un-awaited
     * write to race, because the worker is the only thing that writes to this
     * cache, and doing it from here is exactly right.
     */
    if (typeof caches === 'undefined') return
    const keys = await caches.keys()
    await Promise.all(
      keys.filter((key) => key.startsWith(DATA_CACHE_PREFIX)).map((key) => caches.delete(key)),
    )
  } catch {
    /* No Cache API, or storage denied. There is nothing to fall back to. */
  }
}
