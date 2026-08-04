import { Hono } from 'hono'
import { apiError, requireSession } from './auth'
import type { AppBindings } from './env'
import { authRoutes } from './routes/auth'
import { healthRoutes } from './routes/health'
import { itineraryRoutes } from './routes/itinerary'
import { importRoutes } from './routes/import'
import { itemRoutes } from './routes/items'
import { settingsRoutes } from './routes/settings'
import { tripRoutes } from './routes/trips'

const app = new Hono<AppBindings>()

/**
 * Security headers on every response.
 *
 * noindex is not decoration: this site stores travel dates and medication names
 * (technical-docs/01_ARCHITECTURE.md §8) and must never appear in a search index.
 */
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'same-origin')
  c.header('X-Robots-Tag', 'noindex, nofollow')
})

/**
 * No API answer may be kept in the browser's own HTTP cache.
 *
 * Pack Smart deliberately keeps a copy of the trip on the device — that is what
 * makes the packing list readable on a plane — but it keeps it in **Cache
 * Storage**, where the app can see it, label it as a snapshot, and delete it on
 * sign-out (`src/lib/privateCache.ts`). The browser's HTTP disk cache is a
 * second store with none of those properties: nothing in the app can enumerate
 * it and nothing can clear it, so anything that lands there outlives the
 * session with no way to end it.
 *
 * Without a directive the responses carried none at all, and a heuristically
 * cached wardrobe is a wardrobe on the disk that sign-out cannot reach. One
 * header, on the one prefix that ever returns Alex's data.
 */
app.use('/api/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})

app.route('/api/health', healthRoutes)
app.route('/api/auth', authRoutes)

/**
 * Everything else under /api requires a session.
 *
 * Mounted AFTER the two public route groups, so it guards the product endpoints
 * added from M1 onward without any per-route opt-in to forget.
 */
app.use('/api/*', requireSession)

/* Product endpoints — all behind the guard above. */
app.route('/api/items', itemRoutes)
app.route('/api/import', importRoutes)
app.route('/api/itinerary', itineraryRoutes)
app.route('/api/trips', tripRoutes)
app.route('/api/settings', settingsRoutes)

app.all('/api/*', (c) => c.json(apiError('bad_request', 'No such endpoint.'), 404))

/**
 * Everything that is not an API route is the SPA.
 *
 * Static files that exist are served by the asset router before the Worker is
 * ever invoked. What reaches here is a client-side route like /my-stuff, and
 * forwarding it to the ASSETS binding returns index.html because wrangler.jsonc
 * sets `not_found_handling: single-page-application`. Without this the Worker
 * would 404 every deep link and every refresh away from "/".
 */
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
