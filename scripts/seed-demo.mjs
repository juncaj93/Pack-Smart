#!/usr/bin/env node
/**
 * Puts Pack Smart into every state the UX review has to look at.
 *
 * Written because a screenshot of an empty app proves nothing: hierarchy, density
 * and wrapping only misbehave with real content — Alex's actual 85 garments and 33
 * gear items, a long multi-city trip, a trip whose outfits are half approved, a
 * finished trip, and an essential nothing will ever pack.
 *
 * Everything goes through the real HTTP API, the same path Alex takes, so the
 * seeded state is reachable rather than a fixture the product could never produce.
 *
 * Usage: start the app, then `npm run seed:demo`. Idempotent by trip name —
 * running it twice does not duplicate anything.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const BASE_URL = process.env.SEED_BASE_URL ?? 'http://localhost:4173'
const WORKBOOK = 'seed-data/Master_Packing_Database_Complete.xlsx'
const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE_URL)) {
  console.error('Refusing to run against anything but localhost. This script writes data.')
  process.exit(1)
}

/* The workbook reader is TypeScript; bundle it once so plain Node can load it. */
async function loadWorkbookReader() {
  const outFile = join(mkdtempSync(join(tmpdir(), 'pack-smart-seed-')), 'xlsx.mjs')
  await build({
    entryPoints: ['shared/xlsx.ts'],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  })
  const { readWorkbook } = await import(pathToFileURL(outFile).href)
  return readWorkbook
}

let cookie = ''

async function call(path, init = {}) {
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

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`seed: ${path} answered ${response.status} — ${text.slice(0, 300)}`)
  }
  return text ? JSON.parse(text) : null
}

const post = (path, body) =>
  call(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) })

/** Dates relative to today, so "next trip" and "past trip" stay true forever. */
function isoIn(days) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/*
 * Five trips, chosen for the states they produce rather than for variety: a near
 * departure, a long multi-city trip, a weekend with one activity, a trip far
 * enough out that weather is a climate normal rather than a forecast, and a
 * finished trip for Past Trips and Plan again.
 */
const TRIPS = [
  {
    name: 'Cape Town & Kruger',
    startDate: isoIn(9),
    endDate: isoIn(20),
    destinations: [
      { name: 'Cape Town', country: 'South Africa', arriveDate: isoIn(9), departDate: isoIn(14) },
      { name: 'Kruger', country: 'South Africa', arriveDate: isoIn(15), departDate: isoIn(20) },
    ],
    activities: ['safari', 'nice_dinner', 'sightseeing'],
    international: true,
    laundryAvailable: false,
    flightHours: 15,
    maxDressiness: 3,
    plan: 'approve-some',
  },
  {
    name: 'Portland weekend',
    startDate: isoIn(3),
    endDate: isoIn(5),
    destinations: [{ name: 'Portland', country: 'United States' }],
    activities: ['nice_dinner'],
    international: false,
    laundryAvailable: true,
    flightHours: 5,
    plan: 'none',
  },
  {
    name: 'Tokyo in spring',
    startDate: isoIn(120),
    endDate: isoIn(130),
    destinations: [{ name: 'Tokyo', country: 'Japan' }],
    activities: ['sightseeing', 'nice_dinner'],
    international: true,
    flightHours: 11,
    plan: 'generate',
  },
  {
    name: 'Zion hiking',
    startDate: isoIn(45),
    endDate: isoIn(50),
    destinations: [{ name: 'Springdale', country: 'United States' }],
    activities: ['hiking', 'road_trip'],
    international: false,
    plan: 'generate',
  },
  {
    name: 'Lisbon last spring',
    startDate: isoIn(-40),
    endDate: isoIn(-31),
    destinations: [{ name: 'Lisbon', country: 'Portugal' }],
    activities: ['sightseeing', 'winery'],
    international: true,
    flightHours: 9,
    plan: 'approve-all',
  },
]

/**
 * How many items a *fresh* database already has before anything is seeded.
 *
 * `0009_missing_items` inserts five canonical rows Alex owns, so "the wardrobe is
 * empty" stopped meaning "count is zero" the moment that migration landed. The
 * guard below read `> 0` and, on a clean clone, skipped the entire 119-garment
 * workbook because the migration had put five things there first — leaving a
 * six-item wardrobe in which every outfit was necessarily incomplete. The visual
 * QA run then photographed that and reported twenty passes, because nothing in it
 * asserts how much wardrobe there should be.
 *
 * A threshold rather than an id check on purpose: the question this guard is
 * really asking is "has the workbook been imported?", and any future migration
 * that seeds a handful of rows should not silently answer yes to it either.
 */
const SEEDED_BY_MIGRATIONS = 10

async function importWardrobe() {
  const existing = await call('/api/items')
  if ((existing.activeCount ?? 0) > SEEDED_BY_MIGRATIONS) {
    console.log(`seed: wardrobe already holds ${existing.activeCount} items — not re-importing`)
    return
  }

  const readWorkbook = await loadWorkbookReader()
  const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
  const clothing = sheets.find((sheet) => /clothing/i.test(sheet.name))?.rows
  const gear = sheets.find((sheet) => /non-?clothing|rules|gear/i.test(sheet.name))?.rows
  if (!clothing || !gear) throw new Error(`seed: ${WORKBOOK} is missing one of the two sheets`)

  const result = await post('/api/import/commit', { filename: 'demo-seed.xlsx', clothing, gear })
  console.log(`seed: imported ${result.created} items`)
}

async function seedTrip(spec) {
  const { trips } = await call('/api/trips')
  if (trips.some((trip) => trip.name === spec.name)) {
    console.log(`seed: "${spec.name}" already exists`)
    return
  }

  const { plan, ...input } = spec
  const { trip } = await post('/api/trips', input)
  console.log(`seed: created "${trip.name}"`)

  if (plan === 'none') return

  const { groups } = await post(`/api/trips/${trip.id}/outfits/generate`)
  const completable = groups.filter((group) => group.status !== 'incomplete')

  /*
   * "approve-some" leaves groups unapproved on purpose: an outfit screen where
   * everything is approved never shows the draft or incomplete states, and those
   * are the ones that need reviewing.
   */
  const toApprove =
    plan === 'approve-all' ? completable : completable.slice(0, Math.max(1, completable.length - 2))

  for (const group of toApprove) {
    await post(`/api/trips/${trip.id}/outfits/${group.id}/status`, { status: 'approved' })
  }
  console.log(`seed:   ${toApprove.length} of ${groups.length} outfits approved`)
}

/**
 * An essential with no rule, so the coverage panel has something honest to say.
 *
 * Not a fake warning: the item genuinely exists in My Stuff with nothing that will
 * ever place it on a list, which is the silent omission doc 02 §9c exists to catch.
 */
async function seedUncoveredEssential() {
  const existing = await call('/api/items')
  if ((existing.items ?? []).some((item) => item.displayName === 'Travel adapter')) return

  await post('/api/items', {
    kind: 'gear',
    displayName: 'Travel adapter',
    category: 'Travel Gear',
    isCritical: true,
  })
  console.log('seed: added an essential with no rule')
}

await post('/api/auth/login', { passphrase: PASSPHRASE })
await importWardrobe()
await seedUncoveredEssential()
for (const spec of TRIPS) await seedTrip(spec)
console.log('seed: done')
