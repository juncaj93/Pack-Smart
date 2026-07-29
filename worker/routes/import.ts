import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  coverageWarnings,
  dedupe,
  gearToItemInput,
  normalizeGarment,
  parseGear,
  toItemInput,
  type ClothingSource,
  type GearSource,
  type ImportSummary,
} from '@shared/import'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import { countItems, createItem } from '../repos/items'

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

async function readBody(c: Context<AppBindings>) {
  try {
    const body = await c.req.json<Partial<ImportRequest>>()
    if (!Array.isArray(body.clothing) || !Array.isArray(body.gear)) return null
    return { filename: body.filename ?? 'workbook.xlsx', clothing: body.clothing, gear: body.gear }
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

  const { summary } = analyse(body)
  const counts = await countItems(c.env.DB)

  return c.json({
    summary,
    // Importing on top of an existing catalog is the case most likely to cause
    // regret, so it is stated plainly rather than discovered afterwards.
    existingItems: counts.active,
    willAppend: counts.active > 0,
  })
})

importRoutes.post('/commit', async (c) => {
  const body = await readBody(c)
  if (!body) return c.json(apiError('bad_request', 'Could not read that spreadsheet.'), 400)

  const { gear, deduped, summary } = analyse(body)
  const now = nowSeconds()

  const runId = crypto.randomUUID()
  await c.env.DB.prepare(
    'INSERT INTO import_run (id, filename, file_hash, summary_json, status, created_at) VALUES (?,?,?,?,?,?)',
  )
    .bind(runId, body.filename, '', JSON.stringify(summary), 'committed', now)
    .run()

  let created = 0

  /** display name (lower-cased) -> id, for resolving dependency rules below. */
  const idsByName = new Map<string, string>()
  const pendingDependencies: Array<{ ruleId: string; dependsOn: string }> = []

  for (const g of deduped.unique) {
    const item = await createItem(c.env.DB, toItemInput(g), now, 'seed_import')
    idsByName.set(item.displayName.toLowerCase(), item.id)
    created += 1
    await c.env.DB.prepare(
      `INSERT INTO import_row (id, import_run_id, sheet, row_number, raw_json, normalized_json,
                               identity_hash, decision, matched_item_id, note)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        crypto.randomUUID(), runId, 'Clothing Inventory', g.source.rowNumber,
        JSON.stringify(g.source), JSON.stringify(toItemInput(g)), g.identityHash,
        'imported', item.id, g.derived.join(' ') || null,
      )
      .run()
  }

  // Every skipped row still gets a recorded decision — nothing is silently
  // discarded (product doc 05 §4).
  for (const g of [...deduped.exactDuplicates, ...deduped.identityDuplicates]) {
    await c.env.DB.prepare(
      `INSERT INTO import_row (id, import_run_id, sheet, row_number, raw_json, normalized_json,
                               identity_hash, decision, matched_item_id, note)
       VALUES (?,?,?,?,?,?,?,?,NULL,?)`,
    )
      .bind(
        crypto.randomUUID(), runId, 'Clothing Inventory', g.source.rowNumber,
        JSON.stringify(g.source), null, g.identityHash, 'merged_duplicate',
        'Identical to another row in the spreadsheet.',
      )
      .run()
  }

  for (const item of gear) {
    const saved = await createItem(c.env.DB, gearToItemInput(item), now, 'seed_import')
    idsByName.set(saved.displayName.toLowerCase(), saved.id)
    created += 1

    if (item.rule) {
      const ruleId = crypto.randomUUID()
      await c.env.DB.prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, buffer, condition_json,
                                   depends_on_item_id, enabled, original_text, needs_review, created_at)
         VALUES (?,?,?,?,?,?,NULL,1,?,?,?)`,
      )
        .bind(
          ruleId, saved.id, item.rule.ruleType, item.rule.quantityValue,
          item.rule.buffer, item.rule.condition ? JSON.stringify(item.rule.condition) : null,
          item.originalText, item.needsRuleReview ? 1 : 0, now,
        )
        .run()

      // The spreadsheet names the dependency ("Charger — only if Shaver is
      // packed"), and that item may not exist yet. Resolution is deferred to a
      // second pass; the column is a real foreign key, so a name cannot be
      // stored in it as a placeholder.
      if (item.rule.dependsOn) {
        pendingDependencies.push({ ruleId, dependsOn: item.rule.dependsOn })
      }
    }

    await c.env.DB.prepare(
      `INSERT INTO import_row (id, import_run_id, sheet, row_number, raw_json, normalized_json,
                               identity_hash, decision, matched_item_id, note)
       VALUES (?,?,?,?,?,?,NULL,?,?,?)`,
    )
      .bind(
        crypto.randomUUID(), runId, 'Non-Clothing & Rules', item.source.rowNumber,
        JSON.stringify(item.source), JSON.stringify(gearToItemInput(item)),
        item.needsRuleReview ? 'needs_review' : 'imported', saved.id,
        item.derived.join(' ') || null,
      )
      .run()
  }

  /**
   * Second pass: point every dependency rule at a real item.
   *
   * This matters more than it looks. `dependency_include` vetoes its item when
   * the target is not packed — so a rule left unresolved does not degrade to
   * "include anyway", it degrades to "never include". An unresolved charger
   * silently disappears from every trip forever. Flagging it for review is the
   * only honest outcome.
   */
  const unresolvedDependencies: string[] = []
  for (const pending of pendingDependencies) {
    const targetId = idsByName.get(pending.dependsOn.toLowerCase())
    if (targetId) {
      await c.env.DB.prepare('UPDATE packing_rule SET depends_on_item_id = ? WHERE id = ?')
        .bind(targetId, pending.ruleId)
        .run()
    } else {
      await c.env.DB.prepare('UPDATE packing_rule SET needs_review = 1 WHERE id = ?')
        .bind(pending.ruleId)
        .run()
      unresolvedDependencies.push(pending.dependsOn)
    }
  }

  return c.json({ importRunId: runId, created, summary, unresolvedDependencies })
})

/** Past runs, so any import can be explained after the fact. */
importRoutes.get('/history', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, filename, summary_json, status, created_at FROM import_run ORDER BY created_at DESC LIMIT 20',
  ).all<{ id: string; filename: string; summary_json: string; status: string; created_at: number }>()

  return c.json({ runs: result.results ?? [] })
})
