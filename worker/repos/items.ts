import type { Item, ItemInput, ItemKind, UsageFrequency } from '@shared/items'
import { categoryKind, readTiming } from '@shared/items'
import type { DressinessContext } from '@shared/dressiness'
import { canonicalise, contextForLevel, parseContexts, serialiseContexts } from '@shared/dressiness'
import type {
  FieldProvenance,
  ProvenancedField,
  RefusedWrite,
  ValueSource,
} from '@shared/provenance'
import {
  PROVENANCED_FIELDS,
  clearField,
  decideWrite,
  parseProvenance,
  revertField,
  serialiseProvenance,
} from '@shared/provenance'

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
  usage_frequency: string
  warmth: number | null
  dressiness: number | null
  dressiness_contexts: string | null
  weather_tags: string | null
  typical_uses: string | null
  reuse_capacity: number | null
  owned_quantity: number | null
  comfort: number | null
  versatility: number | null
  is_critical: number
  requires_final_check: number
  default_packing_timing: string
  always_include: number
  never_include: number
  archived_at: number | null
  source: string
  field_provenance: string | null
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
    usageFrequency: row.usage_frequency as UsageFrequency,
    warmth: row.warmth,
    dressiness: row.dressiness,
    dressinessContexts: parseContexts(row.dressiness_contexts),
    weatherTags: parseJsonArray(row.weather_tags),
    typicalUses: parseJsonArray(row.typical_uses),
    reuseCapacity: row.reuse_capacity,
    ownedQuantity: row.owned_quantity,
    comfort: row.comfort,
    versatility: row.versatility,
    isCritical: row.is_critical === 1,
    requiresFinalCheck: row.requires_final_check === 1,
    defaultPackingTiming: readTiming(row.default_packing_timing),
    alwaysInclude: row.always_include === 1,
    neverInclude: row.never_include === 1,
    archivedAt: row.archived_at,
    source: row.source as Item['source'],
    fieldProvenance: parseProvenance(row.field_provenance ?? null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * The provenanced fields of an item, as `decideWrite` wants them.
 *
 * One function rather than a spread at each call site, so a field joining
 * `PROVENANCED_FIELDS` cannot be compared in one place and forgotten in
 * another — the same argument `insertItemStatement` and `updateItemStatement`
 * make for sharing their SQL.
 */
export function provenancedValues(item: Item): Partial<Record<ProvenancedField, unknown>> {
  const all: Record<ProvenancedField, unknown> = {
    displayName: item.displayName,
    category: item.category,
    subcategory: item.subcategory,
    color: item.color,
    pattern: item.pattern,
    brand: item.brand,
    notes: item.notes,
    warmth: item.warmth,
    dressiness: item.dressiness,
    dressinessContexts: item.dressinessContexts,
    typicalUses: item.typicalUses,
    ownedQuantity: item.ownedQuantity,
    comfort: item.comfort,
    versatility: item.versatility,
    isCritical: item.isCritical,
    requiresFinalCheck: item.requiresFinalCheck,
    alwaysInclude: item.alwaysInclude,
  }
  return all
}

/** The column each provenanced field lives in, and how it is stored. */
const FIELD_COLUMNS: Record<ProvenancedField, { column: string; bind(value: unknown): unknown }> = {
  displayName: { column: 'display_name', bind: (v) => String(v ?? '').trim() },
  category: { column: 'category', bind: (v) => String(v ?? '').trim() },
  subcategory: { column: 'subcategory', bind: (v) => textOrNull(v) },
  color: { column: 'color', bind: (v) => textOrNull(v) },
  pattern: { column: 'pattern', bind: (v) => textOrNull(v) },
  brand: { column: 'brand', bind: (v) => textOrNull(v) },
  notes: { column: 'notes', bind: (v) => textOrNull(v) },
  warmth: { column: 'warmth', bind: (v) => (v == null ? null : Number(v)) },
  dressiness: { column: 'dressiness', bind: (v) => (v == null ? null : Number(v)) },
  dressinessContexts: {
    column: 'dressiness_contexts',
    // Canonicalised on the way out as well as in, so a caller that built a set
    // by hand cannot store an order `sameValue` would later read as a change.
    bind: (v) => serialiseContexts(Array.isArray(v) ? (v as DressinessContext[]) : []),
  },
  typicalUses: { column: 'typical_uses', bind: (v) => JSON.stringify(v ?? []) },
  ownedQuantity: { column: 'owned_quantity', bind: (v) => (v == null ? null : Number(v)) },
  comfort: { column: 'comfort', bind: (v) => (v == null ? null : Number(v)) },
  versatility: { column: 'versatility', bind: (v) => (v == null ? null : Number(v)) },
  isCritical: { column: 'is_critical', bind: (v) => (v ? 1 : 0) },
  requiresFinalCheck: { column: 'requires_final_check', bind: (v) => (v ? 1 : 0) },
  alwaysInclude: { column: 'always_include', bind: (v) => (v ? 1 : 0) },
}

/** A legacy level as the single-context set it means. Empty when there was none. */
function contextsFromLevel(level: number | null): DressinessContext[] {
  const context = contextForLevel(level)
  return context === null ? [] : [context]
}

function textOrNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
  return text || null
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
    /*
     * Name, brand, colour, pattern, subcategory and notes (G6).
     *
     * The name no longer repeats the brand and the colour, so a search that
     * only read the name would stop finding "columbia" the moment the title
     * stopped saying it. Doc 09 §6a asks for exactly this — search across the
     * fields rather than forcing keywords into the visible name — and the
     * subcategory is what makes "jacket" find a garment Alex called "Storm
     * Shell".
     */
    where.push(
      // Single quotes. `""` is an IDENTIFIER in standard SQL; SQLite usually
      // forgives it and `node:sqlite` does not, so the pre-G6 version of this
      // clause worked in production and threw the moment a test reached it.
      "(lower(display_name) LIKE ? OR lower(ifnull(brand, '')) LIKE ?" +
        " OR lower(ifnull(color, '')) LIKE ? OR lower(ifnull(pattern, '')) LIKE ?" +
        " OR lower(ifnull(subcategory, '')) LIKE ? OR lower(ifnull(notes, '')) LIKE ?)",
    )
    const like = `%${search.toLowerCase()}%`
    binds.push(like, like, like, like, like, like)
  }

  /*
   * Archived last, then alphabetical (H1d).
   *
   * `favorite DESC` used to sit between those two, which is how a retired
   * signal survives a UI removal: nothing on screen could set the star any
   * more, and the list was still ordered by it. Removing the criterion from the
   * ranker without removing this would have left the wardrobe sorted by a
   * column no screen can explain.
   */
  const sql =
    `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}` +
    ' ORDER BY archived_at IS NOT NULL, lower(display_name)'

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
    usage_frequency: input.usageFrequency ?? 'new',
    warmth: input.warmth ?? null,
    dressiness: input.dressiness ?? null,
    /*
     * The contexts a caller sent, or the single context its legacy level meant
     * (H1c).
     *
     * `undefined` and `[]` are DIFFERENT here and the distinction is the whole
     * point. `[]` is Alex clearing every context — an answer, stored as an
     * answer. `undefined` is a caller that only knows about the old integer, and
     * for that one the level is re-expressed as one context rather than dropped,
     * so no write path can silently lose a garment's formality.
     *
     * One context, never a broadened set: the same choice migration 0022 makes
     * for rows that already existed, so a row written today and a row upgraded
     * yesterday agree. Widening belongs to the H1d review queue, where Alex
     * confirms it.
     */
    dressiness_contexts:
      input.dressinessContexts !== undefined
        ? serialiseContexts(canonicalise(input.dressinessContexts))
        : serialiseContexts(contextsFromLevel(input.dressiness ?? null)),
    weather_tags: JSON.stringify(input.weatherTags ?? []),
    typical_uses: JSON.stringify(input.typicalUses ?? []),
    reuse_capacity: input.reuseCapacity ?? null,
    owned_quantity: input.ownedQuantity ?? null,
    /*
     * `?? null` keeps "not rated" as NULL rather than inventing a middle value.
     * An omitted rating and a cleared rating both land here, and both mean the
     * same thing — unknown — which is the one property H1b must not lose.
     */
    comfort: input.comfort ?? null,
    versatility: input.versatility ?? null,
    is_critical: input.isCritical ? 1 : 0,
    requires_final_check: input.requiresFinalCheck ? 1 : 0,
    default_packing_timing: input.defaultPackingTiming ?? 'anytime',
    always_include: input.alwaysInclude ? 1 : 0,
    never_include: input.neverInclude ? 1 : 0,
  }
}

