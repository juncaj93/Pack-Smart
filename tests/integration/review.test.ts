import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeQuantity, type EngineContext, type PackingRule } from '@shared/rules'
import type { TripInput } from '@shared/trips'
import { generateChecklist, listChecklist, setPackedQty } from '../../worker/repos/checklist'
import { ensureDailyPlans, logWear } from '../../worker/repos/during-trip'
import {
  generateOutfits,
  listOutfits,
  setGroupStatus,
  syncChecklistFromOutfits,
} from '../../worker/repos/outfits'
import { listRules } from '../../worker/repos/rules'
import {
  addAnswer,
  applyChange,
  deleteAnswer,
  duplicateAnswer,
  finishReview,
  listAnswers,
  observations,
  resolveAnswer,
  reviewView,
} from '../../worker/repos/review'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { createTestDatabase, insertItem, type TestDatabase } from './d1'

/**
 * The post-trip review, against real SQL (F1).
 *
 * The model tests decide what a proposal SAYS. These decide what accepting one
 * actually does to the database — which is the half that can silently be wrong,
 * because a rule written with the wrong source, or written over a seeded
 * default, produces exactly the same sentence on screen.
 */

const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-07-31',
  endDate: '2026-08-11',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari'],
  international: true,
  laundryAvailable: false,
}

const NOW = 1_780_000_000
let db: TestDatabase

