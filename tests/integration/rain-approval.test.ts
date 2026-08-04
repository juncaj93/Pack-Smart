import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWorkbook } from '@shared/xlsx'
import { tripDateRange, type TripInput } from '@shared/trips'
import { generateChecklist } from '../../worker/repos/checklist'
import { generateOutfits, listOutfits, setGroupStatus } from '../../worker/repos/outfits'
import { createTrip } from '../../worker/repos/trips'
import { importRoutes } from '../../worker/routes/import'
import { getWeather } from '../../worker/services/weather'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * Rain, the wardrobe, and the approval it used to block (the CI flake, closed).
 *
 * ## What this is a regression test for
 *
 * Seven WebKit tests were recorded as flaky across four files, always downstream
 * of approving an outfit. Doc 09 §5a read the signature — `element(s) not
 * found`, not `not visible` — as a *refused* approval, and that half was right.
 * What was still unmeasured was WHY, and the answer was not the leading
 * candidate (`outfit_pairing` outliving the trip). It was the weather.
 *
 * `POST /api/trips` starts a forecast fetch in the background (`waitUntil`), and
 * every one of those specs plans outfits immediately afterwards. So whether a
 * forecast had landed by the time the planner ran was a race — and on CI, which
 * can reach Open-Meteo, it sometimes had. Rain promotes the outer layer to
 * REQUIRED. **Alex owns nothing recorded as keeping rain out.** So every group
 * came back `incomplete`, every approval was refused, and four cards showed an
 * `Approve outfit` button that did nothing.
 *
 * The suite is green in the sandbox because the sandbox cannot reach the weather
 * service at all. That is the whole reason this lived on CI for weeks: the one
 * environment that could reproduce it was the one nobody could step through.
 *
 * ## What it asserts
 *
 * Measured against the **real workbook** through the real import endpoint,
 * because the defect is a fact about Alex's actual wardrobe rather than about a
 * fixture: a synthetic wardrobe with a raincoat in it never had the problem.
 */

const WORKBOOK = 'seed-data/Master_Packing_Database_Complete.xlsx'

const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-07-31',
  endDate: '2026-08-11',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari', 'nice_dinner'],
  international: true,
  laundryAvailable: false,
}

const NOW = 1_780_000_000
/** Above `RAIN_THRESHOLD`, which is a probability rather than a depth. */
const RAIN_LIKELY = 80
const DRY = 5

let db: TestDatabase

async function importWorkbook(): Promise<void> {
  const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
  const clothing = sheets.find((s) => /clothing/i.test(s.name))?.rows
  const gear = sheets.find((s) => /non-?clothing|rules|gear/i.test(s.name))?.rows
  expect(clothing && gear).toBeTruthy()

  const response = await importRoutes.request(
    new Request('https://example.test/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'seed.xlsx', clothing, gear }),
    }),
    undefined,
    { DB: db.binding } as never,
  )
  expect(response.status).toBe(200)
}

/** Writes a forecast for every day of the trip, as the refresh service would. */
function storeForecast(tripId: string, probability: number) {
  const destination = db.raw
    .prepare('SELECT id FROM trip_destination WHERE trip_id = ?')
    .get(tripId) as { id: string }

  for (const date of tripDateRange(TRIP.startDate, TRIP.endDate)) {
    db.raw
      .prepare(
        `INSERT INTO trip_weather (id, trip_id, destination_id, weather_date, temp_min_c,
                                   temp_max_c, precipitation, wind_kph, source, fetched_at)
         VALUES (?,?,?,?,11,19,?,12,'forecast',?)`,
      )
      .run(crypto.randomUUID(), tripId, destination.id, date, probability, NOW)
  }
}

/** A garment that IS recorded as keeping rain out, which Alex does not own. */
function addRainLayer() {
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, subcategory, favorite,
                         usage_frequency, dressiness, warmth, weather_tags, typical_uses,
                         is_critical, requires_final_check, default_packing_timing,
                         always_include, never_include, source, created_at, updated_at)
       VALUES ('rainshell','clothing','Rain Shell','Tops & Outerwear','Outerwear',0,'sometimes',
               1,2,'["rain"]','["casual","safari"]',0,0,'anytime',0,0,'seed_import',1,1)`,
    )
    .run()
}

async function planWith(probability: number | null) {
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, trip, NOW)
  if (probability !== null) storeForecast(trip.id, probability)
  const { days } = await getWeather(db.binding, trip.id, NOW)
  await generateOutfits(db.binding, trip, NOW, days)
  return { trip, groups: await listOutfits(db.binding, trip.id) }
}

beforeEach(async () => {
  db = createTestDatabase()
  await importWorkbook()
})

afterEach(() => db.close())

describe('a forecast the wardrobe cannot answer', () => {
  /*
   * The defect itself, stated as the thing that must not happen again: rain
   * must never make EVERY outfit on the trip unapprovable.
   */
  it('does not make every outfit unapprovable', async () => {
    const { groups } = await planWith(RAIN_LIKELY)

    expect(groups.length).toBeGreaterThan(0)
    expect(groups.every((group) => group.status === 'incomplete')).toBe(false)
  })

  it('still lets the outfit be approved, and says so from the server', async () => {
    const { groups } = await planWith(RAIN_LIKELY)
    const safari = groups.find((group) => /safari/i.test(group.name))
    expect(safari).toBeTruthy()

    const outcome = await setGroupStatus(db.binding, safari!.id, 'approved', NOW)
    expect(outcome.status).toBe('approved')
  })

  /*
   * The honesty half. Not blocking is not the same as not saying — the gap is
   * still recorded on the slot, in Alex's words, and E2's weather conflict says
   * it again on the day it matters.
   */
  it('still says rain is likely and nothing keeps it out', async () => {
    const { groups } = await planWith(RAIN_LIKELY)

    const reasons = groups
      .flatMap((group) => group.slots)
      .filter((slot) => slot.itemId === null)
      .map((slot) => slot.unmetReason)

    expect(reasons.some((reason) => reason?.includes('keeping it out'))).toBe(true)
  })

  it('leaves a dry forecast planning exactly as before', async () => {
    const { groups } = await planWith(DRY)
    expect(groups.some((group) => group.status !== 'incomplete')).toBe(true)
  })

  it('plans the same way with no forecast at all', async () => {
    const { groups } = await planWith(null)
    expect(groups.some((group) => group.status !== 'incomplete')).toBe(true)
  })
})

describe('a forecast the wardrobe CAN answer', () => {
  /*
   * The other side of the rule, and the reason it is scoped to "nowhere in the
   * wardrobe" rather than to rain in general. Own a rain shell and the demand
   * is real: the slot is filled, not waived.
   */
  it('fills the outer slot from the garment recorded as keeping rain out', async () => {
    addRainLayer()
    const { groups } = await planWith(RAIN_LIKELY)

    const outer = groups
      .flatMap((group) => group.slots)
      .filter((slot) => slot.role === 'outer' && slot.itemId !== null)

    expect(outer.length).toBeGreaterThan(0)
    expect(outer.some((slot) => slot.itemName === 'Rain Shell')).toBe(true)
  })
})
