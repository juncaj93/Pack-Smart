import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { settingsRoutes } from '../../worker/routes/settings'
import { evaluate, type Condition } from '../../shared/rules'
import { createTestDatabase, effectiveRule, insertItem, insertRule, type TestDatabase } from './d1'

/**
 * Settings, driven through the real HTTP routes.
 *
 * These exercise the route handlers rather than the repositories, because the
 * thing worth proving is that the endpoints validate their input — a settings
 * screen that accepts a negative quantity would silently corrupt every future
 * trip. The session guard is mounted in index.ts and has its own tests, so the
 * sub-app is called directly here.
 */

let db: TestDatabase

async function call(path: string, init: RequestInit = {}) {
  // The sub-app is mounted at /api/settings in index.ts, so it sees paths
  // without that prefix.
  const local = path.replace('/api/settings', '')
  return settingsRoutes.request(
    new Request(`https://example.test${local}`, init),
    undefined,
    { DB: db.binding } as never,
  )
}

beforeEach(() => {
  // Migration 0005 already seeds the approved bases.
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

describe('your usual amounts are the rules themselves', () => {
  const json = { 'Content-Type': 'application/json' }

  function amountsOf(body: unknown) {
    return (body as { amounts: Array<{ ruleId: string; itemName: string; multiplier: number }> })
      .amounts
  }

  it('lists the per-day rules, not a parallel table of preferences', async () => {
    const contacts = insertItem(db, { displayName: 'Contacts', category: 'Vision' })
    insertRule(db, contacts, { ruleType: 'per_day', quantityValue: 2 })

    const passport = insertItem(db, { displayName: 'Passport', category: 'Documents' })
    insertRule(db, passport, { ruleType: 'fixed_per_trip', quantityValue: 1 })

    const amounts = amountsOf(await (await call('/api/settings/amounts')).json())

    expect(amounts.map((a) => a.itemName)).toEqual(['Contacts'])
    expect(amounts[0]?.multiplier).toBe(2)
  })

  /*
   * The bug this whole endpoint exists to fix.
   *
   * The old screen wrote to `preference`, which computeQuantity has never read.
   * Alex could set underwear to 4 per day and still be told to pack 2. The
   * assertion that matters is not that the API returns 200 — it is that the
   * number lands on the row the engine actually consults.
   */
  it('writes the number the packing engine reads', async () => {
    const contacts = insertItem(db, { displayName: 'Contacts', category: 'Vision' })
    const rule = insertRule(db, contacts, { ruleType: 'per_day', quantityValue: 2 })

    const response = await call(`/api/settings/amounts/${rule}`, {
      method: 'PUT',
      body: JSON.stringify({ multiplier: 3 }),
      headers: json,
    })
    expect(response.status).toBe(200)

    /*
     * The seeded rule is NOT the row that changed, and that is the second half
     * of the fix. Migration 0011 makes editing a default write a user-owned
     * copy that replaces it, so the number the engine reads is 3 while the
     * default is still 2 and still restorable.
     */
    expect(effectiveRule(db, rule).quantity_value).toBe(3)
    expect(effectiveRule(db, rule).source).toBe('user')

    const seeded = db.raw
      .prepare('SELECT quantity_value, source FROM packing_rule WHERE id = ?')
      .get(rule) as { quantity_value: number; source: string }
    expect(seeded).toMatchObject({ quantity_value: 2, source: 'system' })
  })

  /*
   * Alex's ruling, through the screen he would actually use.
   *
   * "Underwear, 2 per day" is seeded; typing 1 has to mean one per day. Before
   * migration 0011 a rule could not say which default it replaced, so asking
   * for fewer than a default was only expressible by turning the default off.
   */
  it('lets Alex ask for FEWER than the seeded default', async () => {
    const underwear = insertItem(db, { displayName: 'Underwear', category: 'Accessories & Undergarments' })
    const rule = insertRule(db, underwear, { ruleType: 'per_day', quantityValue: 2 })

    await call(`/api/settings/amounts/${rule}`, {
      method: 'PUT',
      body: JSON.stringify({ multiplier: 1 }),
      headers: json,
    })

    const amounts = amountsOf(await (await call('/api/settings/amounts')).json())
    // ONE amount on screen, not two. A default and its override are one row.
    expect(amounts).toHaveLength(1)
    expect(amounts[0]?.multiplier).toBe(1)
  })

  /*
   * The range, end to end, through the endpoint and into the column the engine
   * reads.
   *
   * The brief asked for 3, 12 and 99 to work and 100 to be refused, and it asked
   * because a setting that appears saved and is not read is the worst kind of
   * dead control. These go through the real route rather than calling
   * `readQuantity`, so a validator that agrees with itself but not with the API
   * still fails.
   */
  it.each([3, 12, 99])('accepts %i and stores it where the engine looks', async (multiplier) => {
    const contacts = insertItem(db, { displayName: `Contacts ${multiplier}`, category: 'Vision' })
    const rule = insertRule(db, contacts, { ruleType: 'per_day', quantityValue: 2 })

    const response = await call(`/api/settings/amounts/${rule}`, {
      method: 'PUT',
      body: JSON.stringify({ multiplier }),
      headers: json,
    })
    expect(response.status).toBe(200)

    expect(effectiveRule(db, rule).quantity_value).toBe(multiplier)
  })

  it.each([0, 100, -1, 2.5])('refuses %p and changes nothing', async (multiplier) => {
    const contacts = insertItem(db, { displayName: `Lenses ${multiplier}`, category: 'Vision' })
    const rule = insertRule(db, contacts, { ruleType: 'per_day', quantityValue: 2 })

    const response = await call(`/api/settings/amounts/${rule}`, {
      method: 'PUT',
      body: JSON.stringify({ multiplier }),
      headers: json,
    })
    expect(response.status).toBe(400)

    // Refusing is only half of it: the stored value must be untouched, not
    // clamped to something Alex did not ask for.
    expect(effectiveRule(db, rule).quantity_value).toBe(2)
    // And nothing was written at all — a refused edit must not leave a
    // user-owned copy behind saying the default has been changed.
    expect(effectiveRule(db, rule).source).toBe('system')
  })

  it('says the range it will accept, rather than just refusing', async () => {
    const contacts = insertItem(db, { displayName: 'Daily lenses', category: 'Vision' })
    const rule = insertRule(db, contacts, { ruleType: 'per_day', quantityValue: 2 })

    const response = await call(`/api/settings/amounts/${rule}`, {
      method: 'PUT',
      body: JSON.stringify({ multiplier: 100 }),
      headers: json,
    })
    const body = (await response.json()) as { message?: string; error?: { message?: string } }
    const message = body.message ?? body.error?.message ?? ''
    expect(message).toMatch(/1 and 99/)
  })

  it('adds an amount to something Alex owns', async () => {
    const socks = insertItem(db, { displayName: 'Wool socks', category: 'Accessories & Undergarments' })

    const response = await call('/api/settings/amounts', {
      method: 'POST',
      body: JSON.stringify({ itemId: socks, multiplier: 1 }),
      headers: json,
    })
    expect(response.status).toBe(201)

    const stored = db.raw
      .prepare('SELECT rule_type, quantity_value FROM packing_rule WHERE item_id = ?')
      .get(socks) as { rule_type: string; quantity_value: number }
    expect(stored).toMatchObject({ rule_type: 'per_day', quantity_value: 1 })
  })

  it('refuses an amount for something that is not in My Stuff', async () => {
    const response = await call('/api/settings/amounts', {
      method: 'POST',
      body: JSON.stringify({ itemId: 'nothing-like-this', multiplier: 2 }),
      headers: json,
    })
    expect(response.status).toBe(400)
  })

  /*
   * Two per-day rules on one item would both fire inside computeQuantity and the
   * larger would silently win, with nothing on screen able to explain why.
   */
  it('refuses a second amount for an item that already has one', async () => {
    const contacts = insertItem(db, { displayName: 'Contacts', category: 'Vision' })
    insertRule(db, contacts, { ruleType: 'per_day', quantityValue: 2 })

    const response = await call('/api/settings/amounts', {
      method: 'POST',
      body: JSON.stringify({ itemId: contacts, multiplier: 4 }),
      headers: json,
    })
    expect(response.status).toBe(409)
  })

  it('removes by switching the rule off, so nothing is lost', async () => {
    const contacts = insertItem(db, { displayName: 'Contacts', category: 'Vision' })
    const rule = insertRule(db, contacts, { ruleType: 'per_day', quantityValue: 2, originalText: 'Days x 2' })

    expect((await call(`/api/settings/amounts/${rule}`, { method: 'DELETE' })).status).toBe(200)

    // Nothing about the amount is in force any more...
    expect(effectiveRule(db, rule).enabled).toBe(0)
    expect(amountsOf(await (await call('/api/settings/amounts')).json())).toHaveLength(0)

    // ...and the seeded rule is untouched, wording and all. Switching a default
    // off is a decision recorded BESIDE it, never over it.
    const seeded = db.raw
      .prepare('SELECT enabled, original_text FROM packing_rule WHERE id = ?')
      .get(rule) as { enabled: number; original_text: string }
    expect(seeded.enabled).toBe(1)
    expect(seeded.original_text).toBe('Days x 2')
  })

  it('puts a removed amount back', async () => {
    const contacts = insertItem(db, { displayName: 'Contacts', category: 'Vision' })
    const rule = insertRule(db, contacts, { ruleType: 'per_day', quantityValue: 2 })

    await call(`/api/settings/amounts/${rule}`, { method: 'DELETE' })
    expect((await call(`/api/settings/amounts/${rule}/restore`, { method: 'POST' })).status).toBe(200)

    expect(amountsOf(await (await call('/api/settings/amounts')).json())).toHaveLength(1)
  })

  it('re-enables rather than duplicating when a removed amount is added again', async () => {
    const contacts = insertItem(db, { displayName: 'Contacts', category: 'Vision' })
    const rule = insertRule(db, contacts, { ruleType: 'per_day', quantityValue: 2 })
    await call(`/api/settings/amounts/${rule}`, { method: 'DELETE' })

    const response = await call('/api/settings/amounts', {
      method: 'POST',
      body: JSON.stringify({ itemId: contacts, multiplier: 5 }),
      headers: json,
    })
    expect(response.status).toBe(201)

    /*
     * One amount on screen, at the new number. There are two ROWS behind it —
     * the seeded default and the decision that replaces it — which is the
     * mechanism, not a duplicate: `computeQuantity` resolves the pair to one
     * rule, and the sheet lists what is in force.
     */
    const amounts = amountsOf(await (await call('/api/settings/amounts')).json())
    expect(amounts).toHaveLength(1)
    expect(amounts[0]?.multiplier).toBe(5)
    expect(effectiveRule(db, rule).enabled).toBe(1)
  })

  it('refuses a nonsensical amount', async () => {
    const contacts = insertItem(db, { displayName: 'Contacts', category: 'Vision' })
    const rule = insertRule(db, contacts, { ruleType: 'per_day', quantityValue: 2 })

    /*
     * NaN is absent here on purpose: JSON turns it into null, which the route
     * must reject as "no answer" rather than coerce to zero. Zero is rejected
     * too — "none per day" is a removal, and saying so is clearer than a
     * stepper that reads 0 while the item quietly leaves every list.
     *
     * `99` used to be in this list and is not any more: it was above the old
     * ceiling of 10 and is now the top of the legal range. `100` takes its place
     * so the boundary is still tested from the wrong side of it.
     */
    for (const multiplier of [-1, 0, 100, 1.5, null, 'two']) {
      const response = await call(`/api/settings/amounts/${rule}`, {
        method: 'PUT',
        body: JSON.stringify({ multiplier }),
        headers: json,
      })
      expect(response.status).toBe(400)
    }
  })

  it('reports an amount that is no longer there instead of failing silently', async () => {
    const response = await call('/api/settings/amounts/gone', {
      method: 'PUT',
      body: JSON.stringify({ multiplier: 2 }),
      headers: json,
    })
    expect(response.status).toBe(404)
  })
})

describe('packing rules can be read and turned off', () => {
  it('lists rules with the item they belong to, unparsed ones first', async () => {
    const ok = insertItem(db, { displayName: 'Passport', category: 'Documents' })
    insertRule(db, ok, { ruleType: 'conditional_include', condition: { fact: 'international', eq: true } })

    const odd = insertItem(db, { displayName: 'Mystery Gadget', category: 'Electronics' })
    const oddRule = insertRule(db, odd, { ruleType: 'fixed_per_trip', originalText: 'sometimes?' })
    db.raw.prepare('UPDATE packing_rule SET needs_review = 1 WHERE id = ?').run(oddRule)

    const response = await call('/api/settings/rules')
    const body = (await response.json()) as {
      rules: Array<{ itemName: string; needsReview: boolean }>
    }

    // The unparsed rule is first: it is not being applied, and burying it
    // alphabetically would hide that.
    expect(body.rules[0]?.itemName).toBe('Mystery Gadget')
    expect(body.rules[0]?.needsReview).toBe(true)
    expect(body.rules.map((r) => r.itemName)).toContain('Passport')
  })

  it('hides rules for archived items', async () => {
    const item = insertItem(db, { displayName: 'Retired Thing', archivedAt: 1 })
    insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 1 })

    const response = await call('/api/settings/rules')
    const body = (await response.json()) as { rules: Array<{ itemName: string }> }
    expect(body.rules.map((r) => r.itemName)).not.toContain('Retired Thing')
  })

  it('turns a rule off without deleting it', async () => {
    const item = insertItem(db, { displayName: 'Neck Pillow' })
    const ruleId = insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 1 })

    const response = await call(`/api/settings/rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(response.status).toBe(200)

    expect(effectiveRule(db, ruleId).enabled).toBe(0)

    // The default itself is preserved: turning one off is an explicit,
    // reversible decision recorded as a rule of its own.
    const seeded = db.raw
      .prepare('SELECT enabled, source FROM packing_rule WHERE id = ?')
      .get(ruleId) as { enabled: number; source: string }
    expect(seeded).toMatchObject({ enabled: 1, source: 'system' })
  })

  it('clears the review flag once the quantity is set by hand', async () => {
    const item = insertItem(db, { displayName: 'Odd Thing' })
    const ruleId = insertRule(db, item, { ruleType: 'per_day', quantityValue: null })
    db.raw.prepare('UPDATE packing_rule SET needs_review = 1 WHERE id = ?').run(ruleId)

    await call(`/api/settings/rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantityValue: 2 }),
      headers: { 'Content-Type': 'application/json' },
    })

    const row = effectiveRule(db, ruleId)
    expect(row.quantity_value).toBe(2)
    expect(row.needs_review).toBe(0)
  })

  it('refuses an absurd quantity', async () => {
    const item = insertItem(db, { displayName: 'Socks' })
    const ruleId = insertRule(db, item, { ruleType: 'per_day', quantityValue: 1 })

    const response = await call(`/api/settings/rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantityValue: -5 }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(response.status).toBe(400)
  })
})

describe('export', () => {
  it('returns every table as a downloadable file', async () => {
    insertItem(db, { displayName: 'Passport' })

    const response = await call('/api/settings/export')
    expect(response.headers.get('Content-Disposition')).toContain('pack-smart-backup.json')

    const body = (await response.json()) as {
      version: number
      data: Record<string, Array<Record<string, unknown>>>
    }
    expect(body.version).toBe(1)
    /*
     * By name, not by count. This asserted `toHaveLength(1)` on the assumption
     * that a migrated database holds no items — true until `0009_missing_items`
     * seeded five, at which point a test about the *export* started failing
     * because of something the export had got right. What matters here is that
     * the row inserted above comes back, and that every table is present.
     */
    expect((body.data.item ?? []).map((row) => row.display_name)).toContain('Passport')
    expect(Object.keys(body.data)).toContain('checklist_entry')
  })
})

describe('a resolved dependency is no longer flagged', () => {
  it('leaves only genuinely unresolvable rules in the review list', async () => {
    const shaver = insertItem(db, { displayName: 'Shaver', category: 'Grooming' })
    const charger = insertItem(db, { displayName: 'Shaver Charger', category: 'Electronics' })

    // Resolved: the item it depends on exists.
    insertRule(db, charger, { ruleType: 'dependency_include', dependsOnItemId: shaver })

    // Unresolvable: nothing to point at.
    const orphan = insertItem(db, { displayName: 'Mystery Charger', category: 'Electronics' })
    const orphanRule = insertRule(db, orphan, { ruleType: 'dependency_include' })
    db.raw.prepare('UPDATE packing_rule SET needs_review = 1 WHERE id = ?').run(orphanRule)

    const response = await call('/api/settings/rules')
    const body = (await response.json()) as {
      rules: Array<{ itemName: string; needsReview: boolean; dependsOnName: string | null }>
    }

    const resolved = body.rules.find((r) => r.itemName === 'Shaver Charger')!
    expect(resolved.needsReview).toBe(false)
    expect(resolved.dependsOnName).toBe('Shaver')

    // Only the broken one is surfaced, and it is first.
    expect(body.rules.filter((r) => r.needsReview).map((r) => r.itemName)).toEqual([
      'Mystery Charger',
    ])
    expect(body.rules[0]?.itemName).toBe('Mystery Charger')
  })
})


/**
 * Changing the one number in a rule.
 *
 * The case the brief names: *"Add a Neck Pillow when any flight is at least 5
 * hours"*, and Alex wants 6. The assertion that matters is not that the endpoint
 * returns 200 — it is that the stored condition is the one `evaluate` reads, so
 * a six-hour flight now packs it and a five-hour one does not.
 *
 * A rule that appears edited and is ignored by generation is the exact failure
 * doc 09 §18 calls out: "rules that appear saved but are not read".
 */
describe('the one number in a rule', () => {
  const json = { 'Content-Type': 'application/json' }

  function neckPillow(hours: number) {
    const item = insertItem(db, { displayName: 'Neck Pillow', category: 'Travel Gear' })
    return insertRule(db, item, {
      ruleType: 'conditional_include',
      quantityValue: 1,
      condition: { fact: 'flight_hours', gt: hours },
    })
  }

  /*
   * The condition the ENGINE will read, which since migration 0011 is not
   * necessarily the row that was patched: editing a seeded rule records the
   * change as a rule that replaces it, and reading the seeded row back would
   * report the number Alex just changed away from.
   */
  function storedCondition(ruleId: string) {
    return JSON.parse(effectiveRule(db, ruleId).condition_json!) as Record<string, unknown>
  }

  it('changes the threshold the engine will read', async () => {
    const rule = neckPillow(5)

    const response = await call(`/api/settings/rules/${rule}`, {
      method: 'PATCH',
      body: JSON.stringify({ threshold: 6 }),
      headers: json,
    })
    expect(response.status).toBe(200)
    expect(storedCondition(rule)).toEqual({ fact: 'flight_hours', gt: 6 })
  })

  it('and that changes which trips pack it', async () => {
    /*
     * The whole point, asserted through `evaluate` rather than by reading the
     * column back — the column agreeing with itself proves nothing about what
     * the packing engine does with it.
     */
    const rule = neckPillow(5)
    await call(`/api/settings/rules/${rule}`, {
      method: 'PATCH',
      body: JSON.stringify({ threshold: 6 }),
      headers: json,
    })

    const condition = storedCondition(rule) as unknown as Condition
    // A seven-hour flight still packs it; the five-and-a-half that used to no
    // longer does. That second one is the change Alex asked for.
    expect(evaluate(condition, { flight_hours: 7 })).toBe(true)
    expect(evaluate(condition, { flight_hours: 5.5 })).toBe(false)
  })

  it('refuses a rule that has no single number to change', async () => {
    const item = insertItem(db, { displayName: 'Passport', category: 'Documents' })
    const rule = insertRule(db, item, {
      ruleType: 'conditional_include',
      quantityValue: 1,
      condition: { fact: 'international', eq: true },
    })

    const response = await call(`/api/settings/rules/${rule}`, {
      method: 'PATCH',
      body: JSON.stringify({ threshold: 3 }),
      headers: json,
    })
    expect(response.status).toBe(400)
    // And it is untouched, rather than rewritten into something it never was.
    expect(storedCondition(rule)).toEqual({ fact: 'international', eq: true })
  })

  it('refuses a threshold outside the range, leaving the rule alone', async () => {
    const rule = neckPillow(5)

    for (const threshold of [0, 100, -1, 2.5]) {
      const response = await call(`/api/settings/rules/${rule}`, {
        method: 'PATCH',
        body: JSON.stringify({ threshold }),
        headers: json,
      })
      expect(response.status).toBe(400)
      expect(storedCondition(rule)).toEqual({ fact: 'flight_hours', gt: 5 })
    }
  })
})
