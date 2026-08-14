import { Hono } from 'hono'
import { MAX_QUANTITY, QUANTITY_RANGE_MESSAGE, readQuantity } from '@shared/quantities'
import { writeThreshold } from '@shared/rule-threshold'
import { isCreatableRuleType } from '@shared/rules'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import {
  acceptOverrideProposal,
  acceptRemovalProposal,
  decideLearning,
  listLearningDecisions,
  pendingBagProposals,
  pendingQuantityProposals,
  pendingRemovalProposals,
  pendingTimingProposals,
  pendingUnwornProposals,
  restoreSetAsideLearning,
} from '../repos/learning'
import { undecided, type LearnedChange } from '@shared/learning'
import { recurringGapInsights } from '../repos/closet-gaps'
import {
  createRule,
  deleteRule,
  disableRule,
  editRule,
  enableRule,
  NOT_SUPERSEDED,
  restoreDefault,
  type RuleEdit,
} from '../repos/rules'

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
                          AND i.archived_at IS NULL
                          AND ${NOT_SUPERSEDED}`

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
  const quantity = readQuantity(value)
  return quantity ?? QUANTITY_RANGE_MESSAGE
}

/**
 * Changes an amount — and this is the headline case of Alex's first ruling.
 *
 * *"Underwear, 2 per day"* is a seeded default. Typing `1` here has to mean one
 * per day, including when that is FEWER than the default, and it must not do it
 * by overwriting the default: `editRule` preserves the seeded row and writes a
 * user-owned rule that supersedes it, so `Use the default` in Packing rules can
 * put 2 back exactly.
 */
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

  const outcome = await editRule(c.env.DB, ruleId, { quantityValue: multiplier }, nowSeconds())
  if (!outcome) return c.json(apiError('bad_request', 'That amount is no longer there.'), 404)

  const row = await c.env.DB.prepare(`${AMOUNT_SELECT} AND r.id = ?`)
    .bind(outcome.row.id)
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
    `SELECT r.id, r.enabled FROM packing_rule r
      WHERE r.item_id = ? AND r.rule_type IN ('per_day','per_night','duration_plus_buffer')
        AND ${NOT_SUPERSEDED}`,
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
    // `source = 'user'` from the start. Migration 0011 backfills the rows this
    // endpoint wrote before the column existed, matching on the same wording.
    await c.env.DB.prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, buffer, condition_json,
                                 depends_on_item_id, enabled, needs_review, original_text,
                                 source, supersedes_rule_id, created_at)
       VALUES (?,?,?,?,NULL,NULL,NULL,1,0,?,'user',NULL,?)`,
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
 *
 * For a seeded amount, "switched off" is now a user-owned rule that supersedes
 * the default and contributes nothing — the same reversible decision, recorded
 * without writing over the default itself.
 */
settingsRoutes.delete('/amounts/:ruleId', async (c) => {
  const ruleId = c.req.param('ruleId')
  const row = await c.env.DB.prepare(
    "SELECT id FROM packing_rule WHERE id = ? AND rule_type IN ('per_day','per_night','duration_plus_buffer')",
  )
    .bind(ruleId)
    .first<{ id: string }>()

  if (!row) return c.json(apiError('bad_request', 'That amount is no longer there.'), 404)

  await disableRule(c.env.DB, ruleId, 'user', nowSeconds())
  return c.json({ ruleId, removed: true })
})

/**
 * Puts a removed amount back — the undo half of the delete above.
 *
 * Takes either id: the undo bar is holding whatever the row said before it
 * disappeared, which for a seeded amount is the default's id rather than the
 * override's. `enableRule` resolves that rather than making the screen track
 * which of the two it should be naming.
 */
