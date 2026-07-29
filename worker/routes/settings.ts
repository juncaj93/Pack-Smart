import { Hono } from 'hono'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'

export const settingsRoutes = new Hono<AppBindings>()

/**
 * Preferences and packing rules, manageable through the website.
 *
 * CLAUDE.md is explicit that after launch the website is the source of truth:
 * clothing, items, rules and preferences must all be editable here, not only in
 * the spreadsheet that seeded them.
 */

/* ------------------------------------------------------------------ */
/* your usual amounts                                                  */
/* ------------------------------------------------------------------ */

/**
 * "How many of this per day" — read from and written to the rules themselves.
 *
 * This used to be a hardcoded list of two `preference` rows, and it did not
 * work. `04_IMPORT_PLAN` and the note on `garmentRule()` both say it plainly:
 * preferences are not a second engine, the only mechanism that produces a
 * quantity is a rule. The engine reads `packing_rule` and nothing else — so the
 * old steppers wrote a number into a table no packing list has ever consulted.
 * Alex could set underwear to 4 per day and still get 2.
 *
 * Backing the screen with the per-day family of rules fixes that and gives add
 * and remove for free: adding an amount is adding a rule, removing one is
 * turning that rule off. One concept, one place, and the number on screen is
 * the number the list uses.
 *
 * The `preference` table is left alone rather than dropped — it is in the
 * backup export, and destroying stored data is not something to do as a side
 * effect of a UI change.
 */
type AmountType = 'per_day' | 'per_night' | 'duration_plus_buffer'

const MAX_PER_DAY = 10

interface AmountRow {
  id: string
  item_id: string
  display_name: string
  category: string
  rule_type: AmountType
  quantity_value: number | null
  buffer: number | null
}

function toAmount(row: AmountRow) {
  return {
    ruleId: row.id,
    itemId: row.item_id,
    itemName: row.display_name,
    category: row.category,
    ruleType: row.rule_type,
    multiplier: row.quantity_value ?? 1,
    buffer: row.buffer,
    unit: row.rule_type === 'per_night' ? 'per night' : 'per day',
  }
}

const AMOUNT_SELECT = `SELECT r.id, r.item_id, i.display_name, i.category, r.rule_type,
                              r.quantity_value, r.buffer
                         FROM packing_rule r
                         JOIN item i ON i.id = r.item_id
                        WHERE r.rule_type IN ('per_day','per_night','duration_plus_buffer')
                          AND r.enabled = 1
                          AND i.archived_at IS NULL`

settingsRoutes.get('/amounts', async (c) => {
  const result = await c.env.DB.prepare(
    `${AMOUNT_SELECT} ORDER BY lower(i.display_name)`,
  ).all<AmountRow>()

  return c.json({ amounts: (result.results ?? []).map(toAmount) })
})

/** Parses and range-checks a per-day count. Zero is not an amount — remove it instead. */
function readMultiplier(value: unknown): number | string {
  // `typeof` rather than Number(): JSON turns NaN into null and Number(null) is
  // 0, so a coercing check would quietly store "none" for a broken value.
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return `Pick a whole number between 1 and ${MAX_PER_DAY}.`
  }
  if (value < 1 || value > MAX_PER_DAY) {
    return `Pick a whole number between 1 and ${MAX_PER_DAY}.`
  }
  return value
}

settingsRoutes.put('/amounts/:ruleId', async (c) => {
  const body = await c.req
    .json<{ multiplier?: number }>()
    .catch(() => ({}) as { multiplier?: number })

  const multiplier = readMultiplier(body.multiplier)
  if (typeof multiplier === 'string') return c.json(apiError('bad_request', multiplier), 400)

  const ruleId = c.req.param('ruleId')
  const existing = await c.env.DB.prepare(
    "SELECT id FROM packing_rule WHERE id = ? AND rule_type IN ('per_day','per_night','duration_plus_buffer')",
  )
    .bind(ruleId)
    .first<{ id: string }>()

  if (!existing) return c.json(apiError('bad_request', 'That amount is no longer there.'), 404)

  // Editing clears the review flag: Alex has now looked at it and said a number.
  await c.env.DB.prepare(
    'UPDATE packing_rule SET quantity_value = ?, needs_review = 0 WHERE id = ?',
  )
    .bind(multiplier, ruleId)
    .run()

  const row = await c.env.DB.prepare(`${AMOUNT_SELECT} AND r.id = ?`)
    .bind(ruleId)
    .first<AmountRow>()

  if (!row) return c.json(apiError('bad_request', 'That amount is no longer there.'), 404)
  return c.json(toAmount(row))
})

