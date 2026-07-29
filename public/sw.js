/*
 * Pack Smart service worker.
 *
 * Offline READS of the active trip and today's plan are non-negotiable for v1
 * (technical-docs/01_ARCHITECTURE.md §5, milestone M10). Offline WRITES are not:
 * hotel wifi that drops mid-tap should never leave the packing list in a state
 * Alex cannot see, so a failed write fails loudly rather than queueing silently.
 *
 * Three strategies, chosen per request:
 *
 *   navigation  -> network first, falling back to the cached shell, so a deep
 *                  link still opens on a plane
 *   /assets/*   -> cache first; the filenames are content-hashed, so a cached
 *                  one can never be stale
 *   GET /api/*  -> network first, falling back to the last good response, which
 *                  is what makes the trip readable offline
 *
 * Anything else — every POST, PUT, PATCH — goes straight to the network and is
 * never cached.
 */

const VERSION = 'v1'
const SHELL_CACHE = `pack-smart-shell-${VERSION}`
const DATA_CACHE = `pack-smart-data-${VERSION}`

/** Marks a response that came from the cache, so the UI can say so. */
const CACHED_HEADER = 'x-pack-smart-cached'

/*
 * `Cache.match` honours Vary by default, and the server sends `Vary: Origin`.
 * A navigation request carries no Origin header, so a perfectly good cached
 * page silently fails to match and the app opens blank offline. Nothing here is
 * served per-origin — there is one origin — so Vary is not meaningful.
 */
const MATCH = { ignoreVary: true }

/**
 * Caches the shell, including the hashed script and stylesheet.
 *
 * Those two must be precached here rather than picked up as they are requested.
 * A service worker does not intercept the page that registered it, so by the
 * time it is running, the browser has already loaded them and will not ask
 * again — leaving a cache with index.html and nothing to run, which is a blank
 * screen on the plane.
 *
 * The filenames are content-hashed and change every build, so they are read out
 * of index.html rather than hard-coded or generated at build time.
 */
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE)

  const response = await fetch('/', { cache: 'reload' })
  const html = await response.clone().text()
  await cache.put('/', response)

  const assets = new Set(['/manifest.webmanifest'])
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    if (match[1]) assets.add(match[1])
  }

  await Promise.all(
    [...assets].map(async (url) => {
      try {
        const asset = await fetch(url, { cache: 'reload' })
        if (asset.ok) await cache.put(url, asset)
      } catch {
        // One missing asset must not fail the whole install; the rest are still
        // worth having.
      }
    }),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell())
  // The new worker is the one the user just loaded the page with; waiting would
  // mean shipping a fix that does not take effect until a second launch.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

/** Re-wraps a cached response so the app can tell it is not live. */
async function markCached(response) {
  const headers = new Headers(response.headers)
  headers.set(CACHED_HEADER, '1')
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE)
      cache.put('/', response.clone())
    }
    return response
  } catch {
    const cached = (await caches.match('/', MATCH)) ?? (await caches.match(request, MATCH))
    if (cached) return cached

    /*
     * Never reject.
     *
     * A rejected respondWith makes the browser retry on its own network, which
     * offline means its "No internet" page — losing the app entirely on the one
     * occasion it matters most. A plain page that says what happened is a far
     * better answer, and it only appears if the shell was never cached at all.
     */
    return new Response(
      '<!doctype html><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
        '<title>Pack Smart</title>' +
        '<body style="font:16px -apple-system,system-ui,sans-serif;padding:2rem;color:#16161a">' +
        '<h1 style="font-size:1.3rem">You are offline</h1>' +
        '<p>Pack Smart has not finished saving a copy of your trip yet. ' +
        'Open it once with a connection and it will work offline after that.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

async function handleAsset(request) {
  const cached = await caches.match(request, MATCH)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE)
    cache.put(request, response.clone())
  }
  return response
}

async function handleApiRead(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request, MATCH)
    if (cached) return markCached(cached)

    // Nothing cached. An honest failure is better than an empty screen that
    // looks like the trip has no items in it.
    return new Response(
      JSON.stringify({ error: { code: 'offline', message: 'You are offline and this has not been loaded before.' } }),
      { status: 503, headers: { 'Content-Type': 'application/json', [CACHED_HEADER]: '0' } },
    )
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(handleAsset(request))
    return
  }

  if (url.pathname.startsWith('/api/')) {
    // Auth is deliberately excluded: serving a stale session check would tell
    // Alex he is signed in when he may not be.
    if (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/health')) return
    event.respondWith(handleApiRead(request))
    return
  }

  if (url.pathname === '/' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(handleAsset(request))
  }
})
