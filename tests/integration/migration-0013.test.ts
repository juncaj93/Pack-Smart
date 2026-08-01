import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWorkbook } from '@shared/xlsx'
import type { TripInput } from '@shared/trips'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { importRoutes } from '../../worker/routes/import'
import { applyMigration, createTestDatabase, migrationFiles, type TestDatabase } from './d1'

/**
 * Migration 0013, against the schema it will actually meet.
 *
 * This is the only migration in Pack Smart that deletes rows, and the rows it
 * deletes are Alex's. So it is stood up at **0012** — production as it exists
 * today — given duplicates in every conflicting shape the current schema can
 * hold, and then measured field by field. A migration that has only ever run
 * against an empty database is a migration nobody has tested.
 *
 * The contract, from the D1b brief:
 *
 *   - never turn an excluded item back on
 *   - never turn a packed item back to unpacked
 *   - never delete a manually added row in favour of a weaker generated one
 *   - preserve the highest required quantity unless an override controls it
 *   - retain every outfit reference
 *   - and where two explicit decisions genuinely contradict, STOP rather than
 *     guess
 */

const PREVIOUS = '0012_outfit_deferral.sql'
const NEW = '0013_one_row_per_item.sql'
const WORKBOOK = 'seed-data/Master_Packing_Database_Complete.xlsx'
const NOW = 1_800_000_000

/** The approved worked example: 31 Jul – 11 Aug, 12 days, 11 nights, abroad. */
const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-07-31',
  endDate: '2026-08-11',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari', 'nice_dinner'],
  international: true,
  laundryAvailable: false,
  flightHours: 15,
}

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase({ upTo: PREVIOUS })

  db.raw
    .prepare(
      `INSERT INTO trip (id, name, start_date, end_date, international, status, created_at, updated_at)
       VALUES ('t1','Trip','2026-07-31','2026-08-11',1,'planning',1,1)`,
    )
    .run()

  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                         typical_uses, is_critical, requires_final_check,
                         default_packing_timing, always_include, never_include, source,
                         created_at, updated_at)
       VALUES ('i1','clothing','Grey Tee','Tops & Outerwear',0,'sometimes','[]',0,0,
               'anytime',0,0,'seed_import',1,1)`,
    )
    .run()
})

afterEach(() => {
  db.close()
})

/** One checklist row, every column defaulted so a test names only what it means. */
function row(
  id: string,
  over: Partial<{
    itemId: string | null
    requiredQty: number
    qtyOverride: number | null
    packedQty: number
    packingTiming: string
    requiresFinalCheck: number
    finalCheckedAt: number | null
    excludedAt: number | null
    source: string
    reason: string | null
    breakdown: string | null
    ruleSnapshot: string | null
    isCritical: number
    tripOnly: number
    sortOrder: number
    createdAt: number
    updatedAt: number
  }> = {},
) {
  const v = {
    itemId: 'i1' as string | null,
    requiredQty: 1,
    qtyOverride: null as number | null,
    packedQty: 0,
    packingTiming: 'anytime',
    requiresFinalCheck: 0,
    finalCheckedAt: null as number | null,
    excludedAt: null as number | null,
    source: 'always_packed',
    reason: null as string | null,
    breakdown: null as string | null,
    ruleSnapshot: null as string | null,
    isCritical: 0,
    tripOnly: 0,
    sortOrder: 0,
    createdAt: 100,
    updatedAt: 100,
    ...over,
  }

  db.raw
    .prepare(
      `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                    required_qty, qty_breakdown_json, qty_override, packed_qty,
                                    packing_timing, requires_final_check, final_checked_at,
                                    excluded_at, source, reason_text, rule_snapshot_json,
                                    is_critical, trip_only, sort_order, created_at, updated_at)
       VALUES (?,'t1',?,'Grey Tee','Tops & Outerwear',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id, v.itemId, v.requiredQty, v.breakdown, v.qtyOverride, v.packedQty,
      v.packingTiming, v.requiresFinalCheck, v.finalCheckedAt, v.excludedAt,
      v.source, v.reason, v.ruleSnapshot, v.isCritical, v.tripOnly, v.sortOrder,
      v.createdAt, v.updatedAt,
    )
  return id
}

