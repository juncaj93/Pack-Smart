import { Hono } from 'hono'
import type { LoginRequest, SessionResponse } from '@shared/types'
import { listTrips } from '../repos/trips'
import {
  apiError,
  attemptLogin,
  clearSessionCookie,
  readSession,
  setSessionCookie,
} from '../auth'
import type { AppBindings } from '../env'

export const authRoutes = new Hono<AppBindings>()

/** Unauthenticated by design — this is the endpoint that creates a session. */
authRoutes.post('/login', async (c) => {
  let body: Partial<LoginRequest>
  try {
    body = await c.req.json<Partial<LoginRequest>>()
  } catch {
    return c.json(apiError('bad_request', 'Expected a JSON body.'), 400)
  }

  const passphrase = typeof body.passphrase === 'string' ? body.passphrase : ''
  if (passphrase.length === 0) {
    return c.json(apiError('bad_request', 'Enter your passphrase.'), 400)
  }

  let outcome: Awaited<ReturnType<typeof attemptLogin>>
  try {
    outcome = await attemptLogin(c.env, passphrase)
  } catch (error) {
    // Any unexpected failure — a missing table, an unreachable D1 — becomes the
    // structured error shape the client understands, rather than a bare 500 that
    // the client can only render as "something went wrong".
    console.error('login failed', error)
    return c.json(
      apiError('internal', 'Sign-in is temporarily unavailable. Try again shortly.'),
      500,
    )
  }

  switch (outcome.status) {
    case 'ok': {
      setSessionCookie(c, outcome.token)
      return c.json<SessionResponse>({ authenticated: true, expiresAt: outcome.expiresAt })
    }
    case 'rate_limited':
      return c.json(
        apiError(
          'rate_limited',
          'Too many attempts. Try again shortly.',
          outcome.retryAfterSeconds,
        ),
        429,
        { 'Retry-After': String(outcome.retryAfterSeconds) },
      )
    case 'not_configured':
      return c.json(
        apiError(
          'not_configured',
          'Pack Smart is not set up yet, or its stored passphrase was written by an older version of the setup script. Re-run "node scripts/hash-passphrase.mjs | npx wrangler secret put AUTH_PASSPHRASE_HASH" — see technical-docs/07_SETUP.md.',
        ),
        503,
      )
    case 'invalid':
    default:
      // Deliberately identical to any other rejection: no hint about whether the
      // passphrase was close, and no distinct timing (attemptLogin adds a fixed delay).
      return c.json(apiError('invalid_passphrase', 'That passphrase did not match.'), 401)
  }
})

authRoutes.post('/logout', (c) => {
  clearSessionCookie(c)
  return c.json<SessionResponse>({ authenticated: false })
})

/**
 * The boot question, and — when the answer is yes — the first screen's data.
 *
 * The client cannot render a route until it knows whether it is signed in, so
 * this was a serial gate: the session answered, the route mounted, and only then
 * did the screen ask for anything. Measured at one whole round trip in front of
 * every navigation (P1, doc 09).
 *
 * **The authorization boundary is exactly where it was.** `readSession` decides,
 * on this request, on the server; the trips are attached inside the authenticated
 * branch and are unreachable from the other one. A locked client gets the same
 * bytes it got before. This route stays the one public probe it has always been
 * — it is not becoming a protected route, and it is not becoming a public data
 * route — and `requireSession` still guards every `/api/*` endpoint including the
 * `/api/trips` this duplicates.
 *
 * A failure to read the trips must never fail the session answer: being unable
 * to list trips is not evidence about who Alex is, and answering "locked"
 * because the database hiccuped would sign him out of a working app.
 */
authRoutes.get('/session', async (c) => {
  const session = await readSession(c)
  if (!session) return c.json<SessionResponse>({ authenticated: false })

  const trips = await listTrips(c.env.DB).catch(() => undefined)

  return c.json<SessionResponse>({
    authenticated: true,
    expiresAt: session.expiresAt,
    ...(trips ? { trips } : {}),
  })
})