/**
 * Adds an amount for an item that does not have one.
 *
 * If a matching rule exists but is switched off, it is switched back on rather
 * than duplicated — two per-day rules on one item would silently compete inside
 * `computeQuantity`, and the higher one would win for reasons nothing on screen
 * could explain.
 */
settingsRoutes.post('/amounts', async (c) => {
  const body = await c.req
    .json<{ itemId?: string; multiplier?: number; per?: string }>()
    .catch(() => ({}) as Record<string, never>)

  const multiplier = readMultiplier(body.multiplier)
  if (typeof multiplier === 'string') return c.json(apiError('bad_request', multiplier), 400)

  const ruleType: AmountType = body.per === 'night' ? 'per_night' : 'per_day'

  const itemId = typeof body.itemId === 'string' ? body.itemId : ''
  const item = await c.env.DB.prepare(
    'SELECT id, display_name FROM item WHERE id = ? AND archived_at IS NULL',
  )
    .bind(itemId)
    .first<{ id: string; display_name: string }>()

  if (!item) return c.json(apiError('bad_request', 'Pick something you own.'), 400)

  const clash = await c.env.DB.prepare(
    `SELECT id, enabled FROM packing_rule
      WHERE item_id = ? AND rule_type IN ('per_day','per_night','duration_plus_buffer')`,
  )
    .bind(item.id)
    .first<{ id: string; enabled: number }>()

  const now = nowSeconds()

  if (clash) {
    if (clash.enabled === 1) {
      return c.json(
        apiError('bad_request', `${item.display_name} already has an amount. Change that one instead.`),
        409,
      )
    }
    await c.env.DB.prepare(
      'UPDATE packing_rule SET enabled = 1, rule_type = ?, quantity_value = ?, needs_review = 0 WHERE id = ?',
    )
      .bind(ruleType, multiplier, clash.id)
      .run()
  } else {
    await c.env.DB.prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, buffer, condition_json,
                                 depends_on_item_id, enabled, needs_review, original_text, created_at)
       VALUES (?,?,?,?,NULL,NULL,NULL,1,0,?,?)`,
    )
      .bind(crypto.randomUUID(), item.id, ruleType, multiplier, 'Set in Your usual amounts', now)
      .run()
  }

  const row = await c.env.DB.prepare(`${AMOUNT_SELECT} AND r.item_id = ?`)
    .bind(item.id)
    .first<AmountRow>()

  if (!row) return c.json(apiError('bad_request', 'Could not save that.'), 500)
  return c.json(toAmount(row), 201)
})

/**
 * Removes an amount by switching its rule off, never by deleting it.
 *
 * A deleted rule cannot be undone and takes the original spreadsheet wording
 * with it. Switched off, it vanishes from this screen, stops affecting any
 * list, and is still there in Packing rules to turn back on.
 */
settingsRoutes.delete('/amounts/:ruleId', async (c) => {
  const ruleId = c.req.param('ruleId')
  const row = await c.env.DB.prepare(
    "SELECT id FROM packing_rule WHERE id = ? AND rule_type IN ('per_day','per_night','duration_plus_buffer')",
  )
    .bind(ruleId)
    .first<{ id: string }>()

  if (!row) return c.json(apiError('bad_request', 'That amount is no longer there.'), 404)

  await c.env.DB.prepare('UPDATE packing_rule SET enabled = 0 WHERE id = ?').bind(ruleId).run()
  return c.json({ ruleId, removed: true })
})

/** Puts a removed amount back — the undo half of the delete above. */
settingsRoutes.post('/amounts/:ruleId/restore', async (c) => {
  const ruleId = c.req.param('ruleId')
  await c.env.DB.prepare(
    "UPDATE packing_rule SET enabled = 1 WHERE id = ? AND rule_type IN ('per_day','per_night','duration_plus_buffer')",
  )
    .bind(ruleId)
    .run()

  const row = await c.env.DB.prepare(`${AMOUNT_SELECT} AND r.id = ?`)
    .bind(ruleId)
    .first<AmountRow>()

  if (!row) return c.json(apiError('bad_request', 'That amount is no longer there.'), 404)
  return c.json(toAmount(row))
})

/* ------------------------------------------------------------------ */
/* packing rules                                                       */
/* ------------------------------------------------------------------ */

interface RuleListRow {
  id: string
  item_id: string
  display_name: string
  rule_type: string
  quantity_value: number | null
  buffer: number | null
  condition_json: string | null
  depends_on_item_id: string | null
  depends_on_name: string | null
  enabled: number
  needs_review: number
  original_text: string | null
}

/**
 * Every packing rule, with the item it belongs to and the words it came from.
 *
 * Rules that need review are listed first: an unresolvable dependency silently
 * removes its item from every trip, so it must be the first thing Alex sees
 * rather than something buried alphabetically.
 */
settingsRoutes.get('/rules', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT r.id, r.item_id, i.display_name, r.rule_type, r.quantity_value, r.buffer,
            r.condition_json, r.depends_on_item_id, d.display_name AS depends_on_name,
            r.enabled, r.needs_review, r.original_text
       FROM packing_rule r
       JOIN item i ON i.id = r.item_id
       LEFT JOIN item d ON d.id = r.depends_on_item_id
      WHERE i.archived_at IS NULL
      ORDER BY r.needs_review DESC, lower(i.display_name)`,
  ).all<RuleListRow>()

  const rules = (result.results ?? []).map((row) => ({
    id: row.id,
    itemId: row.item_id,
    itemName: row.display_name,
    ruleType: row.rule_type,
    quantityValue: row.quantity_value,
    buffer: row.buffer,
    condition: row.condition_json,
    dependsOnName: row.depends_on_name,
    enabled: row.enabled === 1,
    needsReview: row.needs_review === 1,
    originalText: row.original_text,
  }))

  return c.json({ rules })
})