const migrate = () => applyMigration(db.raw, NEW)

interface EntryRow {
  id: string
  required_qty: number
  qty_override: number | null
  packed_qty: number
  packing_timing: string
  requires_final_check: number
  final_checked_at: number | null
  excluded_at: number | null
  source: string
  reason_text: string | null
  qty_breakdown_json: string | null
  rule_snapshot_json: string | null
  is_critical: number
  trip_only: number
  sort_order: number
  created_at: number
  updated_at: number
}

const rows = () =>
  db.raw.prepare('SELECT * FROM checklist_entry ORDER BY id').all() as unknown as EntryRow[]

const only = () => {
  const all = rows()
  expect(all).toHaveLength(1)
  return all[0]!
}

describe('what the merge must never lose', () => {
  /*
   * The survivor is pinned by giving it a hand-set quantity, which outranks a
   * packed count in the selection order — so the state under test is on the row
   * that gets DELETED, and the assertion can only pass if it was carried across.
   *
   * Written the other way round first, and it could not fail: putting the packed
   * count on the row that would win selection anyway proved nothing about the
   * merge, only about the ranking.
   */
  it('keeps a packed count that was on the row being removed', () => {
    row('a', { qtyOverride: 1, packedQty: 0, createdAt: 100 })
    row('b', { packedQty: 3, createdAt: 200, source: 'outfit_generated' })

    migrate()

    const merged = only()
    expect(merged.id).toBe('a')
    expect(merged.packed_qty).toBe(3)
  })

  it('keeps an exclusion that was on the row being removed', () => {
    row('a', { qtyOverride: 1, createdAt: 100 })
    row('b', { excludedAt: 555, createdAt: 200, source: 'outfit_generated' })

    migrate()

    const merged = only()
    expect(merged.id).toBe('a')
    expect(merged.excluded_at).toBe(555)
  })

  /*
   * The case the first draft of this migration got wrong. Both rows carry an
   * explicit decision, so ranking them and deleting the loser throws one away
   * whichever way it ranks. They are not alternatives — they are two facts about
   * the same garment, and the merged row holds both.
   */
  it('keeps an exclusion and a packed count that were on different rows', () => {
    row('a', { excludedAt: 555, createdAt: 100 })
    row('b', { packedQty: 2, createdAt: 200, source: 'outfit_generated' })

    migrate()

    const merged = only()
    expect(merged.excluded_at).toBe(555)
    expect(merged.packed_qty).toBe(2)
  })

  it('keeps the earliest timestamp for a decision, not the latest', () => {
    row('a', { excludedAt: 900, finalCheckedAt: 900, createdAt: 100 })
    row('b', { excludedAt: 400, finalCheckedAt: 400, createdAt: 200, source: 'outfit_generated' })

    migrate()

    expect(only().excluded_at).toBe(400)
    expect(only().final_checked_at).toBe(400)
  })

  it('keeps a hand-set quantity, whichever row carried it', () => {
    row('a', { requiredQty: 12, createdAt: 100, source: 'outfit_generated' })
    row('b', { qtyOverride: 4, requiredQty: 1, createdAt: 200 })

    migrate()

    const merged = only()
    expect(merged.qty_override).toBe(4)
    // The highest generated quantity survives underneath it, so restoring the
    // suggestion does not silently drop to the weaker duplicate's number.
    expect(merged.required_qty).toBe(12)
  })

  it('keeps the highest required quantity when nothing overrides it', () => {
    row('a', { requiredQty: 2, createdAt: 100 })
    row('b', { requiredQty: 24, createdAt: 200, source: 'outfit_generated' })

    migrate()

    expect(only().required_qty).toBe(24)
    expect(only().qty_override).toBeNull()
  })

  it('never drops a row Alex added in favour of a generated one', () => {
    row('generated', { createdAt: 100, source: 'outfit_generated' })
    row('mine', { createdAt: 200, source: 'user_added' })

    migrate()

    const merged = only()
    expect(merged.id).toBe('mine')
    expect(merged.source).toBe('user_added')
  })

  it('keeps a Day-of placement', () => {
    row('a', { packingTiming: 'anytime', createdAt: 100 })
    row('b', { packingTiming: 'day_of', createdAt: 200, source: 'outfit_generated' })

    migrate()

    expect(only().packing_timing).toBe('day_of')
  })

  /*
   * `last_minute` is `day_of`'s retired spelling. A row written before the
   * vocabulary shrank still means Day-of, and the CHECK constraint still admits
   * it, so the merge has to read it as one.
   */
  it('reads the retired spelling of Day-of as Day-of', () => {
    row('a', { packingTiming: 'anytime', createdAt: 100 })
    row('b', { packingTiming: 'last_minute', createdAt: 200, source: 'outfit_generated' })

    migrate()

    expect(only().packing_timing).toBe('day_of')
  })

  it('keeps an explanation rather than a blank', () => {
    row('a', { reason: null, breakdown: null, ruleSnapshot: null, createdAt: 100 })
    row('b', {
      reason: 'Worn for Nice dinners',
      breakdown: '12 days of wear = 12',
      ruleSnapshot: '[{"type":"per_day"}]',
      createdAt: 200,
      source: 'outfit_generated',
    })

    migrate()

    const merged = only()
    expect(merged.reason_text).toBe('Worn for Nice dinners')
    expect(merged.qty_breakdown_json).toBe('12 days of wear = 12')
    expect(merged.rule_snapshot_json).toBe('[{"type":"per_day"}]')
  })

  it('keeps a raised flag rather than lowering it', () => {
    row('a', { isCritical: 0, requiresFinalCheck: 0, createdAt: 100 })
    row('b', { isCritical: 1, requiresFinalCheck: 1, createdAt: 200, source: 'outfit_generated' })

    migrate()

    expect(only().is_critical).toBe(1)
    expect(only().requires_final_check).toBe(1)
  })

  it('keeps the row’s true span and its earliest position', () => {
    row('a', { createdAt: 100, updatedAt: 150, sortOrder: 7 })
    row('b', { createdAt: 200, updatedAt: 900, sortOrder: 2, source: 'outfit_generated' })

    migrate()

    const merged = only()
    expect(merged.created_at).toBe(100)
    expect(merged.updated_at).toBe(900)
    expect(merged.sort_order).toBe(2)
  })

  it('moves every outfit reference onto the surviving row', () => {
    db.raw
      .prepare(
        `INSERT INTO outfit_group (id, trip_id, name, occurrences, status, sort_order,
                                   created_at, updated_at)
         VALUES ('g1','t1','Nice dinners',1,'approved',0,1,1)`,
      )
      .run()
    db.raw
      .prepare(
        `INSERT INTO outfit_slot (id, outfit_group_id, slot_role, required, item_id,
                                  reuse_allowed, filled_by, wearings, sort_order)
         VALUES ('s1','g1','top',1,'i1',1,'generated',1,0)`,
      )
      .run()

    // `b` is pinned as the survivor, so `a`'s link has to MOVE rather than
    // happening to be the one that stayed.
    row('a', { createdAt: 100, source: 'outfit_generated' })
    row('b', { qtyOverride: 1, createdAt: 200 })

    // Both duplicates link the same slot — the collision an UPDATE would reject.
    db.raw.prepare("INSERT INTO checklist_link VALUES ('a','s1')").run()
    db.raw.prepare("INSERT INTO checklist_link VALUES ('b','s1')").run()

    migrate()

    const links = db.raw.prepare('SELECT * FROM checklist_link').all() as unknown as Array<{
      checklist_entry_id: string
    }>
    expect(only().id).toBe('b')
    expect(links).toHaveLength(1)
    expect(links[0]!.checklist_entry_id).toBe('b')
  })
})

