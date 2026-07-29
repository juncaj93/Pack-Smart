/**
 * Drives a real import against a running local server, then reports what the
 * packing engine actually produces for the approved worked example.
 *
 * This exists because "the tests pass" and "the app gives Alex the right answer"
 * are different claims. The unit and integration suites use small hand-built
 * catalogs; this runs the real 85 garments and 33 gear items through the real
 * HTTP endpoints and prints the numbers, so they can be checked against
 * technical-docs/05_MILESTONE_PLAN.md M4.
 *
 *   npm run dev            # or: npx vite preview --port 4173
 *   node scripts/verify-import.mjs [baseUrl]
 *
 * Local development only. It signs in with the development passphrase and writes
 * to the local D1. It has no credentials for production and must never be
 * pointed at it.
 */

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const BASE = process.argv[2] ?? 'http://localhost:4173'
const WORKBOOK = 'seed-data/Master_Packing_Database_Complete.xlsx'
const DEV_PASSPHRASE = 'pack-smart-e2e-passphrase'

if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE)) {
  console.error('Refusing to run against anything but localhost. This script writes data.')
  process.exit(1)
}

/* The workbook reader is TypeScript; bundle it once so plain Node can load it. */
const outDir = mkdtempSync(join(tmpdir(), 'pack-smart-'))
const outFile = join(outDir, 'xlsx.mjs')
await build({
  entryPoints: ['shared/xlsx.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
})
const { readWorkbook } = await import(pathToFileURL(outFile).href)

let cookie = ''

async function call(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]

  const text = await response.text()
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : null
}

await call('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ passphrase: DEV_PASSPHRASE }),
})

const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
const clothing = sheets.find((s) => /clothing/i.test(s.name)).rows
const gear = sheets.find((s) => /non-?clothing|rules|gear/i.test(s.name)).rows

const dry = await call('/api/import/dry-run', {
  method: 'POST',
  body: JSON.stringify({ filename: 'verify.xlsx', clothing, gear }),
})

console.log('DRY RUN')
console.log(`  clothing rows        ${dry.summary.clothingRows}`)
console.log(`  unique garments      ${dry.summary.clothingUnique}`)
console.log(`  exact duplicates     ${dry.summary.exactDuplicates}`)
console.log(`  identity duplicates  ${dry.summary.identityDuplicates}`)
console.log(`  needs review         ${dry.summary.reviewCards.length}`)
console.log(`  gear items           ${dry.summary.gearItems}`)
console.log(`  trigger rules        ${dry.summary.triggerRules}`)
console.log(`  already in database  ${dry.existingItems}`)

if (dry.existingItems > 0) {
  console.error('\nSTOP: the database already holds items. Reset the local D1 first.')
  process.exit(1)
}

const committed = await call('/api/import/commit', {
  method: 'POST',
  body: JSON.stringify({ filename: 'verify.xlsx', clothing, gear }),
})
console.log(`\nCOMMITTED ${committed.created} items`)
console.log('  unresolved dependencies:', committed.unresolvedDependencies.length
  ? committed.unresolvedDependencies.join(', ')
  : 'none')

/* The approved worked example: 31 Jul - 11 Aug, international, safari. */
const { trip } = await call('/api/trips', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Verification Trip',
    startDate: '2026-07-31',
    endDate: '2026-08-11',
    destinations: [{ name: 'Cape Town', country: 'South Africa' }],
    activities: ['safari', 'winery'],
    international: true,
    laundryAvailable: false,
    flightHours: 15,
  }),
})

const { entries } = await call(`/api/trips/${trip.id}/checklist`)

console.log(`\nCHECKLIST — ${entries.length} rows for a 12-day international trip\n`)
for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
  const qty = String(entry.requiredQty).padStart(4)
  const why = entry.qtyBreakdown ?? entry.reason ?? ''
  console.log(`${qty}  ${entry.name.padEnd(36)}${why}`)
}

const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]))
const find = (needle) =>
  [...byName.entries()].find(([name]) => name.includes(needle))?.[1] ?? null

console.log('\nACCEPTANCE (05_MILESTONE_PLAN.md M4)')
const checks = [
  ['contacts = 24', find('contacts')?.requiredQty === 24],
  ['underwear = 24', find('boxer brief')?.requiredQty === 24],
  ['Synthroid = 14', find('synthroid')?.requiredQty === 14],
  ['passport present', Boolean(find('passport'))],
  ['adapter present', Boolean(find('adapter'))],
  ['shaver present at 11 nights', Boolean(find('shaver'))],
  ['shaver charger present', Boolean(find('shaver charger'))],
  ['binoculars present for safari', Boolean(find('binoculars'))],
]

let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
}

process.exit(failed === 0 ? 0 : 1)
