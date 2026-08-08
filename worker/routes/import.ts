import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  coverageWarnings,
  dedupe,
  defaultChoice,
  needsAttention,
  reconcile,
  type ExistingItem,
  type FieldDifference,
  type ImportChoice,
  type ParsedGear,
  type ReconcileDecision,
  type ReconcileSummary,
  garmentRule,
  gearToItemInput,
  normalizeGarment,
  parseGear,
  toItemInput,
  type ClothingSource,
  type GearSource,
  type ImportSummary,
} from '@shared/import'
import { correctionFor } from '@shared/rule-corrections'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import { countItems, insertItemStatement, updateItemStatement } from '../repos/items'

export const importRoutes = new Hono<AppBindings>()

/**
 * The client parses the workbook and posts these rows. The Worker never receives
 * the file itself — technical-docs/01_ARCHITECTURE.md §2 puts parsing on the
 * client, which also means an unreadable spreadsheet fails on Alex's device with
 * his file in front of him, rather than as a server error.
 */
interface ImportRequest {
  filename: string
  clothing: string[][]
  gear: string[][]
  /**
   * What Alex chose on the review screen, keyed by `rowKey`.
   *
   * Absent for a row he was never asked about, and absent entirely for a first
   * import into an empty catalog — `defaultChoice` then decides, and every one
   * of its defaults errs toward not losing a garment.
   */
  choices?: Record<string, ImportChoice>
}

function toClothingSources(rows: string[][]): ClothingSource[] {
  return rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r[0] && r[0] !== 'Major Category' && r[1])
    .map(({ r, i }) => ({
      majorCategory: r[0] ?? '',
      subcategory: r[1] ?? '',
      description: r[2] ?? '',
      brand: r[3] ?? '',
      color: r[4] ?? '',
      styleUse: r[5] ?? '',
      notes: r[6] ?? '',
      rowNumber: i + 1,
    }))
}

function toGearSources(rows: string[][]): GearSource[] {
  return rows
    .map((r, i) => ({ r, i }))
    // The gear table has three populated columns. The conditional-trigger table
    // stacked below it has two, which is how the parser tells them apart
    // (04_IMPORT_PLAN.md §1).
    .filter(({ r }) => r[0] && r[1] && r[2] && r[0] !== 'Item')
    .map(({ r, i }) => ({
      item: r[0] ?? '',
      category: r[1] ?? '',
      rule: r[2] ?? '',
      rowNumber: i + 1,
    }))
}

function countTriggers(rows: string[][]): number {
  return rows.filter((r) => r[0] && r[1] && !r[2] && r[0] !== 'Trip Condition').length
}

function analyse(body: ImportRequest) {
  const garments = toClothingSources(body.clothing).map(normalizeGarment)
  const gear = toGearSources(body.gear).map(parseGear)
  const deduped = dedupe(garments)

  const summary: ImportSummary = {
    clothingRows: garments.length,
    clothingUnique: deduped.unique.length,
    exactDuplicates: deduped.exactDuplicates.length,
    identityDuplicates: deduped.identityDuplicates.length,
    reviewCards: deduped.reviewCards,
    gearItems: gear.length,
    triggerRules: countTriggers(body.gear),
    rulesNeedingReview: gear.filter((g) => g.needsRuleReview).map((g) => g.displayName),
    coverageWarnings: coverageWarnings(garments),
  }

  return { garments, gear, deduped, summary }
}

/**
 * Every item the catalog already holds, in the fields identity is computed from
 * (G5b).
 *
 * Archived rows are included on purpose. An archived garment is one Alex put
 * away, not one he threw out — re-importing the workbook must not quietly
 * resurrect it as a second, active copy beside the one he archived.
 */
