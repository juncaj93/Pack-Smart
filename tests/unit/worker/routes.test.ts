import { beforeEach, describe, expect, it } from 'vitest'
import { createPassphraseHash } from '@shared/crypto'
import { DEFAULT_THROTTLE_POLICY } from '@shared/rate-limit'
import app from '../../../worker/index'
import type { Env } from '../../../worker/env'
import { createFakeD1, type FakeD1 } from './fake-d1'

const PASSPHRASE = 'a private passphrase for tests'
const ORIGIN = 'https://pack-smart.example.workers.dev'

let db: FakeD1
let env: Env
let assetRequests: string[]

/** Stands in for the static-asset binding; records what got forwarded to it. */
function createFakeAssets(): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      assetRequests.push(new URL(url).pathname)
      // Mirrors not_found_handling: single-page-application.
      return new Response('<!doctype html><title>Pack Smart</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    },
  } as unknown as Fetcher
}

beforeEach(async () => {
  db = createFakeD1()
  assetRequests = []
  env = {
    DB: db.binding,
    ASSETS: createFakeAssets(),
    AUTH_PASSPHRASE_HASH: JSON.stringify(await createPassphraseHash(PASSPHRASE)),
    SESSION_SECRET: 'unit-test-session-secret',
  }
})

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(
    `${ORIGIN}${path}`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...headers },
    },
    env,
  )
}

function get(path: string, headers: Record<string, string> = {}) {
  return app.request(`${ORIGIN}${path}`, { headers }, env)
}

/** Logs in and returns the raw Cookie header value for subsequent requests. */
async function login(): Promise<string> {
  const response = await post('/api/auth/login', { passphrase: PASSPHRASE })
  expect(response.status).toBe(200)
  const setCookie = response.headers.get('set-cookie')
  expect(setCookie).toBeTruthy()
  return setCookie!.split(';')[0]!
}

describe('GET /api/health', () => {
  it('reports ok and reads the migration count from D1', async () => {
    const response = await get('/api/health')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      database: 'ok',
      migrationsApplied: 1,
    })
  })

  it('fails loudly when the D1 binding is broken', async () => {
    db.failEverything = true
    const response = await get('/api/health')
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ database: 'unavailable' })
  })
})

describe('security headers', () => {
  it('marks every response noindex — this site holds medication names', async () => {
    const response = await get('/api/health')
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('same-origin')
  })
})

describe('POST /api/auth/login', () => {
  it('rejects a wrong passphrase with 401 and sets no cookie', async () => {
    const response = await post('/api/auth/login', { passphrase: 'wrong' })
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_passphrase' },
    })
  })

  it('rejects an empty or malformed body', async () => {
    expect((await post('/api/auth/login', { passphrase: '' })).status).toBe(400)
    expect((await post('/api/auth/login', {})).status).toBe(400)
  })

  it('accepts the correct passphrase and sets the approved cookie attributes', async () => {
    const response = await post('/api/auth/login', { passphrase: PASSPHRASE })
    expect(response.status).toBe(200)

    const cookie = response.headers.get('set-cookie') ?? ''

    // The approved auth design, asserted directly (01_ARCHITECTURE.md §4, R9).
    expect(cookie).toContain('pack_smart_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    // One year. This is the mechanism behind the "survives a week of disuse"
    // acceptance criterion: WebKit's 7-day cap applies to JS-set cookies, not
    // to a server-set HttpOnly cookie like this one.
    expect(cookie).toContain('Max-Age=31536000')
  })

  it('never returns the passphrase or its hash to the client', async () => {
    const response = await post('/api/auth/login', { passphrase: PASSPHRASE })
    const raw = JSON.stringify(await response.json())
    expect(raw).not.toContain(PASSPHRASE)
    expect(raw).not.toContain('pbkdf2')
  })

  it('reports 503 when the secrets are not configured', async () => {
    env = { DB: db.binding, ASSETS: createFakeAssets() }
    const response = await post('/api/auth/login', { passphrase: PASSPHRASE })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'not_configured' } })
  })

  it('rate-limits repeated failures and then refuses even the correct passphrase', async () => {
    for (let i = 0; i < DEFAULT_THROTTLE_POLICY.maxFailures; i += 1) {
      await post('/api/auth/login', { passphrase: 'wrong' })
    }

    const blocked = await post('/api/auth/login', { passphrase: PASSPHRASE })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
    await expect(blocked.json()).resolves.toMatchObject({ error: { code: 'rate_limited' } })
  })

  it('clears the failure count after a successful login', async () => {
    await post('/api/auth/login', { passphrase: 'wrong' })
    await post('/api/auth/login', { passphrase: PASSPHRASE })
    expect(db.throttle).toEqual({ failureCount: 0, windowStartedAt: 0, lockedUntil: 0 })
  })
})

describe('session guard', () => {
  it('reports an unauthenticated session without a cookie', async () => {
    const response = await get('/api/auth/session')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ authenticated: false })
  })

  it('reports an authenticated session with a valid cookie', async () => {
    const cookie = await login()
    const response = await get('/api/auth/session', { Cookie: cookie })
    await expect(response.json()).resolves.toMatchObject({ authenticated: true })
  })

  it('401s a guarded endpoint without a cookie', async () => {
    const response = await get('/api/anything-added-in-m1')
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'unauthorized' } })
  })

  it('lets a guarded endpoint through with a valid cookie', async () => {
    const cookie = await login()
    // Past the guard, so the 404 comes from routing rather than from auth.
    const response = await get('/api/anything-added-in-m1', { Cookie: cookie })
    expect(response.status).toBe(404)
  })

  it('401s a guarded endpoint when the cookie has been tampered with', async () => {
    const cookie = await login()
    const tampered = `${cookie.slice(0, -2)}XY`
    expect((await get('/api/anything-added-in-m1', { Cookie: tampered })).status).toBe(401)
  })

  it('401s when the signing secret has been rotated', async () => {
    const cookie = await login()
    env = { ...env, SESSION_SECRET: 'a-rotated-secret' }
    expect((await get('/api/anything-added-in-m1', { Cookie: cookie })).status).toBe(401)
  })
})

describe('SPA routing', () => {
  /*
   * Regression guard. When a Worker has a `main`, any request that matches no
   * static file is handed to the Worker instead of the asset router, so
   * `not_found_handling` never fires by itself. Before the ASSETS fallthrough
   * existed, every deep link and every refresh away from "/" returned 404 —
   * on the production build, not just in dev.
   */
  it('forwards a client-side route to the asset binding, unauthenticated', async () => {
    const response = await get('/my-stuff')
    expect(response.status).toBe(200)
    expect(assetRequests).toContain('/my-stuff')
  })

  it('serves the shell for a deep link so a refresh does not 404', async () => {
    expect((await get('/settings')).status).toBe(200)
    expect((await get('/trips')).status).toBe(200)
  })

  // The Unlock screen is client-side; gating the HTML would just break the app.
  // Data is what the session guard protects, and it does.
  it('never forwards /api routes to the asset binding', async () => {
    await get('/api/definitely-not-a-route')
    expect(assetRequests).toHaveLength(0)
  })
})

describe('POST /api/auth/logout', () => {
  it('expires the cookie', async () => {
    const cookie = await login()
    const response = await post('/api/auth/logout', {}, { Cookie: cookie })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})
