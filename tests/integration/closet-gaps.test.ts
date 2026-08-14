import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recurringClosetGaps, type UnfilledSlotRow } from '@shared/closet-gaps'
import { recurringGapInsights } from '../../worker/repos/closet-gaps'
import { archiveTrip, createTrip } from '../../worker/repos/trips'
import { generateOutfits } from '../../worker/repos/outfits'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP, garment, seedWardrobe } from './wardrobe'

/**
 * Holes in the wardrobe that keep coming back (P4d).
 *
 * Two claims carry the whole feature, and each has a mutation-checked test:
 *
 *   1. **One unusual trip is not evidence.** A black-tie weekend Alex will not
 *      repeat must not become a permanent statement about his closet.
 *   2. **A gap that is no longer true stops being reported.** The count is only
 *      the trigger; the claim is re-tested against the wardrobe as it stands,
 *      so buying a pair of shoes silences it without anything having to go back
 *      and invalidate three trips of history.
 *
 * And the corollary of (2) that is easy to get wrong: an ARCHIVED garment must
 * not close a gap. Two independent filters enforce that — `listActiveCandidates`
 * never returns an archived row, and `passesFilters` rejects one again — so
 * mutating either alone leaves these tests green. Mutating both together fails
 * three of them, which is what makes the claim tested rather than assumed.
 */

const NOW = 1_780_000_000
let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

/**
 * Plans `count` trips against the seeded wardrobe.
 *
 * Real `generateOutfits`, so the unmet slots are the ones the planner actually
 * left — writing `outfit_slot` rows by hand would be testing a fixture's idea of
 * a gap rather than the product's.
 */
async function plannedTrips(count: number): Promise<string[]> {
  const ids: string[] = []
  for (let n = 1; n <= count; n += 1) {
    const trip = await createTrip(
      db.binding,
      { ...TRIP, name: `Trip ${n}`, startDate: `2026-0${n}-01`, endDate: `2026-0${n}-08` },
      NOW,
    )
    await generateOutfits(db.binding, trip, NOW, [])
    ids.push(trip.id)
  }
  return ids
}

/** Takes every pair of shoes out of the wardrobe, the way archiving does. */
function archiveAllFootwear() {
  db.raw
    .prepare(
      `UPDATE item SET archived_at = ?
        WHERE subcategory LIKE '%shoe%' OR subcategory LIKE '%sneaker%'
           OR subcategory LIKE '%boot%' OR subcategory LIKE '%sandal%'
           OR subcategory LIKE '%slide%'`,
    )
    .run(NOW)
}

/** Empties one slot on every planned outfit, as an unfillable one would be. */
function strandSlot(role: string, reason = 'No shoes in your wardrobe suit nice dinners.') {
  db.raw
    .prepare(
      `UPDATE outfit_slot SET item_id = NULL, unmet_reason = ?, required = 1
        WHERE slot_role = ?`,
    )
    .run(reason, role)
}

describe('the shared rule', () => {
  const row = (over: Partial<UnfilledSlotRow> = {}): UnfilledSlotRow => ({
    role: 'footwear',
    roleLabel: 'shoes',
    occasion: 'Nice dinners',
    trips: 3,
    fillableNow: false,
    ...over,
  })

  it('says nothing about one unusual trip', () => {
    expect(recurringClosetGaps([row({ trips: 1 })])).toEqual([])
    expect(recurringClosetGaps([row({ trips: 2 })])).toEqual([])
    expect(recurringClosetGaps([row({ trips: 3 })])).toHaveLength(1)
  })

  /*
   * The count is only the trigger. History does not update itself, so a gap Alex
   * has since filled would go on being reported from the same three trips.
   */
  it('stops the moment the wardrobe can cover it', () => {
    expect(recurringClosetGaps([row({ fillableNow: true })])).toEqual([])
  })

  it('names the gap and the one action, and never a purchase', () => {
    const [insight] = recurringClosetGaps([row()])
    expect(insight?.message).toBe(
      'Nothing in your wardrobe has suited nice dinners on 3 trips.',
    )
    expect(insight?.fix).toMatch(/My Stuff/)
    // Not shopping, in the words as well as in the absence of a link.
    for (const word of ['buy', 'shop', 'order', 'purchase', 'price', 'http']) {
      expect(`${insight?.message} ${insight?.fix}`.toLowerCase(), word).not.toContain(word)
    }
  })

  /*
   * Two holes in the same drawer are two questions. Saying no to *nothing for
   * nice dinners* must not silence *nothing for hiking*.
   */
  it('keeps the occasion in the topic, so one no is not deafness', () => {
    const [dinner] = recurringClosetGaps([row()])
    const [hike] = recurringClosetGaps([row({ occasion: 'Hiking days' })])
    expect(dinner?.topic).not.toBe(hike?.topic)
  })
})

