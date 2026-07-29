import type { ChecklistEntry } from '@shared/checklist'
import type { Item } from '@shared/items'
import type { Condition, PackingRule } from '@shared/rules'
import { computeQuantity, renderBreakdown } from '@shared/rules'
import { factsToRecord } from '@shared/trips'
import type { Trip } from '@shared/trips'
import { listActiveCandidates } from './items'

/**
 * Generates a trip's packing list from the catalog and the trip's facts.
 *
 * Deliberately regenerates only rows the engine owns. Anything Alex has touched
 * — an added item, a changed quantity, something moved to Not Bringing — is
 * preserved across regeneration, because a checklist that silently undoes your
 * edits is worse than one that is slightly stale (product doc 03 §7).
 */

export type { ChecklistEntry }

interface EntryRow {
  id: string
  trip_id: string
  item_id: string | null
  name_snapshot: string
  category_snapshot: string
  required_qty: number
  qty_breakdown_json: string | null
  qty_override: number | null
  packed_qty: number
  packing_timing: string
  requires_final_check: number
  final_checked_at: number | null
  excluded_at: number | null
  source: string
  reason_text: string | null
  is_critical: number
  trip_only: number
  sort_order: number
}

function toEntry(row: EntryRow): ChecklistEntry {
  return {
    id: row.id,
    tripId: row.trip_id,
    itemId: row.item_id,
    name: row.name_snapshot,
    category: row.category_snapshot,
    requiredQty: row.qty_override ?? row.required_qty,
    qtyBreakdown: row.qty_breakdown_json,
    qtyOverride: row.qty_override,
    packedQty: row.packed_qty,
    packingTiming: row.packing_timing,
    requiresFinalCheck: row.requires_final_check === 1,
    finalCheckedAt: row.final_checked_at,
    excludedAt: row.excluded_at,
    source: row.source,
    reason: row.reason_text,
    isCritical: row.is_critical === 1,
    tripOnly: row.trip_only === 1,
    sortOrder: row.sort_order,
  }
}

export async function listChecklist(db: D1Database, tripId: string): Promise<ChecklistEntry[]> {
  const result = await db
    .prepare('SELECT * FROM checklist_entry WHERE trip_id = ? ORDER BY sort_order, lower(name_snapshot)')
    .bind(tripId)
    .all<EntryRow>()
  return (result.results ?? []).map(toEntry)
}

interface RuleRow {
  id: string
  item_id: string
  rule_type: string
  quantity_value: number | null
  buffer: number | null
  condition_json: string | null
  depends_on_item_id: string | null
  enabled: number
  original_text: string | null
}

function toRule(row: RuleRow): PackingRule {
  let condition: Condition | null = null
  if (row.condition_json) {
    try {
      condition = JSON.parse(row.condition_json) as Condition
    } catch {
      // An unreadable condition must not become "always true". Leaving it null
      // means the rule cannot fire, which is the safe direction.
      condition = null
    }
  }
  return {
    id: row.id,
    itemId: row.item_id,
    ruleType: row.rule_type as PackingRule['ruleType'],
    quantityValue: row.quantity_value,
    buffer: row.buffer,
    condition,
    dependsOnItemId: row.depends_on_item_id,
    enabled: row.enabled === 1,
    originalText: row.original_text,
  }
}

/**
 * Fallback for a dependency rule that still names its target instead of citing
 * an id.
 *
 * The import resolves names to ids in a second pass, so seeded rules arrive here
 * already pointing at a real item. This covers a hand-written rule that names
 * one — a lookup that misses simply leaves the rule as it was, and an
 * unresolvable dependency vetoes its item rather than including it on a guess.
 */
function resolveDependencies(rules: PackingRule[], items: Item[]): PackingRule[] {
  const byName = new Map(items.map((i) => [i.displayName.toLowerCase(), i.id]))
  return rules.map((rule) => {
    if (rule.ruleType !== 'dependency_include' || !rule.dependsOnItemId) return rule
    const resolved = byName.get(rule.dependsOnItemId.toLowerCase())
    return resolved ? { ...rule, dependsOnItemId: resolved } : rule
  })
}

