import type { DressinessContext } from './dressiness'
import type { Item } from './items'

/**
 * Whether a garment suits what Alex is actually DOING (V1.1).
 *
 * ## The defect this exists for
 *
 * On the real closet, the beach outfit came out as:
 *
 * ```
 * swim       Swim Trunks
 * top        Button-Up Shirt      <- a smart-casual shirt, at the beach
 * footwear   White Sneakers       <- sneakers, at the beach
 * ```
 *
 * Nothing was broken in the sense of a rule misfiring. Every gate passed
 * honestly, and that is the point: the planner had no representation of
 * *appropriate for this activity* at all. It had formality, warmth, rain and a
 * coarse `typicalUses` intersection, and all four said yes.
 *
 * ## Why formality alone could not fix it
 *
 * `Button-Up Shirt` is recorded `Smart casual`, and the beach template accepts
 * the band `[0,2]` — Loungewear through Smart casual. So it fitted. Narrowing
 * that band would fix this one garment and immediately break the next case,
 * because **dressiness and activity compatibility are different questions**. A
 * Smart casual shirt is right for a city dinner and wrong on sand; a Loungewear
 * slide is wrong for the dinner and right by the pool. One axis cannot order
 * both.
 *
 * ## What it will not do
 *
 * **It will never read a display name.** `Button-Up Shirt` is not excluded for
 * being called a button-up — a casual linen short-sleeve button-up is a
 * perfectly good beach shirt, and `Plaid Button-Up` and `Denim Button-Up`
 * (recorded `Casual`) stay eligible for exactly that reason. What excludes the
 * first two is that they are recorded ONLY as Smart casual. The rule is about
 * structure, and a garment whose structure changes changes answer with it.
 *
 * **It will never turn missing data into a refusal.** Three states, and
 * `unknown` is not `no` — the same posture `fitsContexts` and the `typicalUses`
 * gate already take, and doc 05 §4's rule. Eleven garments in the workbook have
 * no recorded uses and five have no recorded contexts; a model that read
 * silence as unsuitability would empty half the closet.
 *
 * **It will not rank.** It answers eligibility, and `yes`-versus-`unknown` is
 * handed to the ranker as one criterion. Nothing here knows about comfort.
 */

/* ------------------------------------------------------------------ */
/* the answer                                                          */
/* ------------------------------------------------------------------ */

/**
 * Three states, and the middle one is load-bearing.
 *
 * - `yes` — the recorded data gives a positive reason to believe this suits the
 *   activity. Eligible, and preferred over `unknown` in the ranking.
 * - `no` — the recorded data gives a strong reason it does not. **A hard
 *   exclusion**: no rating, no frequency and no versatility can reach past it.
 * - `unknown` — Pack Smart cannot tell. Eligible, ranked below `yes`, and the
 *   only state that is ever worth asking Alex about.
 */
export type ActivityFit = 'yes' | 'no' | 'unknown'

/* ------------------------------------------------------------------ */
/* the rules, per activity                                             */
/* ------------------------------------------------------------------ */

interface ActivityRules {
  /**
   * The formality contexts this activity can actually use, when that is a HARD
   * fact worth stating.
   *
   * A garment that records contexts and shares NONE of them is a hard `no` —
   * that is the rule that excludes a Smart-casual-only shirt from the beach
   * while leaving a Casual one alone. A garment that records NO contexts is
   * untouched by this: absence is not a wrong answer.
   *
   * Note this is a genuinely different set from the template's dressiness band.
   * The band says what the occasion PERMITS and is a ceiling-and-floor; this
   * says what the activity is compatible with, and for the beach that excludes
   * the top of the band the template still nominally allows.
   *
   * **Optional, and usually absent.** Most activities have no formality fact
   * the template's own band does not already enforce, and restating it here
   * would be two authorities for one rule. Beach is the exception precisely
   * because its band is WIDER than the activity — see `BEACH`.
   */
  contexts?: DressinessContext[]

  /**
   * The warmest a garment may be, or undefined when warmth is not the point.
   *
   * `0` is Cool and `3` is Very warm. A heavy sweater at a hot pool is the case
   * this catches, and it catches it from the recorded number rather than from
   * the word "Heavy" in the name.
   */
  maxWarmth?: number

