import type { ChecklistEntry } from '@shared/checklist'
import type { Item } from '@shared/items'
import { garmentDetail, readTiming } from '@shared/items'
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
  detail_snapshot: string | null
  brand_snapshot: string | null
  color_snapshot: string | null
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
  /*
   * The seven bag traits, joined live from the catalog row (P3).
   *
   * NOT snapshotted, unlike the name and the category. Those are snapshots
   * because a packing list is a record of what Alex took; these are inputs to a
   * RECOMMENDATION, which is computed on read for exactly this reason —
   * answering "yes, that bottle is full-size" should fix every trip, not the
   * next one. Absent where the join found nothing, which is every trip-only row.
   */
  is_liquid?: number | null
  liquid_size?: string | null
  is_fragile?: number | null
  is_valuable?: number | null
  is_medical?: number | null
  is_transit_needed?: number | null
  is_bulky?: number | null
  is_delay_sensitive?: number | null
  /*
   * The bag Alex's own history has taught (P4c, migration 0028).
   *
   * Joined live beside the traits and for the same reason: accepting a
   * suggestion should improve every trip rather than the next one. Absent for a
   * trip-only row, which has no catalog row to learn from.
   */
  default_bag?: string | null
}

/**
 * `1` / `0` / absent as `true` / `false` / **not recorded**.
 *
 * The null branch is the whole point and is asserted by its own test: an
 * unanswered trait must never read as `false`, because "we do not know whether
 * this is a full-size liquid" becoming "this is not a full-size liquid" is how
 * Pack Smart would send a 200ml bottle through cabin security on its own say-so.
 */
function flag(value: number | null | undefined): boolean | null {
  return value === null || value === undefined ? null : value === 1
}

function toEntry(row: EntryRow): ChecklistEntry {
  return {
    id: row.id,
    tripId: row.trip_id,
    itemId: row.item_id,
    name: row.name_snapshot,
    /*
     * Who made it and which one it is (G6), snapshotted beside the name.
     *
     * Null on every row written before G6 — those names still contain the brand
     * and the colour, so a detail line would print them twice. See
     * `migrations/0018`.
     */
    detail: row.detail_snapshot,
    /*
     * The same two fields the detail above is composed FROM, kept apart
     * (migration 0029).
     *
     * A one-line row shows the brand as text and the colour as a swatch, and
     * neither can be recovered from the composed string without guessing which
     * of `Black Diamond · Navy` is the brand. Null together with `detail` on
     * every row written before 0019, and on every trip-only row.
     */
    brand: row.brand_snapshot,
    color: row.color_snapshot,
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
    traits: {
      liquid: flag(row.is_liquid),
      liquidSize: (row.liquid_size as 'cabin' | 'full' | null) ?? null,
      fragile: flag(row.is_fragile),
      valuable: flag(row.is_valuable),
      medical: flag(row.is_medical),
      transitNeeded: flag(row.is_transit_needed),
      bulky: flag(row.is_bulky),
      delaySensitive: flag(row.is_delay_sensitive),
    },
    learnedBag: (row.default_bag as ChecklistEntry['bag']) ?? null,
    // The row version a conditional write is judged against (F2). Zero for a
    // row written before the column was maintained, which reads as "unknown"
    // and therefore never blocks a write.
    updatedAt: row.updated_at ?? 0,
  }
}

/*
 * One query, joined rather than two (P3, and P1B's standing rule).
 *
 * The bag traits live on `item` and are read live, so a recommendation improves
 * for every trip the moment Alex answers a question. A second query would be a
 * second D1 round trip on the busiest read in the app; a LEFT JOIN costs nothing
 * and cannot miss a row — a trip-only entry has no `item_id` and simply gets
 * nulls, which read as *not recorded*.
 */
const ENTRY_SELECT = `SELECT e.*, i.is_liquid, i.liquid_size, i.is_fragile, i.is_valuable,
              i.is_medical, i.is_transit_needed, i.is_bulky, i.is_delay_sensitive,
              i.default_bag
         FROM checklist_entry e
         LEFT JOIN item i ON i.id = e.item_id`

const ENTRY_ORDER = 'ORDER BY e.sort_order, lower(e.name_snapshot)'

