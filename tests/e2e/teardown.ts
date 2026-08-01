/**
 * Removes the trips the suite created, at the end of the run.
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
  } catch {
    /*
     * Never fails the run. The suite has already reported by this point, and a
     * teardown that turns a green run red — or a red run into a confusing
     * different red — is worse than a few leftover rows.
     */
  }
}
