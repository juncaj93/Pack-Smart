import type { BagKey, ChecklistEntry } from './checklist'
import type { Trip } from './trips'

/**
 * Which bag each thing goes in (P3).
 *
 * The rules, and nothing else: this module is pure, takes what it needs as
 * arguments, and is shared by the Worker and the screens so neither can hold a
 * different opinion about where Alex's passport should be.
 *
 * ## Three things it will not do
 *
 * **It will not put a safety-floor item in the hold.** Not to relieve capacity
 * pressure, not because the hold is the only bag selected, not for any reason.
 * When there is nowhere safe it says so and recommends nothing — see
 * `mustStayWithYou` and `bagProblems`.
 *
 * **It will not read a missing fact as a negative one.** Every trait is
 * `boolean | null`, and `null` is *not recorded*. "We do not know whether this
 * is a full-size liquid" must never become "this is not a full-size liquid".
 *
 * **It will not assume a flight.** Liquid limits and delayed-bag resilience are
 * aviation facts. On a drive to the coast they are noise, and a recommendation
 * that cites them is one Alex stops trusting.
 */

/* ------------------------------------------------------------------ */
/* what the trip is carrying                                           */
/* ------------------------------------------------------------------ */

/** The bags a trip can actually put something in. `wear` and `either` are answers, not bags. */
export type CarriedBag = 'personal_item' | 'carry_on' | 'checked'

export const CARRIED_BAGS: readonly CarriedBag[] = ['personal_item', 'carry_on', 'checked']

export function isCarriedBag(value: string): value is CarriedBag {
  return (CARRIED_BAGS as readonly string[]).includes(value)
}

/**
 * The bags this trip is bringing.
 *
 * `bags_json` when Alex has said, and the old `luggageMode` when he has not —
 * which is every trip that predates migration 0025, and is why that column is
 * still read rather than dropped. The fallback is deliberately generous in the
 * cabin direction: `carry_on` meant "I am not checking a bag", which in practice
 * is a carry-on AND the personal item under the seat, and reading it as
 * carry-on alone would push things Alex keeps on him into an overhead bin.
 *
 * An EMPTY array is a real answer — "none of these" — and is not the same as
 * not having answered. A road trip has no personal item in the aviation sense,
 * and the recommendations for it are about convenience rather than cabins.
 */
export function availableBags(trip: Pick<Trip, 'luggageMode'> & { bags?: CarriedBag[] | null }): CarriedBag[] {
  if (trip.bags) return CARRIED_BAGS.filter((bag) => trip.bags!.includes(bag))

  if (trip.luggageMode === 'carry_on') return ['personal_item', 'carry_on']
  if (trip.luggageMode === 'checked') return ['personal_item', 'carry_on', 'checked']

  // Unknown, or never asked. Every bag is a possibility, which keeps the
  // recommendations exactly as generous as they were before this existed.
  return [...CARRIED_BAGS]
}

/**
 * Whether this trip involves a flight.
 *
 * Derived from `flightHours` rather than stored a second time: the trip already
 * records it, the trip sheet already asks, and a second source of truth for one
 * boolean is how the two come to disagree. Null means unanswered, which is
 * treated as *not flying* for the two rules that are purely aviation — a liquid
 * limit invented for a car journey is worse than one not mentioned for a flight,
 * because the second is merely incomplete and the first is wrong.
 */
export function isFlying(trip: Pick<Trip, 'flightHours'>): boolean {
  return typeof trip.flightHours === 'number' && trip.flightHours > 0
}

/** Everything the rules need to know about the trip, worked out once. */
export interface BagContext {
  bags: CarriedBag[]
  flying: boolean
  /** True when a checked bag is coming, so a delay is a thing to protect against. */
  checked: boolean
  /** The cabin bags, in the order they are preferred for something small and important. */
  cabin: CarriedBag[]
}

export function bagContext(
  trip: Pick<Trip, 'luggageMode' | 'flightHours'> & { bags?: CarriedBag[] | null },
): BagContext {
  const bags = availableBags(trip)
  const cabin = bags.filter((bag) => bag !== 'checked')
  return { bags, flying: isFlying(trip), checked: bags.includes('checked'), cabin }
}

/* ------------------------------------------------------------------ */
/* what an item is                                                     */
/* ------------------------------------------------------------------ */

/**
 * The seven facts that change a bag recommendation. `null` is NOT RECORDED.
 *
 * Read live from the catalog row rather than snapshotted onto the checklist,
 * for the same reason recommendations are computed rather than stored: telling
 * Pack Smart that a bottle is full-size should fix every trip, not the next one.
 */
