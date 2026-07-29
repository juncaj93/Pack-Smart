import { Hono } from 'hono'
import { apiError, requireSession } from './auth'
import type { AppBindings } from './env'
import { authRoutes } from './routes/auth'
import { healthRoutes } from './routes/health'
import { importRoutes } from './routes/import'
import { itemRoutes } from './routes/items'

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