/**
 * The insert on its own, unexecuted.
 *
 * Exists because the importer needs every one of its writes as a statement it
 * can hand to `D1Database.batch` — one implicit transaction, so a commit that
 * dies halfway leaves nothing behind (G5b). Sharing the statement rather than
 * copying the SQL is the point: a column added to `item` must not be able to
 * reach one writer and miss the other.
 *
 * The id is a parameter rather than generated here, so a caller building a
 * whole plan up front can resolve references between rows before any of it is
 * sent.
 */
export function insertItemStatement(
  db: D1Database,
  input: ItemInput,
  now: number,
  source: Item['source'],
  id: string,
  /**
   * Which fields this insert is claiming authorship of, and at what rank (H1a).
   *
   * A LIST of source/field pairs rather than one, because the clothing importer
   * genuinely has two answers about one row: nine columns it read and two it
   * guessed. Carrying both here keeps the whole row — values and provenance —
   * in ONE statement. The alternative, a second `UPDATE` to add the guessed
   * pair, would put a second write in the batch for every garment imported: 85
   * extra statements on the real workbook, against a budget
   * `import-atomicity.test.ts` measures on purpose.
   *
   * Optional, and omitting it stores no provenance at all — the honest record
   * for a row nobody has an opinion about yet, and it keeps every existing
   * caller writing exactly the column values it wrote before.
   */
  provenance?: ReadonlyArray<{ source: ValueSource; fields: readonly ProvenancedField[] }>,
): D1PreparedStatement {
  const v = normalise(input)

  /*
   * Only fields that actually got a value.
   *
   * A row with no brand has no brand to have a source FOR, and stamping
   * `imported` on it would claim the spreadsheet said something it never said —
   * the H1d queue would then have no way to tell *the workbook left this blank*
   * from *the workbook filled this in*. Migration 0020's backfill makes exactly
   * the same distinction, with the same `IS NOT NULL` guards, and a fresh
   * install has to agree with an upgraded database about what it knows.
   *
   * `null` and `undefined` only. `false` and `[]` are answers: `parseGear`
   * decides `isCritical` from the rule text, and an empty `typicalUses` is what
   * the parser produced from a Style column it could not read.
   */
  const claimed = input as unknown as Record<string, unknown>
  const stamped: FieldProvenance = {}
  for (const claim of provenance ?? []) {
    for (const field of claim.fields) {
      if (claimed[field] == null) continue
      stamped[field] = { source: claim.source, at: now }
    }
  }

  return db
    .prepare(
      /*
       * `favorite` is not in the column list (H1d).
       *
       * The column is still there and still `NOT NULL`, so it has to get a
       * value — and it does, from its own `DEFAULT 0`. Omitting it here is what
       * makes "the storage stays, nothing writes it" true of new rows as well
       * as old ones, without a migration that changes a single byte.
       */
      `INSERT INTO item (
         id, kind, display_name, category, subcategory, color, pattern, brand, notes,
         usage_frequency, warmth, dressiness, dressiness_contexts,
         weather_tags, typical_uses,
         reuse_capacity, owned_quantity, comfort, versatility,
         is_critical, requires_final_check,
         default_packing_timing, always_include, never_include,
         archived_at, source, field_provenance, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)`,
    )
    .bind(
      id, v.kind, v.display_name, v.category, v.subcategory, v.color, v.pattern, v.brand, v.notes,
      v.usage_frequency, v.warmth, v.dressiness, v.dressiness_contexts,
      v.weather_tags, v.typical_uses,
      v.reuse_capacity, v.owned_quantity, v.comfort, v.versatility,
      v.is_critical, v.requires_final_check,
      v.default_packing_timing, v.always_include, v.never_include,
      source, serialiseProvenance(stamped), now, now,
    )
}

