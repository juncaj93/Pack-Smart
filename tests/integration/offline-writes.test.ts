import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { createPassphraseHash } from '@shared/crypto'
import app from '../../worker/index'
import type { Env } from '../../worker/env'
import { generateChecklist, listChecklist, setPackedQty } from '../../worker/repos/checklist'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP, seedWardrobe } from './wardrobe'

/**
 * The server half of the offline write queue (F2).
 *
 * Through the **real route, against a real database**, because the whole
 * question is what a conditional PATCH does to a row — which is SQL and a
 * status code, and neither is provable against a stub. The client half is
 * `tests/unit/dom/write-queue.test.ts`.
 *
 * Two guarantees live here and nowhere else:
 *
 *   1. **Replaying a write twice is the same as replaying it once.** That is
 *      what makes the queue safe to retry after a dropped connection.
 *   2. **A change made hours ago on a plane cannot undo a newer one.** The row
 *      carries `updatedAt`, the write carries the version it was made against,
 *      and a row that has moved on is refused rather than overwritten.
 */

const PASSPHRASE = 'a private passphrase for tests'
const ORIGIN = 'https://pack-smart.example.workers.dev'
const NOW = 1_780_000_000

let db: TestDatabase
let env: Env
let cookie: string

/**
 * The static-asset binding, which nothing here reaches — the routes under test
 * are all `/api`. Present because `Env` requires it.
 */
function fakeAssets(): Fetcher {
  return {
    fetch: async () => new Response('', { status: 200 }),
  } as unknown as Fetcher
}

beforeEach(async () => {
  db = createTestDatabase()
  seedWardrobe(db)
  env = {
    DB: db.binding,
    ASSETS: fakeAssets(),
    AUTH_PASSPHRASE_HASH: JSON.stringify(await createPassphraseHash(PASSPHRASE)),
    SESSION_SECRET: 'integration-test-session-secret',
  }

  const login = await app.request(
    `${ORIGIN}/api/auth/login`,
    {
      method: 'POST',
      body: JSON.stringify({ passphrase: PASSPHRASE }),
      headers: { 'Content-Type': 'application/json' },
    },
    env,
  )
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]!
})

afterEach(() => {
  db.close()
})

