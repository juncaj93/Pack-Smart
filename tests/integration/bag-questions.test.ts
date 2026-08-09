import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReviewQueue } from '@shared/closet-review'
import { NO_TRAITS, RESILIENCE_CAP, bagContext, planBags, resilienceSet } from '@shared/bags'
import type { TripInput } from '@shared/trips'
import { closetReviewRoutes } from '../../worker/routes/closet-review'
import { itemRoutes } from '../../worker/routes/items'
import { generateChecklist, listChecklist, setBag } from '../../worker/repos/checklist'
import { getItem } from '../../worker/repos/items'
import { liveTrips } from '../../worker/repos/closet-review'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { createTestDatabase, insertItem, insertRule, migrationFiles, type TestDatabase } from './d1'

/**
 * Bag questions, through the real endpoints and the real tables (P3b).
 *
 * `tests/unit/worker/bag-questions.test.ts` proves WHICH question is worth
 * asking, over plain values. This file proves the three things that cannot be
 * tested that way:
 *
 * 1. the trips the gate reasons about really are the ones Alex has ahead of
 *    him, read off the `trip` table rather than handed in by a fixture;
 * 2. an answer reaches the column, and `null` reaches it too — because *I was
 *    wrong about that* has to be expressible or the question is a trap;
 * 3. the answer changes the plan, which is the entire justification for having
 *    asked. A question whose answer moves nothing is the failure this feature is
 *    most likely to ship as, and it would look completely normal.
 */

const NOW = 1_780_000_000
const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** Far enough out that the trip is live whenever this test is run. */
function futureTrip(overrides: Partial<TripInput> = {}): TripInput {
  const start = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  const end = new Date(Date.now() + 35 * 86_400_000).toISOString().slice(0, 10)
  return {
    name: 'Lisbon',
    startDate: start,
    endDate: end,
    destinations: [{ name: 'Lisbon' }],
    activities: ['sightseeing'],
    flightHours: 3,
    bags: ['personal_item', 'carry_on', 'checked'],
    ...overrides,
  }
}

let db: TestDatabase

/**
 * A packing list built here rather than borrowed from `seedWardrobe`.
 *
 * The shared wardrobe reaches a checklist through the outfit planner, so what
 * lands on the list depends on how the ranker felt about a dozen garments — and
 * a delayed-bag assertion that quietly stops testing anything because the
 * planner picked a different shirt is worse than no assertion. Every row here is
 * `always_include`, so the list is exactly this and nothing else.
 *
 * The four names are the four the resilience rules look for. That is the point:
 * the automatic set has to be non-empty before a test can prove an answer
 * changes it.
 */
const LIST: Array<{ id: string; displayName: string; category: string; kind?: string }> = [
  { id: 'underwear', displayName: 'Boxer briefs', category: 'Accessories & Undergarments', kind: 'clothing' },
  { id: 'socks', displayName: 'Wool socks', category: 'Accessories & Undergarments', kind: 'clothing' },
  { id: 'tee', displayName: 'Grey t-shirt', category: 'Tops & Outerwear', kind: 'clothing' },
  { id: 'trousers', displayName: 'Linen trousers', category: 'Bottoms & Swimwear', kind: 'clothing' },
  // Nothing in the resilience rules matches a jacket, which is what makes it
  // the honest subject of "something no rule would have picked".
  { id: 'jacket', displayName: 'Rain jacket', category: 'Tops & Outerwear', kind: 'clothing' },
]

/**
 * One row on the list, with the rule that puts it there.
 *
 * `always_include` alone is not enough and the reason is worth stating:
 * `generateChecklist` asks `computeQuantity` how many, and with no rule at all
 * the answer is `null` — *the engine says no* — so the row is never written.
 * A fixed quantity of one is the smallest rule that makes an item genuinely
 * packable, which is what these tests need it to be.
 */
function onTheList(row: { id: string; displayName: string; category: string; kind?: string }) {
  insertItem(db, { ...row, alwaysInclude: true })
  insertRule(db, row.id, { ruleType: 'fixed_per_trip', quantityValue: 1 })
}

beforeEach(() => {
  db = createTestDatabase()
  for (const row of LIST) onTheList(row)
})
afterEach(() => {
  db.close()
})

