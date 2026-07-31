import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import {
  SESSION_TTL_SECONDS,
  createSessionToken,
  parsePassphraseHash,
  verifyPassphrase,
  verifySessionToken,
} from '@shared/crypto'
import {
  DEFAULT_THROTTLE_POLICY,
  EMPTY_THROTTLE_STATE,
  type ThrottleState,
  checkThrottle,
  registerFailure,
  registerSuccess,
} from '@shared/rate-limit'
import type { ApiError, ApiErrorCode } from '@shared/types'
import type { AppBindings, Env } from './env'
import { PREVIEW_MARKER, PREVIEW_NO_PASSPHRASE, PREVIEW_SESSION_EXPIRES_AT } from './preview'

export const SESSION_COOKIE = 'pack_smart_session'
const THROTTLE_KEY = 'login'

/** Fixed cost on every failed attempt so timing reveals nothing about the miss. */
const FAILURE_DELAY_MS = 250

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  retryAfterSeconds?: number,
): ApiError {
  return {
    error: retryAfterSeconds === undefined ? { code, message } : { code, message, retryAfterSeconds },
  }
}

/* ------------------------------------------------------------------ */
/* throttle persistence                                                */
/* ------------------------------------------------------------------ */

export async function readThrottle(db: D1Database): Promise<ThrottleState> {
  const row = await db
    .prepare(
      'SELECT failure_count, window_started_at, locked_until FROM auth_throttle WHERE key = ?',
    )
    .bind(THROTTLE_KEY)
    .first<{ failure_count: number; window_started_at: number; locked_until: number }>()

  if (!row) return { ...EMPTY_THROTTLE_STATE }
  return {
    failureCount: row.failure_count,
    windowStartedAt: row.window_started_at,
    lockedUntil: row.locked_until,
  }
}

export async function writeThrottle(
  db: D1Database,
  state: ThrottleState,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auth_throttle (key, failure_count, window_started_at, locked_until, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         failure_count     = excluded.failure_count,
         window_started_at = excluded.window_started_at,
         locked_until      = excluded.locked_until,
         updated_at        = excluded.updated_at`,
    )
    .bind(THROTTLE_KEY, state.failureCount, state.windowStartedAt, state.lockedUntil, now)
    .run()
}

/* ------------------------------------------------------------------ */
/* cookie                                                             */
/* ------------------------------------------------------------------ */

/**
 * Sets the session cookie SERVER-side.
 *
 * This is not a style preference (01_ARCHITECTURE.md §4, risk R9): WebKit caps
 * *JavaScript-set* cookies at 7 days, while server-set HttpOnly cookies persist
 * to their stated expiry. With Max-Age of one year Alex logs in about once a
 * year rather than before every trip.
 *
 * `Secure` is omitted on plain-http localhost only, because Safari and Chrome
 * both drop Secure cookies on an insecure origin, which would make local
 * development impossible. Every deployed origin is https.
 */
export function setSessionCookie(c: Context<AppBindings>, token: string): void {
  const isLocalhost = new URL(c.req.url).hostname === 'localhost'
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: !isLocalhost,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearSessionCookie(c: Context<AppBindings>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

/* ------------------------------------------------------------------ */
/* login                                                              */
/* ------------------------------------------------------------------ */

export type LoginOutcome =
  | { status: 'ok'; token: string; expiresAt: number }
  | { status: 'invalid' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'not_configured' }

export async function attemptLogin(env: Env, passphrase: string): Promise<LoginOutcome> {
  const storedHash = env.AUTH_PASSPHRASE_HASH ? parsePassphraseHash(env.AUTH_PASSPHRASE_HASH) : null
  if (!storedHash || !env.SESSION_SECRET) return { status: 'not_configured' }

  const now = nowSeconds()
  const state = await readThrottle(env.DB)

  const decision = checkThrottle(state, now, DEFAULT_THROTTLE_POLICY)
  if (!decision.allowed) {
    return { status: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds }
  }

  const valid = await verifyPassphrase(passphrase, storedHash)

  if (!valid) {
    await writeThrottle(env.DB, registerFailure(state, now, DEFAULT_THROTTLE_POLICY), now)
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS))
    return { status: 'invalid' }
  }

  await writeThrottle(env.DB, registerSuccess(), now)
  return {
    status: 'ok',
    token: await createSessionToken(env.SESSION_SECRET, now),
    expiresAt: now + SESSION_TTL_SECONDS,
  }
}

/* ------------------------------------------------------------------ */
/* session guard                                                      */
/* ------------------------------------------------------------------ */

export async function readSession(
  c: Context<AppBindings>,
): Promise<{ expiresAt: number } | null> {
  const secret = c.env.SESSION_SECRET
  if (!secret) return null

  const raw = getCookie(c, SESSION_COOKIE)
  if (!raw) return null

  const token = await verifySessionToken(raw, secret, nowSeconds())
  return token ? { expiresAt: token.expiresAt } : null
}

/**
 * Guards every route it is mounted on. `01_ARCHITECTURE.md` §4: everything
 * except the login endpoint and the static assets requires a valid session.
 */
export const requireSession: MiddlewareHandler<AppBindings> = async (c, next) => {
  /*
   * The Preview build's passphrase bypass — see `./preview.ts` for why it is
   * safe to write and why it cannot reach production.
   *
   * Deliberately the FIRST thing here, and deliberately not implemented by
   * making `readSession` lie: a fake session leaking into logout, cookie
   * refresh or the session endpoint would be a change to the auth machinery
   * rather than a branch in front of it, and this has to be removable by
   * deleting whole lines.
   */
  if (PREVIEW_NO_PASSPHRASE) {
    c.header('X-Pack-Smart-Build', PREVIEW_MARKER)
    c.set('sessionExpiresAt', PREVIEW_SESSION_EXPIRES_AT)
    return next()
  }

  const session = await readSession(c)
  if (!session) {
    return c.json(apiError('unauthorized', 'Sign in to continue.'), 401)
  }
  c.set('sessionExpiresAt', session.expiresAt)
  await next()
}
