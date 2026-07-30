import type { Item, ItemInput, ItemKind, UsageFrequency } from '@shared/items'
import { categoryKind, readTiming } from '@shared/items'

/**
 * All catalog reads and writes.
 *
 * Candidate selection for new recommendations passes through
 * `listActiveCandidates` alone, so the archive filter lives in exactly one place
 * (technical-docs/02_DATA_MODEL.md §7). Historical reads deliberately do not use
 * it, which is how archived items stay visible on past trips.
 */

interface ItemRow {
  id: string
  kind: string
  display_name: string
  category: string
  subcategory: string | null
  color: string | null
  pattern: string | null
  brand: string | null
  notes: string | null
  favorite: number
  usage_frequency: string
  warmth: number | null
  dressiness: number | null
  weather_tags: string | null
  typical_uses: string | null
  reuse_capacity: number | null
  owned_quantity: number | null
  is_critical: number
  requires_final_check: number
  default_packing_timing: string
  always_include: number
  never_include: number
  archived_at: number | null
  source: string
  created_at: number
  updated_at: number
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    kind: row.kind as ItemKind,
    displayName: row.display_name,
    category: row.category,
    subcategory: row.subcategory,
    color: row.color,
    pattern: row.pattern,
    brand: row.brand,
    notes: row.notes,
    favorite: row.favorite === 1,
    usageFrequency: row.usage_frequency as UsageFrequency,
    warmth: row.warmth,
    dressiness: row.dressiness,
    weatherTags: parseJsonArray(row.weather_tags),
    typicalUses: parseJsonArray(row.typical_uses),
    reuseCapacity: row.reuse_capacity,
    ownedQuantity: row.owned_quantity,
    isCritical: row.is_critical === 1,
    requiresFinalCheck: row.requires_final_check === 1,
    defaultPackingTiming: readTiming(row.default_packing_timing),
    alwaysInclude: row.always_include === 1,
    neverInclude: row.never_include === 1,
    archivedAt: row.archived_at,
    source: row.source as Item['source'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT = 'SELECT * FROM item'

export interface ListOptions {
  /** Include archived items. Defaults to false. */
  includeArchived?: boolean
  category?: string
  /** Case-insensitive match against name, brand and colour. */
  search?: string
}

export async function listItems(db: D1Database, options: ListOptions = {}): Promise<Item[]> {
  const where: string[] = []
  const binds: unknown[] = []

  if (!options.includeArchived) where.push('archived_at IS NULL')

  if (options.category) {
    where.push('category = ?')
    binds.push(options.category)
  }

  const search = options.search?.trim()
  if (search) {
    where.push('(lower(display_name) LIKE ? OR lower(ifnull(brand, "")) LIKE ? OR lower(ifnull(color, "")) LIKE ?)')
    const like = `%${search.toLowerCase()}%`
    binds.push(like, like, like)
  }

  const sql =
    `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}` +
    ' ORDER BY archived_at IS NOT NULL, favorite DESC, lower(display_name)'

  const result = await db.prepare(sql).bind(...binds).all<ItemRow>()
  return (result.results ?? []).map(toItem)
}

/**
 * How many trips each item has been packed on.
 *
 * **Confirmed packing, not inclusion.** The obvious query — count the checklist
 * rows an item appears on — measures what the rules *suggested*, so the top of
 * "Most packed" would be whatever the engine proposes most often, which Alex
 * already knows and did not ask about. Counting only rows where the packed
 * quantity reached the required one measures what he actually put in a bag.
 *
 * Three things are excluded on purpose:
 *
 * - **`excluded_at IS NOT NULL`** — a row he took off the trip. It may have been
 *   packed at some point before he changed his mind, and it did not travel.
 * - **a required quantity of zero** — otherwise `packed_qty >= required` is
 *   trivially true and every such row counts as a triumph.
 * - **duplicate rows on one trip** — `DISTINCT trip_id`, so an item that appears
 *   twice on a single packing list is one trip, not two.
 *
 * `COALESCE(qty_override, required_qty)` and not `required_qty`, because that is
 * what the rest of the product means by "how many". `ChecklistEntry.requiredQty`
 * resolves the override on the way out and `isPacked` compares against the
 * resolved value — so a row where Alex said "two is enough" and packed two is
 * packed everywhere it is displayed. Comparing against the raw column here would
 * have made this one query quietly disagree with every tick on the screen.
 *
 * Trip-only rows have a null `item_id` and never reach this: they are not in the
 * wardrobe, so there is nothing in My Stuff for them to sort.
 */
export async function packedTripCounts(db: D1Database): Promise<Record<string, number>> {
  const result = await db
    .prepare(
      `SELECT item_id AS id, COUNT(DISTINCT trip_id) AS trips
         FROM checklist_entry
        WHERE item_id IS NOT NULL
          AND excluded_at IS NULL
          AND COALESCE(qty_override, required_qty) > 0
          AND packed_qty >= COALESCE(qty_override, required_qty)
        GROUP BY item_id`,
    )
    .all<{ id: string; trips: number }>()

  const counts: Record<string, number> = {}
  for (const row of result.results ?? []) counts[row.id] = row.trips
  return counts
}

export async function countItems(db: D1Database): Promise<{ active: number; archived: number }> {
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived
       FROM item`,
    )
    .first<{ active: number | null; archived: number | null }>()
  return { active: row?.active ?? 0, archived: row?.archived ?? 0 }
}

export async function distinctCategories(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare('SELECT DISTINCT category FROM item WHERE archived_at IS NULL ORDER BY category')
    .all<{ category: string }>()
  return (result.results ?? []).map((r) => r.category)
}

export async function getItem(db: D1Database, id: string): Promise<Item | null> {
  const row = await db.prepare(`${SELECT} WHERE id = ?`).bind(id).first<ItemRow>()
  return row ? toItem(row) : null
}

/**
 * The single archive filter for recommendation candidates.
 *
 * Archived items must not appear in new recommendations but must remain visible
 * on historical trips. Keeping this in one function means that rule cannot drift
 * across the many queries that will need it from M4 onward.
 */
export async function listActiveCandidates(db: D1Database, kind?: ItemKind): Promise<Item[]> {
  const sql = kind
    ? `${SELECT} WHERE archived_at IS NULL AND never_include = 0 AND kind = ?`
    : `${SELECT} WHERE archived_at IS NULL AND never_include = 0`
  const stmt = kind ? db.prepare(sql).bind(kind) : db.prepare(sql)
  const result = await stmt.all<ItemRow>()
  return (result.results ?? []).map(toItem)
}

function normalise(input: ItemInput) {
  const category = input.category.trim()
  return {
    kind: input.kind ?? categoryKind(category),
    display_name: input.displayName.trim(),
    category,
    subcategory: input.subcategory?.trim() || null,
    color: input.color?.trim() || null,
    pattern: input.pattern?.trim() || null,
    brand: input.brand?.trim() || null,
    notes: input.notes?.trim() || null,
    favorite: input.favorite ? 1 : 0,
    usage_frequency: input.usageFrequency ?? 'new',
    warmth: input.warmth ?? null,
    dressiness: input.dressiness ?? null,
    weather_tags: JSON.stringify(input.weatherTags ?? []),
    typical_uses: JSON.stringify(input.typicalUses ?? []),
    reuse_capacity: input.reuseCapacity ?? null,
    owned_quantity: input.ownedQuantity ?? null,
    is_critical: input.isCritical ? 1 : 0,
    requires_final_check: input.requiresFinalCheck ? 1 : 0,
    default_packing_timing: input.defaultPackingTiming ?? 'anytime',
    always_include: input.alwaysInclude ? 1 : 0,
    never_include: input.neverInclude ? 1 : 0,
  }
}

export async function createItem(
  db: D1Database,
  input: ItemInput,
  now: number,
  source: Item['source'] = 'manual',
  id: string = crypto.randomUUID(),
): Promise<Item> {
  const v = normalise(input)
  await db
    .prepare(
      `INSERT INTO item (
         id, kind, display_name, category, subcategory, color, pattern, brand, notes,
         favorite, usage_frequency, warmth, dressiness, weather_tags, typical_uses,
         reuse_capacity, owned_quantity, is_critical, requires_final_check,
         default_packing_timing, always_include, never_include,
         archived_at, source, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,
    )
    .bind(
      id, v.kind, v.display_name, v.category, v.subcategory, v.color, v.pattern, v.brand, v.notes,
      v.favorite, v.usage_frequency, v.warmth, v.dressiness, v.weather_tags, v.typical_uses,
      v.reuse_capacity, v.owned_quantity, v.is_critical, v.requires_final_check,
      v.default_packing_timing, v.always_include, v.never_include,
      source, now, now,
    )
    .run()

  const created = await getItem(db, id)
  if (!created) throw new Error('item disappeared immediately after insert')
  return created
}

export async function updateItem(
  db: D1Database,
  id: string,
  input: ItemInput,
  now: number,
): Promise<Item | null> {
  const existing = await getItem(db, id)
  if (!existing) return null

  const v = normalise(input)
  await db
    .prepare(
      `UPDATE item SET
         kind = ?, display_name = ?, category = ?, subcategory = ?, color = ?, pattern = ?,
         brand = ?, notes = ?, favorite = ?, usage_frequency = ?, warmth = ?, dressiness = ?,
         weather_tags = ?, typical_uses = ?, reuse_capacity = ?, owned_quantity = ?,
         is_critical = ?, requires_final_check = ?, default_packing_timing = ?,
         always_include = ?, never_include = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      v.kind, v.display_name, v.category, v.subcategory, v.color, v.pattern,
      v.brand, v.notes, v.favorite, v.usage_frequency, v.warmth, v.dressiness,
      v.weather_tags, v.typical_uses, v.reuse_capacity, v.owned_quantity,
      v.is_critical, v.requires_final_check, v.default_packing_timing,
      v.always_include, v.never_include, now, id,
    )
    .run()

  return getItem(db, id)
}

/** Archive, never delete (§1 rule 2). Reversible by design. */
export async function archiveItem(db: D1Database, id: string, now: number): Promise<Item | null> {
  await db
    .prepare('UPDATE item SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL')
    .bind(now, now, id)
    .run()
  return getItem(db, id)
}

export async function restoreItem(db: D1Database, id: string, now: number): Promise<Item | null> {
  await db
    .prepare('UPDATE item SET archived_at = NULL, updated_at = ? WHERE id = ?')
    .bind(now, id)
    .run()
  return getItem(db, id)
}