export async function createItem(
  db: D1Database,
  input: ItemInput,
  now: number,
  source: Item['source'] = 'manual',
  id: string = crypto.randomUUID(),
): Promise<Item> {
  await insertItemStatement(db, input, now, source, id).run()

  const created = await getItem(db, id)
  if (!created) throw new Error('item disappeared immediately after insert')
  return created
}

export interface PatchOutcome {
  statement: D1PreparedStatement | null
  /** Fields a stronger source kept, for the review queue H1d builds. */
  refused: RefusedWrite[]
}

/**
 * The update on its own, unexecuted — the counterpart to
 * `insertItemStatement`, and for the same reason.
 *
 * `Update existing` on the import review has to happen inside the importer's
 * single batch, or the one write that changes a garment Alex already owns would
 * be the one write that could land without the rest of the import (G5b).
 *
 * The row keeps its id, so every trip, outfit and checklist entry pointing at
 * it still does — which is the whole reason update is offered rather than
 * "skip it and add a new one".
 *
 * H1A CHANGED TWO THINGS ABOUT IT, AND THE FIRST IS A DEFECT FIX
 *
 * It used to take a whole `ItemInput` and write every column from it. The
 * importer only ever fills part of one — `toItemInput` carries eleven fields
 * and `gearToItemInput` six — so `normalise` turned each omission into a
 * DEFAULT and the UPDATE wrote the default over whatever was there. Measured:
 * choosing `Update existing` on one changed garment reset the favourite flag to 0,
 * `usage_frequency` to `new`, `reuse_capacity` to NULL, `default_packing_timing`
 * to `anytime`, the three include flags to 0, and `weather_tags` to `[]` — on a
 * row the workbook said nothing about any of that. The last one is the serious
 * one: doc 09 §9 makes `weather_tags` the ONLY source the planner trusts for
 * rain, so a jacket silently stopped being a rain layer.
 *
 * It now takes a PATCH: only fields the caller actually carries. A field the
 * writer does not name cannot be defaulted over, because it is not there.
 *
 * The second change is precedence — `decideWrite` drops any field a stronger
 * source owns, and hands it back in `refused` instead of writing it.
 */
