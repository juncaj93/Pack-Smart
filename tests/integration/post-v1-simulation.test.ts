import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { planBags } from '@shared/bags'
import { packByBag } from '@shared/pack-by-bag'
import { planDelta } from '@shared/plan-delta'
import { isPacked } from '@shared/rules'
import { checklistProgress, type ChecklistEntry } from '@shared/checklist'
import {
  generateChecklist,
  listChecklist,
  setBag,
  setPackedQty,
} from '../../worker/repos/checklist'
import { tripCoverageGaps } from '../../worker/repos/coverage'
import { acceptOverrideProposal, pendingBagProposals } from '../../worker/repos/learning'
import { createTrip, getTrip, updateTrip } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * The Post-V1 features, exercised TOGETHER (P4g).
 *
 * Every slice has its own tests and they all pass in isolation. This file exists
 * for the failures isolation cannot produce — a learned preference that never
 * reaches the bag lens, a bag lens that disagrees with the packing list after a
 * trip edit, a delta that describes a plan the list does not have.
 *
 * So nothing here re-asserts a rule. Each walk is a sequence a real trip would
 * go through, and the assertions are about the seams between features.
 */

const NOW = 1_780_000_000
let db: TestDatabase

const FLIGHT: TripInput = {
  name: 'Lisbon',
  startDate: '2026-08-01',
  endDate: '2026-08-08',
  destinations: [{ name: 'Lisbon', country: 'Portugal' }],
  activities: [],
  international: true,
  laundryAvailable: false,
  flightHours: 6,
}

function gear(id: string, options: { critical?: boolean; bulky?: boolean } = {}) {
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                         typical_uses, is_critical, requires_final_check,
                         default_packing_timing, always_include, never_include, source,
                         is_bulky, created_at, updated_at)
       VALUES (?,'gear',?,?,0,'sometimes','[]',?,0,'anytime',0,0,'seed_import',?,1,1)`,
    )
    .run(id, id, options.critical ? 'Documents' : 'Travel Gear', options.critical ? 1 : 0,
         options.bulky ? 1 : null)
  db.raw
    .prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, condition_json,
                                 enabled, needs_review, original_text, created_at)
       VALUES (?,?,'fixed_per_trip',1,NULL,1,0,'test',1)`,
    )
    .run(`rule-${id}`, id)
}

async function planTrip(over: Partial<TripInput> = {}, n = 1) {
  const trip = await createTrip(
    db.binding,
    { ...FLIGHT, ...over, name: `${FLIGHT.name} ${n}`, startDate: `2026-0${n}-01`, endDate: `2026-0${n}-08` },
    NOW,
  )
  await generateChecklist(db.binding, trip, NOW)
  return { trip, entries: await listChecklist(db.binding, trip.id) }
}

/** Every row the bag lens shows, across every group. */
const shown = (plan: ReturnType<typeof planBags>, entries: ChecklistEntry[]) =>
  packByBag(plan, entries).flatMap((group) => group.entries.map((entry) => entry.id))

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

/* ------------------------------------------------------------------ */
/* the shape of a trip decides the shape of the lens                   */
/* ------------------------------------------------------------------ */

describe('the bag lens on the four shapes of trip', () => {
  it.each([
    ['a checked-bag flight', { bags: ['personal_item', 'carry_on', 'checked'] }, 3],
    ['a carry-on-only flight', { bags: ['personal_item', 'carry_on'] }, 2],
    ['a personal item alone', { bags: ['personal_item'] }, 1],
    ['a road trip with a suitcase in the boot', { bags: ['checked'], flightHours: 0 }, 1],
  ] as Array<[string, Partial<TripInput>, number]>)(
    'shows exactly the bags %s carries',
    async (_what, over, expected) => {
      gear('Passport', { critical: true })
      gear('Jumper', { bulky: true })
      const { trip, entries } = await planTrip(over)

      const groups = packByBag(planBags(trip, entries), entries).filter(
        (group) => group.key !== 'unplaced' && group.key !== 'wear',
      )
      expect(groups).toHaveLength(expected)
    },
  )

  /*
   * The road trip's headings, which are the only place aviation words are
   * softened. Everything else in the product keeps one vocabulary.
   */
  it('names a road trip’s bag without airline language', async () => {
    gear('Jumper', { bulky: true })
    const { trip, entries } = await planTrip({ bags: ['checked'], flightHours: 0 })

    const labels = packByBag(planBags(trip, entries), entries).map((group) => group.label)
    expect(labels).toContain('Large bag')
    expect(labels).not.toContain('Checked bag')
  })

  /* Nothing is lost and nothing is doubled, on any of the four. */
  it('shows every row exactly once, on every shape', async () => {
    gear('Passport', { critical: true })
    gear('Jumper', { bulky: true })
    gear('Corkscrew')

    for (const bags of [
      ['personal_item', 'carry_on', 'checked'],
      ['personal_item', 'carry_on'],
      ['personal_item'],
    ]) {
      const { trip, entries } = await planTrip({ bags: bags as never })
      const ids = shown(planBags(trip, entries), entries)
      const bringing = entries.filter((e) => e.excludedAt === null)

      expect(new Set(ids).size, bags.join('+')).toBe(bringing.length)
      expect(ids.length, bags.join('+')).toBe(bringing.length)
    }
  })
})