settingsRoutes.post('/amounts/:ruleId/restore', async (c) => {
  const restored = await enableRule(c.env.DB, c.req.param('ruleId'))
  if (!restored) return c.json(apiError('bad_request', 'That amount is no longer there.'), 404)

  const row = await c.env.DB.prepare(`${AMOUNT_SELECT} AND r.id = ?`)
    .bind(restored.id)
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
  source: string
  supersedes_rule_id: string | null
  default_rule_type: string | null
  default_quantity_value: number | null
  default_buffer: number | null
  default_condition_json: string | null
  default_enabled: number | null
  default_original_text: string | null
}

/**
 * Every rule that is actually in force, and what it replaced if it replaced
 * anything.
 *
 * `NOT_SUPERSEDED` is the difference between this and a plain listing: a
 * default with an override is represented ONCE, by the override, because
 * showing both would put two rules for one item on screen with nothing to say
 * which of them the packing list uses. The default is not hidden, though — it
 * travels with the row as `overridesDefault`, which is what lets the screen say
 * *"changed from 2 per day"* and offer to put it back.
 */
const RULE_LIST_SELECT = `SELECT r.id, r.item_id, i.display_name, r.rule_type, r.quantity_value,
                                 r.buffer, r.condition_json, r.depends_on_item_id,
                                 d.display_name AS depends_on_name, r.enabled, r.needs_review,
                                 r.original_text, r.source, r.supersedes_rule_id,
                                 s.rule_type      AS default_rule_type,
                                 s.quantity_value AS default_quantity_value,
                                 s.buffer         AS default_buffer,
                                 s.condition_json AS default_condition_json,
                                 s.enabled        AS default_enabled,
                                 s.original_text  AS default_original_text
                            FROM packing_rule r
                            JOIN item i ON i.id = r.item_id
                            LEFT JOIN item d ON d.id = r.depends_on_item_id
                            LEFT JOIN packing_rule s ON s.id = r.supersedes_rule_id
                           WHERE i.archived_at IS NULL
                             AND ${NOT_SUPERSEDED}`

function toRuleView(row: RuleListRow) {
  return {
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
    source: row.source,
    /*
     * Only a rule Alex wrote from scratch, of a kind this screen can write.
     *
     * A default is switched off instead — reversible, and it keeps the
     * spreadsheet wording — and an override is removed by restoring the default,
     * which is a different sentence from "delete this rule" and deserves a
     * different control.
     *
     * The third condition is the one that is easy to miss: an amount added in
     * `Your usual amounts` is a `user` rule superseding nothing, so it passed
     * the first two and offered a delete here — while its Undo re-creates
     * through an endpoint that does not accept `per_day` at all. Delete and undo
     * have to be the same set of kinds or the undo is a promise the screen
     * cannot keep. Amounts are removed where they are created, by switching
     * off, which is reversible for a different reason.
     */
    canDelete:
      row.source !== 'system' &&
      row.supersedes_rule_id === null &&
      isCreatableRuleType(row.rule_type),
    overridesDefault: row.supersedes_rule_id
      ? {
          id: row.supersedes_rule_id,
          ruleType: row.default_rule_type,
          quantityValue: row.default_quantity_value,
          buffer: row.default_buffer,
          condition: row.default_condition_json,
          enabled: row.default_enabled === 1,
          originalText: row.default_original_text,
        }
      : null,
  }
}

async function ruleView(db: D1Database, id: string) {
  const row = await db.prepare(`${RULE_LIST_SELECT} AND r.id = ?`).bind(id).first<RuleListRow>()
  return row ? toRuleView(row) : null
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
    `${RULE_LIST_SELECT} ORDER BY r.needs_review DESC, lower(i.display_name)`,
  ).all<RuleListRow>()

  return c.json({ rules: (result.results ?? []).map(toRuleView) })
})

/**
 * Writes a rule of Alex's own.
 *
 * Four kinds, listed in `CREATABLE_RULE_TYPES` with the reasoning for the
 * omissions. The important guarantee is the one that is invisible here: a rule
 * created this way supersedes nothing, so it can only ever COMBINE with an
 * existing default. Alex's ruling is explicit that writing an unrelated rule
 * must never be read as a silent reduction of one, and the way to guarantee
 * that is for creation to have no way of expressing it.
 */