async function existingCatalog(db: D1Database): Promise<ExistingItem[]> {
  const rows = await db
    .prepare(
      `SELECT id, display_name, brand, color, pattern, category, subcategory, notes,
              warmth, dressiness, owned_quantity
         FROM item`,
    )
    .all<{
      id: string
      display_name: string
      brand: string | null
      color: string | null
      pattern: string | null
      category: string | null
      subcategory: string | null
      notes: string | null
      warmth: number | null
      dressiness: number | null
      owned_quantity: number | null
    }>()

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    brand: row.brand,
    color: row.color,
    pattern: row.pattern,
    category: row.category,
    subcategory: row.subcategory,
    notes: row.notes,
    warmth: row.warmth,
    dressiness: row.dressiness,
    ownedQuantity: row.owned_quantity,
  }))
}

/**
 * The rules already attached to an item, and whether any is deliberately
 * retired.
 *
 * A rule superseded by a `user` row is a decision Alex made — G5's retirements
 * are exactly this shape — and recreating the default it supersedes would undo
 * that decision with an import. `supersedes_rule_id` is what says so.
 */
async function existingRules(
  db: D1Database,
): Promise<Map<string, { active: number; superseded: number }>> {
  /*
   * Every rule, with no `IN (?, ?, …)` — and that is a correctness fix, not a
   * style preference.
   *
   * This used to bind one parameter per matched item. On a SECOND import of the
   * workbook — the exact case G5b exists for — that is **117 bound parameters
   * in one query**, measured. D1 caps bound parameters per query far below
   * that; the `node:sqlite` harness allows tens of thousands, so the failure
   * would never appear in any test here and would appear the first time Alex
   * re-imported on production. AUTONOMY §7's "the environment hides a class of
   * defect" applies literally.
   *
   * `packing_rule` is tens of rows, so reading it whole and indexing in memory
   * costs nothing and cannot scale into the limit.
   */
  const rows = await db
    .prepare(
      `SELECT r.item_id, r.id,
              EXISTS (SELECT 1 FROM packing_rule o WHERE o.supersedes_rule_id = r.id) AS overridden
         FROM packing_rule r`,
    )
    .all<{ item_id: string; id: string; overridden: number }>()

  const found = new Map<string, { active: number; superseded: number }>()
  for (const row of rows.results ?? []) {
    const entry = found.get(row.item_id) ?? { active: 0, superseded: 0 }
    if (row.overridden) entry.superseded += 1
    else entry.active += 1
    found.set(row.item_id, entry)
  }
  return found
}

/**
 * A gear row in the shape the importer will actually store it.
 *
 * Gear has no brand, colour or pattern in the workbook, so its identity is the
 * name alone — honest rather than a shortcut: two rows called `Gas-X` with
 * nothing else to tell them apart ARE the same thing.
 *
 * The other fields matter for a different reason. `reconcile` compares an
 * incoming row against what is stored to tell an exact duplicate from a changed
 * one, so it has to be handed **what `gearToItemInput` writes**, not the parsed
 * row. `ParsedGear` keeps the rule text in `originalText`; the item stores it in
 * `notes`. Comparing the parsed shape instead would find `notes` missing on
 * every gear row, call all thirty-three of them changed, and turn the review
 * into the queue that gets clicked through blindly (risk R5).
 */
function comparableGear(item: ParsedGear) {
  const stored = gearToItemInput(item)
  return {
    ...item,
    notes: stored.notes ?? null,
    category: stored.category,
    subcategory: null as string | null,
    brand: null as string | null,
    color: null as string | null,
    pattern: null as string | null,
  }
}

/** `sheet#row`, the key a review choice comes back under. Stable for both sheets. */
export function rowKey(sheet: 'clothing' | 'gear', rowNumber: number): string {
  return `${sheet}#${rowNumber}`
}

/**
 * The plan, in the shape the review screen renders.
 *
 * Built by `/dry-run` as well as `/commit`, because the whole point of the
 * review is that Alex sees it BEFORE anything is written (product doc 05 §4).
 */
