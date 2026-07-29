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

describe('preferences are guarded, not free-form', () => {
  it('returns only the settings Alex can actually change', async () => {
    const response = await call('/api/settings/preferences')
    const body = (await response.json()) as { preferences: Array<{ key: string; multiplier: number }> }

    expect(body.preferences.map((p) => p.key)).toEqual(['contacts_basis', 'underwear_basis'])
    expect(body.preferences[0]?.multiplier).toBe(2)
  })

  it('saves a new amount', async () => {
    const response = await call('/api/settings/preferences/contacts_basis', {
      method: 'PUT',
      body: JSON.stringify({ multiplier: 3 }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(response.status).toBe(200)

    const stored = db.raw
      .prepare("SELECT value_json FROM preference WHERE key = 'contacts_basis'")
      .get() as { value_json: string }
    expect(JSON.parse(stored.value_json)).toEqual({ per: 'trip_day', multiplier: 3 })
  })

  it('refuses a key it does not recognise', async () => {
    const response = await call('/api/settings/preferences/anything_at_all', {
      method: 'PUT',
      body: JSON.stringify({ multiplier: 3 }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(response.status).toBe(400)
  })

  it('refuses a nonsensical amount', async () => {
    // NaN is absent here on purpose: JSON turns it into null, which the route
    // must reject as "no answer" rather than coerce to zero.
    for (const multiplier of [-1, 99, 1.5, null, 'two']) {
      const response = await call('/api/settings/preferences/contacts_basis', {
        method: 'PUT',
        body: JSON.stringify({ multiplier }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(response.status).toBe(400)
    }
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

    const body = (await response.json()) as { version: number; data: Record<string, unknown[]> }
    expect(body.version).toBe(1)
    expect(body.data.item).toHaveLength(1)
    expect(Object.keys(body.data)).toContain('checklist_entry')
  })
})
