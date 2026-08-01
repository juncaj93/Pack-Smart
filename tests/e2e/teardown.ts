/**
 * Removes the trips — and retires the wardrobe items — the suite created.
 *
 * The suite had never deleted anything, and it showed: **176 trips** were
 * sitting in the local database after a handful of runs, every one of them
 * loaded by `/api/trips` on the Trips screen and by every readiness check.
 * That is its own kind of interference — slower with each run, until something
 * that was comfortably inside a 5-second wait is not. A full run took 4.2
 * minutes on a fresh database and 6.1 on the same one an hour later, and one
 * test tipped over.
 *
 * A run-level teardown rather than per-test cleanup for the specs that build a
 * trip through the trip SHEET: those tests are about the sheet, so making each
 * one also responsible for tidying up would put a `try/finally` around the very
 * flow under test. The specs that only *need* a trip use `createTrip` and
 * delete their own in `afterEach`.
 *
 * Matches on the shape `ownedName()` produces — `Some Prefix 12-a4f9x2` — so it
 * cannot touch a trip a developer made by hand. It also runs against the local
 * e2e server only, which is the same server `seed.ts` set up.
 *
 * **Items were the half this missed**, and they grow the same way trips did.
 * `createOwnedItem` adds a garment per spec per run and nothing took it away
 * again: a database seeded with 119 items was carrying 177 after a morning's
 * runs, and every extra garment is one more candidate the planner ranks for
 * every slot of every group. Two full runs on this machine each lost a different
 * test to a plain 5-second timeout, both of which passed in isolation — the
 * signature of a suite getting slower rather than a suite that is wrong.
 *
 * They are **archived, not deleted.** There is deliberately no DELETE endpoint
 * for an item (doc 05 §11, `02_DATA_MODEL.md` §1), and archiving is the real
 * retirement path — it takes the garment out of `listActiveCandidates`, which is
 * the thing that was costing time, without inventing a destructive route for the
 * tests' convenience.
 */

const BASE_URL = 'http://localhost:4173'
const DEV_PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/** `<anything> <counter>-<6 base36 chars>`, which only `ownedName` produces. */
const OWNED = / \d+-[0-9a-z]{6}$/

let cookie = ''

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0] ?? ''
  return response
}

export default async function teardown(): Promise<void> {
  try {
    await call('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ passphrase: DEV_PASSPHRASE }),
    })

    const listed = await call('/api/trips')
    if (!listed.ok) return

    const { trips } = (await listed.json()) as { trips: Array<{ id: string; name: string }> }
    const mine = trips.filter((trip) => OWNED.test(trip.name))

    for (const trip of mine) {
      await call(`/api/trips/${trip.id}`, { method: 'DELETE' })
    }

    if (mine.length > 0) console.log(`teardown: removed ${mine.length} trips the suite created`)

    /*
     * The wardrobe half. Already-archived items are asked for too, because a
     * previous teardown will have archived some and there is no reason to be
     * confused by them appearing again.
     */
    const items = await call('/api/items?archived=true')
    if (!items.ok) return

    const { items: all } = (await items.json()) as {
      items: Array<{ id: string; displayName: string; archivedAt: number | null }>
    }
    const owned = all.filter((item) => item.archivedAt === null && OWNED.test(item.displayName))

    for (const item of owned) {
      await call(`/api/items/${item.id}/archive`, { method: 'POST' })
    }

    if (owned.length > 0) {
      console.log(`teardown: retired ${owned.length} wardrobe items the suite created`)
    }
  } catch {
    /*
     * Never fails the run. The suite has already reported by this point, and a
     * teardown that turns a green run red — or a red run into a confusing
     * different red — is worse than a few leftover rows.
     */
  }
}