describe('when two decisions genuinely contradict', () => {
  /*
   * Two different hand-set quantities are two explicit statements that cannot
   * both be honoured, and no approved document says which wins. A failed
   * migration is recoverable; a silently discarded decision is not.
   */
  it('stops rather than picking one', () => {
    row('a', { qtyOverride: 3, createdAt: 100 })
    row('b', { qtyOverride: 9, createdAt: 200, source: 'outfit_generated' })

    expect(() => migrate()).toThrow(/CHECK constraint/i)

    // And nothing was touched on the way out — the guard runs before any write.
    expect(rows()).toHaveLength(2)
  })

  it('merges happily when the two agree', () => {
    row('a', { qtyOverride: 5, createdAt: 100 })
    row('b', { qtyOverride: 5, createdAt: 200, source: 'outfit_generated' })

    migrate()

    expect(only().qty_override).toBe(5)
  })
})

describe('what the merge must not touch', () => {
  it('leaves two hand-added items alone, because they are two real things', () => {
    row('gift-a', { itemId: null, source: 'user_added', tripOnly: 1, createdAt: 100 })
    row('gift-b', { itemId: null, source: 'user_added', tripOnly: 1, createdAt: 200 })

    migrate()

    expect(rows()).toHaveLength(2)
  })

  it('changes nothing on a list that has no duplicates', () => {
    row('a', { packedQty: 2, requiredQty: 3, reason: 'because', createdAt: 100, updatedAt: 150 })
    const before = rows()

    migrate()

    expect(rows()).toEqual(before)
  })

  it('applies to an empty database and leaves the constraint behind', () => {
    migrate()

    const index = db.raw
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_checklist_one_row_per_item'")
      .get() as { sql: string } | undefined
    expect(index?.sql).toMatch(/UNIQUE/i)
  })

  it('refuses a second row for the same item afterwards', () => {
    migrate()
    row('a')

    expect(() => row('b')).toThrow(/UNIQUE/i)
  })
})

