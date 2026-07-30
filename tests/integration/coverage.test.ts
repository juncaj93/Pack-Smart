import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { tripCoverageGaps } from '../../worker/repos/coverage'
import { createTrip } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * Coverage gaps against real SQL (product doc 02 §9c).
 *
 * The property that matters is AGREEMENT: this warning and the checklist beside
 * it must be built from the same facts. A warning that says "no rule will ever
 * add this" about an item sitting on the list is worse than no warning — it
 * teaches Alex the warnings are wrong.
 */

const NOW = 1_780_000_000

const TRIP: TripInput = {
  name: 'Lisbon',
  startDate: '2026-09-01',
  endDate: '2026-09-05',
  destinations: [{ name: 'Lisbon', country: 'Portugal' }],
  activities: [],
  international: true,
}

let db: TestDatabase

function gear(id: string, opts: { critical?: boolean; always?: boolean } = {}) {
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                         typical_uses, is_critical, requires_final_check,
                         default_packing_timing, always_include, never_include, source,
                         created_at, updated_at)
       VALUES (?,'gear',?,'Travel Gear',0,'sometimes','[]',?,0,'anytime',?,0,'seed_import',1,1)`,
    )
    .run(id, id, opts.critical ? 1 : 0, opts.always ? 1 : 0)
  return id
}

function ruleFor(itemId: string) {
  db.raw
    .prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, condition_json,
                                 enabled, needs_review, original_text, created_at)
       VALUES (?,?,'fixed_per_trip',1,NULL,1,0,'test',1)`,
    )
    .run(`rule-${itemId}`, itemId)
}

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

describe('the warning agrees with the list beside it', () => {
  /*
   * The load-bearing test. If candidacy here ever drifts from
   * generateChecklist's, this warns about an item that is visibly on the list.
   */
  it('never claims an item is unreachable when it is on the checklist', async () => {
    gear('Passport', { critical: true })
    ruleFor('Passport')
    gear('Anker Charger')

    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)

    const onList = new Set((await listChecklist(db.binding, trip.id)).map((e) => e.name))
    const found = await tripCoverageGaps(db.binding, trip)

    expect(onList.has('Passport')).toBe(true)
    for (const gap of found.filter((g) => g.kind === 'unreachable')) {
      expect(onList.has(gap.message.split(' is marked')[0]!)).toBe(false)
    }
  })

  it('reports a critical item that really cannot reach the list', async () => {
    gear('Insulin', { critical: true }) // no rule
    gear('Anker Charger')
    gear('Passport')

    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)

    const onList = (await listChecklist(db.binding, trip.id)).map((e) => e.name)
    const found = await tripCoverageGaps(db.binding, trip)

    // The premise: it genuinely is not there.
    expect(onList).not.toContain('Insulin')
    expect(found.map((g) => g.message).join(' ')).toContain('Insulin')
  })

  /*
   * A disabled rule is not a rule. Turning one off in Settings must move the item
   * from "on the list" to "reported as unreachable", or Settings would look
   * functional while quietly dropping an essential.
   */
  it('follows a rule being disabled in Settings', async () => {
    gear('Insulin', { critical: true })
    ruleFor('Insulin')
    gear('Anker Charger')
    gear('Passport')

    const trip = await createTrip(db.binding, TRIP, NOW)
    expect(await tripCoverageGaps(db.binding, trip)).toEqual([])

    db.raw.prepare('UPDATE packing_rule SET enabled = 0 WHERE item_id = ?').run('Insulin')

    const found = await tripCoverageGaps(db.binding, trip)
    expect(found.map((g) => g.message).join(' ')).toContain('Insulin')
  })

  it('counts an archived item as not owned', async () => {
    gear('Anker Charger')
    gear('Passport')
    const trip = await createTrip(db.binding, TRIP, NOW)
    expect(await tripCoverageGaps(db.binding, trip)).toEqual([])

    // An archived charger cannot be packed, so the gap is real again.
    db.raw.prepare('UPDATE item SET archived_at = 1 WHERE id = ?').run('Anker Charger')

    const found = await tripCoverageGaps(db.binding, trip)
    expect(found.map((g) => g.message).join(' ')).toContain('phone charger')
  })
})

describe('the passport check follows the trip, not a guess', () => {
  it('asks abroad', async () => {
    gear('Anker Charger')
    const trip = await createTrip(db.binding, TRIP, NOW)

    const found = await tripCoverageGaps(db.binding, trip)
    expect(found.map((g) => g.message).join(' ')).toContain('passport')
  })

  it('does not ask on a domestic trip', async () => {
    gear('Anker Charger')
    const trip = await createTrip(db.binding, { ...TRIP, international: false }, NOW)

    expect(await tripCoverageGaps(db.binding, trip)).toEqual([])
  })

  /*
   * Unanswered is not "probably abroad". Warning about a passport on every trip
   * where the question was skipped is the false alarm doc 02 §9c forbids.
   */
  it('stays quiet when the question was never answered', async () => {
    gear('Anker Charger')
    const trip = await createTrip(db.binding, { ...TRIP, international: null }, NOW)

    expect(await tripCoverageGaps(db.binding, trip)).toEqual([])
  })
})
