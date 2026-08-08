/**
 * Where a garment works, as a SET of contexts rather than a point on a ladder
 * (H1c).
 *
 * A single integer could not say *Smart casual **and** Dressy*, so every
 * garment had to be filed at its one best level and the planner compared
 * numbers. Alex's ruling of 2026-08-06: a garment may belong to any combination
 * of the five contexts, and none of them is "better" than another. An Oxford
 * shirt is Smart casual and Dressy. A suit is Dressy and Formal. Pyjamas are
 * Loungewear, and that is not a worse answer than Formal — it is a different
 * one.
 *
 * **Formal is not the top of a quality scale.** A Formal-only garment fails a
 * Casual need, which an integer comparison of "higher is dressier" got exactly
 * backwards: `dressiness >= min` let a tuxedo satisfy a hiking outfit whenever
 * the band had no ceiling. Set membership cannot make that mistake, because
 * membership has no direction.
 *
 * Nothing here touches a database or an item. The whole of H1c's product
 * meaning is set arithmetic over five names, and keeping it that way is what
 * lets every case in doc 09 be a unit test.
 */

/* ------------------------------------------------------------------ */
/* the vocabulary                                                      */
/* ------------------------------------------------------------------ */

/**
 * The five contexts, in the order Alex reads them.
 *
 * **The index is the legacy integer**, deliberately and permanently:
 * `DRESSINESS_CONTEXTS[2] === 'smart_casual'` and the old column stored `2` for
 * Smart casual. That single alignment gives the legacy mapping, the template
 * bands and the trip cap for free, and it means migration `0022` is a lookup
 * rather than a translation table someone has to keep in step.
 *
 * The order is NOT a ranking of quality. It is the order formality is
 * conventionally listed in, which is what makes a floor and a ceiling
 * expressible at all — `Loungewear` really is less formal than `Formal`. What
 * the order must never be read as is *better*.
 */
export const DRESSINESS_CONTEXTS = [
  'loungewear',
  'casual',
  'smart_casual',
  'dressy',
  'formal',
] as const

export type DressinessContext = (typeof DRESSINESS_CONTEXTS)[number]

/** What Alex sees. Index-aligned with `DRESSINESS_CONTEXTS`. */
export const DRESSINESS_CONTEXT_LABELS: Record<DressinessContext, string> = {
  loungewear: 'Loungewear',
  casual: 'Casual',
  smart_casual: 'Smart casual',
  dressy: 'Dressy',
  formal: 'Formal',
}

/** One line each, so a multi-select does not ask Alex to guess what a word covers. */
export const DRESSINESS_CONTEXT_HINTS: Record<DressinessContext, string> = {
  loungewear: 'Around the house, or sleeping',
  casual: 'Everyday, nothing to dress up for',
  smart_casual: 'Tidy but not formal — a nice lunch, a relaxed office',
  dressy: 'A nice dinner, a night out',
  formal: 'A wedding, a black-tie event',
}

const CONTEXT_SET = new Set<string>(DRESSINESS_CONTEXTS)

export function isDressinessContext(value: unknown): value is DressinessContext {
  return typeof value === 'string' && CONTEXT_SET.has(value)
}

/** The legacy integer for a context — its index, by construction. */
export function levelOf(context: DressinessContext): number {
  return DRESSINESS_CONTEXTS.indexOf(context)
}

/** The context a legacy integer meant, or null if it was never a valid level. */
export function contextForLevel(level: number | null): DressinessContext | null {
  if (level === null || !Number.isInteger(level)) return null
  return DRESSINESS_CONTEXTS[level] ?? null
}

/* ------------------------------------------------------------------ */
/* the stored shape                                                    */
/* ------------------------------------------------------------------ */

/**
 * Reads the stored column into a canonical set.
 *
 * **Canonical means sorted into `DRESSINESS_CONTEXTS` order and de-duplicated**,
 * always, on the way in. Two garments Alex marked the same way must compare
 * equal and serialise identically, or H1a's `sameValue` would call every save a
 * change and the review queue would fill with differences nobody made.
 *
 * Unparseable input, unknown names and non-arrays all read as the EMPTY set,
 * which means *not recorded* — the same posture as `parseJsonArray` beside it,
 * and the same meaning `dressiness IS NULL` already had.
 */
export function parseContexts(value: string | null): DressinessContext[] {
  if (!value) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return canonicalise(parsed.filter(isDressinessContext))
}

/** Sorted into the canonical order, with duplicates removed. */
export function canonicalise(contexts: readonly DressinessContext[]): DressinessContext[] {
  const seen = new Set(contexts)
  return DRESSINESS_CONTEXTS.filter((context) => seen.has(context))
}