export interface GenerationResult {
  created: number
  updated: number
  preserved: number
  /** Items whose rules referenced something the trip does not know. */
  needsAnswer: string[]
}

/**
 * Builds or refreshes the rule-driven checklist for a trip.
 *
 * Candidacy is "has at least one enabled rule", not "is gear". Almost all rules
 * are on gear, but underwear is a garment carrying the approved 2-per-trip-day
 * basis, and filtering by kind silently dropped it — the acceptance criterion
 * says 24, and the list showed none.
 *
 * Everything else Alex wears comes from approved outfits (M6), because product
 * doc 04 §8 makes outfits the source of truth for garments. A garment with no
 * rule is therefore left alone here rather than guessed at, which keeps the two
 * paths from producing conflicting clothing plans.
 */
export async function generateChecklist(
  db: D1Database,
  trip: Trip,
  now: number,
): Promise<GenerationResult> {
  // listActiveCandidates is the single archive filter (repos/items.ts §150).
  // Re-querying `item` here would let that rule drift.
  const candidates = await listActiveCandidates(db)

  const rulesResult = await db.prepare('SELECT * FROM packing_rule WHERE enabled = 1').all<RuleRow>()
  const allRules = resolveDependencies((rulesResult.results ?? []).map(toRule), candidates)

  const ruledItemIds = new Set(allRules.map((r) => r.itemId))
  const items = candidates.filter((item) => ruledItemIds.has(item.id) || item.alwaysInclude)

  const rulesByItem = new Map<string, PackingRule[]>()
  for (const rule of allRules) {
    rulesByItem.set(rule.itemId, [...(rulesByItem.get(rule.itemId) ?? []), rule])
  }

  const facts = factsToRecord(trip.facts)
  const existing = await listChecklist(db, trip.id)
  const existingByItem = new Map(existing.filter((e) => e.itemId).map((e) => [e.itemId!, e]))

  const result: GenerationResult = { created: 0, updated: 0, preserved: 0, needsAnswer: [] }

  // Two passes so dependency rules can see what the first pass included —
  // a charger cannot be decided before its device is.
  const included = new Set<string>()
  for (const pass of [1, 2]) {
    for (const item of items) {
      if (pass === 1 && rulesByItem.get(item.id)?.some((r) => r.ruleType === 'dependency_include')) {
        continue
      }
      if (pass === 2 && !rulesByItem.get(item.id)?.some((r) => r.ruleType === 'dependency_include')) {
        continue
      }

      const rules = rulesByItem.get(item.id) ?? []
      const computed = computeQuantity(rules, {
        facts,
        includedItemIds: included,
        preferences: {},
      })

      if (computed.incomplete) result.needsAnswer.push(item.displayName)

      const current = existingByItem.get(item.id)

      if (computed.quantity === null) {
        // The engine says no. If Alex explicitly added or kept it, leave it be.
        if (current && (current.source === 'user_added' || current.qtyOverride !== null)) {
          result.preserved += 1
        }
        continue
      }

      included.add(item.id)

      if (current) {
        // Never overwrite a hand-set quantity or an exclusion.
        if (current.qtyOverride !== null || current.excludedAt !== null) {
          result.preserved += 1
          continue
        }
        await db
          .prepare(
            `UPDATE checklist_entry SET required_qty = ?, qty_breakdown_json = ?, reason_text = ?,
                                        source = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(
            computed.quantity, renderBreakdown(computed), computed.reason,
            computed.source, now, current.id,
          )
          .run()
        result.updated += 1
        continue
      }

      await db
        .prepare(
          `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                        required_qty, qty_breakdown_json, qty_override, packed_qty,
                                        packing_timing, requires_final_check, final_checked_at,
                                        excluded_at, source, reason_text, rule_snapshot_json,
                                        is_critical, trip_only, sort_order, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,NULL,0,?,?,NULL,NULL,?,?,?,?,0,0,?,?)`,
        )
        .bind(
          crypto.randomUUID(), trip.id, item.id, item.displayName, item.category,
          computed.quantity, renderBreakdown(computed),
          item.defaultPackingTiming, item.requiresFinalCheck ? 1 : 0,
          computed.source, computed.reason,
          JSON.stringify(rules.map((r) => ({ type: r.ruleType, text: r.originalText }))),
          item.isCritical ? 1 : 0, now, now,
        )
        .run()
      result.created += 1
    }
  }

  return result
}

/* ------------------------------------------------------------------ */
/* row actions                                                         */
/* ------------------------------------------------------------------ */

export async function setPackedQty(
  db: D1Database,
  entryId: string,
  packedQty: number,
  now: number,
): Promise<ChecklistEntry | null> {
  await db
    .prepare('UPDATE checklist_entry SET packed_qty = ?, updated_at = ? WHERE id = ?')
    .bind(Math.max(0, packedQty), now, entryId)
    .run()
  return getEntry(db, entryId)
}

export async function setQtyOverride(
  db: D1Database,
  entryId: string,
  quantity: number | null,
  now: number,
): Promise<ChecklistEntry | null> {
  await db
    .prepare('UPDATE checklist_entry SET qty_override = ?, updated_at = ? WHERE id = ?')
    .bind(quantity, now, entryId)
    .run()
  return getEntry(db, entryId)
}

export async function setTiming(
  db: D1Database,
  entryId: string,
  timing: string,
  now: number,
): Promise<ChecklistEntry | null> {
  await db
    .prepare('UPDATE checklist_entry SET packing_timing = ?, updated_at = ? WHERE id = ?')
    .bind(timing, now, entryId)
    .run()
  return getEntry(db, entryId)
}

/** Removal moves to Not Bringing — it never erases the evidence it was considered. */
export async function excludeEntry(
  db: D1Database,
  entryId: string,
  now: number,
): Promise<ChecklistEntry | null> {
  await db
    .prepare('UPDATE checklist_entry SET excluded_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, entryId)
    .run()
  return getEntry(db, entryId)
}

export async function restoreEntry(
  db: D1Database,
  entryId: string,
  now: number,
): Promise<ChecklistEntry | null> {
  await db
    .prepare('UPDATE checklist_entry SET excluded_at = NULL, updated_at = ? WHERE id = ?')
    .bind(now, entryId)
    .run()
  return getEntry(db, entryId)
}

export async function setFinalChecked(
  db: D1Database,
  entryId: string,
  checked: boolean,
  now: number,
): Promise<ChecklistEntry | null> {
  await db
    .prepare('UPDATE checklist_entry SET final_checked_at = ?, updated_at = ? WHERE id = ?')
    .bind(checked ? now : null, now, entryId)
    .run()
  return getEntry(db, entryId)
}

export async function addTripOnlyItem(
  db: D1Database,
  tripId: string,
  name: string,
  category: string,
  quantity: number,
  now: number,
): Promise<ChecklistEntry | null> {
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                    required_qty, qty_breakdown_json, qty_override, packed_qty,
                                    packing_timing, requires_final_check, final_checked_at,
                                    excluded_at, source, reason_text, rule_snapshot_json,
                                    is_critical, trip_only, sort_order, created_at, updated_at)
       VALUES (?,?,NULL,?,?,?,NULL,NULL,0,'anytime',0,NULL,NULL,'user_added',NULL,NULL,0,1,0,?,?)`,
    )
    .bind(id, tripId, name.trim(), category, Math.max(1, quantity), now, now)
    .run()
  return getEntry(db, id)
}

export async function getEntry(db: D1Database, id: string): Promise<ChecklistEntry | null> {
  const row = await db.prepare('SELECT * FROM checklist_entry WHERE id = ?').bind(id).first<EntryRow>()
  return row ? toEntry(row) : null
}
