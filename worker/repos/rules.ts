import { isCreatableRuleType } from '@shared/rules'
import type { Condition, CreatableRuleType, PackingRule, RuleSource } from '@shared/rules'
import { nowSeconds } from '../auth'

/**
 * Reading and writing packing rules, and the one place that knows what an
 * override is.
 *
 * Split out of `routes/settings.ts` and `repos/checklist.ts` — which each had
 * their own copy of the row shape and their own `SELECT ... FROM packing_rule`
 * — because migration 0011 makes the query non-obvious. "Every enabled rule" is
 * no longer the set the engine should see: a rule that another rule explicitly
 * supersedes is not in force, and a DISABLED override still is, because it is
 * how "turn this default off" is stored. Two callers reasoning about that
 * separately is two chances to get it wrong.
 *
 * The rule Alex's ruling asks for, in one sentence: **the canonical system
 * record is never mutated.** Editing a default writes a user-owned copy that
 * names it; removing that copy restores the default exactly.
 */

export interface RuleRow {
  id: string
  item_id: string
  rule_type: string
  quantity_value: number | null
  buffer: number | null
  condition_json: string | null
  depends_on_item_id: string | null
  enabled: number
  needs_review: number
  original_text: string | null
  source: string
  supersedes_rule_id: string | null
}

export const RULE_COLUMNS = `r.id, r.item_id, r.rule_type, r.quantity_value, r.buffer,
                             r.condition_json, r.depends_on_item_id, r.enabled, r.needs_review,
                             r.original_text, r.source, r.supersedes_rule_id`

/**
 * The SQL half of `applyPrecedence`, for the queries that only need item ids.
 *
 * `repos/coverage.ts` asks "which items have a rule at all", and after an
 * override exists the honest answer excludes the default it replaced —
 * otherwise switching a default off would leave coverage believing the item is
 * still handled by a rule nothing reads.
 */
export const NOT_SUPERSEDED = `r.id NOT IN (SELECT supersedes_rule_id FROM packing_rule
                                             WHERE supersedes_rule_id IS NOT NULL)`

function readSource(value: string): RuleSource {
  return value === 'user' || value === 'learned' ? value : 'system'
}

export function toRule(row: RuleRow): PackingRule {
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
    source: readSource(row.source),
    supersedesRuleId: row.supersedes_rule_id,
  }
}

/**
 * Every rule, enabled or not.
 *
 * Disabled rules used to be filtered out in SQL. They cannot be any more: a
 * disabled override is a decision about a default, and the engine has to see it
 * to know the default was switched off. `computeQuantity` skips disabled rules
 * itself, so nothing downstream changes — except that the one place deciding
 * what "in force" means is now the engine rather than a WHERE clause.
 */
export async function listRules(db: D1Database): Promise<PackingRule[]> {
  const result = await db
    .prepare(`SELECT ${RULE_COLUMNS} FROM packing_rule r`)
    .all<RuleRow>()
  return (result.results ?? []).map(toRule)
}

export async function getRuleRow(db: D1Database, id: string): Promise<RuleRow | null> {
  return db
    .prepare(`SELECT ${RULE_COLUMNS} FROM packing_rule r WHERE r.id = ?`)
    .bind(id)
    .first<RuleRow>()
}

/** The user-owned rule replacing this default, if Alex has written one. */
export async function getOverrideRow(db: D1Database, systemRuleId: string): Promise<RuleRow | null> {
  return db
    .prepare(`SELECT ${RULE_COLUMNS} FROM packing_rule r WHERE r.supersedes_rule_id = ?`)
    .bind(systemRuleId)
    .first<RuleRow>()
}

/* ------------------------------------------------------------------ */
/* editing                                                             */
/* ------------------------------------------------------------------ */

export interface RuleEdit {
  enabled?: boolean
  quantityValue?: number
  buffer?: number | null
  conditionJson?: string
}

export interface EditOutcome {
  /** The rule that is now in force — the override, when there is one. */
  row: RuleRow
  /** Whether this edit was recorded as an override rather than in place. */
  overrode: boolean
}

/**
 * Copies a system default into a user-owned rule that replaces it.
 *
 * A copy, not a stub. The override carries the default's type, condition,
 * dependency and wording, so the only difference between them is whatever Alex
 * actually changed — which is what makes restoring exact and what makes
 * "disable" expressible as an override that contributes nothing.
 *
 * `needs_review` is cleared: the flag records that the imported wording was not
 * certain, and Alex has now stated what he wants in his own terms.
 */
