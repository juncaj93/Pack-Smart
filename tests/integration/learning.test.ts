import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { excludeEntry, generateChecklist, listChecklist, setPackedQty } from '../../worker/repos/checklist'
import {
  acceptRemovalProposal,
  pendingRemovalProposals,
  pendingUnwornProposals,
} from '../../worker/repos/learning'
import { createTrip } from '../../worker/repos/trips'
import { createTestDatabase, effectiveRule, type TestDatabase } from './d1'

/**
 * Learning from removals, against real SQL (product doc 04 §7).
 *
 * The evidence is `checklist_entry.excluded_at`, which has been recorded since M5
 * and read by nothing across trips. No new table: a derived proposal cannot go
 * stale against the history that produced it, which is why
 * `preference_change_suggestion` stays unused rather than being populated.
 */

const NOW = 1_780_000_000
let db: TestDatabase

function trip(n: number): TripInput {
  return {
    name: `Trip ${n}`,
    startDate: `2026-0${n}-01`,
    endDate: `2026-0${n}-04`,
    destinations: [{ name: 'Lisbon', country: 'Portugal' }],
    activities: [],
    international: false,
  }
}

function gear(id: string, critical = false) {
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                         typical_uses, is_critical, requires_final_check,
                         default_packing_timing, always_include, never_include, source,
                         created_at, updated_at)
       VALUES (?,?,?,'Travel Gear',0,'sometimes','[]',?,0,'anytime',0,0,'seed_import',1,1)`,
    )
    .run(id, 'gear', id, critical ? 1 : 0)

  db.raw
    .prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, condition_json,
                                 enabled, needs_review, original_text, created_at)
       VALUES (?,?,'fixed_per_trip',1,NULL,1,0,'test',1)`,
    )
    .run(`rule-${id}`, id)
}

/** Plans a trip and takes the named item off its list. */
async function removeOn(tripNumber: number, itemName: string) {
  const made = await createTrip(db.binding, trip(tripNumber), NOW)
  await generateChecklist(db.binding, made, NOW)
  const entry = (await listChecklist(db.binding, made.id)).find((e) => e.name === itemName)
  if (!entry) throw new Error(`${itemName} never reached trip ${tripNumber}'s list`)
  await excludeEntry(db.binding, entry.id, NOW)
}

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