settingsRoutes.patch('/rules/:id', async (c) => {
  const body = await c.req
    .json<{ enabled?: boolean; quantityValue?: number | null }>()
    .catch(() => ({}) as Record<string, never>)

  const now = nowSeconds()

  if (body.enabled !== undefined) {
    await c.env.DB.prepare('UPDATE packing_rule SET enabled = ? WHERE id = ?')
      .bind(body.enabled ? 1 : 0, c.req.param('id'))
      .run()
  }

  if (body.quantityValue !== undefined) {
    const value = Number(body.quantityValue)
    if (!Number.isFinite(value) || value < 0 || value > 99) {
      return c.json(apiError('bad_request', 'Pick a number between 0 and 99.'), 400)
    }
    // Editing a rule clears its review flag: Alex has now looked at it.
    await c.env.DB.prepare(
      'UPDATE packing_rule SET quantity_value = ?, needs_review = 0 WHERE id = ?',
    )
      .bind(value, c.req.param('id'))
      .run()
  }

  const row = await c.env.DB.prepare(
    'SELECT id, enabled, quantity_value, needs_review FROM packing_rule WHERE id = ?',
  )
    .bind(c.req.param('id'))
    .first<{ id: string; enabled: number; quantity_value: number | null; needs_review: number }>()

  if (!row) return c.json(apiError('bad_request', 'No such rule.'), 404)

  return c.json({
    id: row.id,
    enabled: row.enabled === 1,
    quantityValue: row.quantity_value,
    needsReview: row.needs_review === 1,
    updatedAt: now,
  })
})

/* ------------------------------------------------------------------ */
/* export                                                              */
/* ------------------------------------------------------------------ */

/**
 * Everything, as JSON.
 *
 * A single-user app on a free plan has no backup story of its own, so the
 * ability to take the data out is the backup. Read-only by design — restoring is
 * a destructive operation and is not something to expose behind one tap.
 */
settingsRoutes.get('/export', async (c) => {
  const tables = [
    'item',
    'packing_rule',
    'preference',
    'trip',
    'trip_destination',
    'trip_fact',
    'checklist_entry',
    'outfit_group',
    'outfit_slot',
    'daily_plan',
    'wear_log',
    'import_run',
  ]

  const data: Record<string, unknown[]> = {}
  for (const table of tables) {
    const result = await c.env.DB.prepare(`SELECT * FROM ${table}`).all()
    data[table] = result.results ?? []
  }

  return c.json(
    { exportedAt: nowSeconds(), version: 1, data },
    200,
    { 'Content-Disposition': 'attachment; filename="pack-smart-backup.json"' },
  )
})