function patch(tripId: string, entryId: string, body: unknown) {
  return app.request(
    `${ORIGIN}/api/trips/${tripId}/checklist/${entryId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
    },
    env,
  )
}

async function aTripWithARow() {
  const created = await createTrip(db.binding, TRIP, NOW)
  const trip = (await getTrip(db.binding, created.id))!
  await generateChecklist(db.binding, trip, NOW)
  const entries = await listChecklist(db.binding, trip.id)
  expect(entries.length).toBeGreaterThan(0)
  return { trip, entry: entries[0]! }
}

describe('the row version the client writes against', () => {
  it('is on every checklist row the client can read', async () => {
    const { entry } = await aTripWithARow()
    // Without this the queue has nothing to be conditional ON, and "do not
    // overwrite something newer" is unimplementable rather than merely unwritten.
    expect(entry.updatedAt).toBeGreaterThan(0)
  })

  it('moves when the row is written, and not when it is only read', async () => {
    const { trip, entry } = await aTripWithARow()

    const unchanged = (await listChecklist(db.binding, trip.id)).find((row) => row.id === entry.id)
    expect(unchanged?.updatedAt).toBe(entry.updatedAt)

    await setPackedQty(db.binding, entry.id, 1, entry.updatedAt + 60)
    const after = (await listChecklist(db.binding, trip.id)).find((row) => row.id === entry.id)
    expect(after?.updatedAt).toBe(entry.updatedAt + 60)
  })
})

describe('replaying the same queued write twice', () => {
  it('lands in the same place, because the value is absolute', async () => {
    const { trip, entry } = await aTripWithARow()

    const first = await patch(trip.id, entry.id, { packedQty: 2 })
    expect(first.status).toBe(200)
    const second = await patch(trip.id, entry.id, { packedQty: 2 })
    expect(second.status).toBe(200)

    const row = (await listChecklist(db.binding, trip.id)).find((r) => r.id === entry.id)
    // Not "2 then 4" — the queue holds desired state, and the endpoint stores
    // it rather than adding to it.
    expect(row?.packedQty).toBe(2)
  })

  it('is true of the final check and the bag as well', async () => {
    const { trip, entry } = await aTripWithARow()

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await patch(trip.id, entry.id, { finalChecked: true })).status).toBe(200)
      expect((await patch(trip.id, entry.id, { bag: 'carry_on' })).status).toBe(200)
    }

    const row = (await listChecklist(db.binding, trip.id)).find((r) => r.id === entry.id)
    expect(row?.finalCheckedAt).not.toBeNull()
    expect(row?.bag).toBe('carry_on')
    expect(row?.bagSource).toBe('user')
  })
})

describe('a row that moved on the server since', () => {
  it('refuses the stale write and changes nothing', async () => {
    const { trip, entry } = await aTripWithARow()

    // Somewhere else — another tab, another device — the row is packed.
    await setPackedQty(db.binding, entry.id, 3, entry.updatedAt + 600)

    // And now the plane lands, and the phone replays what Alex tapped hours ago.
    const response = await patch(trip.id, entry.id, {
      packedQty: 0,
      ifUnmodifiedSince: entry.updatedAt,
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'conflict' },
      // The current row travels with the refusal, so the client can say what it
      // would have overwritten without a second round trip.
      entry: { packedQty: 3 },
    })

    const row = (await listChecklist(db.binding, trip.id)).find((r) => r.id === entry.id)
    expect(row?.packedQty).toBe(3)
  })

  it('refuses the whole patch, never half of it', async () => {
    const { trip, entry } = await aTripWithARow()
    await setPackedQty(db.binding, entry.id, 3, entry.updatedAt + 600)

    const response = await patch(trip.id, entry.id, {
      packedQty: 0,
      bag: 'checked',
      ifUnmodifiedSince: entry.updatedAt,
    })
    expect(response.status).toBe(409)

    const row = (await listChecklist(db.binding, trip.id)).find((r) => r.id === entry.id)
    // The bag is the field nothing else touched, and it is exactly the one a
    // field-by-field check would have let through into a state nobody asked for.
    expect(row?.bag).toBeNull()
    expect(row?.packedQty).toBe(3)
  })

  it('accepts a write made against the version the row still has', async () => {
    const { trip, entry } = await aTripWithARow()

    const response = await patch(trip.id, entry.id, {
      packedQty: 1,
      ifUnmodifiedSince: entry.updatedAt,
    })
    expect(response.status).toBe(200)

    const row = (await listChecklist(db.binding, trip.id)).find((r) => r.id === entry.id)
    expect(row?.packedQty).toBe(1)
  })

  it('accepts a write made in the same second the row was written', async () => {
    const { trip, entry } = await aTripWithARow()

    /*
     * `updated_at` has one-second resolution, so a row generated and tapped
     * inside the same second is indistinguishable from one that moved. Being
     * lenient here is the safe direction: the alternative refuses an ordinary
     * tap on a freshly generated list, which is most of them.
     */
    const response = await patch(trip.id, entry.id, {
      packedQty: 1,
      ifUnmodifiedSince: entry.updatedAt,
    })
    expect(response.status).toBe(200)
  })

  it('leaves an unconditional write alone — nothing changed for the online case', async () => {
    const { trip, entry } = await aTripWithARow()
    await setPackedQty(db.binding, entry.id, 3, entry.updatedAt + 600)

    // No `ifUnmodifiedSince`, which is every tap made with a live connection.
    const response = await patch(trip.id, entry.id, { packedQty: 0 })
    expect(response.status).toBe(200)

    const row = (await listChecklist(db.binding, trip.id)).find((r) => r.id === entry.id)
    expect(row?.packedQty).toBe(0)
  })
})

describe('a queued write still needs a session', () => {
  it('is refused without the cookie, however well-formed it is', async () => {
    const { trip, entry } = await aTripWithARow()

    const response = await app.request(
      `${ORIGIN}/api/trips/${trip.id}/checklist/${entry.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ packedQty: 1, ifUnmodifiedSince: entry.updatedAt }),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
    )

    // The server is the authority. Nothing the client remembers about a session
    // is a substitute for the cookie it cannot read.
    expect(response.status).toBe(401)
    const row = (await listChecklist(db.binding, trip.id)).find((r) => r.id === entry.id)
    expect(row?.packedQty).toBe(0)
  })
})
