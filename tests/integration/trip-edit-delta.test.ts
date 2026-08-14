import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { planChanged, planDelta, deltaLines } from '@shared/plan-delta'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { tripCoverageGaps } from '../../worker/repos/coverage'
import { createTrip, getTrip, updateTrip } from '../../worker/repos/trips'
import { countRoundTrips, createTestDatabase, type TestDatabase } from './d1'

/**
 * What a trip edit did to the plan (P4f).
 *
 * `PUT /trips/:id` is the one trip mutation that regenerates the whole checklist
 * against new inputs, and it is the one where Alex has no idea what moved:
 * answering *laundry: yes* can take a row from eleven to five, and nothing on
 * the screen he returns to would have said so.
 *
 * The route was already returning `generation` — rows created, updated,
 * preserved — and that is work done rather than consequence. A regeneration
 * updates most rows every time, so the number is the same whether the plan
 * changed or not.
 *
 * These tests mirror the route: snapshot, mutate, regenerate, snapshot, diff.
 * The one that matters most is the SILENT one — an edit that changes nothing
 * must produce nothing, because a message after every save is a message Alex
 * learns to ignore.
 */

const NOW = 1_780_000_000
let db: TestDatabase

const TRIP: TripInput = {
  name: 'Lisbon',
  startDate: '2026-08-01',
  endDate: '2026-08-12',
  destinations: [{ name: 'Lisbon', country: 'Portugal' }],
  activities: [],
  international: true,
  laundryAvailable: false,
}

