import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { settingsRoutes } from '../../worker/routes/settings'
import { createTestDatabase, insertItem, insertRule, type TestDatabase } from './d1'

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

    const stored = db.raw
      .prepare('SELECT quantity_value FROM packing_rule WHERE id = ?')
      .get(rule) as { quantity_value: number }
    expect(stored.quantity_value).toBe(3)
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

    const stored = db.raw
      .prepare('SELECT quantity_value FROM packing_rule WHERE id = ?')
      .get(rule) as { quantity_value: number }
    expect(stored.quantity_value).toBe(multiplier)
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
    const stored = db.raw
      .prepare('SELECT quantity_value FROM packing_rule WHERE id = ?')
      .get(rule) as { quantity_value: number }
    expect(stored.quantity_value).toBe(2)
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

    const stored = db.raw
      .prepare('SELECT enabled, original_text FROM packing_rule WHERE id = ?')
      .get(rule) as { enabled: number; original_text: string }
    expect(stored.enabled).toBe(0)
    expect(stored.original_text).toBe('Days x 2')

    expect(amountsOf(await (await call('/api/settings/amounts')).json())).toHaveLength(0)
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

    const rows = db.raw
      .prepare('SELECT id, quantity_value FROM packing_rule WHERE item_id = ?')
      .all(contacts) as Array<{ id: string; quantity_value: number }>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: rule, quantity_value: 5 })
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

    const row = db.raw
      .prepare('SELECT enabled FROM packing_rule WHERE id = ?')
      .get(ruleId) as { enabled: number }
    expect(row.enabled).toBe(0)
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

    const row = db.raw
      .prepare('SELECT quantity_value, needs_review FROM packing_rule WHERE id = ?')
      .get(ruleId) as { quantity_value: number; needs_review: number }

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
