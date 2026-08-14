import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { tripDays, tripNights } from '@shared/trips'
import { quantityIsSurprising, rowSecondaryParts, type ChecklistEntry } from '@shared/checklist'
import { generateChecklist, listChecklist, setQtyOverride } from '../../worker/repos/checklist'
import { createTrip } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * When a count deserves a word, and when it does not (P4f, doc 03 §12).
 *
 * The arithmetic came off the packing list in V1.1 for a good reason: forty rows
 * each carrying `12 days × 1 + spare for 2 extra days = 14` turned the list into
 * a document. Putting it back on every row is not an option, and this is the
 * rule that decides which rows earn it.
 *
 * **A quantity is obvious when it is one Alex would guess**: one of the thing,
 * one per day, or one per night. Everything else — a spare, a floor, a cap, a
 * laundry reduction, two a day for rotation — lands on a number he did not
 * predict, and that is the set §12 calls surprising.
 *
 * The tests below are mostly about the QUIET half, because that is the half a
 * change would break silently: an explanation on every row still looks like a
 * feature working.
 */

const NOW = 1_780_000_000
let db: TestDatabase

/** Twelve days, eleven nights. */
const TRIP: TripInput = {
  name: 'Lisbon',
  startDate: '2026-08-01',
  endDate: '2026-08-12',
  destinations: [{ name: 'Lisbon', country: 'Portugal' }],
  activities: [],
  international: true,
  laundryAvailable: false,
}

const LENGTH = {
  days: tripDays(TRIP.startDate, TRIP.endDate),
  nights: tripNights(TRIP.startDate, TRIP.endDate),
}

function gear(id: string, ruleType: string, quantity: number, buffer: number | null = null) {
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                         typical_uses, is_critical, requires_final_check,
                         default_packing_timing, always_include, never_include, source,
                         created_at, updated_at)
       VALUES (?,'gear',?,'Travel Gear',0,'sometimes','[]',0,0,'anytime',0,0,'seed_import',1,1)`,
    )
    .run(id, id)
  db.raw
    .prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, buffer, condition_json,
                                 enabled, needs_review, original_text, created_at)
       VALUES (?,?,?,?,?,NULL,1,0,'test',1)`,
    )
    .run(`rule-${id}`, id, ruleType, quantity, buffer)
}

async function planned(): Promise<Map<string, ChecklistEntry>> {
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, trip, NOW)
  const rows = await listChecklist(db.binding, trip.id)
  return new Map(rows.map((row) => [row.name, row]))
}

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

describe('the numbers that stay quiet', () => {
  it('says nothing about one of something', async () => {
    gear('Toothbrush', 'fixed_per_trip', 1)
    const rows = await planned()
    const row = rows.get('Toothbrush')!

    expect(row.requiredQty).toBe(1)
    expect(quantityIsSurprising(row, LENGTH)).toBe(false)
    expect(rowSecondaryParts(row, LENGTH)).toEqual(rowSecondaryParts(row))
  })

  it('says nothing about one per night', async () => {
    gear('Socks', 'per_night', 1)
    const rows = await planned()
    const row = rows.get('Socks')!

    expect(row.requiredQty).toBe(LENGTH.nights)
    expect(quantityIsSurprising(row, LENGTH)).toBe(false)
  })

  it('says nothing about one per day', async () => {
    gear('Tee', 'per_day', 1)
    const rows = await planned()
    const row = rows.get('Tee')!

    expect(row.requiredQty).toBe(LENGTH.days)
    expect(quantityIsSurprising(row, LENGTH)).toBe(false)
  })

  /*
   * A number Alex set himself is never surprising TO HIM. `rowExplanationParts`
   * already declines to show a breakdown that argues with an override; this
   * declines to put one on the row in the first place.
   */
  it('says nothing about a number Alex chose', async () => {
    gear('Socks', 'per_night', 2)
    const rows = await planned()
    const row = rows.get('Socks')!
    expect(quantityIsSurprising(row, LENGTH)).toBe(true)

    await setQtyOverride(db.binding, row.id, 4, NOW)
    const after = (await listChecklist(db.binding, row.tripId)).find((e) => e.id === row.id)!
    expect(after.requiredQty).toBe(4)
    expect(quantityIsSurprising(after, LENGTH)).toBe(false)
  })
})

describe('the numbers that earn a word', () => {
  it('explains two a night, which is arithmetic nobody does at a glance', async () => {
    gear('Boxer Briefs', 'per_night', 2)
    const rows = await planned()
    const row = rows.get('Boxer Briefs')!

    expect(row.requiredQty).toBe(LENGTH.nights * 2)
    expect(quantityIsSurprising(row, LENGTH)).toBe(true)

    const parts = rowSecondaryParts(row, LENGTH)
    expect(parts.length).toBeGreaterThan(rowSecondaryParts(row).length)
    expect(parts.join(' ')).toContain(String(row.requiredQty))
  })

  it('explains a spare, which is the number that reads as a mistake', async () => {
    gear('Contact Lenses', 'duration_plus_buffer', 1, 2)
    const rows = await planned()
    const row = rows.get('Contact Lenses')!

    expect(row.requiredQty).toBe(LENGTH.days + 2)
    expect(quantityIsSurprising(row, LENGTH)).toBe(true)
    expect(rowSecondaryParts(row, LENGTH).join(' ')).toMatch(/spare/i)
  })

  /*
   * The one the handoff names: laundry takes a row from eleven to a number that
   * looks like an error unless something says why.
   */
  it('explains a count laundry pulled down', async () => {
    gear('Socks', 'per_night', 1)
    db.raw.prepare("UPDATE packing_rule SET rule_type = 'maximum', quantity_value = 5 WHERE id = 'rule-Socks'").run()

    const rows = await planned()
    const row = rows.get('Socks')
    if (!row) return

    expect(quantityIsSurprising(row, LENGTH)).toBe(true)
  })
})

describe('the line the explanation joins', () => {
  /*
   * The whole point of the rule. Restoring the arithmetic to every row is what
   * V1.1 removed, so the majority of a real list has to stay bare.
   */
  it('leaves most of a real list unexplained', async () => {
    gear('Toothbrush', 'fixed_per_trip', 1)
    gear('Toothpaste', 'fixed_per_trip', 1)
    gear('Shampoo', 'fixed_per_trip', 1)
    gear('Socks', 'per_night', 1)
    gear('Tee', 'per_day', 1)
    gear('Boxer Briefs', 'per_night', 2)

    const rows = [...(await planned()).values()]
    const explained = rows.filter((row) => quantityIsSurprising(row, LENGTH))

    expect(explained.map((r) => r.name)).toEqual(['Boxer Briefs'])
    expect(explained.length * 2).toBeLessThan(rows.length)
  })

  /*
   * Callers that are not the packing list get exactly what they got before.
   * `Before you go` and the bag lens are not screens for asking "why that
   * number", and neither can afford the height.
   */
  it('says nothing at all when no trip length is given', async () => {
    gear('Boxer Briefs', 'per_night', 2)
    const rows = await planned()
    const row = rows.get('Boxer Briefs')!

    expect(rowSecondaryParts(row)).toEqual([])
  })
})