describe('against real trips and a real wardrobe', () => {
  it('says nothing when the planner filled everything', async () => {
    seedWardrobe(db)
    await plannedTrips(3)
    expect(await recurringGapInsights(db.binding)).toEqual([])
  })

  it('reports a slot the wardrobe cannot fill, once it has recurred', async () => {
    seedWardrobe(db)
    await plannedTrips(3)

    /*
     * The footwear the seeded wardrobe owns is archived, so nothing can fill the
     * slot any more — the honest version of "he owns no formal shoes", produced
     * by changing the wardrobe rather than by writing a gap into the fixture.
     */
    archiveAllFootwear()
    strandSlot('footwear')

    const insights = await recurringGapInsights(db.binding)
    expect(insights.length).toBeGreaterThan(0)
    expect(insights[0]!.trips).toBeGreaterThanOrEqual(3)
    expect(insights[0]!.message).toMatch(/Nothing in your wardrobe has suited/)
  })

  /* The corollary that is easy to get wrong. */
  it('does not let an archived garment close a gap', async () => {
    seedWardrobe(db)
    await plannedTrips(3)
    archiveAllFootwear()
    strandSlot('footwear')

    expect((await recurringGapInsights(db.binding)).length).toBeGreaterThan(0)

    // Bringing one back closes it, without anything touching the history.
    db.raw.prepare("UPDATE item SET archived_at = NULL WHERE subcategory LIKE '%shoe%'").run()
    expect(await recurringGapInsights(db.binding)).toEqual([])
  })

  it('learns nothing from a trip Alex has put away', async () => {
    seedWardrobe(db)
    const trips = await plannedTrips(3)
    archiveAllFootwear()
    strandSlot('footwear')

    await archiveTrip(db.binding, trips[0]!, NOW)
    expect(await recurringGapInsights(db.binding)).toEqual([])
  })

  /*
   * Filling the gap for real, rather than by un-archiving: a garment that suits
   * the occasion closes it, which is the "resolved gaps stop surfacing"
   * requirement.
   *
   * Asserted per OCCASION rather than over the whole list, and that is the
   * honest assertion: a dress shoe closes *nice dinners* and says nothing about
   * safari or travel days, whose templates want different garments entirely. A
   * pair of oxfords silencing every footwear gap at once would be the bug.
   */
  it('goes quiet for the occasion a new garment suits, and only that one', async () => {
    seedWardrobe(db)
    await plannedTrips(3)
    archiveAllFootwear()
    strandSlot('footwear')

    const occasions = (list: Array<{ topic: string }>) => list.map((i) => i.topic)
    const before = occasions(await recurringGapInsights(db.binding))
    expect(before).toContain('occasion:Nice dinners')

    garment(db, {
      name: 'Black Oxfords',
      subcategory: 'shoes',
      dressiness: 3,
      // `Nice dinners` gates on the `dressy` use, not on the activity tag.
      uses: ['dressy'],
    })

    const after = occasions(await recurringGapInsights(db.binding))
    expect(after).not.toContain('occasion:Nice dinners')
    // The others are untouched, because nothing about them changed.
    for (const topic of before.filter((t) => t !== 'occasion:Nice dinners')) {
      expect(after, topic).toContain(topic)
    }
  })
})
