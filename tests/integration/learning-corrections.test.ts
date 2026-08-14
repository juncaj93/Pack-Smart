import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { NO_TRIP_CONTEXT, bagFor } from '@shared/bags'
import type { ChecklistEntry } from '@shared/checklist'
import {
  generateChecklist,
  listChecklist,
  setBag,
  setQtyOverride,
  setTiming,
} from '../../worker/repos/checklist'
import {
  acceptOverrideProposal,
  decideLearning,
  listLearningDecisions,
  pendingBagProposals,
  pendingQuantityProposals,
  pendingTimingProposals,
  restoreSetAsideLearning,
} from '../../worker/repos/learning'
import { undecided } from '@shared/learning'
import { getItem, updateItem } from '../../worker/repos/items'
import { archiveTrip, createTrip } from '../../worker/repos/trips'
import { createTestDatabase, effectiveRule, type TestDatabase } from './d1'

/**
 * Learning from the same correction, trip after trip (P4c, doc 04 §7).
 *
 * Three families, all derived from evidence that was already being recorded and
 * read by nothing across trips. The claims that are load-bearing:
 *
 *   1. **Three trips, and consistent.** Two trips is a coincidence, and two
 *      different answers that both reach the threshold are not a preference —
 *      they are a tie the app must not break for him.
 *   2. **Behaviour never becomes truth on its own.** Nothing is written until
 *      Alex accepts, and what is written is reversible where he would look for
 *      it.
 *   3. **No is remembered.** A declined suggestion stops being offered, and a
 *      later, DIFFERENT habit is still asked about once.
 */

const NOW = 1_780_000_000
let db: TestDatabase

function trip(n: number): TripInput {
  return {
    name: `Trip ${n}`,
    startDate: `2026-0${n}-01`,
    endDate: `2026-0${n}-04`,
    destinations: [{ name: 'Lisbon', country: 'Portugal' }],
    activities: [],
    international: false,
    flightHours: 6,
  }
}

function gear(id: string, options: { qty?: number; ruleType?: string; critical?: boolean } = {}) {
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                         typical_uses, is_critical, requires_final_check,
                         default_packing_timing, always_include, never_include, source,
                         created_at, updated_at)
       VALUES (?,?,?,'Travel Gear',0,'sometimes','[]',?,0,'anytime',0,0,'seed_import',1,1)`,
    )
    .run(id, 'gear', id, options.critical ? 1 : 0)

  db.raw
    .prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, condition_json,
                                 enabled, needs_review, original_text, created_at)
       VALUES (?,?,?,?,NULL,1,0,'test',1)`,
    )
    .run(`rule-${id}`, id, options.ruleType ?? 'fixed_per_trip', options.qty ?? 1)
}

/** Plans one trip and hands back its rows, by name. */
async function planned(n: number): Promise<{ id: string; rows: Map<string, ChecklistEntry> }> {
  const made = await createTrip(db.binding, trip(n), NOW)
  await generateChecklist(db.binding, made, NOW)
  const rows = await listChecklist(db.binding, made.id)
  return { id: made.id, rows: new Map(rows.map((row) => [row.name, row])) }
}

/** Makes the same correction on `count` separate trips. */
async function onTrips(
  count: number,
  itemName: string,
  correct: (entryId: string) => Promise<unknown>,
): Promise<string[]> {
  const trips: string[] = []
  for (let n = 1; n <= count; n += 1) {
    const { id, rows } = await planned(n)
    const row = rows.get(itemName)
    if (!row) throw new Error(`${itemName} never reached trip ${n}`)
    await correct(row.id)
    trips.push(id)
  }
  return trips
}

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

/* ------------------------------------------------------------------ */
/* which bag                                                           */
/* ------------------------------------------------------------------ */