interface ReviewRow {
  key: string
  sheet: 'clothing' | 'gear'
  name: string
  decision: ReconcileDecision
  matchedItemId: string | null
  matchedName: string | null
  why: string | null
  differences: FieldDifference[]
  candidates: Array<{ id: string; name: string }>
  defaultChoice: ImportChoice
}

async function readBody(c: Context<AppBindings>) {
  try {
    const body = await c.req.json<Partial<ImportRequest>>()
    if (!Array.isArray(body.clothing) || !Array.isArray(body.gear)) return null
    return {
      filename: body.filename ?? 'workbook.xlsx',
      clothing: body.clothing,
      gear: body.gear,
      choices: (body.choices ?? {}) as Record<string, ImportChoice>,
    }
  } catch {
    return null
  }
}

/**
 * Dry run. Writes nothing.
 *
 * Product doc 05 §4 and 04 §9: nothing is written until Alex taps Commit, and
 * the summary tells him what will happen before it happens.
 */
importRoutes.post('/dry-run', async (c) => {
  const body = await readBody(c)
  if (!body) return c.json(apiError('bad_request', 'Could not read that spreadsheet.'), 400)

  const { gear, deduped, summary } = analyse(body)
  const counts = await countItems(c.env.DB)

  /*
   * The same reconciliation `/commit` will do, run here so the review can be
   * seen before anything is written.
   *
   * It used to live only inside `/commit`, which meant the classification
   * existed but Alex never saw it until afterwards. Doing it in both places is
   * not duplication — `/commit` re-reads the catalog and re-reconciles anyway,
   * because the answer must be computed against the database as it is at the
   * moment of writing, not as it was when the screen was drawn.
   */
  const catalog = await existingCatalog(c.env.DB)
  const plan = [
    ...reconcile(deduped.unique, catalog).map((entry) => ({
      entry,
      sheet: 'clothing' as const,
      rowNumber: entry.row.source.rowNumber,
      name: entry.row.displayName,
    })),
    ...reconcile(gear.map(comparableGear), catalog).map((entry) => ({
      entry,
      sheet: 'gear' as const,
      rowNumber: entry.row.source.rowNumber,
      name: entry.row.displayName,
    })),
  ]

  const review: ReviewRow[] = plan.map(({ entry, sheet, rowNumber, name }) => ({
    key: rowKey(sheet, rowNumber),
    sheet,
    name,
    decision: entry.decision,
    matchedItemId: entry.matchedItemId,
    matchedName: entry.matchedName,
    why: entry.why,
    differences: entry.differences,
    candidates: entry.candidates,
    defaultChoice: defaultChoice(entry.decision),
  }))

  const count = (decision: ReconcileDecision) =>
    review.filter((row) => row.decision === decision).length

  /*
   * Rules the catalog has deliberately retired, named rather than left silent.
   *
   * `CLAUDE.md` asks for a retired rule never to come back quietly, and this is
   * the screen that can say so before the fact. It carries no choice: bringing
   * one back is a decision for the rules screen, not a side effect of an import.
   */
  const rulesByItem = await existingRules(c.env.DB)
  const retiredRulesKept = gear
    .filter((item) => {
      const correction = correctionFor(item.displayName)
      if (correction?.action === 'retire') return true
      const matched = reconcile([comparableGear(item)], catalog)[0]?.matchedItemId
      return matched ? (rulesByItem.get(matched)?.superseded ?? 0) > 0 : false
    })
    .map((item) => item.displayName)

  return c.json({
    summary,
    // Importing on top of an existing catalog is the case most likely to cause
    // regret, so it is stated plainly rather than discovered afterwards.
    existingItems: counts.active,
    willAppend: counts.active > 0,
    review: {
      counts: {
        new: count('new'),
        exactDuplicates: count('exact_duplicate'),
        updateCandidates: count('update_candidate'),
        likelyDuplicates: count('likely_duplicate'),
        conflicts: count('conflict'),
      },
      /*
       * Only the rows that need Alex. An exact duplicate is never here --
       * Alex's ruling of 2026-08-05: it is skipped, it keeps the stored row's
       * identity, and it is reported as a count and nothing more.
       */
      attention: review.filter((row) => needsAttention(row.decision)),
      retiredRulesKept,
    },
  })
})