describe('what it wrote down', () => {
  it('records how many rows it removed, and for how many items', () => {
    row('a', { createdAt: 100 })
    row('b', { createdAt: 200, source: 'outfit_generated' })
    row('c', { createdAt: 300, source: 'trip_triggered' })

    migrate()

    const recorded = db.raw
      .prepare("SELECT value_json FROM preference WHERE key = 'migration_0013_merged'")
      .get() as { value_json: string } | undefined

    expect(JSON.parse(recorded!.value_json)).toEqual({
      duplicate_rows_removed: 2,
      items_affected: 1,
    })
  })

  it('writes nothing when there was nothing to merge', () => {
    row('a')

    migrate()

    const recorded = db.raw
      .prepare("SELECT value_json FROM preference WHERE key = 'migration_0013_merged'")
      .get() as { value_json: string } | undefined
    expect(JSON.parse(recorded!.value_json).duplicate_rows_removed).toBe(0)
  })
})

describe('the migration file itself', () => {
  /*
   * 0013 is the last migration today. When a 0014 arrives this fails, and the
   * right response is to check that 0014 does not reintroduce a second writer
   * before moving the number along.
   */
  it('is applied immediately after the schema these tests stand up', () => {
    const files = migrationFiles()
    expect(files[files.indexOf(PREVIOUS) + 1]).toBe(NEW)
  })
})

/* ------------------------------------------------------------------ */
/* Alex's actual catalog, and the generator that produced the defect   */
/* ------------------------------------------------------------------ */

/**
 * The two scenarios fixtures cannot reach.
 *
 * Everything above builds the duplicates by hand, which proves the merge but not
 * that the merge meets the data it was written for. These import the real
 * 119-row workbook through the real endpoint and then produce the duplicates the
 * way production produced them — the two writers, alternating — before migrating.
 */
