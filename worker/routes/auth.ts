import { Hono } from 'hono'
import type { LoginRequest, SessionResponse } from '@shared/types'
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

/** Cheap check the client uses on boot to decide between Unlock and the shell. */
authRoutes.get('/session', async (c) => {
  const session = await readSession(c)
  return session
    ? c.json<SessionResponse>({ authenticated: true, expiresAt: session.expiresAt })
    : c.json<SessionResponse>({ authenticated: false })
})
