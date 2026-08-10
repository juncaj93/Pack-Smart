import type { Item } from './items'

/**
 * What this trip knows it is not covering (product doc 02 §9c).
 *
 * The gap this closes: checklist candidacy is "has at least one enabled rule",
 * so an item with no rule never reaches any list — and `criticalOutstanding`
 * only reports rows that already exist. Both together mean a charger can sit at
 * home while the app looks complete and confident.
 *
 * The rule that keeps this useful rather than noisy is an asymmetry:
 *
 *   - an essential Alex MARKED and that no rule can place  -> always reported
 *   - a UNIVERSAL essential missing entirely               -> reported
 *   - a PERSONAL essential missing entirely                -> never reported
 *
 * Pack Smart must never say "you have no medication". Owning none may be exactly
 * right, and warning about something he does not need is how a useful alert
 * becomes noise he learns to dismiss.
 */

export type GapKind = 'unreachable' | 'missing'

export interface CoverageGap {
  kind: GapKind
  /** Plain sentence, naming Alex's own item wherever there is one. */
  message: string
  /** The single next action, described — never performed for him. */
  fix: string
  /** Present only for `unreachable`, where a real item is being named. */
  itemId?: string
}

/**
 * The universal list, deliberately tiny.
 *
 * Every entry has to be defensible as "needed on this trip regardless of taste".
 * Anything arguable belongs to the personal case instead, which is silent about
 * absence. A long list here would produce warnings Alex learns to ignore, and an
 * ignored warning is worse than none — it costs attention and buys nothing.
 *
 * Matched against the item's own words: name, subcategory, and notes. Nothing is
 * inferred from a brand.
 */
interface Universal {
  id: string
  /** How it reads in a sentence: "You have nothing recorded as ...". */
  label: string
  pattern: RegExp
  /** Restricts the check; omitted means every trip. */
  onlyWhen?: (context: TripContext) => boolean
}

const UNIVERSAL: Universal[] = [
  {
    id: 'charger',
    label: 'a phone charger',
    pattern: /\b(charger|charging|lightning|usb-?c|power ?bank|wall ?plug|adapter)\b/i,
  },
  {
    id: 'passport',
    label: 'a passport',
    pattern: /\b(passport|travel ?document)\b/i,
    onlyWhen: (context) => context.international,
  },
]

export interface TripContext {
  international: boolean
  /**
   * What the plan is packing to swim in, and what it has to wear over it.
   *
   * Counted from the checklist rather than re-derived, so this and the packing
   * list cannot disagree about how much swimwear the trip has. Both default to
   * zero, which is the honest reading for a caller that has no checklist yet —
   * and zero swimwear is what makes this check silent on every trip that is not
   * about water.
   */
  swimwearPacked?: number
  tankTopsPacked?: number
  /**
   * Whether a qualifying pair of sandals is on the list.
   *
   * One pair covers the trip, so this is a yes/no rather than a count — the
   * difference from the tank tops, and Alex's ruling rather than an inference.
   */
  swimFootwearPacked?: boolean
}

export interface CoverageInput {
  /** Active, unarchived items — the wardrobe and gear as it stands today. */
  items: Item[]
  /** Item ids carrying at least one ENABLED rule. */
  ruledItemIds: Set<string>
  trip: TripContext
}

/** The words an item offers about itself. Never its brand. */
function ownWords(item: Item): string {
  return [item.displayName, item.subcategory, item.notes ?? ''].join(' ')
}

/**
 * Can this item ever reach a packing list?
 *
 * Mirrors `generateChecklist`'s candidacy exactly — a rule, or `alwaysInclude`.
 * If the two ever drift, this reports gaps that are not real, so the condition
 * is stated once here rather than re-derived at a call site.
 */
function canReachAList(item: Item, ruledItemIds: Set<string>): boolean {
  return ruledItemIds.has(item.id) || item.alwaysInclude
}