describe('the real workbook, and the real generator', () => {
  async function importWorkbook(database: TestDatabase): Promise<void> {
    const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
    const clothing = sheets.find((sheet) => /clothing/i.test(sheet.name))?.rows
    const gear = sheets.find((sheet) => /non-?clothing|rules|gear/i.test(sheet.name))?.rows
    expect(clothing && gear).toBeTruthy()

    const response = await importRoutes.request(
      new Request('https://example.test/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'seed.xlsx', clothing, gear }),
      }),
      undefined,
      { DB: database.binding } as never,
    )
    expect(response.status).toBe(200)
  }

  it('migrates a real catalog and a real trip without changing the list', async () => {
    const legacy = createTestDatabase({ upTo: PREVIOUS })
    try {
      await importWorkbook(legacy)
      const trip = await createTrip(legacy.binding, TRIP, NOW)
      const stored = (await getTrip(legacy.binding, trip.id))!
      await generateChecklist(legacy.binding, stored, NOW)

      const before = (await listChecklist(legacy.binding, trip.id))
        .map((e) => `${e.name}=${e.requiredQty}`)
        .sort()
      expect(before.length).toBeGreaterThan(10)

      applyMigration(legacy.raw, NEW)

      const after = (await listChecklist(legacy.binding, trip.id))
        .map((e) => `${e.name}=${e.requiredQty}`)
        .sort()
      expect(after).toEqual(before)
    } finally {
      legacy.close()
    }
  })

  /*
   * The defect, reproduced rather than simulated.
   *
   * Underwear carries the approved 2-per-trip-day rule AND is a garment an
   * outfit can use, which is exactly the overlap that grew a row on every
   * alternating regeneration. Built on the 0012 schema with the pre-D1b writers'
   * behaviour reproduced by hand — the fixed writers can no longer produce it,
   * which is the point of the fix and the reason this has to be constructed.
   */
  it('cleans up what the two writers actually produced, and keeps the packed state', async () => {
    const legacy = createTestDatabase({ upTo: PREVIOUS })
    try {
      await importWorkbook(legacy)
      const trip = await createTrip(legacy.binding, TRIP, NOW)
      const stored = (await getTrip(legacy.binding, trip.id))!
      await generateChecklist(legacy.binding, stored, NOW)

      const entries = await listChecklist(legacy.binding, trip.id)
      const seed = entries.find((e) => e.itemId && e.requiredQty > 1)
      expect(seed).toBeTruthy()

      // What the outfit writer did on the next pass: a second row for the same
      // garment, at its own quantity — and Alex then packed one of them.
      legacy.raw
        .prepare(
          `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                        required_qty, qty_override, packed_qty, packing_timing,
                                        requires_final_check, excluded_at, source, reason_text,
                                        is_critical, trip_only, sort_order, created_at, updated_at)
           VALUES ('dupe',?,?,?,?,1,NULL,1,'day_of',0,NULL,'outfit_generated',
                   'Worn for Nice dinners',0,0,9,?,?)`,
        )
        .run(trip.id, seed!.itemId, seed!.name, seed!.category, NOW + 10, NOW + 10)

      const doubled = (await listChecklist(legacy.binding, trip.id)).filter(
        (e) => e.itemId === seed!.itemId,
      )
      expect(doubled).toHaveLength(2)

      applyMigration(legacy.raw, NEW)

      const merged = (await listChecklist(legacy.binding, trip.id)).filter(
        (e) => e.itemId === seed!.itemId,
      )
      expect(merged).toHaveLength(1)
      // The rule's quantity, the outfit's packed count, and the Day-of placement
      // — three facts from two rows, none of them lost.
      expect(merged[0]!.requiredQty).toBe(seed!.requiredQty)
      expect(merged[0]!.packedQty).toBe(1)
      expect(merged[0]!.packingTiming).toBe('day_of')

      const recorded = legacy.raw
        .prepare("SELECT value_json FROM preference WHERE key = 'migration_0013_merged'")
        .get() as { value_json: string }
      expect(JSON.parse(recorded.value_json).duplicate_rows_removed).toBe(1)
    } finally {
      legacy.close()
    }
  })
})