function gear(id: string, ruleType: string, quantity: number) {
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
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, condition_json,
                                 enabled, needs_review, original_text, created_at)
       VALUES (?,?,?,?,NULL,1,0,'test',1)`,
    )
    .run(`rule-${id}`, id, ruleType, quantity)
}

/** Exactly what the route does, in the same order and for the same reasons. */
async function edit(tripId: string, changes: Partial<TripInput>) {
  const existing = (await getTrip(db.binding, tripId))!
  const before = await listChecklist(db.binding, tripId)
  const gapsBefore = await tripCoverageGaps(db.binding, existing, before)

  const trip = (await updateTrip(
    db.binding,
    tripId,
    { ...TRIP, ...changes },
    NOW,
  ))!
  await generateChecklist(db.binding, trip, NOW)

  const after = await listChecklist(db.binding, trip.id)
  const gapsAfter = await tripCoverageGaps(db.binding, trip, after)

  return planDelta(
    { entries: before, groups: [], gaps: gapsBefore },
    { entries: after, groups: [], gaps: gapsAfter },
  )
}

async function planned(): Promise<string> {
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, trip, NOW)
  return trip.id
}

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

describe('an edit that moved nothing', () => {
  /*
   * The most important test here. Silence is the default, and a regeneration
   * rewrites `sort_order` on most rows and `reason` on some — every one of
   * which `planDelta` ignores on purpose.
   */
  it('says nothing when the trip is saved unchanged', async () => {
    gear('Socks', 'per_night', 1)
    gear('Toothbrush', 'fixed_per_trip', 1)
    const id = await planned()

    const deltas = await edit(id, {})
    expect(deltas).toEqual([])
    expect(planChanged(deltas)).toBe(false)
    expect(deltaLines(deltas)).toEqual([])
  })

  /* A name is not a plan. Renaming a trip must not report a packing change. */
  it('says nothing about a change the plan cannot feel', async () => {
    gear('Socks', 'per_night', 1)
    const id = await planned()

    expect(await edit(id, { name: 'Lisbon again', notes: 'the good one' })).toEqual([])
  })
})

describe('an edit that moved something', () => {
  it('reports the quantities a shorter trip changed', async () => {
    gear('Socks', 'per_night', 1)
    const id = await planned()

    const deltas = await edit(id, { endDate: '2026-08-05' })
    const quantity = deltas.find((d) => d.kind === 'quantity_changed')
    expect(quantity).toBeDefined()
    expect(quantity).toMatchObject({ label: 'Socks', from: 11, to: 4 })

    // And it reads as a result rather than as an instruction.
    expect(deltaLines(deltas)).toContain('Socks 11 → 4')
  })

  /*
   * Where the LAUNDRY delta actually appears, which is not here.
   *
   * Laundry does not reach the packing list through this route. `laundryReducible`
   * and `LAUNDRY_DAY_CAP` act on the OUTFIT plan, and clothing reaches the
   * checklist by approving an outfit — so answering the laundry question stamps
   * the outfits stale and the Outfits screen replans on arrival, where it
   * already reports its own deltas through the same engine.
   *
   * So this route correctly says nothing about it, and asserting that is worth
   * more than asserting a number: it is the difference between "silent because
   * nothing changed here" and "silent because we forgot to look".
   */
  it('leaves the laundry answer to the screen that replans for it', async () => {
    gear('Socks', 'per_night', 1)
    const id = await planned()

    // Gear quantities do not depend on laundry, so nothing on this list moves.
    expect(await edit(id, { laundryAvailable: true })).toEqual([])
  })

  it('reports a row an edit added to the trip', async () => {
    gear('Socks', 'per_night', 1)
    const id = await planned()

    db.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                           typical_uses, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES ('Passport','gear','Passport','Documents',0,'sometimes','[]',1,0,
                 'anytime',0,0,'seed_import',1,1)`,
      )
      .run()
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, condition_json,
                                   enabled, needs_review, original_text, created_at)
         VALUES ('rule-passport','Passport','fixed_per_trip',1,
                 '{"fact":"international","eq":true}',1,0,'test',1)`,
      )
      .run()

    // The rule was written after the plan, so only a regeneration finds it.
    const deltas = await edit(id, {})
    expect(deltas.some((d) => d.kind === 'item_added' && d.label === 'Passport')).toBe(true)
    expect(deltaLines(deltas)).toContain('Added Passport')
  })
})

/**
 * What the delta costs, measured rather than assumed (P4f).
 *
 * Reporting what an edit did is only worth having if the edit stays fast. The
 * snapshots are four extra reads around a regeneration that was already the
 * expensive part — two checklist reads and two coverage passes — and none of
 * them is per-row, which is the property that actually matters.
 *
 * Stated as a ceiling rather than an equality, for the same reason
 * `checklist-cost.test.ts` states one: a future fixed read is a fair change, a
 * read per row is not. The ceiling is far below the row count and comfortably
 * above what is measured, so it fails the moment anybody puts a query inside a
 * loop and does not fail because the workbook gained a rule.
 */
describe('what saying so costs', () => {
  /** One whole edit-with-delta, exactly as the route sequences it. */
  async function editWithDelta(id: string) {
    const counter = countRoundTrips(db.binding)
    const existing = (await getTrip(counter.db, id))!
    const before = await listChecklist(counter.db, id)
    const gapsBefore = await tripCoverageGaps(counter.db, existing, before)
    const trip = (await updateTrip(counter.db, id, { ...TRIP, endDate: '2026-08-05' }, NOW))!
    await generateChecklist(counter.db, trip, NOW)
    const after = await listChecklist(counter.db, trip.id)
    const gapsAfter = await tripCoverageGaps(counter.db, trip, after)
    planDelta(
      { entries: before, groups: [], gaps: gapsBefore },
      { entries: after, groups: [], gaps: gapsAfter },
    )
    return { roundTrips: counter.roundTrips(), rows: after.length }
  }

  /*
   * The property, asserted directly rather than through a ceiling.
   *
   * A ceiling is a guess that has to be re-guessed every time the route gains a
   * fair fixed read. What actually matters is that the cost does not grow with
   * the LIST — so this measures the same edit against two wardrobes of very
   * different sizes and requires the same number of round trips from both. A
   * query put inside a loop fails it immediately, and a new fixed read does not
   * fail it at all.
   */
  it('costs the same whatever the list, so nothing is per-row', async () => {
    for (let n = 0; n < 10; n += 1) gear(`Thing ${n}`, 'fixed_per_trip', 1)
    const small = await editWithDelta(await planned())

    for (let n = 10; n < 60; n += 1) gear(`Thing ${n}`, 'fixed_per_trip', 1)
    const large = await editWithDelta(await planned())

    console.log(
      [
        '',
        'PUT /trips/:id with delta reporting',
        `  ${String(small.roundTrips).padStart(3)} round trips   ${small.rows} rows`,
        `  ${String(large.roundTrips).padStart(3)} round trips   ${large.rows} rows`,
        '',
      ].join('\n'),
    )

    expect(large.rows, 'the two lists differ enough to catch a per-row read').toBeGreaterThan(
      small.rows * 3,
    )
    expect(large.roundTrips, 'the cost does not grow with the rows').toBe(small.roundTrips)
  })

  /*
   * And what the reporting itself adds, named rather than folded into a total.
   *
   * Four reads: the checklist either side of the regeneration, and a coverage
   * pass either side. `tripCoverageGaps` is two queries each, and `getTrip` is
   * the trip the first snapshot is taken against — seven in all, none per-row.
   */
  it('adds only the snapshots it needs', async () => {
    for (let n = 0; n < 10; n += 1) gear(`Thing ${n}`, 'fixed_per_trip', 1)
    const id = await planned()

    const plain = countRoundTrips(db.binding)
    const trip = (await updateTrip(plain.db, id, { ...TRIP, endDate: '2026-08-05' }, NOW))!
    await generateChecklist(plain.db, trip, NOW)

    const withDelta = await editWithDelta(await planned())

    const added = withDelta.roundTrips - plain.roundTrips()
    console.log(`\n  delta reporting adds ${added} reads\n`)
    expect(added, 'the snapshots are a fixed handful').toBeLessThanOrEqual(10)
  })
})