export function patchItemStatement(
  db: D1Database,
  existing: Item,
  patch: Partial<Record<ProvenancedField, unknown>>,
  source: ValueSource,
  now: number,
): PatchOutcome {
  const outcome = decideWrite(
    existing.fieldProvenance,
    provenancedValues(existing),
    patch,
    source,
    now,
  )

  const sets: string[] = []
  const binds: unknown[] = []
  for (const field of PROVENANCED_FIELDS) {
    if (!(field in outcome.accepted)) continue
    const column = FIELD_COLUMNS[field]
    sets.push(`${column.column} = ?`)
    binds.push(column.bind(outcome.accepted[field]))
  }

  /*
   * Nothing accepted still means something to write.
   *
   * A refusal is not a no-op: `decideWrite` may have recorded nothing, but when
   * even one field WAS accepted the provenance column has to move with it. When
   * literally nothing was accepted there is no row change at all and returning
   * a statement that sets `updated_at` would make an import look like it
   * touched a garment it did not.
   */
  if (sets.length === 0) return { statement: null, refused: outcome.refused }

  sets.push('field_provenance = ?')
  binds.push(serialiseProvenance(outcome.provenance))
  sets.push('updated_at = ?')
  binds.push(now)

  return {
    statement: db.prepare(`UPDATE item SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, existing.id),
    refused: outcome.refused,
  }
}

/**
 * One rating, written on its own (H1d).
 *
 * The review queue taps a star and moves on. `updateItem` cannot serve that: it
 * takes a whole `ItemInput` and writes every column, so a card that only knows
 * about comfort would have to send back a garment it never read — which is the
 * exact defect H1a fixed for the importer, arriving through the front door.
 *
 * So this is `patchItemStatement`, executed. Only the named fields move, at
 * `user_confirmed`, and clearing is the same call with `null` rather than a
 * separate verb: `decideWrite` stamps a cleared field `user_confirmed` holding
 * nothing, which is what `clearField` does and what stops the next import
 * helpfully filling it back in.
 *
 * `refused` comes back rather than being swallowed. At `user_confirmed` nothing
 * can refuse — rank 4 is the ceiling — but the outcome is part of the contract
 * this shares with the importer, and a caller that writes at a lower rank one
 * day should not have to discover that this door drops the answer.
 */
export async function patchItem(
  db: D1Database,
  id: string,
  patch: Partial<Record<ProvenancedField, unknown>>,
  now: number,
  source: ValueSource = 'user_confirmed',
): Promise<{ item: Item | null; refused: RefusedWrite[] }> {
  const existing = await getItem(db, id)
  if (!existing) return { item: null, refused: [] }

  const outcome = patchItemStatement(db, existing, patch, source, now)
  if (outcome.statement) await outcome.statement.run()

  return { item: await getItem(db, id), refused: outcome.refused }
}

/**
 * Alex edits a garment in My Stuff.
 *
 * Still writes the whole row, because the editor genuinely owns the whole row —
 * this is not the importer, and every field on the form is one Alex just looked
 * at. The change is what it RECORDS.
 *
 * **Only fields whose value actually moved are stamped `user_confirmed`**, and
 * that restraint is the point. The editor sends the full item back on every
 * save, so stamping the lot would mean changing a colour silently claimed a
 * confirmed dressiness — and a confirmed dressiness is a promise that no future
 * import may touch it. Claiming fourteen answers because Alex gave one is the
 * same guess `item.source` already makes and H1a exists to stop making.
 *
 * Confirming a value WITHOUT changing it is a real action and has its own door:
 * `confirmFields`, which is what the H1d review queue's *Keep as is* calls.
 */
export async function updateItem(
  db: D1Database,
  id: string,
  input: ItemInput,
  now: number,
): Promise<Item | null> {
  const existing = await getItem(db, id)
  if (!existing) return null

  const v = normalise(input)

  const changed: Partial<Record<ProvenancedField, unknown>> = {}
  const incoming = provenancedValues({ ...existing, ...fromInput(input, existing) })
  const stored = provenancedValues(existing)
  for (const field of PROVENANCED_FIELDS) {
    if (!sameStored(stored[field], incoming[field])) changed[field] = incoming[field]
  }
  const { provenance } = decideWrite(
    existing.fieldProvenance, stored, changed, 'user_confirmed', now,
  )

  await db
    .prepare(
      `UPDATE item SET
         kind = ?, display_name = ?, category = ?, subcategory = ?, color = ?, pattern = ?,
         brand = ?, notes = ?, usage_frequency = ?, warmth = ?, dressiness = ?,
         dressiness_contexts = ?,
         weather_tags = ?, typical_uses = ?, reuse_capacity = ?, owned_quantity = ?,
         comfort = ?, versatility = ?,
         is_critical = ?, requires_final_check = ?, default_packing_timing = ?,
         always_include = ?, never_include = ?, field_provenance = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      v.kind, v.display_name, v.category, v.subcategory, v.color, v.pattern,
      v.brand, v.notes, v.usage_frequency, v.warmth, v.dressiness,
      v.dressiness_contexts,
      v.weather_tags, v.typical_uses, v.reuse_capacity, v.owned_quantity,
      v.comfort, v.versatility,
      v.is_critical, v.requires_final_check, v.default_packing_timing,
      v.always_include, v.never_include, serialiseProvenance(provenance), now, id,
    )
    .run()

  return getItem(db, id)
}

/** The provenanced half of an `ItemInput`, normalised the way the row stores it. */
function fromInput(input: ItemInput, existing: Item): Partial<Item> {
  const v = normalise(input)
  return {
    displayName: v.display_name,
    category: v.category,
    subcategory: v.subcategory,
    color: v.color,
    pattern: v.pattern,
    brand: v.brand,
    notes: v.notes,
    warmth: v.warmth,
    dressiness: v.dressiness,
    dressinessContexts: canonicalise(input.dressinessContexts ?? existing.dressinessContexts),
    typicalUses: input.typicalUses ?? existing.typicalUses,
    ownedQuantity: v.owned_quantity,
    comfort: v.comfort,
    versatility: v.versatility,
    isCritical: v.is_critical === 1,
    requiresFinalCheck: v.requires_final_check === 1,
    alwaysInclude: v.always_include === 1,
  }
}

function sameStored(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index])
  }
  if (a == null && b == null) return true
  return a === b
}