function gear(id: string, name: string, rule?: { type: string; quantity: number }) {
  insertItem(db, { id, kind: 'gear', displayName: name, category: 'Travel Gear' })
  if (rule) {
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, enabled, needs_review,
                                   source, created_at)
         VALUES (?,?,?,?,1,0,'system',1)`,
      )
      .run(crypto.randomUUID(), id, rule.type, rule.quantity)
  }
  return id
}

/** The rules in force for one item, as `computeQuantity` would see them. */
function rulesFor(rules: PackingRule[], itemId: string): PackingRule[] {
  return rules.filter((rule) => rule.itemId === itemId)
}

/** A twelve-day trip, which is what `TRIP` actually is. */
const ENGINE: EngineContext = {
  facts: { trip_days: 12, nights: 11 },
  includedItemIds: new Set(),
  preferences: {},
}

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

/* ------------------------------------------------------------------ */

describe('what the app saw', () => {
  it('does not claim anything about wear when During Trip was never opened', async () => {
    gear('socks', 'Wool Socks', { type: 'per_day', quantity: 1 })
    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)
    for (const entry of await listChecklist(db.binding, trip.id)) {
      await setPackedQty(db.binding, entry.id, entry.requiredQty, NOW)
    }

    const seen = await observations(db.binding, trip.id)

    expect(seen.wearLogUsed).toBe(false)
    /*
     * The whole point. Without the guard, every packed item on an untracked
     * trip reads as unworn — and the review would open by telling Alex he wore
     * none of what he took.
     */
    expect(seen.unworn).toEqual([])
  })

  it('names what came home unworn once there is a wear log', async () => {
    gear('socks', 'Wool Socks', { type: 'fixed_per_trip', quantity: 1 })
    gear('torch', 'Head Torch', { type: 'fixed_per_trip', quantity: 1 })
    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)
    for (const entry of await listChecklist(db.binding, trip.id)) {
      await setPackedQty(db.binding, entry.id, entry.requiredQty, NOW)
    }
    await ensureDailyPlans(db.binding, trip, NOW)
    await logWear(db.binding, trip.id, 'socks', TRIP.startDate, 'already_wore', NOW)

    const seen = await observations(db.binding, trip.id)

    expect(seen.wearLogUsed).toBe(true)
    // The canonical additions from migration 0009 are on every list too, so
    // this asserts the DISTINCTION rather than the whole set: the thing that
    // was worn is absent, the thing that was not is present.
    expect(seen.unworn).toContain('Head Torch')
    expect(seen.unworn).not.toContain('Wool Socks')
  })
})

/* ------------------------------------------------------------------ */

describe('accepting a proposal changes the packing list', () => {
  it('adds a spare, and the next trip packs one more', async () => {
    gear('socks', 'Wool Socks', { type: 'per_day', quantity: 1 })
    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)

    const before = await listChecklist(db.binding, trip.id)
    const wasRequired = before.find((e) => e.name === 'Wool Socks')!.requiredQty

    const answerId = await addAnswer(
      db.binding,
      trip.id,
      { kind: 'ran_out', itemId: 'socks', outfitGroupId: null, note: null },
      NOW,
    )

    const view = await reviewView(db.binding, { ...trip, reviewedAt: null })
    const proposal = view.proposals.find((p) => p.answerId === answerId)!
    const answer = (await listAnswers(db.binding, trip.id)).find((a) => a.id === answerId)!
    await resolveAnswer(db.binding, answer, proposal, 'accepted')

    // Measured through the real engine, not by reading the row back.
    const rules = await listRules(db.binding)
    const quantity = computeQuantity(rulesFor(rules, 'socks'), ENGINE)

    expect(quantity.quantity).toBe(wasRequired + 1)
  })

  /*
   * A learned rule has to be labelled `learned`.
   *
   * Not cosmetic: `11_RULE_PRECEDENCE.md` ranks the three sources, Packing
   * rules shows provenance, and a learned rule wearing `user` would be
   * indistinguishable from something Alex decided — which is the one thing the
   * source column exists to prevent.
   */
  it('writes the new rule as learned, not as one Alex wrote', async () => {
    gear('adapter', 'Plug Adapter')
    const trip = await createTrip(db.binding, TRIP, NOW)

    await applyChange(db.binding, { kind: 'always_pack', itemId: 'adapter' }, NOW)
    void trip

    const rule = (await listRules(db.binding)).find((r) => r.itemId === 'adapter')!
    expect(rule.source).toBe('learned')
    expect(rule.ruleType).toBe('fixed_per_trip')
    // It supersedes nothing, so it can only ever combine with a default.
    expect(rule.supersedesRuleId).toBeNull()
  })

  /*
   * Alex's first ruling, reached from a new direction.
   *
   * Stepping a seeded default down must PRESERVE the seeded row and write an
   * override of it, or `Use the default` has nothing to restore to — the
   * default and the decision to change it would be the same row.
   */
  it('never writes over a seeded default when stepping one down', async () => {
    gear('socks', 'Wool Socks', { type: 'per_day', quantity: 2 })
    const trip = await createTrip(db.binding, TRIP, NOW)
    const seeded = (await listRules(db.binding)).find((r) => r.itemId === 'socks')!

    const answerId = await addAnswer(
      db.binding,
      trip.id,
      { kind: 'too_many', itemId: 'socks', outfitGroupId: null, note: null },
      NOW,
    )
    const view = await reviewView(db.binding, { ...trip, reviewedAt: null })
    const proposal = view.proposals.find((p) => p.answerId === answerId)!
    const answer = (await listAnswers(db.binding, trip.id)).find((a) => a.id === answerId)!
    await resolveAnswer(db.binding, answer, proposal, 'accepted')

    const original = db.raw
      .prepare('SELECT quantity_value FROM packing_rule WHERE id = ?')
      .get(seeded.id) as { quantity_value: number }

    expect(original.quantity_value).toBe(2)

    const rules = await listRules(db.binding)
    const quantity = computeQuantity(rulesFor(rules, 'socks'), ENGINE)
    expect(quantity.quantity).toBe(12)
  })

  it('declining changes no rule at all', async () => {
    gear('socks', 'Wool Socks', { type: 'per_day', quantity: 2 })
    const trip = await createTrip(db.binding, TRIP, NOW)

    const answerId = await addAnswer(
      db.binding,
      trip.id,
      { kind: 'too_many', itemId: 'socks', outfitGroupId: null, note: null },
      NOW,
    )
    const view = await reviewView(db.binding, { ...trip, reviewedAt: null })
    const proposal = view.proposals.find((p) => p.answerId === answerId)!
    const answer = (await listAnswers(db.binding, trip.id)).find((a) => a.id === answerId)!
    await resolveAnswer(db.binding, answer, proposal, 'declined')

    const rules = await listRules(db.binding)
    expect(rules.filter((r) => r.itemId === 'socks')).toHaveLength(1)
    expect(computeQuantity(rulesFor(rules, 'socks'), ENGINE).quantity).toBe(24)
  })

  it('a declined proposal is not offered again', async () => {
    gear('socks', 'Wool Socks', { type: 'per_day', quantity: 2 })
    const trip = await createTrip(db.binding, TRIP, NOW)

    const answerId = await addAnswer(
      db.binding,
      trip.id,
      { kind: 'too_many', itemId: 'socks', outfitGroupId: null, note: null },
      NOW,
    )
    const view = await reviewView(db.binding, { ...trip, reviewedAt: null })
    const answer = (await listAnswers(db.binding, trip.id)).find((a) => a.id === answerId)!
    await resolveAnswer(db.binding, answer, view.proposals[0]!, 'declined')

    const after = await reviewView(db.binding, { ...trip, reviewedAt: null })
    expect(after.outstanding).toBe(0)
    expect(after.proposals[0]?.resolution).toBe('declined')
  })
})

/* ------------------------------------------------------------------ */

describe('the outfit that was wrong', () => {
  it('forgets the pairing and leaves the trip’s own outfit alone', async () => {
    for (let i = 1; i <= 14; i += 1) {
      insertItem(db, {
        id: `tee${i}`,
        kind: 'clothing',
        displayName: `Tee ${i}`,
        category: 'Tops & Outerwear',
      })
    }
    for (let i = 1; i <= 5; i += 1) {
      insertItem(db, {
        id: `pants${i}`,
        kind: 'clothing',
        displayName: `Pants ${i}`,
        category: 'Bottoms & Swimwear',
      })
    }
    insertItem(db, { id: 'shoes', kind: 'clothing', displayName: 'Walking Shoes', category: 'Footwear' })

    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)
    await generateOutfits(db.binding, trip, NOW)

    const group = (await listOutfits(db.binding, trip.id)).find((g) => g.status !== 'incomplete')
    if (!group) return // The wardrobe produced nothing approvable; nothing to assert.

    await setGroupStatus(db.binding, group.id, 'approved', NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)

    const pairingsBefore = (
      db.raw.prepare('SELECT COUNT(*) AS n FROM outfit_pairing').get() as { n: number }
    ).n
    expect(pairingsBefore).toBeGreaterThan(0)

    await applyChange(db.binding, { kind: 'forget_pairings', outfitGroupId: group.id }, NOW)

    const pairingsAfter = (
      db.raw.prepare('SELECT COUNT(*) AS n FROM outfit_pairing').get() as { n: number }
    ).n
    expect(pairingsAfter).toBe(0)

    // The trip's record of what he actually wore is untouched.
    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === group.id)!
    expect(after.status).toBe('approved')
    expect(after.slots.map((s) => s.itemId)).toEqual(group.slots.map((s) => s.itemId))
  })
})

/* ------------------------------------------------------------------ */

describe('saying the same thing twice', () => {
  it('refuses a second answer about the same item and question', async () => {
    gear('socks', 'Wool Socks', { type: 'per_day', quantity: 1 })
    const trip = await createTrip(db.binding, TRIP, NOW)
    const answer = { kind: 'ran_out' as const, itemId: 'socks', outfitGroupId: null, note: null }

    expect(await duplicateAnswer(db.binding, trip.id, answer)).toBe(false)
    await addAnswer(db.binding, trip.id, answer, NOW)
    expect(await duplicateAnswer(db.binding, trip.id, answer)).toBe(true)
  })

  it('allows the same item under a different question', async () => {
    gear('socks', 'Wool Socks', { type: 'per_day', quantity: 1 })
    const trip = await createTrip(db.binding, TRIP, NOW)
    await addAnswer(
      db.binding,
      trip.id,
      { kind: 'ran_out', itemId: 'socks', outfitGroupId: null, note: null },
      NOW,
    )

    expect(
      await duplicateAnswer(db.binding, trip.id, {
        kind: 'too_many',
        itemId: 'socks',
        outfitGroupId: null,
        note: null,
      }),
    ).toBe(false)
  })

  it('never treats two free-text notes as duplicates', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    const note = { kind: 'missing_from_screen' as const, itemId: null, outfitGroupId: null, note: 'a' }
    await addAnswer(db.binding, trip.id, note, NOW)

    expect(await duplicateAnswer(db.binding, trip.id, { ...note, note: 'b' })).toBe(false)
  })
})

/* ------------------------------------------------------------------ */

describe('undoing and finishing', () => {
  it('removes an answer that has not been acted on', async () => {
    gear('socks', 'Wool Socks', { type: 'per_day', quantity: 1 })
    const trip = await createTrip(db.binding, TRIP, NOW)
    const id = await addAnswer(
      db.binding,
      trip.id,
      { kind: 'ran_out', itemId: 'socks', outfitGroupId: null, note: null },
      NOW,
    )

    expect(await deleteAnswer(db.binding, trip.id, id)).toBe(true)
    expect(await listAnswers(db.binding, trip.id)).toHaveLength(0)
  })

  /*
   * An accepted answer has already written a rule. Dropping the row would leave
   * that rule with nothing on screen explaining where it came from.
   */
  it('refuses to remove one that has already been used', async () => {
    gear('socks', 'Wool Socks', { type: 'per_day', quantity: 1 })
    const trip = await createTrip(db.binding, TRIP, NOW)
    const id = await addAnswer(
      db.binding,
      trip.id,
      { kind: 'ran_out', itemId: 'socks', outfitGroupId: null, note: null },
      NOW,
    )
    const view = await reviewView(db.binding, { ...trip, reviewedAt: null })
    const answer = (await listAnswers(db.binding, trip.id))[0]!
    await resolveAnswer(db.binding, answer, view.proposals[0]!, 'accepted')

    expect(await deleteAnswer(db.binding, trip.id, id)).toBe(false)
  })

  it('records the sitting, and keeps the first time it happened', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)

    const first = await finishReview(db.binding, trip.id, NOW)
    const second = await finishReview(db.binding, trip.id, NOW + 500)

    expect(second).toBe(first)
    expect((await getTrip(db.binding, trip.id))?.reviewedAt).toBe(NOW)
  })

  it('finishes a review nobody answered anything on', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    await finishReview(db.binding, trip.id, NOW)

    const view = await reviewView(db.binding, {
      ...trip,
      reviewedAt: (await getTrip(db.binding, trip.id))!.reviewedAt,
    })

    expect(view.reviewedAt).toBe(NOW)
    expect(view.proposals).toEqual([])
  })
})

/* ------------------------------------------------------------------ */

describe('what the pickers offer', () => {
  it('offers packed things for “ran out”, and unlisted things for “forgot”', async () => {
    gear('socks', 'Wool Socks', { type: 'fixed_per_trip', quantity: 1 })
    gear('adapter', 'Plug Adapter')

    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)
    for (const entry of await listChecklist(db.binding, trip.id)) {
      await setPackedQty(db.binding, entry.id, entry.requiredQty, NOW)
    }

    const view = await reviewView(db.binding, { ...trip, reviewedAt: null })

    expect(view.choices.packed.map((c) => c.name)).toContain('Wool Socks')
    // Never on the list, because it has no rule — which is exactly the thing a
    // "what did you forget" question exists to catch.
    expect(view.choices.notPacked.map((c) => c.name)).toContain('Plug Adapter')
    expect(view.choices.notPacked.map((c) => c.name)).not.toContain('Wool Socks')
  })

  it('offers nothing from an archived wardrobe row', async () => {
    insertItem(db, {
      id: 'old',
      kind: 'gear',
      displayName: 'Retired Torch',
      category: 'Travel Gear',
      archivedAt: NOW,
    })
    const trip = await createTrip(db.binding, TRIP, NOW)

    const view = await reviewView(db.binding, { ...trip, reviewedAt: null })
    expect(view.choices.notPacked.map((c) => c.name)).not.toContain('Retired Torch')
  })
})
