import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { generateChecklist, listChecklist, setQtyOverride } from '../../worker/repos/checklist'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { settingsRoutes } from '../../worker/routes/settings'
import { createTestDatabase, insertItem, insertRule, type TestDatabase } from './d1'

/**
 * Alex's two rulings, driven through the real endpoints and out the other side
 * onto a real packing list.
 *
 * The unit tests in `tests/unit/worker/rule-precedence.test.ts` prove the
 * arithmetic. This file proves the arithmetic is reachable: that the screen's
 * request stores what it claims to, that generation reads it back, and that the
 * number on the row is the number the ruling asks for. A rule that appears
 * saved and is not read by generation is doc 09 §18's first named failure, and
 * an engine test alone cannot see it.
 */

const TRIP: TripInput = {
  name: 'Ten days',
  startDate: '2026-07-01',
  endDate: '2026-07-10',
  destinations: [{ name: 'Lisbon', country: 'Portugal' }],
  activities: [],
  international: true,
  laundryAvailable: false,
}

const NOW = 1_800_000_000
const json = { 'Content-Type': 'application/json' }

let db: TestDatabase

async function call(path: string, init: RequestInit = {}) {
  return settingsRoutes.request(
    new Request(`https://example.test${path.replace('/api/settings', '')}`, init),
    undefined,
    { DB: db.binding } as never,
  )
}

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

/** Generates the trip's list and reads back what one item came out as. */
async function quantityFor(name: string): Promise<number | null> {
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, (await getTrip(db.binding, trip.id))!, NOW)
  const entry = (await listChecklist(db.binding, trip.id)).find((e) => e.name === name)
  return entry ? entry.requiredQty : null
}

interface RuleView {
  id: string
  itemName: string
  source: string
  enabled: boolean
  quantityValue: number | null
  canDelete: boolean
  overridesDefault: { id: string; quantityValue: number | null } | null
}

async function listedRules(): Promise<RuleView[]> {
  const body = (await (await call('/api/settings/rules')).json()) as { rules: RuleView[] }
  return body.rules
}

/*
 * Scoped to one item, because migration 0009 seeds rules of its own and these
 * are claims about a single item's rules — "one rule left" has to mean one rule
 * for THIS thing, not one rule in the database.
 */
async function rulesFor(itemName: string): Promise<RuleView[]> {
  return (await listedRules()).filter((r) => r.itemName === itemName)
}

/* ------------------------------------------------------------------ */

describe('a user rule may ask for fewer than a default', () => {
  function seededUnderwear() {
    const item = insertItem(db, {
      displayName: 'Underwear',
      category: 'Accessories & Undergarments',
    })
    return { item, rule: insertRule(db, item, { ruleType: 'per_day', quantityValue: 2 }) }
  }

  it('puts the lower number on the packing list', async () => {
    const { rule } = seededUnderwear()
    expect(await quantityFor('Underwear')).toBe(20)

    await call(`/api/settings/amounts/${rule}`, {
      method: 'PUT',
      body: JSON.stringify({ multiplier: 1 }),
      headers: json,
    })

    // Ten, not twenty, and not "twenty because the larger wins". Deliberately
    // lower than the default: that is the case that was impossible to express.
    expect(await quantityFor('Underwear')).toBe(10)
  })

  it('restores the default exactly when the override is removed', async () => {
    const { rule } = seededUnderwear()
    await call(`/api/settings/amounts/${rule}`, {
      method: 'PUT',
      body: JSON.stringify({ multiplier: 1 }),
      headers: json,
    })

    const [row] = await rulesFor('Underwear')
    expect(row?.overridesDefault?.quantityValue).toBe(2)

    const response = await call(`/api/settings/rules/${row!.id}/restore`, { method: 'POST' })
    expect(response.status).toBe(200)

    expect(await quantityFor('Underwear')).toBe(20)

    // And the override is gone rather than merely disabled: one rule for the
    // item again, the one that came with Pack Smart.
    const after = await rulesFor('Underwear')
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: rule, source: 'system', overridesDefault: null })
  })

  it('does NOT reduce the default when an unrelated rule is created', async () => {
    /*
     * The failure Alex named. The new rule asks for a SMALLER number than the
     * default and is about a different thing entirely — a naive "the user wins"
     * precedence would read it as "he wants one" and cut the list in half.
     */
    const { item, rule } = seededUnderwear()

    const response = await call('/api/settings/rules', {
      method: 'POST',
      body: JSON.stringify({ itemId: item, ruleType: 'minimum', quantityValue: 1 }),
      headers: json,
    })
    expect(response.status).toBe(201)

    expect(await quantityFor('Underwear')).toBe(20)

    // Two rules on screen, both in force, neither replacing the other.
    const rules = await rulesFor('Underwear')
    expect(rules).toHaveLength(2)
    expect(rules.every((r) => r.overridesDefault === null)).toBe(true)
    expect(rules.find((r) => r.id === rule)?.source).toBe('system')
  })

  it('lets an unrelated user rule RAISE the default, which is what combining means', async () => {
    const { item } = seededUnderwear()
    await call('/api/settings/rules', {
      method: 'POST',
      body: JSON.stringify({ itemId: item, ruleType: 'minimum', quantityValue: 25 }),
      headers: json,
    })
    expect(await quantityFor('Underwear')).toBe(25)
  })

  it('tells system and user rules apart on the way to the screen', async () => {
    const { item } = seededUnderwear()
    await call('/api/settings/rules', {
      method: 'POST',
      body: JSON.stringify({ itemId: item, ruleType: 'spare', quantityValue: 2 }),
      headers: json,
    })

    const rules = await rulesFor('Underwear')
    expect(rules.map((r) => r.source).sort()).toEqual(['system', 'user'])
    // And only the one Alex wrote offers to be deleted.
    expect(rules.filter((r) => r.canDelete)).toHaveLength(1)
  })
})

