import { readFileSync } from 'node:fs'
import { readWorkbook } from '../../shared/xlsx'

/**
 * Puts Alex's wardrobe in the database before the end-to-end suite runs.
 *
 * Without this the suite silently depends on whatever happened to be in the
 * developer's local database. It passed here and failed on CI for exactly that
 * reason: eleven tests need real clothes to plan outfits from, the Contacts item
 * to reach "12 days × 2 = 24", and the Passport rule to show on the rules
 * screen. A test that only passes on one machine is not a test.
 *
 * Seeding through the real import endpoint rather than raw SQL is deliberate —
 * it is the same path Alex takes on his first run, so the suite exercises the
 * catalog the product will actually have rather than a convenient fixture.
 *
 * Runs as `globalSetup`, which is after the server is listening. Migrations
 * stay chained into `webServer` because those must happen BEFORE the health
 * check answers 200; seeding is the opposite and needs the server up.
 */

const BASE_URL = 'http://localhost:4173'
const WORKBOOK = 'seed-data/Master_Packing_Database_Complete.xlsx'

/** Matches the value scripts/write-dev-vars.mjs hashes for local development. */
const DEV_PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

let cookie = ''

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  })

  const setCookie = response.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0] ?? ''

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`seed: ${path} answered ${response.status} — ${text.slice(0, 300)}`)
  }
  return text ? (JSON.parse(text) as unknown) : null
}

export default async function seed(): Promise<void> {
  await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ passphrase: DEV_PASSPHRASE }),
  })

  /*
   * Idempotent: a developer running the suite repeatedly should not re-import,
   * and a second import would append a duplicate catalog rather than replace it.
   *
   * The threshold is not zero, and the difference is not cosmetic.
   * `0009_missing_items` seeds five canonical rows into a *fresh* database, so
   * `> 0` meant "already imported" the moment those migrations ran — and the
   * whole 119-garment workbook was skipped. Eleven specs then failed for want of
   * clothes to plan outfits from, on a clean clone and on CI, while passing on any
   * machine whose database predated the migration. The identical guard in
   * `scripts/seed-demo.mjs` had the identical bug.
   *
   * A threshold rather than an id check, because the question here is "has the
   * WORKBOOK been imported?", and any future migration seeding a few rows must not
   * answer yes to it either.
   */
  const SEEDED_BY_MIGRATIONS = 10
  const existing = (await call('/api/items')) as { activeCount?: number }
  if ((existing.activeCount ?? 0) > SEEDED_BY_MIGRATIONS) return

  const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
  const clothing = sheets.find((sheet) => /clothing/i.test(sheet.name))?.rows
  const gear = sheets.find((sheet) => /non-?clothing|rules|gear/i.test(sheet.name))?.rows

  if (!clothing || !gear) {
    throw new Error(`seed: ${WORKBOOK} is missing one of the two expected sheets`)
  }

  const result = (await call('/api/import/commit', {
    method: 'POST',
    body: JSON.stringify({ filename: 'e2e-seed.xlsx', clothing, gear }),
  })) as { created: number }

  console.log(`seed: imported ${result.created} items`)
}