describe('a bag Alex keeps choosing', () => {
  it('says nothing after two trips and offers after three', async () => {
    gear('Sunglasses')

    // Two trips, then a third: the same evidence crossing the threshold, not
    // five trips' worth of it.
    for (const n of [1, 2]) {
      const { rows } = await planned(n)
      await setBag(db.binding, rows.get('Sunglasses')!.id, 'personal_item', NOW)
    }
    expect(await pendingBagProposals(db.binding)).toEqual([])

    const third = await planned(3)
    await setBag(db.binding, third.rows.get('Sunglasses')!.id, 'personal_item', NOW)
    const [proposal] = await pendingBagProposals(db.binding)
    expect(proposal?.itemName).toBe('Sunglasses')
    expect(proposal?.trips).toBe(3)
    expect(proposal?.message).toMatch(/personal bag on 3 trips/i)
    expect(proposal?.change).toEqual({
      kind: 'default_bag',
      itemId: 'Sunglasses',
      to: 'personal_item',
    })
  })

  /*
   * The tie. Three trips in the personal bag and three in the carry-on is not a
   * preference, and picking one would be the app inventing a winner.
   */
  it('offers nothing when the corrections disagree with each other', async () => {
    gear('Kindle')
    for (let n = 1; n <= 3; n += 1) {
      const { rows } = await planned(n)
      await setBag(db.binding, rows.get('Kindle')!.id, 'personal_item', NOW)
    }
    for (let n = 4; n <= 6; n += 1) {
      const { rows } = await planned(n)
      await setBag(db.binding, rows.get('Kindle')!.id, 'carry_on', NOW)
    }

    expect(await pendingBagProposals(db.binding)).toEqual([])
  })

  it('learns nothing from a trip Alex has put away', async () => {
    gear('Sunglasses')
    const trips = await onTrips(3, 'Sunglasses', (id) =>
      setBag(db.binding, id, 'personal_item', NOW),
    )
    await archiveTrip(db.binding, trips[0]!, NOW)

    expect(await pendingBagProposals(db.binding)).toEqual([])
  })

  /*
   * A stored bag with any other source is a leftover from an earlier release,
   * not a decision. Only what Alex chose himself counts as evidence.
   */
  it('counts only the bags Alex chose himself', async () => {
    gear('Sunglasses')
    for (let n = 1; n <= 3; n += 1) {
      const { rows } = await planned(n)
      db.raw
        .prepare("UPDATE checklist_entry SET bag = 'checked', bag_source = 'recommended' WHERE id = ?")
        .run(rows.get('Sunglasses')!.id)
    }

    expect(await pendingBagProposals(db.binding)).toEqual([])
  })

  it('remembers it, and then has nothing left to say', async () => {
    gear('Sunglasses')
    await onTrips(3, 'Sunglasses', (id) => setBag(db.binding, id, 'personal_item', NOW))

    const [proposal] = await pendingBagProposals(db.binding)
    await acceptOverrideProposal(db.binding, proposal!.change, NOW)

    const stored = db.raw
      .prepare('SELECT default_bag FROM item WHERE id = ?')
      .get('Sunglasses') as { default_bag: string }
    expect(stored.default_bag).toBe('personal_item')

    // Accepted proposals leave pending state without anything remembering that
    // they were accepted: the preference is now what they are compared against.
    expect(await pendingBagProposals(db.binding)).toEqual([])
  })

  it('suggests the learned bag on a new trip, and yields to a choice made there', async () => {
    gear('Sunglasses')
    await onTrips(3, 'Sunglasses', (id) => setBag(db.binding, id, 'personal_item', NOW))
    const [proposal] = await pendingBagProposals(db.binding)
    await acceptOverrideProposal(db.binding, proposal!.change, NOW)

    const { id, rows } = await planned(4)
    const fresh = (await listChecklist(db.binding, id)).find((r) => r.name === 'Sunglasses')!
    expect(fresh.learnedBag).toBe('personal_item')

    const suggested = bagFor(fresh, NO_TRIP_CONTEXT, fresh.traits)
    expect(suggested.bag).toBe('personal_item')
    expect(suggested.source).toBe('recommended')
    expect(suggested.why).toMatch(/usually/i)

    // And a bag chosen on the trip in front of him still wins outright.
    await setBag(db.binding, rows.get('Sunglasses')!.id, 'checked', NOW)
    const chosen = (await listChecklist(db.binding, id)).find((r) => r.name === 'Sunglasses')!
    expect(bagFor(chosen, NO_TRIP_CONTEXT, chosen.traits)).toMatchObject({
      bag: 'checked',
      source: 'user',
    })
  })

  /*
   * The learned bag survives an ordinary edit in My Stuff.
   *
   * `updateItem` rewrites twenty-odd columns from an `ItemInput` that has no
   * `default_bag` in it, so a column added to that statement — or an input type
   * that grew the field without the form filling it — would silently clear a
   * preference Alex explicitly accepted. It is not a provenanced field, so
   * nothing else would notice.
   */
  it('keeps a learned bag through an edit in My Stuff', async () => {
    gear('Sunglasses')
    await onTrips(3, 'Sunglasses', (id) => setBag(db.binding, id, 'personal_item', NOW))
    const [proposal] = await pendingBagProposals(db.binding)
    await acceptOverrideProposal(db.binding, proposal!.change, NOW)

    const before = (await getItem(db.binding, 'Sunglasses'))!
    await updateItem(
      db.binding,
      'Sunglasses',
      { ...before, notes: 'scratched the left lens' },
      NOW + 1,
    )

    const stored = db.raw
      .prepare('SELECT default_bag, notes FROM item WHERE id = ?')
      .get('Sunglasses') as { default_bag: string | null; notes: string | null }
    expect(stored.notes).toBe('scratched the left lens')
    expect(stored.default_bag).toBe('personal_item')
  })

  /*
   * The safety floor is not re-implemented in the learning rules and must not
   * need to be: `recommendBag` returns before the learned branch for anything
   * that must stay with you, so a learned `checked` on a passport cannot place
   * it in the hold even if the column somehow held one.
   */
  it('cannot learn its way around the cabin-only floor', async () => {
    gear('Passport', { critical: true })
    db.raw.prepare("UPDATE item SET default_bag = 'checked' WHERE id = 'Passport'").run()

    const { id } = await planned(1)
    const row = (await listChecklist(db.binding, id)).find((r) => r.name === 'Passport')!
    expect(row.learnedBag).toBe('checked')
    expect(bagFor(row, NO_TRIP_CONTEXT, row.traits).bag).not.toBe('checked')
  })
})