/**
 * *Keep as is* — Alex confirms a value without editing it (H1a, for H1d).
 *
 * The row's numbers do not move; only their authority does. From here the field
 * sits at `user_confirmed` and no import may write it, which is the whole
 * transaction the review queue offers: one tap, nothing changes, and the
 * spreadsheet stops being able to change it either.
 */
export async function confirmFields(
  db: D1Database,
  id: string,
  fields: readonly ProvenancedField[],
  now: number,
  source: ValueSource = 'user_confirmed',
): Promise<Item | null> {
  const existing = await getItem(db, id)
  if (!existing) return null

  const stored = provenancedValues(existing)
  const patch: Partial<Record<ProvenancedField, unknown>> = {}
  for (const field of fields) patch[field] = stored[field]

  const { provenance } = decideWrite(existing.fieldProvenance, stored, patch, source, now)
  await writeProvenance(db, id, provenance, now)
  return getItem(db, id)
}

/**
 * Alex clears a value on purpose — and the absence is itself confirmed.
 *
 * A cleared field is `user_confirmed` holding null, not a field with nothing
 * recorded. The difference matters exactly once: at the next import, where the
 * first refuses to be refilled and the second is refilled silently.
 */
export async function clearFieldValue(
  db: D1Database,
  id: string,
  field: ProvenancedField,
  now: number,
): Promise<Item | null> {
  const existing = await getItem(db, id)
  if (!existing) return null

  const provenance = clearField(existing.fieldProvenance, provenancedValues(existing), field, now)
  const column = FIELD_COLUMNS[field]
  await db
    .prepare(
      `UPDATE item SET ${column.column} = ?, field_provenance = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(column.bind(null), serialiseProvenance(provenance), now, id)
    .run()

  return getItem(db, id)
}

/**
 * *Use the value from my spreadsheet* — G5's *Use the default*, for a field.
 *
 * Restores the one superseded value AND the source that wrote it, so the field
 * really is back under that source's authority and a later import may write it
 * again. A revert that left the rank where it was would be a revert in the
 * value only, and the next import would be refused for a value Alex no longer
 * claims.
 */
export async function revertFieldValue(
  db: D1Database,
  id: string,
  field: ProvenancedField,
  now: number,
): Promise<Item | null> {
  const existing = await getItem(db, id)
  if (!existing) return null

  const result = revertField(existing.fieldProvenance, field)
  if (!result.reverted) return existing

  const column = FIELD_COLUMNS[field]
  await db
    .prepare(
      `UPDATE item SET ${column.column} = ?, field_provenance = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(column.bind(result.value), serialiseProvenance(result.provenance), now, id)
    .run()

  return getItem(db, id)
}

async function writeProvenance(
  db: D1Database,
  id: string,
  provenance: FieldProvenance,
  now: number,
): Promise<void> {
  await db
    .prepare('UPDATE item SET field_provenance = ?, updated_at = ? WHERE id = ?')
    .bind(serialiseProvenance(provenance), now, id)
    .run()
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
