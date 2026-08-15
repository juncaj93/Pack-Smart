import { Hono } from 'hono'
import { isValidDate } from '@shared/trips'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import { homeLocation, homeWeather, setHomeLocation } from '../services/home-weather'

export const homeRoutes = new Hono<AppBindings>()

/** Mounted under /api/home, behind the session guard. */

/**
 * The phone's own calendar date, read off the request header.
 *
 * A HEADER rather than a query parameter, for the same reason `today.ts` uses
 * one: `sw.js` caches `GET /api/*` by full URL, so a `?today=` would mint a
 * fresh entry every midnight and miss the previous day's — on precisely the day
 * an offline read is worth having.
 */
const CLIENT_DATE_HEADER = 'X-Client-Date'

function deviceDate(c: { req: { header: (name: string) => string | undefined } }): string {
  const value = c.req.header(CLIENT_DATE_HEADER)
  // Validated rather than trusted: this decides which day's forecast is read,
  // and a malformed value must not put the row on a date that does not exist.
  return value && isValidDate(value) ? value : new Date().toISOString().slice(0, 10)
}

/**
 * What the Home status row says, in one request whatever the answer is.
 *
 * The place is resolved server-side — see `services/home-weather.ts` for why
 * that is not the client's decision to make.
 */
homeRoutes.get('/weather', async (c) => {
  /*
   * `waitUntil` is passed rather than reached for, because a direct route test
   * has no execution context. Same shape as `today.ts`: the refresh is already
   * running, there is simply nothing to keep it alive past the response.
   */
  let waitUntil: ((work: Promise<unknown>) => void) | undefined
  try {
    const ctx = c.executionCtx
    waitUntil = (work) => ctx.waitUntil(work)
  } catch {
    waitUntil = undefined
  }

  return c.json(
    await homeWeather({
      db: c.env.DB,
      today: deviceDate(c),
      now: nowSeconds(),
      waitUntil,
    }),
  )
})

/**
 * Where Alex lives, which he can change.
 *
 * `CLAUDE.md` requires preferences be manageable through the website, and a
 * "default" that could only be changed by editing a constant would not be one.
 * There is no cache invalidation here on purpose: the stored forecast records
 * the place it was fetched for, so a new name makes the old one stale by itself.
 */
homeRoutes.get('/location', async (c) => c.json({ location: await homeLocation(c.env.DB) }))

homeRoutes.put('/location', async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as Record<string, never>)
  const name = body.name?.trim()

  if (!name) return c.json(apiError('bad_request', 'Where do you live?'), 400)
  if (name.length > 120) return c.json(apiError('bad_request', 'That is too long.'), 400)

  return c.json({ location: await setHomeLocation(c.env.DB, name, nowSeconds()) })
})