export interface ItemTraits {
  liquid: boolean | null
  /** `cabin` is within the usual 100ml limit; `full` is not. Null is unknown. */
  liquidSize: 'cabin' | 'full' | null
  fragile: boolean | null
  valuable: boolean | null
  medical: boolean | null
  transitNeeded: boolean | null
  bulky: boolean | null
  /**
   * Whether losing this for a day would actually matter (P3b, migration 0026).
   *
   * The one trait that is about CONSEQUENCE rather than about the thing itself,
   * and the only input `resilienceSet` will take from Alex. `true` keeps it out
   * of the hold whatever the subcategory rules think; `false` keeps it out of
   * the resilience set even when they would have picked it. Null is unknown and
   * leaves the rules exactly as they were.
   */
  delaySensitive: boolean | null
}

export const NO_TRAITS: ItemTraits = {
  liquid: null,
  liquidSize: null,
  fragile: null,
  valuable: null,
  medical: null,
  transitNeeded: null,
  bulky: null,
  delaySensitive: null,
}

/* ------------------------------------------------------------------ */
/* the safety floor                                                    */
/* ------------------------------------------------------------------ */

/**
 * Categories whose contents do not go in the hold, ever.
 *
 * `Electronics` is here for a rule that is not Pack Smart's opinion: loose
 * lithium batteries are prohibited in checked baggage, and a power bank in the
 * hold is a thing airlines remove and airports announce. The other three are
 * the ones that end a trip rather than inconvenience it.
 */
const FLOOR_CATEGORIES = new Set(['Documents', 'Medication', 'Vision', 'Electronics'])

/**
 * Whether this must travel in the cabin, whatever else is true.
 *
 * **The hard rule of P3, and the one with mutation-checked tests.** Capacity
 * pressure does not override it, a checked-only trip does not override it, and
 * no recommendation below may return `checked` for anything this says yes to.
 *
 * `isCritical` is Alex's own flag on the catalog row, so it is his judgement
 * rather than an inference — and it is the catch-all for the things no category
 * describes: keys, a wallet, the one charger that matters.
 */
export function mustStayWithYou(entry: ChecklistEntry, traits: ItemTraits = NO_TRAITS): boolean {
  if (FLOOR_CATEGORIES.has(entry.category)) return true
  if (entry.isCritical) return true
  return traits.medical === true || traits.valuable === true || traits.transitNeeded === true
}

/* ------------------------------------------------------------------ */
/* the recommendation                                                  */
/* ------------------------------------------------------------------ */

export interface BagAdvice {
  bag: BagKey
  /** One short sentence. Never a rule chain, never a score. */
  why: string
}

/**
 * Where Pack Smart thinks a row goes, or null when it has nothing to say.
 *
 * Deliberately quiet, and that has not changed: a suggestion on every row is a
 * screen full of advice, and an unrecommended row simply says nothing. What
 * HAS changed is that it now knows which bags exist, whether there is a flight,
 * and seven facts about the thing itself.
 *
 * Returns null rather than a bag when the honest answer is "nowhere safe" —
 * `bagProblems` is what says so, once, at the top of the screen, instead of
 * every affected row quietly claiming the hold.
 */
export function recommendBag(
  entry: ChecklistEntry,
  /* Defaults to a trip that has said nothing, which reproduces the pre-P3
   * answer exactly — see `NO_TRIP_CONTEXT`. Evaluated at call time, so its
   * being declared below this function is not a problem. */
  context: BagContext = NO_TRIP_CONTEXT,
  traits: ItemTraits = NO_TRAITS,
  /** Rows chosen for the delayed-bag set, by entry id. See `resilienceSet`. */
  resilience: ReadonlySet<string> = new Set(),
): BagAdvice | null {
  /* --- the floor, before anything else -------------------------------- */

  if (mustStayWithYou(entry, traits)) {
    const bag = context.cabin.includes('personal_item')
      ? 'personal_item'
      : context.cabin[0]
    // Nowhere safe. Said once by `bagProblems`, not implied here.
    if (!bag) return null
    return { bag, why: floorReason(entry, traits) }
  }

  /* --- the delayed-bag set -------------------------------------------- */

  if (resilience.has(entry.id)) {
    const bag = context.cabin.includes('carry_on') ? 'carry_on' : context.cabin[0]
    if (bag) return { bag, why: 'Useful if your checked bag is delayed.' }
  }

  /* --- liquids, which are only a rule in the air ---------------------- */

  if (context.flying && traits.liquid === true) {
    if (traits.liquidSize === 'full') {
      if (context.checked) return { bag: 'checked', why: 'Too big for cabin security.' }
      // No hold to put it in. Saying "checked" would be advice he cannot take.
      return null
    }
    if (traits.liquidSize === 'cabin' && context.cabin.length > 0) {
      return { bag: cabinDefault(context), why: 'Small enough for your cabin bag.' }
    }
    // Liquid, size not recorded. Nothing useful to say, and guessing the size
    // is the one guess with a security queue at the end of it.
    return null
  }

  /* --- fragile, which is about handling rather than the air ----------- */

  if (traits.fragile === true && context.cabin.length > 0) {
    return { bag: cabinDefault(context), why: 'Breakable — better kept with you.' }
  }

  /* --- bulk, which is only worth saying when there is a hold ---------- */

  if (traits.bulky === true && context.checked) {
    return { bag: 'checked', why: 'Bulky, and losing a day of it would only be annoying.' }
  }

  return null
}

