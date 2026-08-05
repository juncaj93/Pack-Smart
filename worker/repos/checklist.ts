import type { ChecklistEntry } from '@shared/checklist'
import type { Item } from '@shared/items'
import { readTiming } from '@shared/items'
import type { PackingRule } from '@shared/rules'
import { applyPrecedence, computeQuantity, renderBreakdown } from '@shared/rules'
import { factsToRecord } from '@shared/trips'
import type { Trip } from '@shared/trips'
import { listActiveCandidates } from './items'
import { listRules } from './rules'

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
  bag: string | null
  bag_source: string | null
  updated_at: number
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
    // Normalised, so a row written before the vocabulary shrank still reads as
    // one of the two surviving answers rather than a value nothing can label.
    packingTiming: readTiming(row.packing_timing),
    requiresFinalCheck: row.requires_final_check === 1,
    finalCheckedAt: row.final_checked_at,
    excludedAt: row.excluded_at,
    source: row.source,
    reason: row.reason_text,
    isCritical: row.is_critical === 1,
    tripOnly: row.trip_only === 1,
    sortOrder: row.sort_order,
    bag: (row.bag as ChecklistEntry['bag']) ?? null,
    bagSource: (row.bag_source as ChecklistEntry['bagSource']) ?? null,
    // The row version a conditional write is judged against (F2). Zero for a
    // row written before the column was maintained, which reads as "unknown"
    // and therefore never blocks a write.
    updatedAt: row.updated_at ?? 0,
  }
}

export async function listChecklist(db: D1Database, tripId: string): Promise<ChecklistEntry[]> {
  const result = await db
    .prepare('SELECT * FROM checklist_entry WHERE trip_id = ? ORDER BY sort_order, lower(name_snapshot)')
    .bind(tripId)
    .all<EntryRow>()
  return (result.results ?? []).map(toEntry)
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
  /** Rows whose rule stopped applying, and which nothing of Alex's was holding. */
  removed: number
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

  /*
   * Overrides are resolved here rather than left to `computeQuantity`, even
   * though it resolves them too. Candidacy, the two-pass dependency split and
   * the rule snapshot written onto each row all ask "which rules apply to this
   * item", and a superseded default is not one of them — answering that
   * question differently in four places is how a screen ends up citing a rule
   * the quantity never used.
   */
  const allRules = applyPrecedence(resolveDependencies(await listRules(db), candidates))

  const ruledItemIds = new Set(allRules.map((r) => r.itemId))
  const items = candidates.filter((item) => ruledItemIds.has(item.id) || item.alwaysInclude)

  const rulesByItem = new Map<string, PackingRule[]>()
  for (const rule of allRules) {
    rulesByItem.set(rule.itemId, [...(rulesByItem.get(rule.itemId) ?? []), rule])
  }

  /*
   * Display names by id, so a dependency rule's row can say "because you are
   * packing Apple Watch" instead of naming nothing. Built from every candidate
   * rather than from `items`, because the thing depended on may itself be
   * ruleless and still be what the sentence is about.
   */
  const itemNames: Record<string, string> = {}
  for (const item of candidates) itemNames[item.id] = item.displayName

  const facts = factsToRecord(trip.facts)
  const existing = await listChecklist(db, trip.id)
  const existingByItem = new Map(existing.filter((e) => e.itemId).map((e) => [e.itemId!, e]))

  const result: GenerationResult = { created: 0, updated: 0, preserved: 0, removed: 0, needsAnswer: [] }

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
        itemNames,
      })

      if (computed.incomplete) result.needsAnswer.push(item.displayName)

      const current = existingByItem.get(item.id)

      if (computed.quantity === null) {
        /*
         * The engine says no — and now the row goes with it.
         *
         * This function had no delete path at all, so a shaver conditioned on
         * `nights >= 3` stayed on the list after the trip was shortened to one
         * night. `syncChecklistFromOutfits` has always removed a row it no
         * longer wants, guarded exactly like this; the two writers disagreed
         * about an engine-owned row nobody wants any more, and only one of them
         * was right.
         *
         * The guards are what make a delete safe here. Anything Alex added, a
         * quantity he set, a decision to leave it behind, or **anything already
         * in the bag** stays: having packed the thing is the strongest possible
         * statement that it should be on the list, whatever the rule now says.
         */
        if (!current) continue

        const usersRow =
          current.source === 'user_added' ||
          current.qtyOverride !== null ||
          current.excludedAt !== null ||
          current.packedQty > 0

        if (usersRow) {
          result.preserved += 1
          continue
        }

        await db.prepare('DELETE FROM checklist_entry WHERE id = ?').bind(current.id).run()
        result.removed += 1
        continue
      }

      included.add(item.id)

      if (current) {
        // Never overwrite a hand-set quantity or an exclusion.
        if (current.qtyOverride !== null || current.excludedAt !== null) {
          result.preserved += 1
          /*
           * The quantity is preserved. The EXPLANATION is still refreshed.
           *
           * These two facts answer different questions: an override changes
           * how many, never why the item is on the trip at all. Skipping the
           * row entirely — which is what this did before C1 — left every
           * overridden row permanently unexplained, and a row Alex has taken
           * the trouble to adjust is the last one that should go silent.
           *
           * Recomputed with `quantityIsUsers`, so the reason cannot offer
           * arithmetic that no longer produces the number beside it.
           */
          const explained = computeQuantity(rules, {
            facts,
            includedItemIds: included,
            preferences: {},
            itemNames,
          }, { quantityIsUsers: current.qtyOverride !== null })

          if (explained.reason !== current.reason) {
            await db
              .prepare('UPDATE checklist_entry SET reason_text = ?, updated_at = ? WHERE id = ?')
              .bind(explained.reason, now, current.id)
              .run()
          }
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
          // Only the rules that actually spoke. A disabled rule reaches this
          // function now — it has to, so a switched-off default can be seen to
          // be switched off — and recording it here would have the row cite a
          // reason its quantity never used.
          JSON.stringify(
            rules.filter((r) => r.enabled).map((r) => ({ type: r.ruleType, text: r.originalText })),
          ),
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

/**
 * Which bag a row goes in — always as Alex's own choice.
 *
 * `bag_source = 'user'` unconditionally, because this function is only ever
 * reached from a tap. A recommendation is never STORED: `bagFor` computes it on
 * read, so improving the rules improves every existing trip without a migration
 * and without the risk of a suggestion being mistaken later for a decision.
 *
 * Clearing it (`null`) hands the row back to the recommendation, which is the
 * honest way to undo a choice rather than freezing whatever was suggested at the
 * moment Alex changed his mind.
 */
export async function setBag(
  db: D1Database,
  entryId: string,
  bag: string | null,
  now: number,
): Promise<ChecklistEntry | null> {
  await db
    .prepare('UPDATE checklist_entry SET bag = ?, bag_source = ?, updated_at = ? WHERE id = ?')
    .bind(bag, bag === null ? null : 'user', now, entryId)
    .run()
  return getEntry(db, entryId)
}

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