function review(path: string, init: RequestInit = {}) {
  return closetReviewRoutes.request(
    new Request(`https://example.test${path.replace('/api/closet-review', '') || '/'}`, init),
    undefined,
    { DB: db.binding } as never,
  )
}

function items(path: string, init: RequestInit = {}) {
  return itemRoutes.request(
    new Request(`https://example.test${path.replace('/api/items', '')}`, init),
    undefined,
    { DB: db.binding } as never,
  )
}

async function queue(): Promise<ReviewQueue> {
  return (await (await review('/api/closet-review')).json()) as ReviewQueue
}

/** A full-size-liquid candidate: a toiletry with nothing recorded about it. */
function shampoo(id = 'shampoo') {
  onTheList({ id, displayName: 'Shampoo', category: 'Toiletries', kind: 'gear' })
  return id
}

async function plannedTrip(overrides: Partial<TripInput> = {}) {
  const created = await createTrip(db.binding, futureTrip(overrides), NOW)
  const trip = (await getTrip(db.binding, created.id))!
  await generateChecklist(db.binding, trip, NOW)
  return trip
}

function traits(id: string, body: Record<string, unknown>) {
  return items(`/api/items/${id}/traits`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
}

/* ------------------------------------------------------------------ */

describe('migration 0026 is additive', () => {
  it('is applied by the normal migration run', () => {
    expect(migrationFiles()).toContain('0026_delay_sensitivity.sql')
  })

  it('leaves every existing row unrecorded rather than not-delay-sensitive', () => {
    /*
     * The distinction the whole schema turns on. A migration that defaulted
     * this to 0 would have silently answered the question for 119 garments,
     * and the queue would then never ask — a feature disabled by its own
     * migration, with nothing visibly wrong.
     */
    const rows = db.raw
      .prepare('SELECT COUNT(*) AS n FROM item WHERE is_delay_sensitive IS NOT NULL')
      .get() as { n: number }
    expect(rows.n).toBe(0)
  })
})

/* ------------------------------------------------------------------ */

describe('the trips the gate reasons about', () => {
  it('reads a trip that has not happened yet, with its list and its bags', async () => {
    const trip = await plannedTrip()
    const live = await liveTrips(db.binding, new Date().toISOString().slice(0, 10))

    expect(live.map((t) => t.tripId)).toEqual([trip.id])
    expect(live[0]!.context.bags).toEqual(['personal_item', 'carry_on', 'checked'])
    expect(live[0]!.context.flying).toBe(true)
    expect(live[0]!.entries.length).toBeGreaterThan(0)
  })

  it('does not read a trip that is over', async () => {
    await createTrip(
      db.binding,
      futureTrip({ name: 'Last year', startDate: '2024-03-01', endDate: '2024-03-05' }),
      NOW,
    )
    expect(await liveTrips(db.binding, new Date().toISOString().slice(0, 10))).toEqual([])
  })

  it('carries the bag traits onto the entries it returns', async () => {
    const id = shampoo()
    await plannedTrip()
    await traits(id, { liquid: true, liquidSize: 'full' })

    const live = await liveTrips(db.binding, new Date().toISOString().slice(0, 10))
    const row = live[0]!.entries.find((e) => e.itemId === id)
    expect(row?.traits?.liquid).toBe(true)
    expect(row?.traits?.liquidSize).toBe('full')
  })
})

/* ------------------------------------------------------------------ */

describe('the queue asks, and stops asking', () => {
  it('asks nothing about the closet when no trip is ahead', async () => {
    shampoo()
    const cards = (await queue()).cards.filter((c) => c.bagQuestions.length > 0)
    expect(cards).toEqual([])
  })

  it('asks about the bottle once a flight is planned, and names the trip', async () => {
    const id = shampoo()
    await plannedTrip()

    const card = (await queue()).cards.find((c) => c.item.id === id)
    expect(card?.bagQuestions.map((q) => q.key)).toContain('liquid')
    expect(card?.reason).toBe('bag_question')
    expect(card?.why).toContain('Lisbon')
  })

  it('puts the bag question at the very front of the queue', async () => {
    shampoo()
    await plannedTrip()
    // Ahead of ~119 unrated seeded garments, because its value is proven
    // rather than assumed.
    expect((await queue()).cards[0]?.reason).toBe('bag_question')
  })

  it('stops asking the moment the answer is recorded', async () => {
    const id = shampoo()
    await plannedTrip()

    await traits(id, { liquid: true, liquidSize: 'full' })

    const card = (await queue()).cards.find((c) => c.item.id === id)
    expect(card?.bagQuestions.map((q) => q.key) ?? []).not.toContain('liquid')
  })

  it('honours *Not sure* without answering the question for him', async () => {
    const id = shampoo()
    await plannedTrip()

    await review('/api/closet-review/decisions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ itemId: id, topic: 'bag:liquid', decision: 'not_sure' }),
    })

    const card = (await queue()).cards.find((c) => c.item.id === id)
    expect(card?.bagQuestions.map((q) => q.key) ?? []).not.toContain('liquid')
    // Withdrawn, not decided. The column is still unrecorded, so no rule may
    // act on it — which is the difference between "not sure" and "no".
    expect((await getItem(db.binding, id))!.isLiquid).toBeNull()
  })
})