settingsRoutes.post('/rules', async (c) => {
  const body = await c.req
    .json<{ itemId?: string; ruleType?: string; quantityValue?: number }>()
    .catch(() => ({}) as Record<string, never>)

  if (!isCreatableRuleType(body.ruleType)) {
    return c.json(apiError('bad_request', 'Pick what kind of rule this is.'), 400)
  }

  const quantity = readQuantity(body.quantityValue)
  if (quantity === null) return c.json(apiError('bad_request', QUANTITY_RANGE_MESSAGE), 400)

  const item = await c.env.DB.prepare(
    'SELECT id, display_name FROM item WHERE id = ? AND archived_at IS NULL',
  )
    .bind(typeof body.itemId === 'string' ? body.itemId : '')
    .first<{ id: string; display_name: string }>()

  if (!item) return c.json(apiError('bad_request', 'Pick something you own.'), 400)

  /*
   * One rule of a kind per item.
   *
   * Two `at least` rules on one thing are not two facts, they are one fact
   * written twice, and the larger would quietly win inside `computeQuantity`
   * with nothing on screen able to explain which. Sending Alex to the rule that
   * already exists is both shorter and honest — and if that rule is a default,
   * changing it is exactly the override path.
   */
  const clash = await c.env.DB.prepare(
    `SELECT r.id FROM packing_rule r
      WHERE r.item_id = ? AND r.rule_type = ? AND ${NOT_SUPERSEDED}`,
  )
    .bind(item.id, body.ruleType)
    .first<{ id: string }>()

  if (clash) {
    return c.json(
      apiError('bad_request', `${item.display_name} already has a rule like that. Change that one instead.`),
      409,
    )
  }

  const id = await createRule(
    c.env.DB,
    { itemId: item.id, ruleType: body.ruleType, quantityValue: quantity },
    nowSeconds(),
  )

  const view = await ruleView(c.env.DB, id)
  if (!view) return c.json(apiError('bad_request', 'Could not save that.'), 500)
  return c.json(view, 201)
})

/**
 * Puts a default back, by removing the rule that was replacing it.
 *
 * The fourth thing Alex's ruling requires of an edited default, and the reason
 * the other three are safe: because the seeded row was never touched, restoring
 * is a deletion of Alex's copy rather than an attempt to reconstruct a number
 * nobody wrote down.
 */
settingsRoutes.post('/rules/:id/restore', async (c) => {
  const system = await restoreDefault(c.env.DB, c.req.param('id'))
  if (!system) {
    return c.json(apiError('bad_request', 'That rule is not changing a default.'), 400)
  }

  const view = await ruleView(c.env.DB, system.id)
  if (!view) return c.json(apiError('bad_request', 'No such rule.'), 404)
  return c.json({ ...view, listedRuleId: c.req.param('id') })
})

/** Deletes a rule Alex wrote, and explains itself for anything it will not. */
settingsRoutes.delete('/rules/:id', async (c) => {
  const outcome = await deleteRule(c.env.DB, c.req.param('id'))

  if (outcome === 'not_found') return c.json(apiError('bad_request', 'No such rule.'), 404)
  if (outcome === 'is_default') {
    return c.json(
      apiError('bad_request', 'This rule came with Pack Smart. Turn it off instead — you can turn it back on.'),
      409,
    )
  }
  if (outcome === 'is_override') {
    return c.json(apiError('bad_request', 'Use the default to undo this change.'), 409)
  }
  if (outcome === 'is_amount') {
    return c.json(
      apiError('bad_request', 'Change or remove this in Your usual amounts.'),
      409,
    )
  }

  return c.json({ id: c.req.param('id'), deleted: true })
})

/**
 * What Alex's own history suggests changing (product doc 04 §7).
 *
 * Read-only. Nothing here alters a rule until he accepts a proposal, because a
 * permanent preference change must be explicit (CLAUDE.md).
 */
/**
 * Everything the history suggests, in one read.
 *
 * Five families now: the two that watch an ABSENCE (a row taken off, a garment
 * that came home unworn) and the three that watch a CORRECTION (a bag moved, a
 * timing shifted, a number set). All five are derived — nothing is stored, and
 * the counts are recomputed here on every open — so none of them can go stale
 * against the history that produced it.
 *
 * `setAside=1` is how *Not sure* comes back, offered from the sheet's own empty
 * state rather than as a standing control.
 */
