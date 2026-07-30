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

  return gaps
}