/* ------------------------------------------------------------------ */
/* the seam that matters most                                          */
/* ------------------------------------------------------------------ */

describe('learning a bag, then packing by it', () => {
  /*
   * The walk that crosses three slices, and the one no isolated test can do:
   * correct the same bag on three trips, accept the proposal, plan a FOURTH
   * trip, and find the garment in that bag in the lens — having never touched
   * the fourth trip.
   */
  it('carries a learned bag through to the lens on a later trip', async () => {
    gear('Sunglasses')

    for (let n = 1; n <= 3; n += 1) {
      const { entries } = await planTrip({}, n)
      const row = entries.find((e) => e.name === 'Sunglasses')!
      await setBag(db.binding, row.id, 'carry_on', NOW)
    }

    const [proposal] = await pendingBagProposals(db.binding)
    expect(proposal, 'three trips of the same choice is a proposal').toBeDefined()
    await acceptOverrideProposal(db.binding, proposal!.change, NOW)

    // A trip planned afterwards, untouched.
    const { trip, entries } = await planTrip({}, 4)
    const groups = packByBag(planBags(trip, entries), entries)
    const carryOn = groups.find((group) => group.key === 'carry_on')!

    expect(carryOn.entries.map((e) => e.name)).toContain('Sunglasses')
    // And it is in exactly one group, which is the lens's own invariant.
    expect(
      groups.filter((g) => g.entries.some((e) => e.name === 'Sunglasses')),
    ).toHaveLength(1)
  })

  /*
   * The safety floor beats a learned habit, and this is the walk that proves it
   * end to end rather than by calling `recommendBag` directly.
   */
  it('will not let a learned bag put a passport in the hold', async () => {
    gear('Passport', { critical: true })
    db.raw.prepare("UPDATE item SET default_bag = 'checked' WHERE id = 'Passport'").run()

    const { trip, entries } = await planTrip({ bags: ['personal_item', 'carry_on', 'checked'] })
    const groups = packByBag(planBags(trip, entries), entries)
    const hold = groups.find((group) => group.key === 'checked')!

    expect(hold.entries.map((e) => e.name)).not.toContain('Passport')
    expect(
      groups.find((g) => g.entries.some((e) => e.name === 'Passport'))?.key,
    ).toBe('personal_item')
  })
})

/* ------------------------------------------------------------------ */
/* one list, two lenses                                                */
/* ------------------------------------------------------------------ */

describe('the lens and the list cannot disagree', () => {
  it('counts the same trip the same way, however it is cut', async () => {
    gear('Passport', { critical: true })
    gear('Jumper', { bulky: true })
    gear('Corkscrew')
    const { trip, entries } = await planTrip({ bags: ['personal_item', 'carry_on', 'checked'] })

    const first = entries.find((e) => e.excludedAt === null)!
    await setPackedQty(db.binding, first.id, first.requiredQty, NOW)

    const now = await listChecklist(db.binding, trip.id)
    const progress = checklistProgress(now)
    const groups = packByBag(planBags(trip, now), now)

    /*
     * Summed across the groups rather than read off one, because a row set to
     * `Either cabin bag` appears under both — and on this trip none is, so the
     * two numbers must agree exactly. The screen itself never sums them, which
     * is why this is worth asserting here.
     */
    const packedInLens = groups.reduce((total, group) => total + group.packed, 0)
    expect(packedInLens).toBe(progress.packed)
    expect(now.filter(isPacked)).toHaveLength(progress.packed)
  })

  /*
   * A trip edit changes the list; the lens is derived from the list; so the
   * delta, the list and the lens all have to describe the same trip afterwards.
   */
  it('agrees with the delta about what the edit did', async () => {
    gear('Passport', { critical: true })
    gear('Corkscrew')
    const { trip, entries } = await planTrip({ bags: ['personal_item', 'carry_on'] })

    const gapsBefore = await tripCoverageGaps(db.binding, trip, entries)

    // The hold arrives, which is the kind of edit that moves bag placement.
    const edited = (await updateTrip(
      db.binding,
      trip.id,
      { ...FLIGHT, name: trip.name, startDate: trip.startDate, endDate: trip.endDate,
        bags: ['personal_item', 'carry_on', 'checked'] },
      NOW,
    ))!
    await generateChecklist(db.binding, edited, NOW)

    const after = await listChecklist(db.binding, edited.id)
    const gapsAfter = await tripCoverageGaps(db.binding, edited, after)
    const deltas = planDelta(
      { entries, groups: [], gaps: gapsBefore },
      { entries: after, groups: [], gaps: gapsAfter },
    )

    // Whatever the delta says, the lens shows the list it describes.
    const reloaded = (await getTrip(db.binding, edited.id))!
    const ids = shown(planBags(reloaded, after), after)
    const bringing = after.filter((e) => e.excludedAt === null)
    expect(new Set(ids).size).toBe(bringing.length)

    // And every row the delta names is a row that exists.
    for (const delta of deltas) {
      if ('entryId' in delta) {
        expect(after.some((e) => e.id === delta.entryId), delta.label).toBe(true)
      }
    }
  })
})
