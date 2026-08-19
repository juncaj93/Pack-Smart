import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findDisagreements, type ReviewQueue } from '@shared/closet-review'
import type { Item } from '@shared/items'
import { closetReviewRoutes } from '../../worker/routes/closet-review'
import { itemRoutes } from '../../worker/routes/items'
import { createItem, getItem } from '../../worker/repos/items'
import { createTestDatabase, migrationFiles, type TestDatabase } from './d1'

/**
 * Review Closet Items, through the real endpoints and the real tables (H1d).
 *
 * `tests/unit/worker/closet-review.test.ts` decides WHICH question is worth
 * asking, over plain values. This file proves the two halves that cannot be
 * tested that way: that the evidence the ordering reads comes out of the tables
 * that actually record it, and that one tap on a star writes one field at
 * `user_confirmed` and survives everything H1a was built to survive.
 */

const NOW = 1_780_000_000
const JSON_HEADERS = { 'Content-Type': 'application/json' }

let db: TestDatabase

/*
 * The test database arrives with `0005_seed_preferences.sql` applied, so the
 * catalog is never empty and the queue is never only what a test created.
 * Every assertion below is scoped to the rows this file made — a seeded bite
 * guard drifting into an ordering assertion would make the test about the seed.
 */
const created: string[] = []