export async function listChecklist(db: D1Database, tripId: string): Promise<ChecklistEntry[]> {
  const result = await db
    .prepare(`${ENTRY_SELECT} WHERE e.trip_id = ? ${ENTRY_ORDER}`)
    .bind(tripId)
    .all<EntryRow>()
  return (result.results ?? []).map(toEntry)
}

/**
 * Every row across several trips, in ONE query.
 *
 * Review Closet Items has to simulate a bag question against every trip Alex
 * still has ahead of him, and a loop calling `listChecklist` per trip would be
 * the one-row-per-round-trip shape P1B spent a release removing — with the trip
 * count as the multiplier instead of the row count. The `IN` list is built from
 * placeholders rather than interpolated ids, so a trip id can never reach the
 * SQL text.
 *
 * Grouped by trip on the way out, because every caller wants it that way and
 * regrouping at each call site is the same loop written twice.
 */
export async function listChecklistsForTrips(
  db: D1Database,
  tripIds: string[],
): Promise<Map<string, ChecklistEntry[]>> {
  const grouped = new Map<string, ChecklistEntry[]>()
  for (const id of tripIds) grouped.set(id, [])
  if (tripIds.length === 0) return grouped

  const result = await db
    .prepare(
      `${ENTRY_SELECT} WHERE e.trip_id IN (${tripIds.map(() => '?').join(',')}) ${ENTRY_ORDER}`,
    )
    .bind(...tripIds)
    .all<EntryRow>()

  for (const row of result.results ?? []) {
    const entry = toEntry(row)
    grouped.get(entry.tripId)?.push(entry)
  }
  return grouped
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

  /*
   * Every row's write, collected and sent as ONE round trip (P1B).
   *
   * This used to `await … .run()` per row: 32 sequential statements on Alex's
   * real workbook, 35 counting the reads, and the same 32 again on every
   * regeneration — which made this 71% of creating a trip and 69% of editing
   * one, the second most expensive write in the app. D1 is a network database,
   * so those are 32 round trips for a list nobody is looking at yet.
   *
   * Nothing in the loop reads what the loop has written. `included` is an
   * in-memory set, `existingByItem` was read once before the first pass, and
   * `computeQuantity` is pure — so the order the statements are SENT in cannot
   * change what any of them contains, only when they land.
   *
   * The batch also fixes something that was quietly wrong. D1 runs one in an
   * implicit transaction, so a failure half way through now leaves the list as
   * it was rather than half regenerated.
   */
  const writes: D1PreparedStatement[] = []

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

        writes.push(db.prepare('DELETE FROM checklist_entry WHERE id = ?').bind(current.id))
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
            writes.push(
              db
                .prepare('UPDATE checklist_entry SET reason_text = ?, updated_at = ? WHERE id = ?')
                .bind(explained.reason, now, current.id),
            )
          }
          continue
        }
        writes.push(
          db
            .prepare(
              `UPDATE checklist_entry SET required_qty = ?, qty_breakdown_json = ?, reason_text = ?,
                                          source = ?, updated_at = ? WHERE id = ?`,
            )
            .bind(
              computed.quantity, renderBreakdown(computed), computed.reason,
              computed.source, now, current.id,
            ),
        )
        result.updated += 1
        continue
      }

      writes.push(
        db
          .prepare(
            `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, detail_snapshot,
                                          brand_snapshot, color_snapshot, category_snapshot,
                                          required_qty, qty_breakdown_json, qty_override, packed_qty,
                                          packing_timing, requires_final_check, final_checked_at,
                                          excluded_at, source, reason_text, rule_snapshot_json,
                                          is_critical, trip_only, sort_order, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,NULL,0,?,?,NULL,NULL,?,?,?,?,0,0,?,?)`,
          )
          .bind(
            crypto.randomUUID(), trip.id, item.id, item.displayName, garmentDetail(item),
            item.brand, item.color, item.category,
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
          ),
      )
      result.created += 1
    }
  }

  /*
   * One round trip for the whole list.
   *
   * Guarded, because a regeneration that changed nothing is the common case and
   * an empty batch is not universally a no-op.
   */
  if (writes.length > 0) await db.batch(writes)

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
