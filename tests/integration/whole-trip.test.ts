import { appendFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { listChecklist } from '../../worker/repos/checklist'
import { createTrip, getTrip, setTripDays } from '../../worker/repos/trips'
import { generateOutfits, setGroupStatus, syncChecklistFromOutfits } from '../../worker/repos/outfits'
import { planBags } from '@shared/bags'
import type { ChecklistEntry } from '@shared/checklist'
import { createTestDatabase, type TestDatabase } from './d1'
import { garment, seedWardrobe } from './wardrobe'

/**
 * Pack Smart as a PACKING PRODUCT, not as a list of rules that each fired.
 *
 * Every other integration file here proves one rule through the real door. This
 * one asks the question none of them can: **would this look sensible if Alex
 * laid it all out on the bed?** Ten trips of the shapes he actually takes, each
 * planned end to end — outfits generated, approved, synced onto the checklist,
 * bags resolved — and then the whole result inspected.
 *
 * ## Why the assertions are ranges and relationships
 *
 * Pinning "a three-day trip packs four pairs of underwear" would be tuning
 * toward an aesthetic count, and the first legitimate change to the reuse
 * defaults would break it for no reason. What is actually worth protecting is
 * that the numbers stay in a range a person would recognise, and that they move
 * the right WAY when the trip changes: laundry reduces, more swim days do not
 * multiply the sandals, a longer trip does not pack fewer clothes than a shorter
 * one.
 *
 * ## What this is hunting
 *
 * Two individually-correct rules combining badly. Each rule below has its own
 * passing test file; the interactions have never had one:
 *
 *   swim template + swim-footwear companion  -> two pairs of sandals
 *   delayed-bag resilience + ordinary packing -> a second wardrobe in the cabin
 *   reuse defaults + a long trip             -> silently under-packed
 *   several activities on one day            -> quantities multiplied per activity
 *   tank-top companion + ordinary tank tops  -> duplicates
 *   laundry reduction + swim reuse           -> one swimsuit for six swim days
 *   nice dinners                             -> a suitcase of dressy clothes
 *
 * `summarise` prints the whole result for each scenario, so a defect that no
 * assertion happens to name is still visible in the run.
 */

const NOW = 1_780_000_000
let db: TestDatabase

/** Every scenario plans against the same closet, the way Alex has one closet. */
beforeEach(() => {
  db = createTestDatabase()
  seedWardrobe(db)

  // Swim, and the two things that go with it. One subcategory for both pairs of
  // open footwear, told apart by name — which is how the workbook records them
  // and why the footwear rule counts by subcategory rather than by name.
  garment(db, { id: 'swim1', name: 'Swim Trunks', subcategory: 'Swimwear', dressiness: 0, uses: ['swim', 'warm_weather'] })
  garment(db, { id: 'swim2', name: 'Board Shorts', subcategory: 'Swimwear', dressiness: 0, uses: ['swim', 'warm_weather'] })
  garment(db, { id: 'tank1', name: 'Athletic Tank Top', subcategory: 'Tank Top', uses: ['swim', 'warm_weather'] })
  garment(db, { id: 'tank2', name: 'Ribbed Tank Top', subcategory: 'Tank Top', uses: ['swim', 'warm_weather'] })
  garment(db, { id: 'birks', name: 'Birkenstocks', subcategory: 'Sandals', uses: ['casual'] })
  garment(db, { id: 'slides', name: 'Slides', subcategory: 'Sandals', dressiness: 0, uses: ['casual', 'loungewear'] })

  /*
   * A second dressy option, because a wardrobe with exactly one dress shirt is a
   * straw man. The nice-dinner template asks for two tops, two bottoms and a
   * layer; with one of each the group is INCOMPLETE and — correctly — contributes
   * nothing, which would have made this scenario test the fixture rather than the
   * product. See "never quietly under-packed" below for what that behaviour is.
   */
  garment(db, { id: 'shirt2', name: 'Blue Oxford', subcategory: 'Shirt', dressiness: 3, uses: ['dressy'] })
  garment(db, { id: 'dress-pants2', name: 'Navy Trousers', subcategory: 'Pants', dressiness: 3, uses: ['dressy'] })
  garment(db, { id: 'blazer', name: 'Wool Blazer', subcategory: 'Jacket', dressiness: 3, uses: ['dressy'] })
  garment(db, { id: 'dress-shoes2', name: 'Suede Derbies', subcategory: 'Shoes', dressiness: 3, uses: ['dressy'] })
  garment(db, { id: 'shirt3', name: 'Striped Shirt', subcategory: 'Shirt', dressiness: 3, uses: ['dressy'] })
  garment(db, { id: 'dress-pants3', name: 'Grey Trousers', subcategory: 'Pants', dressiness: 3, uses: ['dressy'] })

  // Cold weather, so the cold scenario has something to reach for.
  garment(db, { id: 'parka', name: 'Down Parka', subcategory: 'Jacket', warmth: 3, uses: ['cold_weather'] })
  garment(db, { id: 'fleece', name: 'Fleece', subcategory: 'Sweater', warmth: 3, uses: ['cold_weather', 'casual'] })
  garment(db, { id: 'thermal', name: 'Base Layer', subcategory: 'Long Sleeve', warmth: 3, uses: ['cold_weather'] })
  garment(db, { id: 'boots', name: 'Winter Boots', subcategory: 'Shoes', warmth: 3, uses: ['cold_weather'] })
})

afterEach(() => {
  db.close()
})

interface Scenario {
  name: string
  trip: TripInput
  days?: Array<{ date: string; activityTag: string }>
}

const base = {
  name: 'Trip',
  destinations: [{ name: 'Lisbon', country: 'Portugal' }],
  international: true,
  laundryAvailable: false,
  flightHours: 6,
} satisfies Partial<TripInput>

/** `YYYY-MM-DD`, n days after the trip's first day. */
const day = (start: string, offset: number) =>
  new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)) + offset))
    .toISOString()
    .slice(0, 10)

