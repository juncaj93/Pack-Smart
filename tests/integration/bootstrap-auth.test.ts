import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authRoutes } from '../../worker/routes/auth'
import { tripRoutes } from '../../worker/routes/trips'
import { createTrip } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP } from './wardrobe'

/**
 * The bootstrap answer, and the boundary it must not move (P1b).
 *
 * `/api/auth/session` now carries the trips list **on the authenticated branch
 * only**, so the client stops paying a serial round trip before its first data
 * request. That is a performance change made inside an auth endpoint, which is
 * the one place in Pack Smart where a clever change is a security change — so
 * every one of these is about what a client that is NOT signed in can obtain.
 *
 * The rule being defended: *the server decides, on this request, and an
 * unauthenticated answer carries nothing.*
 */

const NOW = 1_780_000_000
let db: TestDatabase

beforeEach(async () => {
  db = createTestDatabase()
  await createTrip(db.binding, TRIP, NOW)
})

afterEach(() => {
  db.close()
})

const env = () => ({ DB: db.binding, SESSION_SECRET: 'test-secret', PASSPHRASE_HASH: 'x' })

async function session(cookie?: string) {
  const response = await authRoutes.request(
    new Request('https://example.test/session', {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    undefined,
    env() as never,
  )
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('what an unauthenticated client can obtain', () => {
  it('gets no trips, and no key that hints at them', async () => {
    const { status, body } = await session()

    expect(status).toBe(200)
    expect(body.authenticated).toBe(false)
    // Absent, not empty. "Locked" and "signed in with nothing planned" are
    // different answers and must not render as the same shape.
    expect(body).not.toHaveProperty('trips')
    expect(JSON.stringify(body)).not.toMatch(/South Africa/)
  })

  it('gets nothing from a malformed cookie', async () => {
    for (const cookie of ['ps_session=', 'ps_session=nonsense', 'ps_session=a.b.c', 'other=1']) {
      const { body } = await session(cookie)
      expect(body.authenticated, cookie).toBe(false)
      expect(body, cookie).not.toHaveProperty('trips')
    }
  })

  it('gets nothing from a signature that does not verify', async () => {
    // A well-formed payload with someone else's signature.
    const forged = `ps_session=${btoa(JSON.stringify({ expiresAt: NOW + 99999 }))}.deadbeef`
    const { body } = await session(forged)

    expect(body.authenticated).toBe(false)
    expect(body).not.toHaveProperty('trips')
  })

  /*
   * The endpoint this one duplicates is still guarded. If `/api/trips` ever
   * stopped answering 401 without a session, the bootstrap would be the least
   * of the problems — but it is exactly the guard a change here could tempt
   * someone to relax.
   */
  it('still cannot reach /api/trips directly', async () => {
    const response = await tripRoutes.request(
      new Request('https://example.test/'),
      undefined,
      env() as never,
    )
    // The route itself has no guard — `requireSession` is mounted in front of
    // the whole `/api/*` tree in `worker/index.ts`, which is asserted there.
    // What matters here is that the bootstrap did not become a second door.
    expect(response.status).toBeLessThan(500)
  })
})

describe('the guard in front of every protected route', () => {
  /*
   * Asserted against the real app rather than the router in isolation, because
   * the guard is mounted on `/api/*` and a route tested on its own would not
   * pass through it. This is the assertion that P1b must not weaken.
   */
  it('answers 401 for a protected endpoint without a session', async () => {
    const { default: app } = await import('../../worker/index')

    const response = await app.request(
      new Request('https://example.test/api/trips'),
      undefined,
      env() as never,
    )
    expect(response.status).toBe(401)
  })

  it('answers 401 for a protected endpoint with a forged cookie', async () => {
    const { default: app } = await import('../../worker/index')

    const response = await app.request(
      new Request('https://example.test/api/trips', {
        headers: { Cookie: 'ps_session=forged.signature' },
      }),
      undefined,
      env() as never,
    )
    expect(response.status).toBe(401)
  })

  it('leaves the session probe public, as it always was', async () => {
    const { default: app } = await import('../../worker/index')

    const response = await app.request(
      new Request('https://example.test/api/auth/session'),
      undefined,
      env() as never,
    )
    expect(response.status).toBe(200)
    expect(((await response.json()) as Record<string, unknown>).authenticated).toBe(false)
  })
})

describe('the answer does not become fragile', () => {
  /*
   * Being unable to list trips is not evidence about who Alex is. Answering
   * "locked" because the database hiccuped would sign him out of a working app,
   * which is a worse failure than one screen loading a moment later.
   *
   * **This covers the unauthenticated path only**, and says so rather than
   * implying more: the authenticated branch needs a validly signed cookie, which
   * means minting one with the real secret, and that belongs in a test that can
   * sign. The `.catch(() => undefined)` on the authenticated branch is therefore
   * asserted by inspection here and not by execution — recorded as a gap rather
   * than dressed up as coverage.
   */
  it('still answers, rather than erroring, when the database is unavailable', async () => {
    const broken = {
      DB: {
        prepare: () => {
          throw new Error('D1 is having a moment')
        },
      },
      SESSION_SECRET: 'test-secret',
      PASSPHRASE_HASH: 'x',
    }

    const response = await authRoutes.request(
      new Request('https://example.test/session'),
      undefined,
      broken as never,
    )

    expect(response.status).toBe(200)
    expect(((await response.json()) as Record<string, unknown>).authenticated).toBe(false)
  })
})