/** The cabin bag something small and important should default to. */
function cabinDefault(context: BagContext): CarriedBag {
  return context.cabin.includes('carry_on')
    ? 'carry_on'
    : (context.cabin[0] ?? 'personal_item')
}

function floorReason(entry: ChecklistEntry, traits: ItemTraits): string {
  if (entry.category === 'Documents') return 'You need it before you reach the bag.'
  if (entry.category === 'Medication' || traits.medical === true) {
    return 'Medication stays with you — a checked bag can go astray.'
  }
  if (entry.category === 'Vision') return 'You would not want to land without it.'
  if (entry.category === 'Electronics') return 'Batteries are not allowed in the hold.'
  if (traits.valuable === true) return 'Too valuable to put in the hold.'
  if (traits.transitNeeded === true) return 'You will want this on the way.'
  return 'You marked this essential, so it travels with you.'
}

/* ------------------------------------------------------------------ */
/* delayed-bag resilience                                              */
/* ------------------------------------------------------------------ */

/**
 * The smallest set worth having in the cabin if the hold bag is late.
 *
 * **Only when a checked bag is actually coming**, and only on a flight — a
 * checked bag that travels in the boot of your own car does not go missing in
 * Frankfurt. Bounded hard: the point is the first twenty-four hours, not a
 * second copy of the packing list, and a cabin bag stuffed with contingency is
 * its own kind of bad advice.
 *
 * Chosen by subcategory rather than by name, and the list is short and stated:
 * underwear, socks, one top, one bottom. Anything critical is already handled
 * by the floor and is deliberately not counted here.
 */
const RESILIENCE_SUBCATEGORIES: ReadonlyArray<{ match: RegExp; take: number }> = [
  { match: /underwear|boxer|brief|knicker/i, take: 1 },
  { match: /sock/i, take: 1 },
  { match: /t-?shirt|top|shirt|blouse/i, take: 1 },
  { match: /trouser|pant|short|skirt|jean/i, take: 1 },
]

/**
 * How many things Alex may add to the set himself before it stops being small.
 *
 * His answers outrank the rules — that is the whole point of asking — but
 * "outranks" is not "unbounded". A cabin bag holding twelve contingency items
 * is the failure mode this cap exists for, and it is a cap he can always work
 * around by placing something himself, which is a deliberate choice rather than
 * an accumulation of yeses.
 */
export const RESILIENCE_USER_CAP = 4

/** The largest a resilience set may ever be, whatever the trip's length. */
export const RESILIENCE_CAP = RESILIENCE_SUBCATEGORIES.length + RESILIENCE_USER_CAP

/**
 * The delayed-bag set, with Alex's own answers taken first.
 *
 * Two passes, and the order is the ruling: **a recorded `delaySensitive` beats
 * the subcategory guess in both directions.** `true` puts something in that no
 * rule would have picked — the one jumper he would actually miss — and `false`
 * keeps something out that a rule did pick, which is the half a
 * can-only-add trait would have silently dropped.
 */
