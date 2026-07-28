import { Hono } from 'hono'
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  buildClearedSessionCookie,
  buildSessionCookie,
  createSessionToken,
  readCookie,
  verifyPassphrase,
  verifySessionToken,
} from '../shared/auth'
import { evaluateRateLimit } from '../shared/rate-limit'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  /** Output of hashPassphrase(). Set with: wrangler secret put PACK_SMART_PASSPHRASE_HASH */
  PACK_SMART_PASSPHRASE_HASH?: string
  /** Random 32+ byte string. Set with: wrangler secret put PACK_SMART_SESSION_SECRET */
  PACK_SMART_SESSION_SECRET?: string
}

const app = new Hono<{ Bindings: Env }>()

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** Best-effort client identifier for rate limiting. */
function clientKey(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown'
}

function configError(missing: string) {
  return Response.json(
    {
      error: 'not_configured',
      message: `${missing} is not set. See technical-docs/07_SETUP.md.`,
    },
    { status: 503 },
  )
}

// --- auth --------------------------------------------------------------------

app.post('/api/auth/login', async (c) => {
  const { PACK_SMART_PASSPHRASE_HASH, PACK_SMART_SESSION_SECRET, DB } = c.env
  if (!PACK_SMART_PASSPHRASE_HASH) return configError('PACK_SMART_PASSPHRASE_HASH')
  if (!PACK_SMART_SESSION_SECRET) return configError('PACK_SMART_SESSION_SECRET')

  const key = clientKey(c.req.raw)
  const now = nowSeconds()

  const { results } = await DB.prepare(
    'SELECT attempted_at FROM login_attempt WHERE client_key = ?1 AND attempted_at > ?2',
  )
    .bind(key, now - 15 * 60)
    .all<{ attempted_at: number }>()

  const decision = evaluateRateLimit(
    (results ?? []).map((r) => r.attempted_at),
    now,
  )

  if (!decision.allowed) {
    return Response.json(
      { error: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
    )
  }

  let passphrase = ''
  try {
    const body = (await c.req.json()) as { passphrase?: unknown }
    if (typeof body.passphrase === 'string') passphrase = body.passphrase
  } catch {
    // fall through to the failure path below
  }

  const ok = passphrase !== '' && (await verifyPassphrase(passphrase, PACK_SMART_PASSPHRASE_HASH))

  if (!ok) {
    await DB.prepare('INSERT INTO login_attempt (client_key, attempted_at) VALUES (?1, ?2)')
      .bind(key, now)
      .run()
    return Response.json({ error: 'invalid_passphrase' }, { status: 401 })
  }

  // Successful login clears the failure history for this client.
  await DB.prepare('DELETE FROM login_attempt WHERE client_key = ?1').bind(key).run()

  const token = await createSessionToken(PACK_SMART_SESSION_SECRET, now)
  return Response.json(
    { authenticated: true },
    { headers: { 'Set-Cookie': buildSessionCookie(token, SESSION_MAX_AGE_SECONDS) } },
  )
})

app.get('/api/auth/session', async (c) => {
  const secret = c.env.PACK_SMART_SESSION_SECRET
  if (!secret) return configError('PACK_SMART_SESSION_SECRET')

  const token = readCookie(c.req.header('Cookie') ?? null, SESSION_COOKIE)
  if (!token) return Response.json({ authenticated: false })

  const payload = await verifySessionToken(secret, token, nowSeconds())
  return Response.json({ authenticated: payload !== null, expiresAt: payload?.exp ?? null })
})

app.post('/api/auth/logout', () =>
  Response.json({ authenticated: false }, { headers: { 'Set-Cookie': buildClearedSessionCookie() } }),
)

// --- everything else under /api requires a session ---------------------------

app.use('/api/*', async (c, next) => {
  const secret = c.env.PACK_SMART_SESSION_SECRET
  if (!secret) return configError('PACK_SMART_SESSION_SECRET')

  const token = readCookie(c.req.header('Cookie') ?? null, SESSION_COOKIE)
  const payload = token ? await verifySessionToken(secret, token, nowSeconds()) : null
  if (!payload) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  await next()
})

app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()
  return Response.json({ ok: true, database: row?.ok === 1 })
})

app.all('/api/*', () => Response.json({ error: 'not_found' }, { status: 404 }))

// --- static assets -----------------------------------------------------------
// Anything that is not /api/* falls through to the SPA. Route protection is on
// the API, not the shell: the shell renders the passphrase screen when the
// session check fails.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