  /**
   * Subcategories that are positive evidence ON THEIR OWN.
   *
   * Reserved for garment types that are unambiguous about the activity —
   * swimwear and sandals at a beach are not a judgement call. Deliberately
   * short: everything arguable belongs in `contextualSubcategories`, where a
   * recorded context has to agree before the answer becomes `yes`.
   */
  strongSubcategories?: string[]

  /**
   * The contexts a garment must share before `contextualSubcategories` will
   * call it a `yes`.
   *
   * Separate from `contexts` on purpose, because they answer different
   * questions. `contexts` is a HARD fact — *this activity cannot use that* —
   * and its absence excludes. This one is only about whether there is enough
   * agreement to make a POSITIVE claim, and its absence merely withholds one.
   *
   * The walking activities need exactly that split, and a test caught it: with
   * `shoes` as unconditional positive evidence, a Formal-only dress shoe was
   * classified `yes` for hiking — "suits a day of walking" — on the strength of
   * being a shoe. The dressiness band rejected it a moment later, so no outfit
   * was ever wrong, but the classification was, and a wrong classification is
   * one refactor away from a wrong outfit.
   *
   * Defaults to `contexts` where an activity states one, so beach is unchanged.
   */
  positiveContexts?: DressinessContext[]

  /**
   * Subcategories that are positive evidence ONLY alongside a compatible
   * recorded context.
   *
   * A t-shirt is a good beach top when it is recorded Casual, and genuinely
   * unknown when nothing is recorded about it at all — which is the state of
   * the three `Layering T-Shirt` rows and both `Undershirt T-Shirt` rows. Those
   * stay `unknown` rather than being promoted on the strength of the word
   * "T-Shirt", and that is the honest answer.
   */
  contextualSubcategories?: string[]

  /** `typicalUses` tags that are positive evidence on their own. */
  strongUses?: string[]

  /**
   * Tags that must not inflate the INFERRED versatility score here.
   *
   * The second half of the beach defect, and the more surprising one. Inferred
   * versatility is `typicalUses.length`, so `Casual / Smart Casual` — which
   * parses to `['casual','dressy']` — scored 2 while a plain casual tee scored
   * 1. **Being dressy is what won the beach slot.** The same arithmetic put
   * `White Sneakers` (`casual`+`dressy`) above `Sandals` (`casual`).
   *
   * A tag the activity cannot use is not breadth, and counting it is not a
   * small unfairness — it is a systematic thumb on the scale for dressier
   * garments in every casual slot in the product. Alex's own 1–5 rating is
   * never touched by this; only the inference is.
   */
  discountedUses?: string[]
}

/**
 * Water, sun and sand — the activity the reported defect happened on.
 *
 * `Beach` and `Pool and downtime` are one rule set because they are one
 * situation: the two templates already carry identical slots, identical
 * `uses` and an identical dressiness band, and giving them two tables would be
 * two things to keep in step for no difference anyone could name.
 *
 * `loungewear` is IN the compatible set, and that is not an oversight. A poolside
 * slide is Loungewear and is exactly right; formality here is not a ladder where
 * lower is worse, which is the whole argument `shared/dressiness.ts` makes.
 */
const BEACH: ActivityRules = {
  contexts: ['loungewear', 'casual'],
  // Warm and Very warm. A light layer against a sea breeze is fine; a sweater
  // is not, and 2 is where the recorded scale puts "Warm".
  maxWarmth: 1,
  strongSubcategories: ['swimwear', 'tank top', 'sandals'],
  contextualSubcategories: ['t-shirt', 'shorts'],
  strongUses: ['swim', 'warm_weather'],
  discountedUses: ['dressy', 'work', 'cold_weather', 'cool_weather'],
}

/**
 * The activities Pack Smart has an opinion about, by template activity tag.
 *
 * Everything absent answers `unknown` for every garment, which makes this a
 * no-op for the ten templates not listed — the property that lets an activity
 * be added one at a time with evidence, rather than a table filled in for
 * symmetry. `road_trip` is not here despite being a "travel" activity: nobody
 * has shown a road-trip outfit that is wrong, and a rule with no defect behind
 * it is a guess with a table around it.
 */