export function resilienceSet(
  entries: ChecklistEntry[],
  context: BagContext,
  traitsOf: (entry: ChecklistEntry) => ItemTraits = (entry) => entry.traits ?? NO_TRAITS,
  detailOf: (entry: ChecklistEntry) => string | null = (entry) => entry.detail,
): Set<string> {
  const chosen = new Set<string>()
  if (!context.flying || !context.checked || context.cabin.length === 0) return chosen

  /** A row already spoken for by Alex is never a candidate, in either pass. */
  const candidate = (entry: ChecklistEntry) =>
    entry.excludedAt === null && entry.bagSource !== 'user'

  // Pass one: what he actually told us, capped so "outranks" stays bounded.
  let added = 0
  for (const entry of entries) {
    if (added >= RESILIENCE_USER_CAP) break
    if (!candidate(entry)) continue
    if (traitsOf(entry).delaySensitive !== true) continue
    chosen.add(entry.id)
    added += 1
  }

  // Pass two: the rules, filling what he has not spoken about.
  for (const rule of RESILIENCE_SUBCATEGORIES) {
    let taken = 0
    for (const entry of entries) {
      if (taken >= rule.take) break
      if (!candidate(entry)) continue
      // Already in from pass one — it counts towards the rule it satisfies.
      if (chosen.has(entry.id)) {
        if (rule.match.test(`${entry.name} ${detailOf(entry) ?? ''}`)) taken += 1
        continue
      }
      // An explicit no. The rule would have picked this, and he said not to.
      if (traitsOf(entry).delaySensitive === false) continue
      const haystack = `${entry.name} ${detailOf(entry) ?? ''}`
      if (!rule.match.test(haystack)) continue
      chosen.add(entry.id)
      taken += 1
    }
  }

  return chosen
}

/* ------------------------------------------------------------------ */
/* what cannot be packed safely, and what is getting full              */
/* ------------------------------------------------------------------ */

export interface BagProblem {
  kind: 'no_safe_bag' | 'crowded'
  /** One sentence, already written for the screen. */
  message: string
}

/**
 * The things worth saying about the plan as a whole, said once.
 *
 * **`no_safe_bag` is not a suggestion.** It is the case §4 names: a trip where
 * the only bag is the hold and something must not go in it. The planner refuses
 * to assign rather than inventing an unsafe answer, and this is how Alex finds
 * out — with the count, so he can see it is four things rather than one.
 *
 * `crowded` is a warning and nothing more. Capacity pressure is never a reason
 * to move a safety-floor item, and no code path here does.
 */
export function bagProblems(
  entries: ChecklistEntry[],
  context: BagContext,
  traitsOf: (entry: ChecklistEntry) => ItemTraits,
  /**
   * Where each row ACTUALLY ends up — Alex's choice or Pack Smart's answer.
   *
   * Required rather than defaulted, and that is the fix. This counted
   * `entry.bag`, which is only written when Alex assigns a bag himself: on a
   * trip where he has assigned nothing every row reads `null`, so the crowding
   * warning could not fire at all. It would have shipped as a feature that
   * looks like it works and never says anything.
   *
   * A default of `entry.bag` would have kept that behaviour available to any
   * caller who forgot the argument, which is the same defect with a longer
   * fuse. There is one resolver — `planBags` — and everything reads it.
   */
  resolved: ReadonlyMap<string, BagResolution>,
): BagProblem[] {
  const problems: BagProblem[] = []
  const bringing = entries.filter((entry) => entry.excludedAt === null)

  /*
   * A hold-safety conflict needs a HOLD.
   *
   * `context.cabin.length === 0` is true for two completely different trips:
   * one where the checked bag is the only bag, and one carrying none of these
   * at all — which is every drive and every train. Warning the second that a
   * passport "should not go in a checked bag" is advice about a bag that does
   * not exist, on a trip where no aviation rule applies.
   */
  if (context.checked && context.cabin.length === 0) {
    const stranded = bringing.filter((entry) => mustStayWithYou(entry, traitsOf(entry)))
    if (stranded.length > 0) {
      const what =
        stranded.length === 1 ? stranded[0]!.name : `${stranded.length} things you are packing`
      problems.push({
        kind: 'no_safe_bag',
        /*
         * Says the problem and the two ways out, and does not pretend to have
         * solved it. The planner has already refused to name a bag for these
         * rows; this is where that refusal becomes something Alex can act on.
         */
        message:
          `${what} should not go in a checked bag, and that is the only bag you are taking. ` +
          `Add a personal item or carry-on, or choose a bag yourself.`,
      })
    }
  }

  /*
   * Crowding, kept as simple as doc 09 §8.4 asks for: a count of bulky things
   * in a bag that is not the hold. No volumes, no weights, no model of a
   * suitcase — those would be a system nobody has evidence is needed, and it
   * would still be guessing.
   *
   * Counted on the RESOLVED bag, so a bulky thing the floor or the delayed-bag
   * set pulled into the cabin counts exactly like one Alex put there. Rows the
   * planner declined to place are skipped rather than invented into a bag.
   */
  for (const bag of context.cabin) {
    const bulky = bringing.filter(
      (entry) => resolved.get(entry.id)?.bag === bag && traitsOf(entry).bulky === true,
    ).length
    if (bulky >= 3) {
      problems.push({
        kind: 'crowded',
        message:
          bag === 'personal_item'
            ? `Several bulky things are in your personal bag.`
            : `Your carry-on may be getting full.`,
      })
    }
  }

  return problems
}

