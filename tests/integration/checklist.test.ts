import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { generateChecklist, listChecklist, setQtyOverride, excludeEntry } from '../../worker/repos/checklist'
import { createTrip, getTrip, updateTrip } from '../../worker/repos/trips'
import { createTestDatabase, insertItem, insertRule, type TestDatabase } from './d1'

/**
 * The approved worked example, end to end against real SQL.
 *
 * `technical-docs/05_MILESTONE_PLAN.md` M4 states the expected output for a
 * 31 Jul - 11 Aug international trip. The unit tests in tests/unit/worker prove
 * the arithmetic; this proves the whole path — migrations, inserts, rule
 * loading, two-pass generation, persistence — produces those numbers.
 */

const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-07-31',
  endDate: '2026-08-11',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari', 'winery'],
  international: true,
  laundryAvailable: false,
  flightHours: 15,
}

const NOW = 1_780_000_000

let db: TestDatabase

/** The subset of the real catalog the worked example names. */
function seedCatalog() {
  const contacts = insertItem(db, { displayName: 'Daily Contacts', category: 'Vision', isCritical: true })
  insertRule(db, contacts, { ruleType: 'per_day', quantityValue: 2 })

  const underwear = insertItem(db, { displayName: 'Boxer Briefs', category: 'Accessories & Undergarments' })
  insertRule(db, underwear, { ruleType: 'per_day', quantityValue: 2 })

  const synthroid = insertItem(db, {
    displayName: 'Synthroid',
    category: 'Medication',
    isCritical: true,
    requiresFinalCheck: true,
  })
  insertRule(db, synthroid, { ruleType: 'duration_plus_buffer', quantityValue: 1, buffer: 2 })

  const passport = insertItem(db, {
    displayName: 'Passport',
    category: 'Documents',
    isCritical: true,
    requiresFinalCheck: true,
    defaultPackingTiming: 'last_minute',
  })
  insertRule(db, passport, {
    ruleType: 'conditional_include',
    condition: { fact: 'international', eq: true },
  })

  const adapter = insertItem(db, { displayName: 'Travel Adapter', category: 'Electronics' })
  insertRule(db, adapter, {
    ruleType: 'conditional_include',
    condition: { fact: 'international', eq: true },
  })

  const shaver = insertItem(db, { displayName: 'Shaver', category: 'Grooming' })
  insertRule(db, shaver, { ruleType: 'conditional_include', condition: { fact: 'nights', gte: 3 } })

  const shaverCharger = insertItem(db, { displayName: 'Shaver Charger', category: 'Electronics' })
  insertRule(db, shaverCharger, { ruleType: 'dependency_include', dependsOnItemId: shaver })

  // A device that does not qualify for this trip, and its charger. Neither may
  // appear — the charger because its device did not.
  const camera = insertItem(db, { displayName: 'Camera', category: 'Electronics' })
  insertRule(db, camera, {
    ruleType: 'conditional_include',
    condition: { fact: 'activities', contains: 'photography' },
  })
  const cameraCharger = insertItem(db, { displayName: 'Camera Charger', category: 'Electronics' })
  insertRule(db, cameraCharger, { ruleType: 'dependency_include', dependsOnItemId: camera })

  const binoculars = insertItem(db, { displayName: 'Binoculars', category: 'Travel Gear' })
  insertRule(db, binoculars, {
    ruleType: 'conditional_include',
    condition: { fact: 'activities', contains: 'safari' },
  })

  const toothbrush = insertItem(db, { displayName: 'Toothbrush', category: 'Toiletries' })
  insertRule(db, toothbrush, { ruleType: 'fixed_per_trip', quantityValue: 1 })

  return { contacts, underwear, synthroid, passport, adapter, shaver, shaverCharger, binoculars }
}

async function quantities() {
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, trip, NOW)
  const entries = await listChecklist(db.binding, trip.id)
  return {
    trip,
    entries,
    byName: new Map(entries.map((e) => [e.name, e])),
  }
}

beforeEach(() => {
  db = createTestDatabase()
  seedCatalog()
})

afterEach(() => {
  db.close()
})