/**
 * A day spent walking — and a rule set that is deliberately all preference.
 *
 * ## The defect this exists for
 *
 * Once the beach correctly chose `Slides`, they became the shoe for the whole
 * trip:
 *
 * ```
 * Beach          Slides   <- right
 * Sightseeing    Slides   <- a full day of walking, in slides
 * ```
 *
 * The cause is not a bad rule, it is a good one with nothing to push back on
 * it. Footwear `reuseCapacity` is 99 by design — doc 04 §6's "pack light", so
 * one pair serves the trip — and `Slides`, `White Sneakers` and `Running Shoes`
 * all tie on inferred versatility. *Already packed for another day* then breaks
 * the tie toward whatever the first-assigned group happened to take, and Beach
 * is assigned first because it is the most constrained.
 *
 * ## Why every rule here is SOFT
 *
 * Nothing below excludes anything. `strongSubcategories` only produces `yes`,
 * and `yes` outranks `unknown` in the ranking — which is enough, because the
 * activity criterion sits above both versatility and reuse. A known walking
 * shoe therefore beats a slide that was merely packed first, and the planner
 * ends up carrying two pairs, which is the correct answer for a trip with a
 * beach day and a walking day.
 *
 * A hard exclusion would have been the wrong tool twice over. Some sandals are
 * genuinely walkable, and `subcategory` cannot tell a trekking sandal from a
 * pool slide. And if slides were the only footwear Alex owned, excluding them
 * would produce a coverage gap for a day he can plainly dress for. Preference
 * gets the right answer here without claiming a fact the data does not hold.
 */
const WALKING: ActivityRules = {
  /*
   * Contextual rather than strong, and the difference is a real one.
   *
   * `shoes` as unconditional positive evidence classified a Formal-only dress
   * shoe as suiting a day of walking. The dressiness band rejected it before
   * any outfit was built, so nothing shipped wrong — but the classification was
   * wrong, and a wrong classification survives a refactor that removes the gate
   * which happened to be covering for it.
   *
   * Nothing here excludes: a shoe that fails this stays `unknown`, and
   * `unknown` is eligible.
   */
  contextualSubcategories: ['shoes'],
  positiveContexts: ['loungewear', 'casual', 'smart_casual'],
}

/**
 * The activities Pack Smart has an opinion about.
 *
 * Keyed by `activityKey` — the template's activity tag, or its NAME for the two
 * templates that carry no tag. Everything absent answers `unknown` for every
 * garment, which is what lets an activity be added one at a time with evidence
 * behind it rather than a table filled in for symmetry.
 *
 * ## What is deliberately NOT here, and why
 *
 * **`nice_dinner`, `wedding`, `business`.** Their templates already band out
 * what an activity rule would exclude: the dinner band is `[2,4]`, so
 * `Sweatpants` — recorded `Loungewear` — fails `fitsContexts` before anything
 * here is consulted. `activity-compatibility.test.ts` asserts that rather than
 * restating it, because a rule written in two places is a rule that comes to
 * disagree with itself.
 *
 * **`hiking` formal footwear.** Same argument: the hiking band is `[0,1]`, so a
 * Formal-only shoe is already ineligible. Hiking appears below only for the
 * walking PREFERENCE, which the band cannot express.
 *
 * **`gym`, `safari`.** Their `uses` gates (`['athletic']`) already do the work.
 *
 * **`Casual days`.** The catch-all, and it carries no claim about what Alex is
 * doing — a slide on a casual day of a beach holiday is a perfectly good
 * answer, and preferring a sneaker there would be this module inventing an
 * opinion the product does not have.
 */
const RULES: Record<string, ActivityRules> = {
  beach: BEACH,
  swimming: BEACH,
  sightseeing: WALKING,
  hiking: WALKING,
  // The flight or drive out and back. Practical footwear over poolside
  // footwear, for the same reason and by the same soft preference.
  'Travel days': WALKING,
}

/**
 * The key a template is looked up by.
 *
 * `activityTag` is the real identity, and NAME is the fallback for the two
 * templates that have none — `Travel days` and `Casual days` both store
 * `activity_tag = null`, so without this they are indistinguishable. That is
 * not a new mechanism: `templateFor` already resolves those two by name for
 * exactly this reason, and matching it keeps one activity identity in the
 * codebase rather than two.
 */