importRoutes.post('/commit', async (c) => {
  const body = await readBody(c)
  if (!body) return c.json(apiError('bad_request', 'Could not read that spreadsheet.'), 400)

  const { gear, deduped, summary } = analyse(body)
  const now = nowSeconds()

  /*
   * Reconciled against the catalog before a single row is written (G5b).
   *
   * `dedupe()` compared the spreadsheet with itself; this compares it with what
   * is already stored. Without it, importing the same file twice added a fresh
   * copy of everything — items 123 → 241, rules 41 → 75 — and a retired rule
   * came back on an unsuperseded `system` copy.
   */
  const catalog = await existingCatalog(c.env.DB)
  const garmentPlan = reconcile(deduped.unique, catalog)
  const gearPlan = reconcile(gear.map(comparableGear), catalog)

  const rulesByItem = await existingRules(c.env.DB)

  /**
   * What to do with one row: what Alex chose, or the safe default.
   *
   * An **exact duplicate never consults this**. It is skipped, it keeps the
   * stored row's identity, and it is not offered a choice at all — Alex's
   * ruling of 2026-08-05. Two identical physical things are added through
   * My Stuff after the import, where the second gets an identity of its own.
   */
  const chosen = (sheet: 'clothing' | 'gear', rowNumber: number, decision: ReconcileDecision) =>
    body.choices[rowKey(sheet, rowNumber)] ?? defaultChoice(decision)

  const reconciled: ReconcileSummary = {
    new: [...garmentPlan, ...gearPlan].filter((e) => e.decision === 'new').length,
    exactDuplicates: [...garmentPlan, ...gearPlan].filter((e) => e.decision === 'exact_duplicate')
      .length,
    likelyDuplicates: [...garmentPlan, ...gearPlan].filter((e) => e.decision === 'likely_duplicate')
      .length,
    retiredRulesKept: [],
    rulesAlreadyPresent: [],
  }

  /*
   * From here to the batch at the bottom, nothing is written — every statement
   * is built and collected, and the whole import goes to the database in one
   * `batch()`, which D1 runs in an implicit transaction (G5b).
   *
   * This was measured before it was changed. Writing statement by statement, a
   * commit that died partway left fourteen distinct partial states — some
   * garments in, some rules missing, some `import_row` decisions never recorded
   * — and, worst of the lot, `import_run` was written **first** with
   * `status = 'committed'`, so the import history claimed success for an import
   * that had half failed. `tests/integration/import-atomicity.test.ts` holds
   * the sweep that says so.
   *
   * Ids are generated here rather than by the repos, because a plan that has
   * not been sent yet still has to be able to point one row at another — which
   * is also what lets the dependency rules below be resolved in memory instead
   * of by a second pass of `UPDATE`s that could themselves fail separately.
   */
  const runId = crypto.randomUUID()
  const writes: D1PreparedStatement[] = []

  const importRow = (
    sheet: string,
    rowNumber: number,
    raw: unknown,
    normalized: string | null,
    identityHash: string | null,
    decision: string,
    matchedItemId: string | null,
    note: string | null,
  ): D1PreparedStatement =>
    c.env.DB.prepare(
      `INSERT INTO import_row (id, import_run_id, sheet, row_number, raw_json, normalized_json,
                               identity_hash, decision, matched_item_id, note)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(), runId, sheet, rowNumber, JSON.stringify(raw), normalized,
      identityHash, decision, matchedItemId, note,
    )

  writes.push(
    c.env.DB.prepare(
      'INSERT INTO import_run (id, filename, file_hash, summary_json, status, created_at) VALUES (?,?,?,?,?,?)',
    ).bind(runId, body.filename, '', JSON.stringify(summary), 'committed', now),
  )

  /**
   * A rule to be written, held until every item id is known.
   *
   * `depends_on_item_id` names another row from the same spreadsheet, so it
   * cannot be resolved while the gear is still being walked. Holding the specs
   * and building their statements at the end replaces the old second pass of
   * `UPDATE`s — which was two more chances to fail, after the rule had already
   * been written wrong.
   */
  interface RuleSpec {
    itemId: string
    ruleType: string
    quantityValue: number | null
    buffer: number | null
    condition: Record<string, unknown> | null
    dependsOn: string | null
    originalText: string
    needsReview: boolean
  }
  const ruleSpecs: RuleSpec[] = []

  let created = 0

  /** display name (lower-cased) -> id, for resolving dependency rules below. */
  const idsByName = new Map<string, string>()

  for (const entry of garmentPlan) {
    const g = entry.row

    /*
     * An exact identity match is not imported again.
     *
     * The only class that CANNOT be a distinct item: same name, same brand,
     * same colour. A likely duplicate still is imported, because wrongly
     * skipping a garment loses something Alex cannot get back and wrongly
     * importing one costs an archive tap.
     */
    if (entry.decision === 'exact_duplicate') {
      idsByName.set(g.displayName.toLowerCase(), entry.matchedItemId!)
      writes.push(
        importRow(
          'Clothing Inventory', g.source.rowNumber, g.source, null, g.identityHash,
          'merged_duplicate', entry.matchedItemId, entry.why,
        ),
      )
      continue
    }

    const input = toItemInput(g)
    const choice = chosen('clothing', g.source.rowNumber, entry.decision)

    /*
     * Keeping what is stored, or leaving the row out entirely. Neither writes a
     * garment — but both still write an `import_row`, because product doc 05 §4
     * asks that every source row's fate be recorded and nothing be silently
     * discarded. `skipped_by_user` is Alex's own decision; `merged_duplicate`
     * is his decision to let the stored row stand.
     */
    if (entry.matchedItemId && (choice === 'keep_existing' || choice === 'skip')) {
      idsByName.set(g.displayName.toLowerCase(), entry.matchedItemId)
      writes.push(
        importRow(
          'Clothing Inventory', g.source.rowNumber, g.source, null, g.identityHash,
          choice === 'skip' ? 'skipped_by_user' : 'merged_duplicate', entry.matchedItemId,
          choice === 'skip' ? 'You chose not to import this row.' : 'You kept the one you already had.',
        ),
      )
      continue
    }

    if (choice === 'skip') {
      writes.push(
        importRow(
          'Clothing Inventory', g.source.rowNumber, g.source, null, g.identityHash,
          'skipped_by_user', null, 'You chose not to import this row.',
        ),
      )
      continue
    }

    /*
     * Updating what is already there, rather than adding beside it.
     *
     * The stored row keeps its id, so every trip, outfit and checklist entry
     * pointing at it still points at it — which is the whole reason update is
     * offered instead of "skip and re-add".
     */
    if (choice === 'update_existing' && entry.matchedItemId) {
      idsByName.set(g.displayName.toLowerCase(), entry.matchedItemId)
      writes.push(updateItemStatement(c.env.DB, input, now, entry.matchedItemId))
      writes.push(
        importRow(
          'Clothing Inventory', g.source.rowNumber, g.source, JSON.stringify(input), g.identityHash,
          'merged_duplicate', entry.matchedItemId, 'You updated the one you already had.',
        ),
      )
      continue
    }

    const itemId = crypto.randomUUID()
    writes.push(insertItemStatement(c.env.DB, input, now, 'seed_import', itemId))
    idsByName.set(input.displayName.trim().toLowerCase(), itemId)
    created += 1

    // The one seeded quantity rule that belongs to a garment; see garmentRule.
    const clothingRule = garmentRule(g)
    if (clothingRule) {
      ruleSpecs.push({
        itemId,
        ruleType: clothingRule.ruleType,
        quantityValue: clothingRule.quantityValue,
        buffer: null,
        condition: null,
        dependsOn: null,
        originalText: 'Saved preference: 2 per trip day',
        needsReview: false,
      })
    }

    writes.push(
      importRow(
        'Clothing Inventory', g.source.rowNumber, g.source, JSON.stringify(input), g.identityHash,
        entry.decision === 'likely_duplicate' ? 'needs_review' : 'imported', itemId,
        [entry.why, g.derived.join(' ')].filter(Boolean).join(' ') || null,
      ),
    )
  }

  // Every skipped row still gets a recorded decision — nothing is silently
  // discarded (product doc 05 §4).
  for (const g of [...deduped.exactDuplicates, ...deduped.identityDuplicates]) {
    writes.push(
      importRow(
        'Clothing Inventory', g.source.rowNumber, g.source, null, g.identityHash,
        'merged_duplicate', null, 'Identical to another row in the spreadsheet.',
      ),
    )
  }

  for (const entry of gearPlan) {
    const item = entry.row

    /*
     * The item may already be there — and if it is, its RULES are the thing
     * that matters, not another copy of the row.
     */
    const gearInput = gearToItemInput(item)
    const gearChoice = chosen('gear', item.source.rowNumber, entry.decision)

    /*
     * A gear row Alex chose to leave out. Its rules are left out with it —
     * writing a rule for an item that was not imported would attach it to
     * whatever the name happened to match, which is exactly backwards.
     */
    if (entry.decision !== 'exact_duplicate' && gearChoice === 'skip') {
      writes.push(
        importRow(
          'Non-Clothing & Rules', item.source.rowNumber, item.source, null, null,
          'skipped_by_user', entry.matchedItemId, 'You chose not to import this row.',
        ),
      )
      continue
    }

    let savedId: string
    if (entry.decision === 'exact_duplicate') {
      savedId = entry.matchedItemId!
      idsByName.set(item.displayName.toLowerCase(), savedId)
    } else if (entry.matchedItemId && gearChoice === 'keep_existing') {
      savedId = entry.matchedItemId
      idsByName.set(item.displayName.toLowerCase(), savedId)
    } else if (entry.matchedItemId && gearChoice === 'update_existing') {
      savedId = entry.matchedItemId
      idsByName.set(item.displayName.toLowerCase(), savedId)
      writes.push(updateItemStatement(c.env.DB, gearInput, now, savedId))
    } else {
      savedId = crypto.randomUUID()
      writes.push(insertItemStatement(c.env.DB, gearInput, now, 'seed_import', savedId))
      idsByName.set(gearInput.displayName.trim().toLowerCase(), savedId)
      created += 1
    }

    /*
     * Three reasons not to write a rule, and each is a decision already made:
     *
     * 1. **A retired rule stays retired.** The item's existing default is
     *    superseded by a `user` row — which is what `disableRule` and migration
     *    0017 write — so recreating it would undo that with an import.
     * 2. **An equivalent rule is already active.** A second copy adds nothing
     *    and doubles the rule table.
     * 3. **Alex asked for this one to be different.** `RULE_CORRECTIONS` is
     *    applied here rather than only in migration 0017, because migrations
     *    run before any import: a fresh install would otherwise never get them.
     */
    const known = rulesByItem.get(savedId)
    const correction = correctionFor(item.displayName)

    if (correction?.action === 'retire') {
      reconciled.retiredRulesKept.push(item.displayName)
    } else if (known && known.superseded > 0) {
      reconciled.retiredRulesKept.push(item.displayName)
    } else if (known && known.active > 0) {
      reconciled.rulesAlreadyPresent.push(item.displayName)
    } else if (correction?.action === 'replace') {
      ruleSpecs.push({
        itemId: savedId,
        ruleType: correction.ruleType,
        quantityValue: correction.quantityValue,
        buffer: null,
        condition: null,
        dependsOn: null,
        originalText: correction.originalText,
        needsReview: false,
      })
    } else if (item.rule) {
      /*
       * The spreadsheet names the dependency ("Charger — only if Shaver is
       * packed"), and that item may not have an id yet. The column is a real
       * foreign key, so the name cannot be parked in it — the spec carries the
       * name and the statement is built once every id is known.
       */
      ruleSpecs.push({
        itemId: savedId,
        ruleType: item.rule.ruleType,
        quantityValue: item.rule.quantityValue,
        buffer: item.rule.buffer,
        condition: item.rule.condition,
        dependsOn: item.rule.dependsOn,
        originalText: item.originalText,
        needsReview: item.needsRuleReview,
      })
    }

    writes.push(
      importRow(
        'Non-Clothing & Rules', item.source.rowNumber, item.source, JSON.stringify(gearInput), null,
        entry.decision === 'exact_duplicate' || gearChoice === 'keep_existing' ||
        gearChoice === 'update_existing'
          ? 'merged_duplicate'
          : item.needsRuleReview || entry.decision === 'likely_duplicate'
            ? 'needs_review'
            : 'imported',
        savedId,
        [entry.why, item.derived.join(' ')].filter(Boolean).join(' ') || null,
      ),
    )
  }

  /**
   * Every dependency rule pointed at a real item, before anything is sent.
   *
   * This matters more than it looks. `dependency_include` vetoes its item when
   * the target is not packed — so a rule left unresolved does not degrade to
   * "include anyway", it degrades to "never include". An unresolved charger
   * silently disappears from every trip forever. Flagging it for review is the
   * only honest outcome.
   *
   * It used to be a second pass of `UPDATE`s after the rules were written.
   * Resolving in memory is not merely tidier: those updates were two more
   * writes that could fail on their own, and a failure between the insert and
   * its update left a `dependency_include` rule pointing at nothing — which is
   * the silent-disappearance case above, written into the database.
   *
   * The rules go in after the items for a plain reason: `packing_rule.item_id`
   * is a real foreign key, and a batch is one transaction, not one statement.
   */
  const unresolvedDependencies: string[] = []
  for (const spec of ruleSpecs) {
    let dependsOnId: string | null = null
    let needsReview = spec.needsReview

    if (spec.dependsOn) {
      dependsOnId = idsByName.get(spec.dependsOn.toLowerCase()) ?? null
      if (dependsOnId) {
        // Clearing needs_review matters. The flag records "the wording was not
        // certain"; once the item it names has been found, that doubt is
        // settled, and leaving it set would put a working rule at the top of
        // the review list where the genuinely broken ones belong.
        needsReview = false
      } else {
        needsReview = true
        unresolvedDependencies.push(spec.dependsOn)
      }
    }

    writes.push(
      c.env.DB.prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, buffer, condition_json,
                                   depends_on_item_id, enabled, original_text, needs_review, created_at)
         VALUES (?,?,?,?,?,?,?,1,?,?,?)`,
      ).bind(
        crypto.randomUUID(), spec.itemId, spec.ruleType, spec.quantityValue, spec.buffer,
        spec.condition ? JSON.stringify(spec.condition) : null, dependsOnId,
        spec.originalText, needsReview ? 1 : 0, now,
      ),
    )
  }

  /*
   * The whole import, in one transaction.
   *
   * D1 runs a batch as an implicit transaction, so this either lands entirely
   * or not at all — including the `import_run` row, which is what stops the
   * history claiming a half-failed import succeeded. There is no partial state
   * left for a rerun to repair, and no compounded duplicate to avoid, because
   * there is nothing to rerun over.
   */
  await c.env.DB.batch(writes)

  return c.json({ importRunId: runId, created, summary, reconciled, unresolvedDependencies })
})

/** Past runs, so any import can be explained after the fact. */
importRoutes.get('/history', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, filename, summary_json, status, created_at FROM import_run ORDER BY created_at DESC LIMIT 20',
  ).all<{ id: string; filename: string; summary_json: string; status: string; created_at: number }>()

  return c.json({ runs: result.results ?? [] })
})
