import type { Item } from './items'
import { SLOT_LABELS, slotFor, type SlotRole } from './outfits'

/**
 * One Last Look.
 *
 * Product doc 04 §9 is emphatic about what this screen must NOT do: leading
 * with the full closet encourages overpacking. So it leads with two short,
 * specific lists — favourites you left behind, and near-matches for the gaps in
 * the plan — and hides the rest of the wardrobe behind a search.
 *
 * The screen is deliberately not called "Final Check". That is a different
 * thing entirely: Final Check is the pre-departure confirmation that critical
 * items are physically in the bag.
 */

export interface LastLookItem {
  itemId: string
  name: string
  subcategory: string | null
  color: string | null
  favorite: boolean
  role: SlotRole | null
  roleLabel: string | null
  /** One line explaining why this is being shown. Never a score. */
  reason: string
}

export interface LastLookInput {
  wardrobe: Item[]
  /** Item ids already on the packing list, excluded or not. */
  plannedItemIds: Set<string>
  /** Roles the approved outfits could not fill. */
  unfilledRoles: Array<{ role: SlotRole; groupName: string }>
  /** Roles the plan does use, for judging relevance. */
  usedRoles: Set<SlotRole>
}

export interface LastLookResult {
  /** Favourites that did not make the plan. */
  favourites: LastLookItem[]
  /** Garments that would fill a gap the plan could not. */
  nearMatches: LastLookItem[]
  /** Everything else, for the search behind progressive disclosure. */
  remaining: LastLookItem[]
}

function toItem(item: Item, reason: string): LastLookItem {
  const role = slotFor(item)
  return {
    itemId: item.id,
    name: item.displayName,
    subcategory: item.subcategory,
    color: item.color,
    favorite: item.favorite,
    role,
    roleLabel: role ? SLOT_LABELS[role] : null,
    reason,
  }
}

/**
 * Splits the wardrobe into the three lists the screen shows.
 *
 * Nothing here is a recommendation to pack more. A favourite left behind is
 * often the right call — Alex is being shown what he did not choose, not being
 * told he was wrong.
 */
export function reviewWardrobe(input: LastLookInput): LastLookResult {
  const favourites: LastLookItem[] = []
  const nearMatches: LastLookItem[] = []
  const remaining: LastLookItem[] = []

  const gapRoles = new Map(input.unfilledRoles.map((gap) => [gap.role, gap.groupName]))

  for (const item of input.wardrobe) {
    if (item.archivedAt !== null) continue
    if (item.neverInclude) continue
    if (input.plannedItemIds.has(item.id)) continue

    const role = slotFor(item)

    // A gap in the plan is the one genuinely useful suggestion this screen has.
    const gapGroup = role ? gapRoles.get(role) : undefined
    if (gapGroup) {
      nearMatches.push(toItem(item, `Your ${gapGroup.toLowerCase()} outfit has no ${labelFor(role)}.`))
      continue
    }

    if (item.favorite) {
      favourites.push(toItem(item, 'A favourite you have not packed.'))
      continue
    }

    remaining.push(toItem(item, ''))
  }

  const byName = (a: LastLookItem, b: LastLookItem) => a.name.localeCompare(b.name)

  return {
    favourites: favourites.sort(byName),
    // Frequently used ones first — the near-match list should be short and good.
    nearMatches: nearMatches.sort(byName),
    remaining: remaining.sort(byName),
  }
}

function labelFor(role: SlotRole | null): string {
  switch (role) {
    case 'top':
      return 'top'
    case 'mid':
      return 'layer'
    case 'outer':
      return 'jacket'
    case 'bottom':
      return 'bottoms'
    case 'footwear':
      return 'shoes'
    case 'swim':
      return 'swimwear'
    default:
      return 'item'
  }
}