/* ------------------------------------------------------------------ */

describe('recording an answer', () => {
  it('writes what was answered and nothing else', async () => {
    const id = shampoo()
    await traits(id, { liquid: true, liquidSize: 'cabin' })
    await traits(id, { fragile: true })

    const stored = (await getItem(db.binding, id))!
    expect(stored.isLiquid).toBe(true)
    expect(stored.liquidSize).toBe('cabin')
    expect(stored.isFragile).toBe(true)
    // Never touched, and still unknown rather than false.
    expect(stored.isBulky).toBeNull()
    expect(stored.isValuable).toBeNull()
  })

  it('takes an answer back to unrecorded, rather than to no', async () => {
    const id = shampoo()
    await traits(id, { fragile: true })
    await traits(id, { fragile: null })
    expect((await getItem(db.binding, id))!.isFragile).toBeNull()
  })

  it('refuses a value it does not understand', async () => {
    const id = shampoo()
    expect((await traits(id, { liquidSize: 'enormous' })).status).toBe(400)
    expect((await traits(id, { bulky: 'yes' })).status).toBe(400)
    expect((await traits(id, { category: 'Toiletries' })).status).toBe(400)
    expect((await getItem(db.binding, id))!.liquidSize).toBeNull()
  })

  it('does not touch the row when there is nothing to change', async () => {
    const id = shampoo()
    expect((await traits(id, {})).status).toBe(400)
  })

  it('leaves a recorded answer alone when the whole row is saved from the editor', async () => {
    /*
     * `PUT /api/items/:id` rebuilds a row from the editor's fields, and the
     * editor has never heard of a bag trait. It must therefore leave them
     * where they are — a screen that does not show a value has no business
     * clearing it, which is the defect H1a removed from the importer.
     */
    const id = shampoo()
    await traits(id, { liquid: true, liquidSize: 'full' })

    await items(`/api/items/${id}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        displayName: 'Shampoo',
        category: 'Toiletries',
        usageFrequency: 'frequent',
      }),
    })

    const stored = (await getItem(db.binding, id))!
    expect(stored.isLiquid).toBe(true)
    expect(stored.liquidSize).toBe('full')
  })
})

/* ------------------------------------------------------------------ */

describe('the answer actually changes the plan', () => {
  /*
   * The section that justifies the whole feature.
   *
   * A gate that asks beautifully-worded questions whose answers move nothing
   * would pass every test above and be worthless — and it would look completely
   * normal, because the queue would still empty and the columns would still
   * fill. These assert the other end: that answering moves a real row on a real
   * trip's real plan.
   */

  it('sends a full-size bottle to the hold and a travel-size one to the cabin', async () => {
    const id = shampoo()
    const trip = await plannedTrip()

    await traits(id, { liquid: true, liquidSize: 'full' })
    let entries = await listChecklist(db.binding, trip.id)
    let row = entries.find((e) => e.itemId === id)!
    expect(planBags(trip, entries).advice.get(row.id)?.bag).toBe('checked')

    await traits(id, { liquid: true, liquidSize: 'cabin' })
    entries = await listChecklist(db.binding, trip.id)
    row = entries.find((e) => e.itemId === id)!
    expect(planBags(trip, entries).advice.get(row.id)?.bag).toBe('carry_on')
  })

  it('never lets an answer move something Alex placed himself', async () => {
    const id = shampoo()
    const trip = await plannedTrip()
    const before = (await listChecklist(db.binding, trip.id)).find((e) => e.itemId === id)!
    // `setBag` stamps `bag_source = 'user'` itself — it is the door Alex's own
    // choice comes through, and there is no other kind of caller.
    await setBag(db.binding, before.id, 'personal_item', NOW)

    await traits(id, { liquid: true, liquidSize: 'full' })

    const entries = await listChecklist(db.binding, trip.id)
    const plan = planBags(trip, entries)
    const row = entries.find((e) => e.itemId === id)!
    expect(plan.advice.get(row.id)?.bag).toBe('personal_item')
    expect(plan.advice.get(row.id)?.source).toBe('user')
  })

  it('drops something from the delayed-bag set when he says he would not miss it', async () => {
    const trip = await plannedTrip()
    const entries = await listChecklist(db.binding, trip.id)
    const context = bagContext(trip)

    const protectedIds = resilienceSet(entries, context)
    expect(protectedIds.size).toBeGreaterThan(0)

    const first = entries.find((e) => protectedIds.has(e.id))!
    await traits(first.itemId!, { delaySensitive: false })

    const after = resilienceSet(await listChecklist(db.binding, trip.id), context)
    expect(after.has(first.id)).toBe(false)
  })

  it('pulls something into the delayed-bag set that no rule would have picked', async () => {
    const trip = await plannedTrip()
    const before = await listChecklist(db.binding, trip.id)
    const ruled = resilienceSet(before, bagContext(trip))

    const jacket = before.find((e) => e.itemId === 'jacket')!
    expect(ruled.has(jacket.id)).toBe(false)

    await traits('jacket', { delaySensitive: true })

    const plan = planBags(trip, await listChecklist(db.binding, trip.id))
    expect(plan.resilience.has(jacket.id)).toBe(true)
    expect(plan.advice.get(jacket.id)?.why).toContain('checked bag is delayed')
  })

  it('keeps the delayed-bag set small however many yeses it is given', async () => {
    /*
     * Comfortably MORE rows than the cap allows, and that is the whole test.
     *
     * With the five-row list this file starts from, an unbounded set would
     * still come out under the cap — so the assertion would pass with the cap
     * deleted, which makes it decoration. Twenty spares is the difference
     * between proving a bound and describing one.
     */
    const spares = Array.from({ length: 20 }, (_, i) => `spare-${i}`)
    for (const id of spares) {
      onTheList({ id, displayName: `Spare ${id}`, category: 'Tops & Outerwear', kind: 'clothing' })
    }

    const trip = await plannedTrip()
    for (const id of spares) await traits(id, { delaySensitive: true })
    for (const row of LIST) await traits(row.id, { delaySensitive: true })

    const after = resilienceSet(await listChecklist(db.binding, trip.id), bagContext(trip))
    expect(spares.length).toBeGreaterThan(RESILIENCE_CAP)
    // Bounded. A cabin bag stuffed with contingency is its own bad advice, and
    // "his answer outranks the guess" was never a licence for an unbounded set.
    expect(after.size).toBeLessThanOrEqual(RESILIENCE_CAP)
  })

  it('protects nothing on a trip with no checked bag', async () => {
    const trip = await plannedTrip({ bags: ['personal_item', 'carry_on'] })
    const entries = await listChecklist(db.binding, trip.id)
    expect(planBags(trip, entries).resilience.size).toBe(0)
  })

  it('protects nothing on a drive, however much is being checked', async () => {
    const trip = await plannedTrip({ flightHours: null })
    const entries = await listChecklist(db.binding, trip.id)
    expect(planBags(trip, entries).resilience.size).toBe(0)
  })
})

/* ------------------------------------------------------------------ */

describe('unknown stays unknown', () => {
  it('never reads an unanswered trait as a negative one', async () => {
    const id = shampoo()
    const trip = await plannedTrip()
    const entries = await listChecklist(db.binding, trip.id)
    const row = entries.find((e) => e.itemId === id)!

    expect(row.traits).toEqual(NO_TRAITS)
    // Not "this is not a liquid" — nothing at all, which is why the question
    // exists in the first place.
    expect(planBags(trip, entries).advice.get(row.id)?.bag).toBeNull()
  })
})