const days = (start: string, tags: string[]) =>
  tags.map((activityTag, index) => ({ date: day(start, index), activityTag }))

const START = '2026-09-01'

const SCENARIOS: Scenario[] = [
  {
    name: '3-day city weekend',
    trip: { ...base, name: 'City weekend', startDate: START, endDate: day(START, 2), activities: ['sightseeing'] },
    days: days(START, ['sightseeing', 'sightseeing', 'sightseeing']),
  },
  {
    name: '7-day beach and pool',
    trip: { ...base, name: 'Beach', startDate: START, endDate: day(START, 6), activities: ['swimming', 'beach'] },
    days: days(START, ['beach', 'swimming', 'beach', 'swimming', 'beach', 'sightseeing', 'swimming']),
  },
  {
    name: '10-day sightseeing, dinners and swim',
    trip: { ...base, name: 'Mixed', startDate: START, endDate: day(START, 9), activities: ['sightseeing', 'nice_dinner', 'swimming'] },
    days: days(START, [
      'sightseeing', 'nice_dinner', 'swimming', 'sightseeing', 'hiking',
      'nice_dinner', 'swimming', 'sightseeing', 'hiking', 'nice_dinner',
    ]),
  },
  {
    name: 'cold weather',
    trip: {
      ...base, name: 'Reykjavik', startDate: START, endDate: day(START, 5),
      destinations: [{ name: 'Reykjavik', country: 'Iceland' }], activities: ['sightseeing'],
    },
    days: days(START, ['sightseeing', 'sightseeing', 'hiking', 'sightseeing', 'hiking', 'sightseeing']),
  },
  {
    name: 'road trip, no flight',
    trip: {
      ...base, name: 'Road trip', startDate: START, endDate: day(START, 4),
      activities: ['sightseeing'], international: false, flightHours: null, bags: [],
    },
    days: days(START, ['road_trip', 'sightseeing', 'road_trip', 'sightseeing', 'road_trip']),
  },
  {
    name: 'several nice dinners',
    trip: { ...base, name: 'Dinners', startDate: START, endDate: day(START, 4), activities: ['nice_dinner'] },
    days: days(START, ['nice_dinner', 'sightseeing', 'nice_dinner', 'sightseeing', 'nice_dinner']),
  },
  {
    name: '10 days with laundry',
    trip: {
      ...base, name: 'Laundry', startDate: START, endDate: day(START, 9),
      activities: ['sightseeing'], laundryAvailable: true,
    },
    days: days(START, Array.from({ length: 10 }, () => 'sightseeing')),
  },
  {
    name: 'flight with a checked bag',
    trip: {
      ...base, name: 'Checked', startDate: START, endDate: day(START, 8), activities: ['sightseeing'],
      flightHours: 11, bags: ['personal_item', 'carry_on', 'checked'],
    },
    days: days(START, Array.from({ length: 9 }, () => 'sightseeing')),
  },
  {
    name: 'carry-on only',
    trip: {
      ...base, name: 'Carry-on', startDate: START, endDate: day(START, 3), activities: ['sightseeing'],
      flightHours: 3, bags: ['personal_item', 'carry_on'],
    },
    days: days(START, ['sightseeing', 'hiking', 'sightseeing', 'hiking']),
  },
  {
    name: 'several activities on the same days',
    trip: {
      ...base, name: 'Busy', startDate: START, endDate: day(START, 4),
      activities: ['sightseeing', 'swimming', 'nice_dinner', 'beach'],
    },
    days: days(START, ['swimming', 'nice_dinner', 'beach', 'nice_dinner', 'swimming']),
  },
]