describe('turning a default off is a decision, not an erasure', () => {
  it('stops packing the item and can be undone exactly', async () => {
    const item = insertItem(db, { displayName: 'Travel Iron', category: 'Travel Gear' })
    const rule = insertRule(db, item, {
      ruleType: 'fixed_per_trip',
      quantityValue: 1,
      originalText: 'Always packed.',
    })

    await call(`/api/settings/rules/${rule}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
      headers: json,
    })
    expect(await quantityFor('Travel Iron')).toBeNull()

    const [row] = await rulesFor('Travel Iron')
    expect(row).toMatchObject({ enabled: false, source: 'user' })
    expect(row?.overridesDefault?.id).toBe(rule)

    await call(`/api/settings/rules/${row!.id}/restore`, { method: 'POST' })
    expect(await quantityFor('Travel Iron')).toBe(1)

    // The spreadsheet wording survived the whole round trip, because the row
    // holding it was never written to.
    const seeded = db.raw
      .prepare('SELECT original_text FROM packing_rule WHERE id = ?')
      .get(rule) as { original_text: string }
    expect(seeded.original_text).toBe('Always packed.')
  })

  it('is not "changed" after being turned off and straight back on', async () => {
    /*
     * The interface reads the RELATIONSHIP — a rule that supersedes a default is
     * shown as changed from it — so an override edited back into agreement with
     * its default would label an untouched rule as changed and offer to restore
     * it to itself. `editRule` drops an override that has stopped overriding
     * anything, which makes off-then-on a true round trip.
     */
    const item = insertItem(db, { displayName: 'Travel Iron', category: 'Travel Gear' })
    const rule = insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 1 })

    for (const enabled of [false, true]) {
      const [row] = await rulesFor('Travel Iron')
      await call(`/api/settings/rules/${row!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
        headers: json,
      })
    }

    const [after] = await rulesFor('Travel Iron')
    expect(after).toMatchObject({ id: rule, source: 'system', overridesDefault: null })

    const rows = db.raw
      .prepare('SELECT id FROM packing_rule WHERE item_id = ?')
      .all(item) as Array<{ id: string }>
    expect(rows).toHaveLength(1)
  })

  it('writes nothing at all for an edit that changes nothing', async () => {
    const item = insertItem(db, { displayName: 'Travel Iron', category: 'Travel Gear' })
    const rule = insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 1 })

    // Already on. Minting an override here would have the row announce a change
    // Alex never made.
    await call(`/api/settings/rules/${rule}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true }),
      headers: json,
    })

    expect(await rulesFor('Travel Iron')).toEqual([
      expect.objectContaining({ id: rule, source: 'system', overridesDefault: null }),
    ])
  })

  it('turns back on without needing the default restored', async () => {
    const item = insertItem(db, { displayName: 'Travel Iron', category: 'Travel Gear' })
    const rule = insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 1 })

    await call(`/api/settings/rules/${rule}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
      headers: json,
    })
    const [off] = await rulesFor('Travel Iron')

    await call(`/api/settings/rules/${off!.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true }),
      headers: json,
    })
    expect(await quantityFor('Travel Iron')).toBe(1)
  })
})

describe('deletion, where it is safe', () => {
  it('deletes a rule Alex wrote', async () => {
    const item = insertItem(db, { displayName: 'Socks', category: 'Accessories & Undergarments' })
    const created = (await (
      await call('/api/settings/rules', {
        method: 'POST',
        body: JSON.stringify({ itemId: item, ruleType: 'fixed_per_trip', quantityValue: 4 }),
        headers: json,
      })
    ).json()) as RuleView

    expect(await quantityFor('Socks')).toBe(4)

    expect((await call(`/api/settings/rules/${created.id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await quantityFor('Socks')).toBeNull()
    expect(await rulesFor('Socks')).toHaveLength(0)
  })

  it('refuses to delete a default, and says what to do instead', async () => {
    const item = insertItem(db, { displayName: 'Passport', category: 'Documents' })
    const rule = insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 1 })

    const response = await call(`/api/settings/rules/${rule}`, { method: 'DELETE' })
    expect(response.status).toBe(409)

    const body = (await response.json()) as { message?: string; error?: { message?: string } }
    expect(body.message ?? body.error?.message ?? '').toMatch(/turn it off/i)

    // And it is still there, still packing.
    expect(await quantityFor('Passport')).toBe(1)
  })

  it('refuses to delete an override, because that is what Use the default is for', async () => {
    const item = insertItem(db, { displayName: 'Passport', category: 'Documents' })
    const rule = insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 1 })

    await call(`/api/settings/rules/${rule}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantityValue: 2 }),
      headers: json,
    })
    const [override] = await rulesFor('Passport')

    expect((await call(`/api/settings/rules/${override!.id}`, { method: 'DELETE' })).status).toBe(409)
  })

  it('refuses a second rule of the same kind for one item', async () => {
    const item = insertItem(db, { displayName: 'Socks', category: 'Accessories & Undergarments' })
    const body = JSON.stringify({ itemId: item, ruleType: 'minimum', quantityValue: 3 })

    expect((await call('/api/settings/rules', { method: 'POST', body, headers: json })).status).toBe(201)
    expect((await call('/api/settings/rules', { method: 'POST', body, headers: json })).status).toBe(409)
  })

  it('refuses a kind of rule that cannot be written here', async () => {
    // `conditional_include` needs a condition, and doc 09 §18 rules out a
    // builder for one. Accepting the type and storing no condition would create
    // a rule that gates on nothing.
    const item = insertItem(db, { displayName: 'Socks' })
    const response = await call('/api/settings/rules', {
      method: 'POST',
      body: JSON.stringify({ itemId: item, ruleType: 'conditional_include', quantityValue: 1 }),
      headers: json,
    })
    expect(response.status).toBe(400)
  })
})

/* ------------------------------------------------------------------ */

describe('`fixed_per_trip` is a floor, on a real list', () => {
  function tenDayPair(order: 'fixed_first' | 'per_day_first') {
    const item = insertItem(db, { displayName: 'Shirts', category: 'Tops & Outerwear' })
    const fixed = () => insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 3 })
    const perDay = () => insertRule(db, item, { ruleType: 'per_day', quantityValue: 2 })

    // Insert order IS row order for `SELECT * FROM packing_rule` here, which is
    // exactly the thing that must stop mattering.
    if (order === 'fixed_first') {
      fixed()
      perDay()
    } else {
      perDay()
      fixed()
    }
  }

  it.each(['fixed_first', 'per_day_first'] as const)(
    'gives 20 on a ten-day trip whichever row comes first (%s)',
    async (order) => {
      tenDayPair(order)
      expect(await quantityFor('Shirts')).toBe(20)
    },
  )
})

describe('a corrected engine does not rewrite a list Alex has already touched', () => {
  /*
   * The other half of Alex's second ruling, and the one that is easy to get
   * wrong: making the engine deterministic must not reach backwards into a trip
   * that is already planned. A hand-set quantity is an explicit trip-level
   * decision and sits above every rule in the order of authority.
   */
  it('leaves a hand-set quantity alone through regeneration', async () => {
    const item = insertItem(db, { displayName: 'Shirts', category: 'Tops & Outerwear' })
    insertRule(db, item, { ruleType: 'per_day', quantityValue: 2 })

    const trip = await createTrip(db.binding, TRIP, NOW)
    const stored = (await getTrip(db.binding, trip.id))!
    await generateChecklist(db.binding, stored, NOW)

    const entry = (await listChecklist(db.binding, trip.id)).find((e) => e.name === 'Shirts')!
    await setQtyOverride(db.binding, entry.id, 6, NOW)

    // A rule appears that would have raised the number, and the list is
    // regenerated. The number Alex typed still wins.
    insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 30 })
    const result = await generateChecklist(db.binding, stored, NOW)

    const after = (await listChecklist(db.binding, trip.id)).find((e) => e.name === 'Shirts')!
    expect(after.requiredQty).toBe(6)
    expect(result.preserved).toBeGreaterThan(0)
  })

  it('does apply the corrected arithmetic to a newly generated list', async () => {
    // The same pair on a trip planned after the change: 20, not 30-overwrites-20
    // and not 3-overwrites-20.
    const item = insertItem(db, { displayName: 'Shirts', category: 'Tops & Outerwear' })
    insertRule(db, item, { ruleType: 'per_day', quantityValue: 2 })
    insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 3 })

    expect(await quantityFor('Shirts')).toBe(20)
  })

  it('applies it again when the list is explicitly regenerated', async () => {
    const item = insertItem(db, { displayName: 'Shirts', category: 'Tops & Outerwear' })
    insertRule(db, item, { ruleType: 'per_day', quantityValue: 2 })

    const trip = await createTrip(db.binding, TRIP, NOW)
    const stored = (await getTrip(db.binding, trip.id))!
    await generateChecklist(db.binding, stored, NOW)

    insertRule(db, item, { ruleType: 'fixed_per_trip', quantityValue: 30 })
    await generateChecklist(db.binding, stored, NOW)

    // Untouched rows follow the rules, so the floor raises the number here —
    // and this is the row that would have been left at 20 by a fix that only
    // applied to new trips.
    const after = (await listChecklist(db.binding, trip.id)).find((e) => e.name === 'Shirts')!
    expect(after.requiredQty).toBe(30)
  })
})