describe('M4 acceptance — the worked example against real SQL', () => {
  it('counts 12 trip days and 11 nights and stores them as facts', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    const facts = Object.fromEntries(trip.facts.map((f) => [f.factKey, f.value]))

    expect(facts.trip_days).toBe(12)
    expect(facts.nights).toBe(11)
    expect(facts.international).toBe(true)
  })

  it('gives contacts 24 and underwear 24', async () => {
    const { byName } = await quantities()

    expect(byName.get('Daily Contacts')?.requiredQty).toBe(24)
    expect(byName.get('Daily Contacts')?.qtyBreakdown).toBe('12 days × 2 = 24')
    expect(byName.get('Boxer Briefs')?.requiredQty).toBe(24)
  })

  it('gives Synthroid 14 — the trip plus a two-day buffer', async () => {
    const { byName } = await quantities()
    expect(byName.get('Synthroid')?.requiredQty).toBe(14)
  })

  it('includes the passport and the adapter for an international trip', async () => {
    const { byName } = await quantities()

    expect(byName.get('Passport')?.requiredQty).toBe(1)
    expect(byName.get('Passport')?.reason).toBe('International travel')
    expect(byName.get('Travel Adapter')).toBeDefined()
  })

  it('leaves both out of a domestic trip', async () => {
    const trip = await createTrip(db.binding, { ...TRIP, international: false }, NOW)
    await generateChecklist(db.binding, trip, NOW)
    const names = (await listChecklist(db.binding, trip.id)).map((e) => e.name)

    expect(names).not.toContain('Passport')
    expect(names).not.toContain('Travel Adapter')
  })

  it('includes the shaver at 3 nights and not at 2', async () => {
    const threeNights = await createTrip(
      db.binding,
      { ...TRIP, startDate: '2026-07-31', endDate: '2026-08-03' },
      NOW,
    )
    await generateChecklist(db.binding, threeNights, NOW)
    expect((await listChecklist(db.binding, threeNights.id)).map((e) => e.name)).toContain('Shaver')

    const twoNights = await createTrip(
      db.binding,
      { ...TRIP, startDate: '2026-07-31', endDate: '2026-08-02' },
      NOW,
    )
    await generateChecklist(db.binding, twoNights, NOW)
    expect((await listChecklist(db.binding, twoNights.id)).map((e) => e.name)).not.toContain('Shaver')
  })

  it('includes a charger only alongside its device', async () => {
    const { byName } = await quantities()

    // The shaver qualifies at 11 nights, so its charger comes too.
    expect(byName.get('Shaver')).toBeDefined()
    expect(byName.get('Shaver Charger')?.source).toBe('dependency_triggered')

    // Nothing on this trip packs a camera.
    expect(byName.has('Camera Charger')).toBe(false)
  })

  it('drops the charger when its device drops out', async () => {
    const trip = await createTrip(
      db.binding,
      { ...TRIP, startDate: '2026-07-31', endDate: '2026-08-02' },
      NOW,
    )
    await generateChecklist(db.binding, trip, NOW)
    const names = (await listChecklist(db.binding, trip.id)).map((e) => e.name)

    expect(names).not.toContain('Shaver')
    expect(names).not.toContain('Shaver Charger')
  })

  it('includes binoculars for the safari', async () => {
    const { byName } = await quantities()
    expect(byName.get('Binoculars')).toBeDefined()
  })

  it('carries critical flags and final-check requirements onto the rows', async () => {
    const { byName } = await quantities()

    expect(byName.get('Passport')?.isCritical).toBe(true)
    expect(byName.get('Passport')?.requiresFinalCheck).toBe(true)
    expect(byName.get('Passport')?.packingTiming).toBe('last_minute')
    expect(byName.get('Toothbrush')?.isCritical).toBe(false)
  })

  it('explains a computed quantity but not an obvious single item', async () => {
    const { byName } = await quantities()

    expect(byName.get('Daily Contacts')?.qtyBreakdown).toBeTruthy()
    expect(byName.get('Toothbrush')?.qtyBreakdown).toBeNull()
  })
})

describe('regeneration respects what Alex has already decided', () => {
  it('updates a derived quantity when the dates change', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)

    const shorter = await updateTrip(db.binding, trip.id, { ...TRIP, endDate: '2026-08-04' }, NOW)
    expect(shorter).not.toBeNull()
    await generateChecklist(db.binding, shorter!, NOW)

    const entries = await listChecklist(db.binding, trip.id)
    // 31 Jul -> 4 Aug is 5 inclusive days.
    expect(entries.find((e) => e.name === 'Daily Contacts')?.requiredQty).toBe(10)
  })

  it('never overwrites a hand-set quantity', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)

    const contacts = (await listChecklist(db.binding, trip.id)).find((e) => e.name === 'Daily Contacts')!
    await setQtyOverride(db.binding, contacts.id, 30, NOW)

    const shorter = await updateTrip(db.binding, trip.id, { ...TRIP, endDate: '2026-08-04' }, NOW)
    await generateChecklist(db.binding, shorter!, NOW)

    const after = (await listChecklist(db.binding, trip.id)).find((e) => e.name === 'Daily Contacts')!
    expect(after.qtyOverride).toBe(30)
    expect(after.requiredQty).toBe(30)
  })

  it('keeps a Not Bringing decision through regeneration', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)

    const binoculars = (await listChecklist(db.binding, trip.id)).find((e) => e.name === 'Binoculars')!
    await excludeEntry(db.binding, binoculars.id, NOW)

    await generateChecklist(db.binding, (await getTrip(db.binding, trip.id))!, NOW)

    const after = (await listChecklist(db.binding, trip.id)).find((e) => e.name === 'Binoculars')!
    expect(after.excludedAt).toBe(NOW)
  })

  it('does not duplicate rows when generated twice', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)
    const first = await listChecklist(db.binding, trip.id)

    await generateChecklist(db.binding, trip, NOW)
    const second = await listChecklist(db.binding, trip.id)

    expect(second).toHaveLength(first.length)
  })
})

describe('the catalog is never written by trip generation', () => {
  it('leaves item and packing_rule untouched', async () => {
    const before = {
      items: db.raw.prepare('SELECT count(*) AS n FROM item').get() as { n: number },
      rules: db.raw.prepare('SELECT count(*) AS n FROM packing_rule').get() as { n: number },
    }

    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)

    expect((db.raw.prepare('SELECT count(*) AS n FROM item').get() as { n: number }).n).toBe(before.items.n)
    expect((db.raw.prepare('SELECT count(*) AS n FROM packing_rule').get() as { n: number }).n).toBe(
      before.rules.n,
    )
  })

  it('excludes archived items from a new trip', async () => {
    db.raw.prepare("UPDATE item SET archived_at = 1 WHERE display_name = 'Binoculars'").run()

    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)

    expect((await listChecklist(db.binding, trip.id)).map((e) => e.name)).not.toContain('Binoculars')
  })
})