/** Plans, approves every outfit, syncs, and hands back the whole result. */
async function pack(scenario: Scenario) {
  const created = await createTrip(db.binding, scenario.trip, NOW)
  if (scenario.days) await setTripDays(db.binding, created.id, scenario.days, NOW)

  const planned = (await getTrip(db.binding, created.id))!
  const { groups } = await generateOutfits(db.binding, planned, NOW)
  for (const group of groups) await setGroupStatus(db.binding, group.id, 'approved', NOW)

  const trip = (await getTrip(db.binding, created.id))!
  await syncChecklistFromOutfits(db.binding, trip, NOW)

  const entries = (await listChecklist(db.binding, trip.id)).filter((e) => e.excludedAt === null)
  return { trip, entries, groups, bags: planBags(trip, entries) }
}

/** Total units, not rows: three pairs of socks on one row is three things. */
const units = (entries: ChecklistEntry[], match: (e: ChecklistEntry) => boolean) =>
  entries.filter(match).reduce((total, e) => total + e.requiredQty, 0)

const named = (entries: ChecklistEntry[], needle: RegExp) => units(entries, (e) => needle.test(e.name))

/**
 * The whole list, written out.
 *
 * Assertions can only catch what someone thought to write down. Set
 * `PACK_SMART_SIM_OUT` to a path and every scenario's full result lands there,
 * so a list that is absurd in a way no assertion names — forty pairs of socks,
 * no trousers — is still visible to a human reading the run.
 *
 * A file rather than `console.log` because the runner swallows console output
 * from tests that PASS, which is exactly the case this is for.
 */
function summarise(label: string, entries: ChecklistEntry[], groups: Array<{ status: string }> = []) {
  const out = process.env.PACK_SMART_SIM_OUT
  if (!out) return

  const clothing = entries.filter((e) => e.category !== 'Toiletries' && e.category !== 'Travel Gear')
  const lines = clothing
    .map((e) => `${e.name}${e.requiredQty > 1 ? ` ×${e.requiredQty}` : ''}`)
    .sort()
    .join(', ')

  appendFileSync(
    out,
    `[${label}] ${entries.length} rows, ${units(entries, () => true)} things\n` +
      `  clothing: ${lines || '(none)'}\n` +
      `  other: ${entries.filter((e) => !clothing.includes(e)).map((e) => e.name).sort().join(', ') || '(none)'}\n` +
      `  outfits: ${groups.map((g) => g.status).sort().join(', ') || '(none)'}\n\n`,
  )
}

