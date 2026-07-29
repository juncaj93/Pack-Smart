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

/**
 * The preferences Alex can actually change, with plain-English labels.
 *
 * A deliberate allowlist rather than a generic key/value editor. Exposing every
 * internal key would be a developer-facing settings screen, which doc 06 rules
 * out — and an unrecognised key would let a typo silently break the engine.
 */
const EDITABLE = [
  {
    key: 'contacts_basis',
    label: 'Contact lenses',
    unit: 'per day',
    help: 'How many pairs you get through on an average day.',
  },
  {
    key: 'underwear_basis',
    label: 'Underwear',
    unit: 'per day',
    help: 'How many pairs you pack for each day of a trip.',
  },
] as const

interface Basis {
  per: string
  multiplier: number
}

settingsRoutes.get('/preferences', async (c) => {
  const result = await c.env.DB.prepare('SELECT key, value_json FROM preference').all<{
    key: string
    value_json: string
  }>()

  const stored = new Map((result.results ?? []).map((r) => [r.key, r.value_json]))

  const preferences = EDITABLE.map((definition) => {
    let multiplier = 0
    try {
      const parsed = JSON.parse(stored.get(definition.key) ?? '{}') as Partial<Basis>
      multiplier = Number(parsed.multiplier ?? 0)
    } catch {
      /* a corrupt value reads as zero and is visibly wrong rather than silently applied */
    }
    return { ...definition, multiplier }
  })

  return c.json({ preferences })
})

settingsRoutes.put('/preferences/:key', async (c) => {
  const key = c.req.param('key')
  const definition = EDITABLE.find((d) => d.key === key)
  if (!definition) return c.json(apiError('bad_request', 'Not a setting you can change.'), 400)

  const body = await c.req
    .json<{ multiplier?: number }>()
    .catch(() => ({}) as { multiplier?: number })

  // `typeof` rather than Number(): JSON turns NaN into null, and Number(null)
  // is 0, so a coercing check would quietly store "none" for a broken value.
  // Zero is a real answer here ("I do not wear contacts"); absent is not.
  const multiplier = body.multiplier
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) {
    return c.json(apiError('bad_request', 'Pick a number between 0 and 10.'), 400)
  }
  if (multiplier < 0 || multiplier > 10 || !Number.isInteger(multiplier)) {
    return c.json(apiError('bad_request', 'Pick a whole number between 0 and 10.'), 400)
  }

  await c.env.DB.prepare(
    `INSERT INTO preference (key, value_json, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  )
    .bind(key, JSON.stringify({ per: 'trip_day', multiplier }), nowSeconds())
    .run()

  return c.json({ key, multiplier })
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
