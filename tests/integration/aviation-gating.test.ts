import { describe, expect, it } from 'vitest'
import {
  airTravel,
  availableBags,
  bagContext,
  isFlying,
  mentionsAviation,
  NO_TRAITS,
  planBags,
  recommendBag,
  resilienceSet,
  type CarriedBag,
} from '@shared/bags'
import { bagQuestionsFor, traitsOfItem, type LiveTrip } from '@shared/bag-questions'
import type { ChecklistEntry } from '@shared/checklist'
import { openQuestions } from '@shared/readiness'
import { UNRECORDED_TRAITS, type Item } from '@shared/items'
import type { Trip } from '@shared/trips'

/**
 * Aviation questions belong to trips with aeroplanes in them (V1.1).
 *
 * ## The defect, as Alex reported it
 *
 * Pack Smart asked flight questions on a trip with no flight.
 *
 * ## The defect, as the code had it
 *
 * `flightHours: null` was read two ways at once, and both readings were
 * individually correct:
 *
 *   - `isFlying` read it as **not flying**, so liquids and delayed-bag
 *     resilience stayed quiet. Right, and the reason the worst version of this
 *     bug never shipped.
 *   - `openQuestions` read it as **not answered**, and asked *How long is the
 *     longest flight?* Also right — the trip genuinely had not said.
 *
 * A boolean cannot hold *we do not know* and *there is no flight* apart, so
 * "not answered" was the permanent state of every road trip and the question
 * came back on every visit. `Not now` deferred it and stored nothing; the only
 * number Alex could type would have been a lie.
 *
 * ## The fix, in one sentence
 *
 * `flightHours` becomes tri-state on the way OUT — `airTravel` returns `yes`,
 * `no` or `unknown` — and `0` is made answerable in one tap. No new column, no
 * migration, no second source of truth about whether Alex is at an airport.
 *
 * Every test below fails on `825c31a`.
 */

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function trip(partial: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    name: 'Trip',
    emoji: null,
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    status: 'planning',
    destinations: [],
    activities: [],
    days: [],
    notes: null,
    international: null,
    laundryAvailable: null,
    maxDressiness: null,
    luggageMode: null,
    bags: null,
    flightHours: null,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  } as unknown as Trip
}

/** A drive to the coast: Alex has SAID there is no flight. */
const ROAD_TRIP = trip({ name: 'Drive to the coast', flightHours: 0 })

/** A trip that has not been asked yet. Not the same thing, and must not be. */
const UNASKED = trip({ name: 'Somewhere', flightHours: null })

/** A real flight. */
const FLIGHT = trip({ name: 'Lisbon', flightHours: 3 })

function entry(partial: Partial<ChecklistEntry> = {}): ChecklistEntry {
  return {
    id: 'e1',
    tripId: 't1',
    itemId: 'i1',
    name: 'Thing',
    detail: null, brand: null, color: null,
    category: 'Travel Gear',
    quantity: 1,
    section: 'pack_now',
    packedAt: null,
    excludedAt: null,
    isCritical: false,
    requiresFinalCheck: false,
    bag: null,
    bagSource: null,
    traits: null,
    ...partial,
  } as unknown as ChecklistEntry
}

function item(partial: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    kind: 'gear',
    displayName: 'Shampoo',
    category: 'Toiletries',
    subcategory: null,
    color: null,
    pattern: null,
    brand: null,
    notes: null,
    usageFrequency: 'sometimes',
    warmth: null,
    dressiness: null,
    dressinessContexts: [],
    weatherTags: [],
    typicalUses: [],
    reuseCapacity: null,
    ownedQuantity: null,
    ...UNRECORDED_TRAITS,
    isCritical: false,
    requiresFinalCheck: false,
    defaultPackingTiming: 'anytime',
    alwaysInclude: false,
    neverInclude: false,
    archivedAt: null,
    source: 'manual',
    comfort: null,
    versatility: null,
    fieldProvenance: {},
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  } as unknown as Item
}

function liveTrip(t: Trip, entries: ChecklistEntry[]): LiveTrip {
  return { tripId: t.id, tripName: t.name, context: bagContext(t), entries }
}

/* ------------------------------------------------------------------ */
/* the three states                                                    */
/* ------------------------------------------------------------------ */