describe('a whole trip, laid out on the bed', () => {
  for (const scenario of SCENARIOS) {
    it(`is a sensible list: ${scenario.name}`, async () => {
      const { entries, groups } = await pack(scenario)
      summarise(scenario.name, entries, groups)

      const nights = scenario.days?.length ?? 1

      /*
       * A trip with no clothing on it is the failure that would make every other
       * assertion here vacuous, and it is a real shape: a planner that generated
       * no groups still produces a checklist full of toiletries.
       */
      const clothing = entries.filter(
        (e) => e.category !== 'Toiletries' && e.category !== 'Travel Gear',
      )
      expect(clothing.length, 'no clothing at all').toBeGreaterThan(0)

      // Nobody packs more than three changes a day, however the rules combine.
      expect(units(entries, () => true)).toBeLessThan(nights * 12 + 30)

      // And nothing is on the list twice: one row per item, always.
      const ids = entries.filter((e) => e.itemId).map((e) => e.itemId)
      expect(new Set(ids).size, 'the same garment on two rows').toBe(ids.length)

      // No row asks for a quantity a person would not recognise.
      for (const entry of entries) {
        expect(entry.requiredQty, `${entry.name} quantity`).toBeGreaterThan(0)
        expect(entry.requiredQty, `${entry.name} quantity`).toBeLessThanOrEqual(nights * 2 + 4)
      }
    })
  }
})

/**
 * The interactions. Each pair of rules below is individually tested elsewhere
 * and passing; what has never been checked is what they do to each other.
 */