async function readSuggestions(db: D1Database, setAside: boolean) {
  const today = new Date().toISOString().slice(0, 10)
  const [removals, unworn, timing, bag, amount, gaps, decisions] = await Promise.all([
    pendingRemovalProposals(db),
    pendingUnwornProposals(db, today),
    pendingTimingProposals(db),
    pendingBagProposals(db),
    pendingQuantityProposals(db),
    recurringGapInsights(db),
    listLearningDecisions(db),
  ])

  /*
   * An item can qualify on both counts — removed from some trips, packed and
   * unworn on others. Showing it twice would look like two separate findings
   * about one item, so the removal reading wins: "you took it off the list" is
   * a more direct statement of intent than "you did not wear it".
   */
  const seen = new Set(removals.map((p) => p.itemId))

  /*
   * A removal proposal SILENCES every correction about the same item, and the
   * order is the argument. "Stop packing this at all" and "put this in your
   * carry-on" are answers to different questions, and offering both is the app
   * asking Alex to arbitrate between two halves of itself.
   */
  const settled = new Set([...seen, ...unworn.map((p) => p.itemId)])
  const corrections = undecided([...timing, ...bag, ...amount], decisions, setAside).filter(
    (proposal) => !settled.has(proposal.itemId),
  )

  /*
   * A closet gap is answered the same way a correction is, through the same
   * table — it is a suggestion Alex can disagree with, and until this existed
   * every suggestion in this sheet came back forever. There is no ACCEPT: the
   * only thing that closes a wardrobe gap is owning something, which is a fact
   * about My Stuff rather than a preference to be recorded.
   */
  const said = new Map(decisions.map((d) => [`${d.subject} ${d.topic}`, d.decision]))
  const closet = gaps.filter((gap) => {
    const decision = said.get(`${gap.subject} ${gap.topic}`)
    if (decision === undefined) return true
    if (decision === 'not_sure') return setAside
    return false
  })

  return {
    removals,
    unworn: unworn.filter((p) => !seen.has(p.itemId)),
    corrections,
    closet,
    /* Whether offering "show what I set aside" would show anything. */
    setAside: decisions.some((decision) => decision.decision === 'not_sure'),
  }
}

settingsRoutes.get('/suggestions', async (c) =>
  c.json(await readSuggestions(c.env.DB, c.req.query('setAside') === '1')),
)

/**
 * Makes one repeated correction the default.
 *
 * The explicit act `CLAUDE.md` requires of any permanent preference change, and
 * the change itself is carried in the request rather than re-derived here — the
 * screen shows a proposal and accepts THAT proposal, so what is applied is what
 * was read.
 */
settingsRoutes.post('/suggestions/corrections/accept', async (c) => {
  const body = await c.req
    .json<{ change?: LearnedChange }>()
    .catch(() => ({}) as Record<string, never>)

  const change = body.change
  if (!change || !ACCEPTABLE.has(change.kind)) {
    return c.json(apiError('bad_request', 'No change to make.'), 400)
  }

  const outcome = await acceptOverrideProposal(c.env.DB, change, nowSeconds())
  if (!outcome.applied) return c.json(apiError('bad_request', 'That is no longer there.'), 404)

  return c.json(await readSuggestions(c.env.DB, false))
})

/** The three a request is allowed to name, so a body cannot invent a fourth. */
const ACCEPTABLE = new Set(['default_timing', 'default_bag', 'usual_amount'])

/**
 * Says no, or not now — the half that did not exist.
 *
 * Until this, a suggestion Alex disagreed with came back on every open forever,
 * which is the fastest way to teach him the panel is not worth reading.
 * `declined` silences this exact suggestion; a later, different habit still gets
 * asked about once, because the topic carries the value.
 */