export function coverageGaps(input: CoverageInput): CoverageGap[] {
  const gaps: CoverageGap[] = []

  /*
   * 1. Essentials Alex marked that nothing can ever place.
   *
   * The sharpest check in the file, and the only one that needs no keyword list:
   * it uses his own criticality marking and his own item name, so every sentence
   * it produces is a fact about his data rather than a guess about his needs.
   */
  for (const item of input.items) {
    if (!item.isCritical) continue

    /*
     * Clothing is exempt, and this is not a shortcut.
     *
     * A garment with no rule is not stranded — it reaches the list through an
     * approved outfit, which doc 04 §8 makes the source of truth for clothing
     * (and doc 09 §2.1 states the split). Saying "no rule will ever add this"
     * about a garment would be false, and it would be visibly false the moment
     * Alex approved an outfit containing it: the warning would sit above the
     * very row it claims cannot exist.
     *
     * The rule path is for gear, so that is what this checks.
     */
    if (item.kind === 'clothing') continue
    if (canReachAList(item, input.ruledItemIds)) continue

    gaps.push({
      kind: 'unreachable',
      itemId: item.id,
      message: `${item.displayName} is marked essential, but no rule will ever add it to a packing list.`,
      fix: 'Give it a rule, or set it to always include.',
    })
  }

  /*
   * 2. Universal essentials missing from the inventory entirely.
   *
   * Only reported when NOTHING matches — including archived-out items, since an
   * archived charger cannot be packed. Where a match exists but cannot reach a
   * list, check 1 has it covered if he marked it essential; if he did not, that
   * is his call and this stays quiet.
   */
  for (const universal of UNIVERSAL) {
    if (universal.onlyWhen && !universal.onlyWhen(input.trip)) continue
    if (input.items.some((item) => universal.pattern.test(ownWords(item)))) continue

    gaps.push({
      kind: 'missing',
      message: `You have nothing recorded as ${universal.label}.`,
      fix: 'Add it in My Stuff, or ignore this if you are not taking one.',
    })
  }

  /*
   * 3. Swimwear packed with nothing to wear over it.
   *
   * Alex's rule is one tank top per swimsuit, and `pairTankTopsWithSwimwear`
   * draws them from the wardrobe wherever there are spares. Where there are
   * not — a swim-heavy trip and a drawer with two tank tops in it — the honest
   * answer is to pack what exists and say what is short, which is exactly the
   * shape of every other gap here. Inventing a third tank top is the one thing
   * doc 04 §15 forbids.
   *
   * Reported here rather than as a second warning system of its own, and only
   * ever when swimwear is genuinely being packed: no swimwear, no sentence. It
   * is the itinerary that decides that, never a garment's Loungewear marking.
   */
  const swimwear = input.trip.swimwearPacked ?? 0
  const tankTops = input.trip.tankTopsPacked ?? 0
  if (swimwear > tankTops) {
    const short = swimwear - tankTops
    gaps.push({
      kind: 'missing',
      message:
        `You are packing ${swimwear} ${swimwear === 1 ? 'swimsuit' : 'swimsuits'} and ` +
        `${tankTops === 0 ? 'no tank tops' : tankTops === 1 ? '1 tank top' : `${tankTops} tank tops`} to wear over them.`,
      fix: `Add ${short === 1 ? 'a tank top' : `${short} tank tops`} in My Stuff, or ignore this if you have it covered.`,
    })
  }

  /*
   * 4. Swimwear packed with nothing to walk to the pool in.
   *
   * One pair settles the whole trip, so this fires only when Alex owns no
   * qualifying pair at all — and it names both kinds, because either will do
   * and naming one would read as an instruction to buy that one.
   */
  if (swimwear > 0 && input.trip.swimFootwearPacked === false) {
    gaps.push({
      kind: 'missing',
      message: 'You have nothing recorded as slides or Birkenstocks.',
      fix: 'Add a pair in My Stuff, or ignore this if you are not taking any.',
    })
  }

  return gaps
}