async function createOverride(db: D1Database, system: RuleRow, now: number): Promise<string> {
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, buffer, condition_json,
                                 depends_on_item_id, enabled, original_text, needs_review,
                                 source, supersedes_rule_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,'user',?,?)`,
    )
    .bind(
      id, system.item_id, system.rule_type, system.quantity_value, system.buffer,
      system.condition_json, system.depends_on_item_id, system.enabled, system.original_text,
      system.id, now,
    )
    .run()
  return id
}

/** The fields that decide whether two rules say the same thing. */
function sameRule(a: RuleRow, b: RuleRow): boolean {
  return (
    a.rule_type === b.rule_type &&
    a.quantity_value === b.quantity_value &&
    a.buffer === b.buffer &&
    a.condition_json === b.condition_json &&
    a.depends_on_item_id === b.depends_on_item_id &&
    a.enabled === b.enabled
  )
}

/** Whether an edit would actually change the rule it is aimed at. */
function changesAnything(row: RuleRow, edit: RuleEdit): boolean {
  if (edit.enabled !== undefined && edit.enabled !== (row.enabled === 1)) return true
  if (edit.quantityValue !== undefined && edit.quantityValue !== row.quantity_value) return true
  if (edit.buffer !== undefined && edit.buffer !== row.buffer) return true
  if (edit.conditionJson !== undefined && edit.conditionJson !== row.condition_json) return true
  return false
}

async function writeEdit(db: D1Database, id: string, edit: RuleEdit): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []

  if (edit.enabled !== undefined) {
    sets.push('enabled = ?')
    values.push(edit.enabled ? 1 : 0)
  }
  if (edit.quantityValue !== undefined) {
    sets.push('quantity_value = ?')
    values.push(edit.quantityValue)
  }
  if (edit.buffer !== undefined) {
    sets.push('buffer = ?')
    values.push(edit.buffer)
  }
  if (edit.conditionJson !== undefined) {
    sets.push('condition_json = ?')
    values.push(edit.conditionJson)
  }
  if (sets.length === 0) return

  // Editing a rule clears its review flag: Alex has now looked at it and said
  // what he wants.
  sets.push('needs_review = 0')

  await db
    .prepare(`UPDATE packing_rule SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, id)
    .run()
}

/**
 * Applies an edit to whichever rule should actually carry it.
 *
 * The whole of Alex's first ruling lives here. A system default is preserved
 * and shadowed; anything he owns is edited in place. The caller does not choose
 * — it cannot, because the choice depends on provenance the caller would have
 * to re-read to know.
 */
export async function editRule(
  db: D1Database,
  ruleId: string,
  edit: RuleEdit,
  now: number,
): Promise<EditOutcome | null> {
  const target = await getRuleRow(db, ruleId)
  if (!target) return null

  if (readSource(target.source) !== 'system') {
    await writeEdit(db, target.id, edit)
    const row = await getRuleRow(db, target.id)
    if (!row) return null

    /*
     * An override that has been edited back into agreement with the default it
     * replaces is not an override any more, so it goes.
     *
     * Without this, turning a default off and straight back on leaves a rule
     * that supersedes the default while saying exactly what the default said —
     * and the screen, reading the relationship rather than the values, would
     * label an untouched rule "changed". Self-healing here rather than in the
     * interface, so every caller gets it.
     */
    if (row.supersedes_rule_id) {
      const original = await getRuleRow(db, row.supersedes_rule_id)
      if (original && sameRule(row, original)) {
        await db.prepare('DELETE FROM packing_rule WHERE id = ?').bind(row.id).run()
        return { row: original, overrode: false }
      }
    }

    return { row, overrode: false }
  }

  const existing = await getOverrideRow(db, target.id)

  /*
   * An edit that changes nothing writes nothing.
   *
   * Otherwise `PATCH { enabled: true }` on a rule that is already on would mint
   * an override identical to the default, and the row would announce a change
   * Alex never made.
   */
  if (!existing && !changesAnything(target, edit)) return { row: target, overrode: false }

  // A default that is already overridden: the edit belongs on the override,
  // whichever id the caller happened to name.
  const overrideId = existing?.id ?? (await createOverride(db, target, now))
  await writeEdit(db, overrideId, edit)

  const row = await getRuleRow(db, overrideId)
  if (!row) return null

  if (sameRule(row, target)) {
    await db.prepare('DELETE FROM packing_rule WHERE id = ?').bind(row.id).run()
    return { row: target, overrode: false }
  }

  return { row, overrode: true }
}

/**
 * Switches a rule off as an explicit, reversible decision.
 *
 * Used by the learning panel, which used to run `UPDATE packing_rule SET
 * enabled = 0` straight over a seeded row. That is a mutation of the canonical
 * record, and after it there was nothing left to restore *to*. Accepting a
 * suggestion now writes a `learned` override — the first writer of the third
 * source — and "put it back" is the same restore any other override has.
 */