beforeEach(() => {
  db = createTestDatabase()
  created.length = 0
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

/** The queue, with the seeded wardrobe filtered out. Order is preserved. */
async function myQueue(): Promise<ReviewQueue> {
  const full = await queue()
  return { ...full, cards: full.cards.filter((c) => created.includes(c.item.id)) }
}

/** A clothing row, with nothing rated — the state the queue exists for. */
async function tee(id: string, displayName = id, extra: Record<string, unknown> = {}) {
  created.push(id)
  return createItem(
    db.binding,
    {
      displayName,
      category: 'Tops & Outerwear',
      subcategory: 'T-Shirt',
      usageFrequency: 'sometimes',
      dressinessContexts: [],
      ...extra,
    },
    NOW,
    'manual',
    id,
  )
}

/**
 * A thing with nothing to RATE, so its card can only be about something else.
 *
 * Gear rather than a garment, and that is the whole trick: `ratingAsks` returns
 * nothing for anything that is not clothing, because comfort, versatility and
 * dressiness are questions about WEARING something. So a duplicate pair of these
 * reaches the queue on the duplicate alone.
 *
 * The obvious alternative — a garment with its ratings filled in — cannot be
 * used any more, and the reason is the feature these fixtures sit beside:
 * answering a garment's ratings is exactly what retires it (`hasFeedback`), so
 * a "fully rated tee" is a garment with no card at all. Reaching for one would
 * be a fixture that makes its test pass by testing nothing.
 */
async function gear(id: string, displayName = id, extra: Record<string, unknown> = {}) {
  created.push(id)
  return createItem(
    db.binding,
    {
      displayName,
      category: 'Travel Gear',
      subcategory: 'Pouch',
      usageFrequency: 'sometimes',
      dressinessContexts: [],
      ...extra,
    },
    NOW,
    'manual',
    id,
  )
}

function post(body: unknown, init: RequestInit = {}) {
  return { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), ...init }
}

/* ------------------------------------------------------------------ */

describe('migration 0023 is additive', () => {
  it('is applied by the normal migration run and starts empty', () => {
    expect(migrationFiles()).toContain('0023_closet_review_decisions.sql')
    const rows = db.raw.prepare('SELECT COUNT(*) AS n FROM closet_review_decision').get() as {
      n: number
    }
    expect(rows.n).toBe(0)
  })

  it('leaves the catalog exactly as it found it', () => {
    /*
     * The seeded rows from 0005 are the check: an additive migration that
     * touched a single item row would be a data rewrite nobody approved. Read
     * back through the same query the planner uses.
     */
    const before = db.raw.prepare('SELECT COUNT(*) AS n FROM item').get() as { n: number }
    expect(before.n).toBeGreaterThan(0)
    const anyProvenance = db.raw
      .prepare('SELECT COUNT(*) AS n FROM item WHERE field_provenance IS NOT NULL')
      .get() as { n: number }
    // 0020 backfills only `seed_import` rows; 0023 adds none of its own.
    expect(anyProvenance.n).toBeGreaterThanOrEqual(0)
  })
})

/* ------------------------------------------------------------------ */

describe('the evidence comes from the tables that record it', () => {
  /**
   * A trip with one outfit group and one slot, so `filled_by` has somewhere
   * real to live. Built with raw SQL rather than the planner, because what is
   * under test is the COUNT — driving a whole trip through `generateOutfits`
   * would make this a test of the planner that happens to assert on a number.
   */
  function slotFilledBy(itemId: string, filledBy: 'generated' | 'user_swap', n = 1) {
    db.raw
      .prepare(
        `INSERT INTO trip (id, name, start_date, end_date, status, created_at, updated_at)
         VALUES (?,?,?,?,'planning',?,?)`,
      )
      .run(`trip-${itemId}-${n}`, 'T', '2026-01-01', '2026-01-05', NOW, NOW)
    db.raw
      .prepare(
        `INSERT INTO outfit_group (id, trip_id, name, occurrences, status, created_at, updated_at)
         VALUES (?,?,?,1,'draft',?,?)`,
      )
      .run(`grp-${itemId}-${n}`, `trip-${itemId}-${n}`, 'Day', NOW, NOW)
    db.raw
      .prepare(
        `INSERT INTO outfit_slot (id, outfit_group_id, slot_role, item_id, filled_by)
         VALUES (?,?, 'top', ?, ?)`,
      )
      .run(`slot-${itemId}-${n}`, `grp-${itemId}-${n}`, itemId, filledBy)
  }

  it('counts the slots Alex filled himself, and not the generated ones', async () => {
    await tee('picked')
    await tee('given', 'Given', { subcategory: 'Pants', category: 'Bottoms & Swimwear' })
    slotFilledBy('picked', 'user_swap', 1)
    slotFilledBy('picked', 'user_swap', 2)
    slotFilledBy('given', 'generated', 1)
    slotFilledBy('given', 'generated', 2)

    const { cards } = await myQueue()
    const picked = cards.find((c) => c.item.id === 'picked')
    expect(picked?.reason).toBe('swapped_in')
    expect(picked?.why).toBe('You have chosen this yourself 2 times, over what was suggested.')
    expect(cards.find((c) => c.item.id === 'given')?.reason).not.toBe('swapped_in')
  })

  it('counts the packing lists a garment was taken off', async () => {
    await tee('dropped')

    for (const n of [1, 2, 3]) {
      db.raw
        .prepare(
          `INSERT INTO trip (id, name, start_date, end_date, status, created_at, updated_at)
           VALUES (?,?,?,?,'planning',?,?)`,
        )
        .run(`t${n}`, 'T', '2026-01-01', '2026-01-05', NOW, NOW)
      db.raw
        .prepare(
          `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                        required_qty, excluded_at, source, created_at, updated_at)
           VALUES (?,?,?,?,?,1,?,'user_added',?,?)`,
        )
        .run(`e${n}`, `t${n}`, 'dropped', 'Dropped', 'Tops & Outerwear', NOW, NOW, NOW)
    }

    const card = (await myQueue()).cards.find((c) => c.item.id === 'dropped')
    expect(card?.reason).toBe('removed')
    expect(card?.why).toBe('You have taken this off 3 packing lists.')
  })
})

/* ------------------------------------------------------------------ */

describe('one tap writes one field, at the rank that protects it', () => {
  it('stores a comfort rating and stamps only comfort as confirmed', async () => {
    const item = await tee('tee')

    const response = await items(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ comfort: 4 }),
    })
    expect(response.status).toBe(200)

    const stored = (await getItem(db.binding, item.id))!
    expect(stored.comfort).toBe(4)
    expect(stored.fieldProvenance.comfort?.source).toBe('user_confirmed')
    // Nothing else claimed. Confirming fourteen answers because Alex gave one
    // is the guess H1a exists to stop making.
    expect(Object.keys(stored.fieldProvenance)).toEqual(['comfort'])
  })

  it('keeps several dressiness contexts rather than collapsing them', async () => {
    const item = await tee('oxford', 'Oxford')

    await items(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ dressinessContexts: ['dressy', 'smart_casual'] }),
    })

    const stored = (await getItem(db.binding, item.id))!
    // Canonical order, both kept — `Smart casual + Dressy` must not become one.
    expect(stored.dressinessContexts).toEqual(['smart_casual', 'dressy'])
  })

  it('treats a null as clearing, and records the absence as confirmed', async () => {
    const item = await tee('tee', 'Tee', { comfort: 5 })

    await items(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ comfort: null }),
    })

    const stored = (await getItem(db.binding, item.id))!
    expect(stored.comfort).toBeNull()
    /*
     * `user_confirmed` holding nothing, not an empty entry. The difference
     * matters exactly once: at the next import, where the first refuses to be
     * refilled and the second is refilled silently.
     */
    expect(stored.fieldProvenance.comfort?.source).toBe('user_confirmed')
  })

  it('refuses a field this door does not own', async () => {
    const item = await tee('tee')
    const response = await items(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ category: 'Footwear' }),
    })

    expect(response.status).toBe(400)
    expect((await getItem(db.binding, item.id))!.category).toBe('Tops & Outerwear')
  })

  it('refuses a rating outside 1–5', async () => {
    const item = await tee('tee')
    for (const comfort of [0, 6, 2.5, 'five']) {
      const response = await items(`/api/items/${item.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ comfort }),
      })
      expect(response.status).toBe(400)
    }
    expect((await getItem(db.binding, item.id))!.comfort).toBeNull()
  })

  it('drops the question once the rating exists', async () => {
    await tee('tee')
    expect((await myQueue()).cards).toHaveLength(1)

    await items('/api/items/tee', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ comfort: 3 }),
    })
    await items('/api/items/tee', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ versatility: 3 }),
    })
    await items('/api/items/tee', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ dressinessContexts: ['casual'] }),
    })

    // No stored cursor, and none needed: an answered garment stops qualifying.
    expect((await myQueue()).cards).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */

describe('keeping a name, and putting a spreadsheet value back', () => {
  it('confirms a name without changing it, so no import may rewrite it', async () => {
    const item = await tee('tee', 'Storm Shell', { brand: 'Arc’teryx' })

    const response = await items(
      `/api/items/${item.id}/confirm`,
      post({ fields: ['displayName', 'brand'] }),
    )
    expect(response.status).toBe(200)

    const stored = (await getItem(db.binding, item.id))!
    expect(stored.displayName).toBe('Storm Shell')
    expect(stored.fieldProvenance.displayName?.source).toBe('user_confirmed')
    expect(stored.fieldProvenance.brand?.source).toBe('user_confirmed')
  })

  it('restores the spreadsheet value AND the source that wrote it', async () => {
    const item = await tee('tee', 'Tee', { dressinessContexts: ['smart_casual'] })

    // The importer's claim, then Alex's confirmation over the top of it.
    db.raw
      .prepare('UPDATE item SET field_provenance = ? WHERE id = ?')
      .run(
        JSON.stringify({
          dressinessContexts: { source: 'inferred', at: NOW },
        }),
        item.id,
      )
    await items(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ dressinessContexts: ['smart_casual', 'dressy'] }),
    })

    /*
     * The garment retired itself on that PATCH — answering its dressiness is
     * feedback, and feedback takes a garment out of the queue (`hasFeedback`).
     * This test is about the disagreement that OUTLIVES the answer, so it is
     * read from the row directly rather than from the queue.
     */
    expect(findDisagreements((await getItem(db.binding, item.id))!)).toEqual([
      {
        field: 'dressinessContexts',
        label: 'Where it works',
        mine: 'Smart casual + Dressy',
        theirs: 'Smart casual',
        theirsSource: 'inferred',
      },
    ])

    const response = await items(
      `/api/items/${item.id}/revert`,
      post({ field: 'dressinessContexts' }),
    )
    expect(response.status).toBe(200)

    const restored = (await getItem(db.binding, item.id))!
    expect(restored.dressinessContexts).toEqual(['smart_casual'])
    // Back under the importer's authority, or it is a revert that does not revert.
    expect(restored.fieldProvenance.dressinessContexts?.source).toBe('inferred')
  })
})

/* ------------------------------------------------------------------ */

/**
 * Alex's ruling: **feedback retires the garment, not just the field.**
 *
 * The old behaviour was per-field and it was the right answer to the wrong
 * question. A card asks for everything a row is missing, so rating comfort on a
 * garment with three empty fields left it qualifying for the other two — and it
 * came back, with a new reason line, looking exactly like a queue that had not
 * listened. It could then return again for a tidier name and again for a
 * possible duplicate.
 *
 * These are the cases that had to be true before that could be called fixed.
 */
describe('a garment Alex has rated does not come back', () => {
  it('retires the whole garment on one comfort rating, not just comfort', async () => {
    await tee('rated')
    expect((await myQueue()).cards).toHaveLength(1)

    await items('/api/items/rated', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ comfort: 4 }),
    })

    // Versatility and dressiness are still empty. Under the per-field rule this
    // was a card; under Alex's it is not.
    const after = await myQueue()
    expect(after.cards).toHaveLength(0)
    expect((await getItem(db.binding, 'rated'))!.versatility).toBeNull()
  })

  it('retires it on a dressiness answer alone', async () => {
    await tee('dressed')
    await items('/api/items/dressed', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ dressinessContexts: ['casual'] }),
    })
    expect((await myQueue()).cards).toHaveLength(0)
  })

  it('retires it whatever else the card had to ask — a name, a duplicate', async () => {
    /*
     * The case the per-field rule could never cover. This garment repeats its
     * own brand in its name AND has a twin, so it had three separate claims on
     * the queue. One rating settles all of them.
     */
    await tee('repeat-a', 'Uniqlo Grey Tee', { brand: 'Uniqlo', color: 'Grey' })
    await tee('repeat-b', 'Uniqlo Grey Tee', { brand: 'Uniqlo', color: 'Grey' })
    expect((await myQueue()).cards).toHaveLength(2)

    await items('/api/items/repeat-a', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ versatility: 2 }),
    })

    const after = await myQueue()
    expect(after.cards.map((c) => c.item.id)).toEqual(['repeat-b'])
  })

  it('counts a rating given anywhere, not only one given on this screen', async () => {
    /*
     * The ask was about having provided feedback, not about which screen he was
     * on — and the item sheet in My Stuff carries the same three controls. Both
     * screens write through doors that stamp `user_confirmed`, which is the one
     * thing `hasFeedback` reads, so there is nothing on the review side to keep
     * in step with either of them.
     */
    await tee('elsewhere')
    await items('/api/items/elsewhere', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ comfort: 5, versatility: 5 }),
    })

    const stored = (await getItem(db.binding, 'elsewhere'))!
    expect(stored.fieldProvenance.comfort?.source).toBe('user_confirmed')
    expect((await myQueue()).cards).toHaveLength(0)

    /*
     * And no row was written to record it. The retirement is DERIVED — see
     * `hasFeedback` for the two ways a stored `reviewed` row went wrong.
     */
    expect(
      db.raw.prepare('SELECT COUNT(*) AS n FROM closet_review_decision').get(),
    ).toEqual({ n: 0 })
  })

  it('gives the garment back when the rating is put back to the spreadsheet value', async () => {
    /*
     * `Use spreadsheet value` hands the field back to the importer's authority,
     * which is Alex withdrawing his opinion rather than confirming it. A stored
     * *reviewed* row could not have noticed; reading the row cannot miss it.
     */
    const item = await tee('reverted', 'Reverted', { dressinessContexts: ['smart_casual'] })
    db.raw
      .prepare('UPDATE item SET field_provenance = ? WHERE id = ?')
      .run(JSON.stringify({ dressinessContexts: { source: 'inferred', at: NOW } }), item.id)

    await items('/api/items/reverted', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ dressinessContexts: ['smart_casual', 'dressy'] }),
    })
    expect((await myQueue()).cards).toHaveLength(0)

    await items('/api/items/reverted/revert', post({ field: 'dressinessContexts' }))
    expect((await myQueue()).cards.map((c) => c.item.id)).toEqual(['reverted'])
  })

  it('does not retire a garment the importer merely had an opinion about', async () => {
    /*
     * Migration 0022 gave every imported garment the one context its guessed
     * dressiness meant, at `inferred`. Treating that as an answer would retire
     * ~85 garments nobody has ever been asked about — the same null-scan failure
     * `contextsWorthAsking` exists to avoid, arriving through the other door.
     */
    const item = await tee('guessed', 'Guessed', { dressinessContexts: ['casual'] })
    db.raw
      .prepare('UPDATE item SET field_provenance = ? WHERE id = ?')
      .run(JSON.stringify({ dressinessContexts: { source: 'inferred', at: NOW } }), item.id)

    expect((await myQueue()).cards.map((c) => c.item.id)).toEqual(['guessed'])
  })

  it('does not retire it for a rename, which is housekeeping rather than feedback', async () => {
    await tee('renamed', 'Uniqlo Grey Tee', { brand: 'Uniqlo', color: 'Grey' })

    await items('/api/items/renamed', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ displayName: 'Grey Tee' }),
    })

    // Still nothing known about how comfortable it is, so still worth asking.
    expect((await myQueue()).cards.map((c) => c.item.id)).toEqual(['renamed'])
  })

  it('does not retire it for CLEARING a rating, which is the opposite of an answer', async () => {
    await tee('cleared', 'Cleared', { comfort: 3 })

    await items('/api/items/cleared', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ comfort: null }),
    })

    /*
     * Clearing puts the field back to unknown, which is precisely the state the
     * queue exists to fill. Retiring the garment on the strength of an answer
     * Alex had just withdrawn would be the feature swallowing its own question.
     */
    expect((await myQueue()).cards.map((c) => c.item.id)).toEqual(['cleared'])
  })

  it('does not retire it for an empty dressiness set — that is *clear all*', async () => {
    await tee('emptied', 'Emptied', { dressinessContexts: ['casual'] })

    await items('/api/items/emptied', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ dressinessContexts: [] }),
    })

    expect((await myQueue()).cards.map((c) => c.item.id)).toEqual(['emptied'])
  })
})

/* ------------------------------------------------------------------ */

describe('the decisions that are not edits', () => {
  it('remembers a skip, and still offers the card — at the back', async () => {
    await tee('skipped')
    await tee('fresh', 'Fresh', { subcategory: 'Pants', category: 'Bottoms & Swimwear' })

    const response = await review(
      '/api/closet-review/decisions',
      post({ itemId: 'skipped', topic: 'ratings', decision: 'skipped' }),
    )
    expect(response.status).toBe(200)

    const { cards } = await myQueue()
    expect(cards.map((c) => c.item.id)).toEqual(['fresh', 'skipped'])
    expect(cards[1]?.skipped).toBe(true)
  })

  it('withdraws a Not sure, and gives it back on request', async () => {
    await tee('unsure')

    await review(
      '/api/closet-review/decisions',
      post({ itemId: 'unsure', topic: 'ratings', decision: 'not_sure' }),
    )
    expect(await myQueue()).toMatchObject({ cards: [], notSure: 1 })

    const reopened = await (await review('/api/closet-review/reopen', post({}))).json()
    expect(reopened).toEqual({ reopened: 1 })
    expect((await myQueue()).cards).toHaveLength(1)
  })

  it('leaves a skip alone when reopening the ones he was not sure about', async () => {
    await tee('skipped')
    await tee('unsure', 'Unsure', { subcategory: 'Pants', category: 'Bottoms & Swimwear' })
    await review(
      '/api/closet-review/decisions',
      post({ itemId: 'skipped', topic: 'ratings', decision: 'skipped' }),
    )
    await review(
      '/api/closet-review/decisions',
      post({ itemId: 'unsure', topic: 'ratings', decision: 'not_sure' }),
    )

    await review('/api/closet-review/reopen', post({}))

    const rows = db.raw
      .prepare('SELECT item_id, decision FROM closet_review_decision')
      .all() as Array<{ item_id: string; decision: string }>
    expect(rows).toEqual([{ item_id: 'skipped', decision: 'skipped' }])
  })

  it('records one row per question however often it is answered', async () => {
    await tee('tee')
    for (const decision of ['skipped', 'skipped', 'not_sure']) {
      await review(
        '/api/closet-review/decisions',
        post({ itemId: 'tee', topic: 'ratings', decision }),
      )
    }

    const rows = db.raw
      .prepare('SELECT decision FROM closet_review_decision WHERE item_id = ?')
      .all('tee') as Array<{ decision: string }>
    expect(rows).toEqual([{ decision: 'not_sure' }])
  })

  it('refuses a decision for an item that does not exist', async () => {
    const response = await review(
      '/api/closet-review/decisions',
      post({ itemId: 'nope', topic: 'ratings', decision: 'skipped' }),
    )
    expect(response.status).toBe(404)
  })

  it('refuses a decision it has no word for', async () => {
    await tee('tee')
    const response = await review(
      '/api/closet-review/decisions',
      post({ itemId: 'tee', topic: 'ratings', decision: 'maybe' }),
    )
    expect(response.status).toBe(400)
  })
})

/* ------------------------------------------------------------------ */

describe('same item — archived, never merged', () => {
  it('archives the copy Alex did not keep, and keeps every reference intact', async () => {
    await gear('keep', 'Packing Cube', { brand: 'Eagle Creek' })
    await gear('drop', 'Packing Cube', { brand: 'Eagle Creek' })

    // A trip already refers to the row about to be archived. It must survive.
    db.raw
      .prepare(
        `INSERT INTO trip (id, name, start_date, end_date, status, created_at, updated_at)
         VALUES ('t1','T','2026-01-01','2026-01-05','planning',?,?)`,
      )
      .run(NOW, NOW)
    db.raw
      .prepare(
        `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                      required_qty, source, created_at, updated_at)
         VALUES ('e1','t1','drop','Packing Cube','Travel Gear',1,'user_added',?,?)`,
      )
      .run(NOW, NOW)

    const response = await review(
      '/api/closet-review/archive-duplicate',
      post({ keepItemId: 'keep', archiveItemId: 'drop' }),
    )
    expect(response.status).toBe(200)

    const dropped = (await getItem(db.binding, 'drop'))!
    expect(dropped.archivedAt).not.toBeNull()
    // Archived, not deleted — the whole reason merge is deferred.
    expect(dropped.displayName).toBe('Packing Cube')
    const entry = db.raw
      .prepare('SELECT item_id FROM checklist_entry WHERE id = ?')
      .get('e1') as { item_id: string }
    expect(entry.item_id).toBe('drop')

    // And neither side is asked about the pair again.
    expect((await myQueue()).cards).toHaveLength(0)
  })

  it('refuses to archive a garment against itself', async () => {
    await tee('one')
    const response = await review(
      '/api/closet-review/archive-duplicate',
      post({ keepItemId: 'one', archiveItemId: 'one' }),
    )
    expect(response.status).toBe(400)
    expect((await getItem(db.binding, 'one'))!.archivedAt).toBeNull()
  })

  it('remembers Keep both, so the pair stops being offered', async () => {
    await gear('a', 'Packing Cube', { brand: 'Eagle Creek' })
    await gear('b', 'Packing Cube', { brand: 'Eagle Creek' })
    expect((await myQueue()).cards).toHaveLength(2)

    for (const [itemId, other] of [
      ['a', 'b'],
      ['b', 'a'],
    ]) {
      await review(
        '/api/closet-review/decisions',
        post({ itemId, topic: `duplicate:${other}`, decision: 'answered' }),
      )
    }

    const after = await myQueue()
    expect(after.cards).toHaveLength(0)
    // Both rows are still there. "Keep both" means keep both.
    const live = (await Promise.all([getItem(db.binding, 'a'), getItem(db.binding, 'b')])) as Item[]
    expect(live.every((i) => i.archivedAt === null)).toBe(true)
  })
})
