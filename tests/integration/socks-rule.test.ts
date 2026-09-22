import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { createTrip } from '../../worker/repos/trips'
import { applyMigration, createTestDatabase, insertItem, insertRule, type TestDatabase } from './d1'

/**
 * Socks: days + 1, replacing the floor of five (doc 09 §0x).
 *
 * Stood up the way production actually is — the schema as it stands before the
 * migration, the rule Alex wrote already in it, and *then* 0030 applied. Order
 * is the whole point: this migration acts on a row that already exists, so a
 * database migrated before that row is written finds nothing to supersede and
 * the file is a silent no-op.
 *
 * What is asserted is the NUMBER ON THE LIST, not the shape of the row. A
 * migration that writes a correct-looking rule the engine then ignores is the
 * failure worth catching, and only a real checklist catches it.
 */

const PREVIOUS = '0029_row_metadata_and_manual_outfits.sql'
const NEW = '0030_socks_days_plus_one.sql'
const NOW = 1_780_000_000

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase({ upTo: PREVIOUS })
})

afterEach(() => {
  db.close()
})

/** Five inclusive days, which is what makes six pairs distinguishable from five. */
const FIVE_DAYS: TripInput = {
  name: 'Five days away',
  startDate: '2026-08-01',
  endDate: '2026-08-05',
  destinations: [{ name: 'Lisbon', country: 'Portugal' }],
  activities: [],
  international: true,
  laundryAvailable: false,
  flightHours: 3,
}

function socks(displayName = 'Socks') {
  return insertItem(db, { displayName, kind: 'clothing', category: 'Accessories & Undergarments' })
}

/** How many pairs a real checklist asks for, and the sentence beside the number. */
async function onTheList(itemId: string) {
  const trip = await createTrip(db.binding, FIVE_DAYS, NOW)
  await generateChecklist(db.binding, trip, NOW)
  const row = (await listChecklist(db.binding, trip.id)).find((e) => e.itemId === itemId)
  return row ?? null
}

describe('replacing the floor of five', () => {
  it('asks for one pair a day plus a spare, where it used to ask for five', async () => {
    const item = socks()
    insertRule(db, item, {
      ruleType: 'fixed_per_trip',
      quantityValue: 5,
      source: 'user',
      originalText: 'Set in Packing rules',
    })

    // Before: the floor, whatever the trip is.
    expect((await onTheList(item))?.requiredQty).toBe(5)

    applyMigration(db.raw, NEW)

    expect((await onTheList(item))?.requiredQty).toBe(6)
  })

  /*
   * The same ruling stated as a `minimum`, which is the other shape "at least
   * five" can have been written in. Both are quantity rules and both are
   * replaced — a migration that handled only one would leave the floor standing
   * and silently take the higher of the two.
   */
  it('replaces a minimum of five as well as a fixed count', async () => {
    const item = socks()
    insertRule(db, item, { ruleType: 'minimum', quantityValue: 5, source: 'user' })

    applyMigration(db.raw, NEW)

    expect((await onTheList(item))?.requiredQty).toBe(6)
  })

  /*
   * Additive, exactly as 0017 is. The old rule is still there and still
   * readable, so `Use the default` can put it back — the migration records a
   * decision rather than destroying the row it decided against.
   */
  it('leaves the old rule in place, superseded rather than rewritten', () => {
    const item = socks()
    const old = insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 5 })

    applyMigration(db.raw, NEW)

    const before = db.raw
      .prepare('SELECT rule_type, quantity_value, enabled FROM packing_rule WHERE id = ?')
      .get(old) as { rule_type: string; quantity_value: number; enabled: number }

    expect(before).toMatchObject({ rule_type: 'fixed_per_trip', quantity_value: 5, enabled: 1 })

    const override = db.raw
      .prepare('SELECT * FROM packing_rule WHERE supersedes_rule_id = ?')
      .get(old) as { rule_type: string; quantity_value: number; buffer: number; source: string }

    expect(override).toMatchObject({
      rule_type: 'duration_plus_buffer',
      quantity_value: 1,
      buffer: 1,
      source: 'user',
    })
  })

  /*
   * A fresh import is the case with no rule at all: `garmentRule` writes one for
   * boxer briefs and for nothing else, so socks arrive bare. Alex has stated a
   * basis for them now, so the migration writes it outright.
   */
  it('writes the rule outright where socks carry none', async () => {
    const item = socks()

    expect(await onTheList(item)).toBeNull()

    applyMigration(db.raw, NEW)

    expect((await onTheList(item))?.requiredQty).toBe(6)
  })

  it('finds the socks row under the name the workbook gives it', async () => {
    const item = socks('Socks (Multiple Pairs)')
    insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 5 })

    applyMigration(db.raw, NEW)

    expect((await onTheList(item))?.requiredQty).toBe(6)
  })

  /*
   * Idempotence, and it is not theoretical. The first draft of this file had no
   * guard against its own output: a second application found the rule it had
   * just written — enabled, unsuperseded, a quantity rule — superseded THAT,
   * and left socks with a nested pair of identical rules. The test failed
   * before the guard existed, which is the only reason to trust it now.
   */
  it('can be applied twice without writing a second rule', async () => {
    const item = socks()
    insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 5 })

    applyMigration(db.raw, NEW)
    applyMigration(db.raw, NEW)

    const count = db.raw
      .prepare("SELECT count(*) AS n FROM packing_rule WHERE item_id = ? AND rule_type = 'duration_plus_buffer'")
      .get(item) as { n: number }

    expect(count.n).toBe(1)
    expect((await onTheList(item))?.requiredQty).toBe(6)
  })

  /*
   * Socks that have already been overridden once.
   *
   * It is the rule IN FORCE that Alex is replacing, so the override is what
   * gets superseded and the shadowed row underneath it is left where it is.
   * Superseding the shadowed row instead would change nothing on the list and
   * would spend the unique index on `supersedes_rule_id` doing it.
   */
  it('replaces the rule in force, not the one already shadowed', async () => {
    const item = socks()
    const seeded = insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 5 })
    const inForce = insertRule(db, item, {
      ruleType: 'per_day',
      quantityValue: 2,
      source: 'user',
      supersedesRuleId: seeded,
    })

    expect((await onTheList(item))?.requiredQty).toBe(10)

    applyMigration(db.raw, NEW)

    expect((await onTheList(item))?.requiredQty).toBe(6)

    const chain = db.raw
      .prepare('SELECT supersedes_rule_id AS s FROM packing_rule WHERE rule_type = ?')
      .all('duration_plus_buffer') as Array<{ s: string | null }>

    expect(chain.map((r) => r.s)).toEqual([inForce])
  })

  it('touches nothing else in the wardrobe', async () => {
    const socksId = socks()
    insertRule(db, socksId, { ruleType: 'fixed_per_trip', quantityValue: 5 })

    const tee = insertItem(db, { displayName: 'T-Shirt', kind: 'clothing' })
    insertRule(db, tee, { ruleType: 'fixed_per_trip', quantityValue: 5 })

    applyMigration(db.raw, NEW)

    expect((await onTheList(tee))?.requiredQty).toBe(5)
  })
})