export async function disableRule(
  db: D1Database,
  ruleId: string,
  by: RuleSource,
  now: number,
): Promise<boolean> {
  const target = await getRuleRow(db, ruleId)
  if (!target) return false

  if (readSource(target.source) !== 'system') {
    if (target.enabled === 0) return false
    await db.prepare('UPDATE packing_rule SET enabled = 0 WHERE id = ?').bind(target.id).run()
    return true
  }

  const existing = await getOverrideRow(db, target.id)
  if (existing) {
    if (existing.enabled === 0) return false
    await db.prepare('UPDATE packing_rule SET enabled = 0 WHERE id = ?').bind(existing.id).run()
    return true
  }

  const id = await createOverride(db, target, now)
  await db
    .prepare('UPDATE packing_rule SET enabled = 0, source = ? WHERE id = ?')
    .bind(by, id)
    .run()
  return true
}

/**
 * Switches a rule back on — the undo half of `disableRule`.
 *
 * Re-enables rather than removing the override, because "put that back" and
 * "go back to the default" are different requests. An override that carries a
 * changed quantity as well as a switched-off state must not lose the quantity
 * to an undo that only meant to reverse the switch.
 */
export async function enableRule(db: D1Database, ruleId: string): Promise<RuleRow | null> {
  // Routed through `editRule` rather than writing `enabled = 1` directly, so a
  // seeded rule that was already off gets an override instead of being written
  // over — and so an override that agrees with its default again is dropped.
  return (await editRule(db, ruleId, { enabled: true }, nowSeconds()))?.row ?? null
}

/** Whichever rule is actually in force for the id a screen happens to hold. */
export async function effectiveRuleId(db: D1Database, ruleId: string): Promise<string | null> {
  const target = await getRuleRow(db, ruleId)
  if (!target) return null
  if (readSource(target.source) !== 'system') return target.id
  return (await getOverrideRow(db, target.id))?.id ?? target.id
}

/* ------------------------------------------------------------------ */
/* creating, restoring, deleting                                       */
/* ------------------------------------------------------------------ */

export async function createRule(
  db: D1Database,
  input: { itemId: string; ruleType: CreatableRuleType; quantityValue: number },
  now: number,
): Promise<string> {
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, buffer, condition_json,
                                 depends_on_item_id, enabled, original_text, needs_review,
                                 source, supersedes_rule_id, created_at)
       VALUES (?,?,?,?,NULL,NULL,NULL,1,NULL,0,'user',NULL,?)`,
    )
    .bind(id, input.itemId, input.ruleType, input.quantityValue, now)
    .run()
  return id
}

/**
 * Removes an override, so the default it replaced comes back into force.
 *
 * A delete rather than a flag, and safe as a delete: the override holds nothing
 * that is not either Alex's own recent edit or a copy of the row it shadows.
 * The thing that must survive — the seeded rule and its original wording — was
 * never touched.
 */
export async function restoreDefault(db: D1Database, overrideId: string): Promise<RuleRow | null> {
  const override = await getRuleRow(db, overrideId)
  if (!override?.supersedes_rule_id) return null

  const system = await getRuleRow(db, override.supersedes_rule_id)
  await db.prepare('DELETE FROM packing_rule WHERE id = ?').bind(override.id).run()
  return system
}

export type DeleteOutcome = 'deleted' | 'not_found' | 'is_default' | 'is_override' | 'is_amount'

/**
 * Deletes a rule Alex wrote, and refuses anything else.
 *
 * "Deletion where safe" is the whole scope, and safe means three things:
 *
 * - **Not a system default.** It is switched off instead, which is reversible
 *   and keeps the spreadsheet wording.
 * - **Not an override.** It is removed by restoring the default, which is a
 *   different sentence from "delete this rule".
 * - **Not an amount.** A `per_day` rule is Alex's, and deleting it would work —
 *   but nothing can put it back, because `createRule` writes the four kinds
 *   Packing rules offers and `per_day` is deliberately not one of them. An
 *   amount is removed in `Your usual amounts`, by switching off.
 */
export async function deleteRule(db: D1Database, ruleId: string): Promise<DeleteOutcome> {
  const rule = await getRuleRow(db, ruleId)
  if (!rule) return 'not_found'
  if (readSource(rule.source) === 'system') return 'is_default'
  if (rule.supersedes_rule_id) return 'is_override'
  if (!isCreatableRuleType(rule.rule_type)) return 'is_amount'

  await db.prepare('DELETE FROM packing_rule WHERE id = ?').bind(ruleId).run()
  return 'deleted'
}