describe('noticing a habit', () => {
  it('says nothing after two trips, and offers after three', async () => {
    gear('Travel Iron')

    await removeOn(1, 'Travel Iron')
    await removeOn(2, 'Travel Iron')
    expect(await pendingRemovalProposals(db.binding)).toEqual([])

    await removeOn(3, 'Travel Iron')
    const proposals = await pendingRemovalProposals(db.binding)

    expect(proposals).toHaveLength(1)
    expect(proposals[0]!.itemName).toBe('Travel Iron')
    expect(proposals[0]!.trips).toBe(3)
  })

  /*
   * Counts trips, not rows. Removing the same thing twice within one trip is one
   * decision, and counting it twice would fake a pattern out of a single change
   * of mind.
   *
   * This used to insert a second excluded row on the same trip and assert the
   * counter still said one — the shape a re-add then re-remove would leave.
   *
   * **Migration 0013 makes that row impossible**, which is a stronger answer than
   * counting around it: `COUNT(DISTINCT trip_id)` is still what the query does,
   * and now nothing can produce the state it was defending against. So the test
   * asserts the refusal, because a test that sets up an unreachable state proves
   * nothing about the product.
   */
  it('cannot be given two rows for the same garment on one trip', async () => {
    gear('Travel Iron')
    await removeOn(1, 'Travel Iron')

    const rows = db.raw
      .prepare('SELECT trip_id FROM checklist_entry WHERE excluded_at IS NOT NULL')
      .all() as Array<{ trip_id: string }>

    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                        required_qty, packed_qty, packing_timing,
                                        requires_final_check, excluded_at, source, is_critical,
                                        trip_only, sort_order, created_at, updated_at)
           VALUES ('dup',?, 'Travel Iron','Travel Iron','Travel Gear',1,0,'anytime',0,1,
                   'trip_triggered',0,0,0,1,1)`,
        )
        .run(rows[0]!.trip_id),
    ).toThrow(/UNIQUE/i)

    await removeOn(2, 'Travel Iron')
    // And two real trips are still under the three-trip threshold.
    expect(await pendingRemovalProposals(db.binding)).toEqual([])
  })
})

describe('accepting is the explicit act', () => {
  it('disables the rule and drops the proposal', async () => {
    gear('Travel Iron')
    for (const n of [1, 2, 3]) await removeOn(n, 'Travel Iron')

    const [proposal] = await pendingRemovalProposals(db.binding)
    const outcome = await acceptRemovalProposal(db.binding, proposal!.ruleId)

    expect(outcome.disabled).toBe(true)
    expect(await pendingRemovalProposals(db.binding)).toEqual([])

    /*
     * Nothing adds the item any more — and the seeded rule is still exactly
     * where it was.
     *
     * This used to run `UPDATE packing_rule SET enabled = 0` over whichever row
     * it found, including a seeded one. That is a mutation of a canonical
     * default, and after it the default and the decision to stop using it were
     * the same row, with nothing left to restore to. Accepting now writes a
     * `learned` rule that replaces the default — reversible, and visibly not
     * something Alex typed himself.
     */
    expect(effectiveRule(db, proposal!.ruleId)).toMatchObject({
      enabled: 0,
      source: 'learned',
    })

    const seeded = db.raw
      .prepare('SELECT enabled, source FROM packing_rule WHERE id = ?')
      .get(proposal!.ruleId) as { enabled: number; source: string }
    expect(seeded).toMatchObject({ enabled: 1, source: 'system' })
  })

  /*
   * Disabled, not deleted. Packing rules can turn it back on, and nothing about
   * why the rule existed is lost (data model Rule 2).
   */
  it('leaves the rule in place so it can be turned back on', async () => {
    gear('Travel Iron')
    for (const n of [1, 2, 3]) await removeOn(n, 'Travel Iron')
    const [proposal] = await pendingRemovalProposals(db.binding)

    await acceptRemovalProposal(db.binding, proposal!.ruleId)

    const rule = db.raw
      .prepare('SELECT original_text FROM packing_rule WHERE id = ?')
      .get(proposal!.ruleId) as { original_text: string } | undefined
    expect(rule?.original_text).toBe('test')
  })

  it('reports honestly when there was nothing to disable', async () => {
    expect(await acceptRemovalProposal(db.binding, 'no-such-rule')).toEqual({ disabled: false })
  })

  it('stops the item reaching the next trip’s list', async () => {
    gear('Travel Iron')
    for (const n of [1, 2, 3]) await removeOn(n, 'Travel Iron')
    const [proposal] = await pendingRemovalProposals(db.binding)
    await acceptRemovalProposal(db.binding, proposal!.ruleId)

    const next = await createTrip(db.binding, trip(4), NOW)
    await generateChecklist(db.binding, next, NOW)

    const names = (await listChecklist(db.binding, next.id)).map((e) => e.name)
    expect(names).not.toContain('Travel Iron')
  })
})

describe('what it will not offer', () => {
  /*
   * The safety interaction with doc 02 §9c. Accepting would leave a critical item
   * with no enabled rule — unable to reach any list — which is the silent
   * omission that check exists to catch.
   */
  it('never offers to stop adding an essential', async () => {
    gear('Passport', true)
    for (const n of [1, 2, 3]) await removeOn(n, 'Passport')

    expect(await pendingRemovalProposals(db.binding)).toEqual([])
  })

  it('ignores an archived item', async () => {
    gear('Travel Iron')
    for (const n of [1, 2, 3]) await removeOn(n, 'Travel Iron')
    expect(await pendingRemovalProposals(db.binding)).toHaveLength(1)

    db.raw.prepare('UPDATE item SET archived_at = 1 WHERE id = ?').run('Travel Iron')
    expect(await pendingRemovalProposals(db.binding)).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* packed, and never worn                                              */
/* ------------------------------------------------------------------ */

/** A finished trip, so "not yet worn" is a real answer rather than a pending one. */
function pastTrip(n: number): TripInput {
  return { ...trip(n), startDate: `2025-0${n}-01`, endDate: `2025-0${n}-04` }
}

/** Packs the item, and optionally records that During Trip was used on this trip. */
async function packOn(
  tripNumber: number,
  itemName: string,
  opts: { tracked: boolean; wore?: boolean } = { tracked: true },
) {
  const made = await createTrip(db.binding, pastTrip(tripNumber), NOW)
  await generateChecklist(db.binding, made, NOW)
  const entry = (await listChecklist(db.binding, made.id)).find((e) => e.name === itemName)!
  await setPackedQty(db.binding, entry.id, 1, NOW)

  if (opts.tracked) {
    // A wear_log row for SOMETHING on this trip proves the screen was used.
    db.raw
      .prepare(
        `INSERT INTO wear_log (id, trip_id, item_id, event_id, worn_date, action, created_at)
         VALUES (?,?,?,NULL,?,?,1)`,
      )
      .run(
        `w-${tripNumber}-${opts.wore ? itemName : 'other'}`,
        made.id,
        opts.wore ? entry.itemId : itemName,
        pastTrip(tripNumber).startDate,
        opts.wore ? 'already_wore' : 'too_warm',
      )
  }
  return made
}

describe('packed and never worn, against real SQL', () => {
  const TODAY = '2026-01-01'

  it('offers after three finished trips where it was packed and never worn', async () => {
    gear('Rain Jacket')
    for (const n of [1, 2, 3]) await packOn(n, 'Rain Jacket')

    const proposals = await pendingUnwornProposals(db.binding, TODAY)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]!.message).toContain('never wore it')
  })

  /*
   * THE guard, and the reason this feature is usable at all.
   *
   * `wear_log` is written only from During Trip. On a trip Alex never opened,
   * every packed item looks unworn — so without requiring proof the screen was
   * used, this panel would confidently offer to stop packing his whole wardrobe.
   * Absence of evidence is not evidence of absence.
   */
  it('ignores trips where During Trip was never used', async () => {
    gear('Rain Jacket')
    for (const n of [1, 2, 3]) await packOn(n, 'Rain Jacket', { tracked: false })

    expect(await pendingUnwornProposals(db.binding, TODAY)).toEqual([])
  })

  it('does not count a trip where it was actually worn', async () => {
    gear('Rain Jacket')
    await packOn(1, 'Rain Jacket', { tracked: true, wore: true })
    await packOn(2, 'Rain Jacket', { tracked: true })
    await packOn(3, 'Rain Jacket', { tracked: true })

    // Two unworn trips out of three is below the threshold.
    expect(await pendingUnwornProposals(db.binding, TODAY)).toEqual([])
  })

  // Mid-trip, "not yet worn" says nothing at all.
  it('ignores a trip that has not finished', async () => {
    gear('Rain Jacket')
    for (const n of [1, 2, 3]) await packOn(n, 'Rain Jacket')

    // A date before those trips ended makes all three unfinished.
    expect(await pendingUnwornProposals(db.binding, '2025-01-02')).toEqual([])
  })

  it('ignores something that was never actually packed', async () => {
    gear('Rain Jacket')
    for (const n of [1, 2, 3]) {
      const made = await createTrip(db.binding, pastTrip(n), NOW)
      await generateChecklist(db.binding, made, NOW)
      db.raw
        .prepare(
          `INSERT INTO wear_log (id, trip_id, item_id, event_id, worn_date, action, created_at)
           VALUES (?,?,?,NULL,?, 'too_warm',1)`,
        )
        .run(`w-none-${n}`, made.id, 'Rain Jacket', pastTrip(n).startDate)
    }

    // packed_qty stayed 0, so it never went in the bag and proves nothing.
    expect(await pendingUnwornProposals(db.binding, TODAY)).toEqual([])
  })

  it('never offers to stop packing an essential', async () => {
    gear('Passport', true)
    for (const n of [1, 2, 3]) await packOn(n, 'Passport')

    expect(await pendingUnwornProposals(db.binding, TODAY)).toEqual([])
  })
})