/** `null` when the set is empty, so *not recorded* stays a NULL column. */
export function serialiseContexts(contexts: readonly DressinessContext[]): string | null {
  const canonical = canonicalise(contexts)
  return canonical.length === 0 ? null : JSON.stringify(canonical)
}

/** "Smart casual and Dressy", or "Not set". For a screen, never for a decision. */
export function describeContexts(contexts: readonly DressinessContext[]): string {
  const labels = canonicalise(contexts).map((c) => DRESSINESS_CONTEXT_LABELS[c])
  if (labels.length === 0) return 'Not set'
  if (labels.length === 1) return labels[0]!
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/* ------------------------------------------------------------------ */
/* what a template and a trip cap ask for                              */
/* ------------------------------------------------------------------ */

/** An inclusive `[min, max]` band expanded into the set it always meant. */
export function bandToContexts(band: readonly [number, number]): DressinessContext[] {
  const [low, high] = band
  return DRESSINESS_CONTEXTS.filter((_, index) => index >= low && index <= high)
}

export interface AcceptableContexts {
  contexts: DressinessContext[]
  /**
   * The trip cap asked for something the template cannot give.
   *
   * **The template wins and this says so**, rather than the cap silently
   * lowering the requirement — doc 09 §9's rule, which exists because saying
   * "nothing formal" about a trip that includes a wedding must not put Alex in
   * loungewear at the wedding.
   */
  capConflict: boolean
}

/**
 * What this slot will actually accept: the template's contexts, capped by the
 * trip, floor preserved.
 *
 * **This generalises the integer arithmetic it replaces rather than changing
 * it.** The old line was
 * `max(minDress, min(templateMax, cap))`, and on a contiguous band that is
 * exactly `templateSet ∩ capSet`, falling back to the floor when the
 * intersection empties. Measured both ways in `dressiness.test.ts`: template
 * `[3,4]` with cap `1` gives `{Dressy}` under either model, and template `[0,2]`
 * with cap `1` gives `{Loungewear, Casual}` under either.
 *
 * So a wardrobe of single-context garments behaves EXACTLY as it did before
 * H1c, which is the property that made this safe to put inside a working
 * planner — the same argument H1b's `versatilitySignal` rests on.
 */
export function acceptableContexts(
  band: readonly [number, number],
  cap: number | null | undefined,
): AcceptableContexts {
  const wanted = bandToContexts(band)
  if (cap === null || cap === undefined) return { contexts: wanted, capConflict: false }

  const capped = wanted.filter((context) => levelOf(context) <= cap)
  if (capped.length > 0) return { contexts: capped, capConflict: false }

  /*
   * The cap removed everything the template asks for.
   *
   * Keep the template's FLOOR — the least formal thing the occasion still
   * permits — and report the conflict. Returning the empty set instead would
   * make the slot unfillable and the outfit silently incomplete, which is the
   * failure mode G2 spent a release removing.
   */
  return { contexts: [wanted[0]!], capConflict: true }
}

/* ------------------------------------------------------------------ */
/* eligibility                                                         */
/* ------------------------------------------------------------------ */

/**
 * Does this garment work for this occasion?
 *
 * **Set intersection, and nothing else.** Not "is its highest level within the
 * band", not "is its lowest" — a garment marked `Smart casual + Dressy` is
 * eligible for a Smart casual need AND for a Dressy one, and collapsing it to
 * either end would lose one of those. `fitsContexts` is the only question the
 * planner asks about formality.
 *
 * **An empty garment set passes.** A garment nobody has classified is not
 * excluded, exactly as `item.dressiness === null` was never excluded before
 * H1c: that would punish missing data rather than unsuitability, which doc 05
 * §4 forbids.
 *
 * An empty ACCEPTABLE set cannot happen — `acceptableContexts` always returns at
 * least the template floor — but if one is passed in it accepts everything,
 * because "this occasion has no formality requirement" is the honest reading of
 * a template that named none.
 */
export function fitsContexts(
  garment: readonly DressinessContext[],
  acceptable: readonly DressinessContext[],
): boolean {
  if (garment.length === 0) return true
  if (acceptable.length === 0) return true
  return garment.some((context) => acceptable.includes(context))
}

/**
 * The dressiest context a garment claims, or null when it claims none.
 *
 * **The one legitimate reason to collapse a set to a single level**, and it is
 * legitimate because the question it answers is a CEILING: `laundryReducible`
 * asks whether a garment is ordinary washable clothing, and a shirt that also
 * works Dressy is the dress shirt for the one nice dinner that the laundry
 * ruling says must never be cut.
 *
 * Reading the minimum here would start reducing that shirt. Nothing else in the
 * repository may use this to make an eligibility decision.
 */
export function highestContext(contexts: readonly DressinessContext[]): DressinessContext | null {
  const canonical = canonicalise(contexts)
  return canonical.length === 0 ? null : canonical[canonical.length - 1]!
}