describe('two correct rules, together', () => {
  it('packs ONE pair of open footwear however many swim days there are', async () => {
    const { entries } = await pack(SCENARIOS[1]!)

    /*
     * The swim template can put sandals on a beach outfit and the companion rule
     * adds a pair for the swimwear. Both are right; both firing is two pairs of
     * Birkenstocks for one person, which is the shape §0m warned about.
     *
     * Counted in UNITS rather than rows, because the way this defect hides is a
     * single row whose quantity quietly became four.
     */
    const sandals = units(entries, (e) => /sandal|birkenstock|slide/i.test(e.name))
    expect(sandals, 'open footwear for one trip').toBeLessThanOrEqual(1)
  })

  it('does not pair a tank top with a swimsuit twice', async () => {
    const { entries } = await pack(SCENARIOS[1]!)

    const suits = named(entries, /swim trunks|board shorts/i)
    const tanks = named(entries, /tank top/i)

    expect(suits, 'at least one swimsuit on a swim trip').toBeGreaterThan(0)
    // One over, not one each plus the ones the outfits already chose.
    expect(tanks, 'tank tops beyond the swimsuits they go over').toBeLessThanOrEqual(suits)
  })

  it('does not multiply quantities when a day has several activities', async () => {
    const busy = await pack(SCENARIOS[9]!)
    const plain = await pack(SCENARIOS[0]!)

    /*
     * Five busy days against three plain ones. More days legitimately means
     * more clothing; what would be wrong is the busy trip packing several times
     * the plain one because each activity claimed its own outfit.
     */
    const busyUnits = units(busy.entries, () => true)
    const plainUnits = units(plain.entries, () => true)
    expect(busyUnits).toBeLessThan(plainUnits * 3)
  })

  it('packs less when there is laundry, not more', async () => {
    const withLaundry = await pack(SCENARIOS[6]!)
    const without = await pack({
      ...SCENARIOS[6]!,
      trip: { ...SCENARIOS[6]!.trip, laundryAvailable: false },
    })

    /*
     * Counted across the whole list rather than on underwear, and that is a limit
     * of this harness rather than a choice. Laundry reduces RULE-driven
     * quantities, and this fixture seeds a wardrobe with no packing rules, so
     * there are no socks here to count. `tests/integration/laundry.test.ts` is
     * where the reduction itself is proved; what belongs here is that the rest of
     * the pipeline does not react to laundry by packing MORE.
     */
    const wash = units(withLaundry.entries, () => true)
    const noWash = units(without.entries, () => true)

    expect(wash, 'laundry should not increase what he takes').toBeLessThanOrEqual(noWash)
    expect(wash, 'laundry is a reduction, not an empty bag').toBeGreaterThan(0)
  })

  it('does not under-pack a long trip relative to a short one', async () => {
    const long = await pack(SCENARIOS[2]!)
    const short = await pack(SCENARIOS[0]!)

    /*
     * The reuse defaults are what make this worth asserting. A garment with a
     * generous reuse capacity can cover a long trip with very little, and the
     * failure is silent: ten days out of a weekend bag.
     */
    expect(units(long.entries, () => true)).toBeGreaterThan(units(short.entries, () => true))
  })

  it('keeps the delayed-bag set small rather than packing a second wardrobe', async () => {
    const { entries, bags } = await pack(SCENARIOS[7]!)

    expect(bags.resilience.size, 'nothing kept back for a delayed bag').toBeGreaterThan(0)
    /*
     * A resilience set that grew with the trip would be the cabin bag holding a
     * copy of the hold. It answers one question — one day's worth — so it is
     * bounded by a handful of rows regardless of how long the trip is.
     */
    expect(bags.resilience.size, 'the cabin is holding a second wardrobe').toBeLessThanOrEqual(8)
    expect(bags.resilience.size).toBeLessThan(entries.length / 2)
  })

  it('never routes anything into a hold that is not coming', async () => {
    const { entries, bags } = await pack(SCENARIOS[8]!)

    const checked = entries.filter((e) => bags.advice.get(e.id)?.bag === 'checked')
    expect(checked.map((e) => e.name), 'a checked bag on a carry-on-only trip').toEqual([])
  })

  it('does not turn four nice dinners into a suitcase of dressy clothes', async () => {
    const { entries } = await pack(SCENARIOS[5]!)

    const dressy = named(entries, /oxford|trousers|loafers/i)
    expect(dressy, 'nothing dressy for four nice dinners').toBeGreaterThan(0)
    /*
     * Dressy garments are reused across occasions like everything else. One
     * outfit per dinner would be the planner treating each evening as a separate
     * wardrobe problem.
     */
    expect(dressy, 'a dressy garment per dinner').toBeLessThanOrEqual(6)
  })

  /*
   * Warmth is chosen by *Suits the conditions*, which reads a FORECAST. This
   * harness plans without one, so no scenario here can prefer a parka and an
   * assertion that it did would be testing the fixture. Stated rather than
   * quietly dropped: the conditions criterion is proved in
   * `tests/unit/worker/outfits.test.ts`, and the weather-versus-outfit conflict
   * end to end in `tests/e2e/weather-today.spec.ts`.
   *
   * What this file can still hold is that a cold-destination trip comes out as a
   * complete, ordinary list rather than as nothing — the failure that would
   * follow from the planner refusing every garment it could not weather-match.
   */
  it('still dresses a trip whose conditions are unknown', async () => {
    const { entries, groups } = await pack(SCENARIOS[3]!)

    expect(groups.length).toBeGreaterThan(0)
    expect(units(entries, () => true)).toBeGreaterThan(0)
  })

  /**
   * The invariant that matters most, and the one the simulations turned up.
   *
   * `refreshGroupStatus` VETOES approving an outfit with a required garment
   * missing, and `syncChecklistFromOutfits` only reads approved groups. So a
   * wardrobe one garment short of a template does not produce a slightly worse
   * packing list — it produces NOTHING from that occasion, including the
   * garments the planner did choose. A trip can end up nearly empty.
   *
   * That is the right behaviour: claiming an outfit Alex cannot actually wear is
   * the confident-and-wrong answer doc 09 §25 forbids. What would be wrong is it
   * happening QUIETLY. So the rule is not "always pack a lot" — it is that a thin
   * list must always come with a reason attached to it.
   *
   * Proved by construction: this scenario's wardrobe genuinely cannot fill a
   * beach template twice over, so the beach group is incomplete, and the test
   * asserts the signal exists rather than asserting the list is full.
   */
  it('never comes out thin without saying why', async () => {
    for (const scenario of SCENARIOS) {
      const { entries, groups } = await pack(scenario)

      const nights = scenario.days?.length ?? 1
      const clothing = units(
        entries,
        (e) => e.category !== 'Toiletries' && e.category !== 'Travel Gear',
      )
      if (clothing >= nights) continue

      // Thin. There must be an unresolved outfit saying so — which is what the
      // trip screen reports as "N outfits need attention".
      const unresolved = groups.filter((group) => group.status !== 'approved')
      expect(
        unresolved.length,
        `${scenario.name}: ${clothing} garments for ${nights} days, and nothing flagged`,
      ).toBeGreaterThan(0)
    }
  })

  it('asks for no bag decisions on a trip with no flight', async () => {
    const { bags } = await pack(SCENARIOS[4]!)

    /*
     * A drive has no hold to lose, so there is nothing to keep out of it and
     * nothing to warn about. Both used to fire on every trip.
     */
    expect(bags.resilience.size).toBe(0)
    expect(bags.problems.filter((p) => p.kind === 'no_safe_bag')).toEqual([])
  })
})