/* ------------------------------------------------------------------ */
/* when to pack it                                                     */
/* ------------------------------------------------------------------ */

describe('a timing Alex keeps moving', () => {
  it('offers after three trips and lands on the catalog default', async () => {
    gear('Toothbrush')
    await onTrips(3, 'Toothbrush', (id) => setTiming(db.binding, id, 'day_of', NOW))

    const [proposal] = await pendingTimingProposals(db.binding)
    expect(proposal?.message).toMatch(/You moved Toothbrush to .+ on 3 trips/i)

    await acceptOverrideProposal(db.binding, proposal!.change, NOW)
    const stored = db.raw
      .prepare('SELECT default_packing_timing FROM item WHERE id = ?')
      .get('Toothbrush') as { default_packing_timing: string }
    expect(stored.default_packing_timing).toBe('day_of')

    expect(await pendingTimingProposals(db.binding)).toEqual([])
  })

  /* A timing that already matches the default is the default working. */
  it('says nothing about rows that agree with the default', async () => {
    gear('Toothbrush')
    for (let n = 1; n <= 3; n += 1) await planned(n)
    expect(await pendingTimingProposals(db.binding)).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* how many                                                            */
/* ------------------------------------------------------------------ */

describe('a quantity Alex keeps correcting', () => {
  it('offers after three trips and changes the rule as a learned override', async () => {
    gear('Socks', { qty: 5 })
    await onTrips(3, 'Socks', (id) => setQtyOverride(db.binding, id, 2, NOW))

    const [proposal] = await pendingQuantityProposals(db.binding)
    expect(proposal?.message).toMatch(/fewer Socks .* 3 trips .* 2 each time/i)
    expect(proposal?.change).toEqual({ kind: 'usual_amount', ruleId: 'rule-Socks', to: 2 })

    await acceptOverrideProposal(db.binding, proposal!.change, NOW)

    const rule = effectiveRule(db, 'rule-Socks')
    expect(rule.quantity_value).toBe(2)
    // A learned rule labelled `user` would be indistinguishable from something
    // Alex decided, which is what the source column exists to prevent.
    expect(rule.source).toBe('learned')
  })

  /*
   * The guard that makes this family honest. A per-night rule answers a
   * different number for every trip, so "he set it to 7 three times" says
   * nothing about the rule — seven pairs is a correction on a week and a
   * shortfall on a fortnight.
   */
  it('refuses to correct a rule whose answer depends on the trip', async () => {
    gear('Socks', { qty: 1, ruleType: 'per_night' })
    await onTrips(3, 'Socks', (id) => setQtyOverride(db.binding, id, 2, NOW))

    expect(await pendingQuantityProposals(db.binding)).toEqual([])
  })

  /* Two enabled rules and no unambiguous target — declined outright. */
  it('refuses when there is more than one rule it could mean', async () => {
    gear('Socks', { qty: 5 })
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, condition_json,
                                   enabled, needs_review, original_text, created_at)
         VALUES ('rule-Socks-2','Socks','minimum',3,NULL,1,0,'test',1)`,
      )
      .run()

    await onTrips(3, 'Socks', (id) => setQtyOverride(db.binding, id, 2, NOW))
    expect(await pendingQuantityProposals(db.binding)).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* saying no, and saying not now                                       */
/* ------------------------------------------------------------------ */

describe('what Alex says about a suggestion', () => {
  async function offered() {
    gear('Sunglasses')
    await onTrips(3, 'Sunglasses', (id) => setBag(db.binding, id, 'personal_item', NOW))
    const [proposal] = await pendingBagProposals(db.binding)
    return proposal!
  }

  it('stops offering a suggestion he declined', async () => {
    const proposal = await offered()
    await decideLearning(db.binding, proposal.subject, proposal.topic, 'declined', NOW)

    const decisions = await listLearningDecisions(db.binding)
    expect(undecided([proposal], decisions)).toEqual([])
    // And declining is not accepting: nothing was written.
    const stored = db.raw
      .prepare('SELECT default_bag FROM item WHERE id = ?')
      .get('Sunglasses') as { default_bag: string | null }
    expect(stored.default_bag).toBeNull()
  })

  /*
   * The reason the topic carries the value. Saying no to *the personal bag* must
   * not make Pack Smart deaf to a habit that later becomes the carry-on.
   */
  it('still asks once about a different habit for the same thing', async () => {
    const proposal = await offered()
    await decideLearning(db.binding, proposal.subject, proposal.topic, 'declined', NOW)

    const later: typeof proposal = { ...proposal, topic: 'bag:carry_on' }
    const decisions = await listLearningDecisions(db.binding)
    expect(undecided([later], decisions)).toEqual([later])
  })

  it('withdraws a Not sure until it is asked for back', async () => {
    const proposal = await offered()
    await decideLearning(db.binding, proposal.subject, proposal.topic, 'not_sure', NOW)

    let decisions = await listLearningDecisions(db.binding)
    expect(undecided([proposal], decisions)).toEqual([])
    expect(undecided([proposal], decisions, true)).toEqual([proposal])

    await restoreSetAsideLearning(db.binding)
    decisions = await listLearningDecisions(db.binding)
    expect(undecided([proposal], decisions)).toEqual([proposal])
  })

  /* "No" and "not now" are different answers, and only one was temporary. */
  it('does not bring a decline back with the set-aside ones', async () => {
    const proposal = await offered()
    await decideLearning(db.binding, proposal.subject, proposal.topic, 'declined', NOW)
    await restoreSetAsideLearning(db.binding)

    const decisions = await listLearningDecisions(db.binding)
    expect(undecided([proposal], decisions, true)).toEqual([])
  })
})