/* ------------------------------------------------------------------ */
/* the answer a row shows                                              */
/* ------------------------------------------------------------------ */

/**
 * A trip that has said nothing.
 *
 * Every bag possible, no flight. Chosen so that `bagFor(entry)` with no context
 * behaves EXACTLY as it did before P3 — the safety floor reproduces the old
 * category table and the `isCritical` fallback, and no trait rule can fire
 * without traits. Callers that have a trip pass one and get the better answer;
 * callers that do not are not silently given a worse one.
 */
export const NO_TRIP_CONTEXT: BagContext = {
  bags: [...CARRIED_BAGS],
  flying: false,
  checked: true,
  cabin: ['personal_item', 'carry_on'],
}

/**
 * The bag a row should show, and where that answer came from.
 *
 * **An explicit choice always wins, and is never overwritten.** That is the
 * whole reason `bag` and `bag_source` are two columns, and P3 does not touch
 * it: a better rule may not move something Alex has placed. The recommendation
 * is still COMPUTED rather than stored, so improving these rules improves every
 * existing trip without a migration and without a single write.
 */
export function bagFor(
  entry: ChecklistEntry,
  context: BagContext = NO_TRIP_CONTEXT,
  traits: ItemTraits = NO_TRAITS,
  resilience: ReadonlySet<string> = new Set(),
): { bag: BagKey | null; source: 'recommended' | 'user' | null; why: string | null } {
  if (entry.bag && entry.bagSource === 'user') {
    return { bag: entry.bag, source: 'user', why: null }
  }

  const suggested = recommendBag(entry, context, traits, resilience)
  if (suggested) return { bag: suggested.bag, source: 'recommended', why: suggested.why }

  // A stored recommendation from an earlier release whose rule has since gone.
  if (entry.bag) return { bag: entry.bag, source: entry.bagSource ?? 'recommended', why: null }

  return { bag: null, source: null, why: null }
}

/* ------------------------------------------------------------------ */
/* the whole answer for one trip, worked out once                      */
/* ------------------------------------------------------------------ */

export interface BagResolution {
  bag: BagKey | null
  source: 'recommended' | 'user' | null
  /** One short sentence, or null when the answer speaks for itself. */
  why: string | null
}

export interface BagPlan {
  context: BagContext
  /** Entry ids the delayed-bag set is protecting. Empty unless a hold is coming. */
  resilience: Set<string>
  /** Entry id → where it goes and why. Every row, including the null answers. */
  advice: Map<string, BagResolution>
  problems: BagProblem[]
}

/**
 * Everything the bag rules have to say about one trip.
 *
 * One entry point rather than four, because the four are not independent:
 * `resilienceSet` has to be computed BEFORE `recommendBag` or the delayed-bag
 * rule never fires, and a screen that called `bagFor` directly — as every screen
 * did before this existed — would silently get the answer for a trip with no
 * resilience set at all. That is not a hypothetical: it was the state of the
 * code, and it is why the delayed-bag question could not have been asked
 * honestly until this function existed.
 *
 * Pure, and computed on read like everything else here. Nothing is stored, so a
 * better rule improves every trip that already exists.
 */
export function planBags(
  trip: Pick<Trip, 'luggageMode' | 'flightHours'> & { bags?: CarriedBag[] | null },
  entries: ChecklistEntry[],
): BagPlan {
  const context = bagContext(trip)
  const traitsOf = (entry: ChecklistEntry): ItemTraits => entry.traits ?? NO_TRAITS
  const resilience = resilienceSet(entries, context, traitsOf)

  const advice = new Map<string, BagResolution>()
  for (const entry of entries) {
    advice.set(entry.id, bagFor(entry, context, traitsOf(entry), resilience))
  }

  // Problems last: crowding is counted on the resolved bags above, so the
  // advice has to exist before it can be read.
  return { context, resilience, advice, problems: bagProblems(entries, context, traitsOf, advice) }
}
