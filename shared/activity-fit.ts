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
   * The formality contexts this activity can actually use.
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
   */
  contexts: DressinessContext[]

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
const RULES: Record<string, ActivityRules> = {
  beach: BEACH,
  swimming: BEACH,
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

/** Whether the garment shares any context with what the activity can use. */
function contextCompatible(item: Item, rules: ActivityRules): boolean {
  return item.dressinessContexts.some((context) => rules.contexts.includes(context))
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
  if (item.dressinessContexts.length > 0 && !contextCompatible(item, rules)) {
    return 'no'
  }

  if (rules.maxWarmth !== undefined && item.warmth !== null && item.warmth > rules.maxWarmth) {
    return 'no'
  }

  /* --- the positive evidence -------------------------------------- */

  const subcategory = subcategoryOf(item)

  if (rules.strongUses?.some((use) => item.typicalUses.includes(use))) return 'yes'
  if (rules.strongSubcategories?.includes(subcategory)) return 'yes'
  if (rules.contextualSubcategories?.includes(subcategory) && contextCompatible(item, rules)) {
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