describe('flightHours is read as three states, not two', () => {
  it('tells "no flight" apart from "not asked"', () => {
    expect(airTravel({ flightHours: 3 })).toBe('yes')
    expect(airTravel({ flightHours: 0 })).toBe('no')
    expect(airTravel({ flightHours: null })).toBe('unknown')
  })

  /*
   * The rules gate and the language gate are deliberately different, and this
   * is the pair that says why. Acting on a guess puts a wrong liquid limit on a
   * car journey; refusing to ASK on a guess means the question can never be
   * answered. So `flying` is false when unknown and `mentionsAviation` is true.
   */
  it('does not apply aviation rules on a guess, but may still ask', () => {
    expect(isFlying(UNASKED)).toBe(false)
    expect(mentionsAviation(UNASKED)).toBe(true)
  })

  it('goes fully quiet only once Alex has said there is no flight', () => {
    expect(isFlying(ROAD_TRIP)).toBe(false)
    expect(mentionsAviation(ROAD_TRIP)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* 1D — the question Alex could not answer                             */
/* ------------------------------------------------------------------ */

describe('the flight question can be answered "not flying"', () => {
  /** The defect, stated as a test: on a road trip this used to be unanswerable. */
  it('offers a one-tap answer that is not a number', () => {
    const question = openQuestions(UNASKED).find((q) => q.fact === 'flight_hours')
    expect(question).toBeDefined()
    expect(question!.escape).toEqual({ label: 'Not flying', value: 0 })
  })

  it('stops asking once that answer is given', () => {
    expect(openQuestions(ROAD_TRIP).map((q) => q.fact)).not.toContain('flight_hours')
  })

  /*
   * The whole point of the escape answer: what it records must be a value the
   * rest of the engine already understands, not a new flag. Answering with the
   * escape value has to produce `airTravel === 'no'`.
   */
  it('records a value the rest of the engine reads as "no flight"', () => {
    const { escape } = openQuestions(UNASKED).find((q) => q.fact === 'flight_hours')!
    expect(airTravel({ flightHours: escape!.value as number })).toBe('no')
  })

  it('still asks the non-aviation questions on a road trip', () => {
    // Leaving the country and having laundry are true of a drive to France.
    expect(openQuestions(ROAD_TRIP).map((q) => q.fact)).toEqual([
      'international',
      'laundry_available',
    ])
  })
})

/* ------------------------------------------------------------------ */
/* 1B — no aviation semantics on a non-flight trip                     */
/* ------------------------------------------------------------------ */

describe('a non-flight trip gets no cabin-and-hold vocabulary', () => {
  it('does not invent three airline bags for a trip with no flight', () => {
    expect(availableBags({ luggageMode: null, bags: null, flightHours: 0 })).toEqual([])
  })

  it('keeps the generous default while the answer is still unknown', () => {
    expect(availableBags({ luggageMode: null, bags: null, flightHours: null })).toEqual([
      'personal_item',
      'carry_on',
      'checked',
    ])
  })

  /*
   * Legacy compatibility must not imply a flight (brief 1D).
   *
   * `luggageMode: 'checked'` predates migration 0025 and meant "I am taking a
   * suitcase". Suitcases go in cars. Reading that column as evidence of air
   * travel would reintroduce the defect through the one door the tri-state
   * cannot see.
   */
  it('does not read the legacy luggage column as evidence of a flight', () => {
    expect(airTravel({ flightHours: 0 })).toBe('no')
    expect(availableBags({ luggageMode: 'checked', bags: null, flightHours: 0 })).toEqual([])
    expect(bagContext(trip({ luggageMode: 'checked', flightHours: 0 })).flying).toBe(false)
  })

  /* Bag PRESENCE is not evidence of a flight either (brief 1D). */
  it('does not read a chosen bag as evidence of a flight', () => {
    const drive = trip({ flightHours: 0, bags: ['checked'] as CarriedBag[] })
    expect(bagContext(drive).flying).toBe(false)
    expect(mentionsAviation(drive)).toBe(false)
    // His explicit choice is still honoured — hiding a control never discards an answer.
    expect(bagContext(drive).bags).toEqual(['checked'])
  })

  it('says nothing about liquids and security without a flight', () => {
    const context = bagContext(ROAD_TRIP)
    const fullSize = entry({ category: 'Toiletries', traits: { ...NO_TRAITS, liquid: true, liquidSize: 'full' } })
    expect(recommendBag(fullSize, context, fullSize.traits!)).toBeNull()
  })

  it('protects nothing against a delayed checked bag without a flight', () => {
    const entries = [
      entry({ id: 'e1', name: 'Underwear', category: 'Accessories & Undergarments' }),
      entry({ id: 'e2', name: 'Socks', category: 'Accessories & Undergarments' }),
    ]
    expect(resilienceSet(entries, bagContext(ROAD_TRIP)).size).toBe(0)
    // And the delayed-bag section on the trip screen is driven by exactly this.
    expect(planBags(ROAD_TRIP, entries).resilience.size).toBe(0)
  })

  it('raises no bag problems about a hold that does not exist', () => {
    const passport = entry({ name: 'Passport', category: 'Documents' })
    expect(planBags(ROAD_TRIP, [passport]).problems).toEqual([])
  })

  /*
   * The five bag questions, all of them, gone on a road trip.
   *
   * Not by a new list of exceptions — by the simulation that was already there.
   * With no cabin and no hold, every answer to every question lands the row in
   * the same place, so `answersDisagree` retires all five on its own. That is
   * the property worth asserting: the gate is one fact, not five patches.
   */
  it('asks none of the five bag questions on a road trip', () => {
    const shampoo = item({ displayName: 'Shampoo', category: 'Toiletries' })
    const entries = [
      entry({ id: 'e1', itemId: shampoo.id, name: 'Shampoo', category: 'Toiletries' }),
      entry({ id: 'e2', itemId: 'i2', name: 'Underwear', category: 'Accessories & Undergarments' }),
    ]
    const questions = bagQuestionsFor(shampoo, [liveTrip(ROAD_TRIP, entries)], traitsOfItem(shampoo))
    expect(questions).toEqual([])
  })

  it('asks no aviation question about a jumper for the car', () => {
    const jumper = item({
      kind: 'clothing',
      displayName: 'Quarter-Zip',
      category: 'Tops & Outerwear',
      subcategory: 'Mid-Layer',
    })
    const entries = [entry({ id: 'e1', itemId: jumper.id, name: 'Quarter-Zip', category: 'Tops & Outerwear' })]
    expect(bagQuestionsFor(jumper, [liveTrip(ROAD_TRIP, entries)], traitsOfItem(jumper))).toEqual([])
  })

  /* A road trip with a swim day is still a road trip (brief 13). */
  it('handles a road trip with swimming without an aviation prompt', () => {
    const swimTrip = trip({ name: 'Lakes', flightHours: 0, activities: ['swimming'] })
    expect(openQuestions(swimTrip).map((q) => q.fact)).not.toContain('flight_hours')
    expect(planBags(swimTrip, [entry({ name: 'Swim Trunks', category: 'Bottoms & Swimwear' })]).problems).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* 1C — nothing about a real flight regresses                          */
/* ------------------------------------------------------------------ */

describe('a flying trip keeps every P3 behaviour it had', () => {
  it('still puts a full-size liquid in the hold', () => {
    const context = bagContext(FLIGHT)
    const shampoo = entry({
      category: 'Toiletries',
      traits: { ...NO_TRAITS, liquid: true, liquidSize: 'full' },
    })
    expect(recommendBag(shampoo, context, shampoo.traits!)).toEqual({
      bag: 'checked',
      why: 'Too big for cabin security.',
    })
  })

  it('still keeps a small set back against a delayed checked bag', () => {
    const entries = [
      entry({ id: 'e1', name: 'Underwear', category: 'Accessories & Undergarments' }),
      entry({ id: 'e2', name: 'Socks', category: 'Accessories & Undergarments' }),
      entry({ id: 'e3', name: 'T-Shirt', category: 'Tops & Outerwear' }),
    ]
    expect(resilienceSet(entries, bagContext(FLIGHT)).size).toBeGreaterThan(0)
  })

  it('still keeps a passport out of the hold', () => {
    const passport = entry({ name: 'Passport', category: 'Documents' })
    const advice = planBags(FLIGHT, [passport]).advice.get(passport.id)
    expect(advice?.bag).toBe('personal_item')
  })

  it('still asks a liquid question when the answer would move the bottle', () => {
    const shampoo = item({ displayName: 'Shampoo', category: 'Toiletries' })
    const entries = [entry({ id: 'e1', itemId: shampoo.id, name: 'Shampoo', category: 'Toiletries' })]
    const questions = bagQuestionsFor(shampoo, [liveTrip(FLIGHT, entries)], traitsOfItem(shampoo))
    expect(questions.map((q) => q.key)).toContain('liquid')
  })

  it('still raises the no-safe-bag conflict when the hold is the only bag', () => {
    const holdOnly = trip({ flightHours: 3, bags: ['checked'] as CarriedBag[] })
    const passport = entry({ name: 'Passport', category: 'Documents' })
    expect(planBags(holdOnly, [passport]).problems.map((p) => p.kind)).toContain('no_safe_bag')
  })

  /* A trip nobody has asked about must behave exactly as it did before V1.1. */
  it('leaves an unasked trip exactly as it was', () => {
    const context = bagContext(UNASKED)
    expect(context.bags).toEqual(['personal_item', 'carry_on', 'checked'])
    expect(context.flying).toBe(false)
    expect(context.checked).toBe(true)
    expect(context.cabin).toEqual(['personal_item', 'carry_on'])
  })
})