settingsRoutes.post('/suggestions/corrections/decide', async (c) => {
  const body = await c.req
    .json<{ subject?: string; topic?: string; decision?: string }>()
    .catch(() => ({}) as Record<string, never>)

  const decision = body.decision
  if (!body.subject || !body.topic || (decision !== 'declined' && decision !== 'not_sure')) {
    return c.json(apiError('bad_request', 'Nothing to record.'), 400)
  }

  await decideLearning(c.env.DB, body.subject, body.topic, decision, nowSeconds())
  return c.json(await readSuggestions(c.env.DB, false))
})

/** Brings back everything set aside. Declines are untouched — see the repo. */
settingsRoutes.post('/suggestions/corrections/restore', async (c) => {
  await restoreSetAsideLearning(c.env.DB)
  return c.json(await readSuggestions(c.env.DB, true))
})

settingsRoutes.post('/suggestions/removals/:ruleId/accept', async (c) => {
  const outcome = await acceptRemovalProposal(c.env.DB, c.req.param('ruleId'))
  return c.json({ ...outcome, ...(await readSuggestions(c.env.DB, false)) })
})

/**
 * Changes a rule — or, when the rule is a default, records the change as an
 * override of it.
 *
 * Nothing in this handler decides which of those happens; `editRule` does,
 * from the rule's own provenance. That matters because the alternative is every
 * caller remembering to check, and the one that forgets is the one that
 * overwrites a seeded rule.
 *
 * `listedRuleId` comes back with the result because an edit can change which
 * row the screen should be talking to: the first change to a default answers
 * with a rule that did not exist when the list was drawn. Returning the id the
 * caller used means the screen can swap the row it holds rather than re-fetch
 * the whole list to find out what happened.
 */
settingsRoutes.patch('/rules/:id', async (c) => {
  const body = await c.req
    .json<{ enabled?: boolean; quantityValue?: number | null; threshold?: number }>()
    .catch(() => ({}) as Record<string, never>)

  const listedRuleId = c.req.param('id')
  const now = nowSeconds()
  const edit: RuleEdit = {}

  if (body.enabled !== undefined) edit.enabled = body.enabled

  if (body.quantityValue !== undefined) {
    const value = Number(body.quantityValue)
    /*
     * The rules endpoint keeps a floor of 0 where the amounts endpoint uses 1:
     * a rule's stored quantity can legitimately be zero for a basis that does
     * not multiply. The CEILING is shared, so the two cannot drift apart again.
     */
    if (!Number.isFinite(value) || value < 0 || value > MAX_QUANTITY) {
      return c.json(apiError('bad_request', `Pick a number between 0 and ${MAX_QUANTITY}.`), 400)
    }
    edit.quantityValue = value
  }

  /*
   * The one number in a rule worth editing — the 5 in "any flight of at least
   * 5 hours".
   *
   * Rewritten from the parsed condition rather than by string substitution, and
   * refused outright when the rule has no single numeric comparison. A rule with
   * two of them has no unambiguous threshold, and quietly changing the first
   * would be worse than declining.
   */
  if (body.threshold !== undefined) {
    const value = readQuantity(body.threshold)
    if (value === null) {
      return c.json(apiError('bad_request', QUANTITY_RANGE_MESSAGE), 400)
    }

    const existing = await c.env.DB.prepare(
      'SELECT condition_json FROM packing_rule WHERE id = ?',
    )
      .bind(listedRuleId)
      .first<{ condition_json: string | null }>()

    const rewritten = writeThreshold(existing?.condition_json ?? null, value)
    if (rewritten === null) {
      return c.json(
        apiError('bad_request', 'This rule does not have a single number to change.'),
        400,
      )
    }

    edit.conditionJson = rewritten
  }

  const outcome = await editRule(c.env.DB, listedRuleId, edit, now)
  if (!outcome) return c.json(apiError('bad_request', 'No such rule.'), 404)

  const view = await ruleView(c.env.DB, outcome.row.id)
  if (!view) return c.json(apiError('bad_request', 'No such rule.'), 404)

  return c.json({ ...view, listedRuleId, updatedAt: now })
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