export function activityKey(template: { activityTag: string | null; name: string }): string {
  return template.activityTag ?? template.name
}

/** Whether Pack Smart has any activity opinion at all here. */
export function hasActivityRules(activityTag: string | null): boolean {
  return activityTag !== null && activityTag in RULES
}

/* ------------------------------------------------------------------ */
/* the question                                                        */
/* ------------------------------------------------------------------ */

function subcategoryOf(item: Item): string {
  return (item.subcategory ?? '').trim().toLowerCase()
}

/**
 * Whether the garment shares any context with what the activity can use.
 *
 * True when the activity states no formality fact at all — an activity with no
 * opinion cannot disagree with a garment, and `contextualSubcategories` reads
 * this as "nothing objects", which is the right meaning for a walking day that
 * only cares what kind of shoe it is.
 */
function contextCompatible(item: Item, allowed: DressinessContext[] | undefined): boolean {
  if (!allowed) return true
  return item.dressinessContexts.some((context) => allowed.includes(context))
}

/**
 * Would this garment sensibly be worn for this kind of activity?
 *
 * **`no` is checked before `yes`, and that order is the ruling.** A garment can
 * carry positive evidence and disqualifying evidence at once — a swim-tagged
 * item recorded Formal, a tank top recorded Very warm — and when they disagree
 * the exclusion wins. Positive evidence is a reason to prefer something;
 * disqualifying evidence is a reason it cannot be worn, and those are not
 * symmetric.
 */
export function activityFit(item: Item, activityTag: string | null): ActivityFit {
  if (activityTag === null) return 'unknown'
  const rules = RULES[activityTag]
  if (!rules) return 'unknown'

  /* --- the exclusions --------------------------------------------- */

  /*
   * Recorded as belonging somewhere else entirely.
   *
   * `length > 0` is the whole safety of this line: a garment with no recorded
   * contexts is not excluded, because it has not said anything to disagree
   * with. This is what keeps `Swim Trunks` — which record no contexts at all —
   * out of the exclusion despite being the most obviously correct garment on
   * the list.
   */
  if (rules.contexts && item.dressinessContexts.length > 0 && !contextCompatible(item, rules.contexts)) {
    return 'no'
  }

  if (rules.maxWarmth !== undefined && item.warmth !== null && item.warmth > rules.maxWarmth) {
    return 'no'
  }

  /* --- the positive evidence -------------------------------------- */

  const subcategory = subcategoryOf(item)

  if (rules.strongUses?.some((use) => item.typicalUses.includes(use))) return 'yes'
  if (rules.strongSubcategories?.includes(subcategory)) return 'yes'
  /*
   * The positive path reads `positiveContexts`, falling back to the hard set.
   *
   * An activity that states neither asks nothing of the garment's formality
   * before making a positive claim — which is right for an activity that only
   * cares what KIND of thing it is.
   */
  if (
    rules.contextualSubcategories?.includes(subcategory) &&
    contextCompatible(item, rules.positiveContexts ?? rules.contexts)
  ) {
    return 'yes'
  }

  /* --- nothing either way ----------------------------------------- */

  return 'unknown'
}

/* ------------------------------------------------------------------ */
/* the versatility correction                                          */
/* ------------------------------------------------------------------ */

/**
 * `typicalUses` with the tags this activity cannot use removed.
 *
 * Used only by the INFERRED half of the versatility signal, and only when the
 * planner knows which activity it is filling. A caller with no activity gets
 * the list back unchanged, so every ranking outside a modelled activity is
 * bit-for-bit what it was.
 *
 * This does not edit the item and does not touch eligibility — `typicalUses`
 * remains what the template's own gate reads and what explanations quote.
 */
export function relevantUses(item: Item, activityTag: string | null): string[] {
  const rules = activityTag === null ? undefined : RULES[activityTag]
  const discounted = rules?.discountedUses
  if (!discounted || discounted.length === 0) return item.typicalUses
  return item.typicalUses.filter((use) => !discounted.includes(use))
}
