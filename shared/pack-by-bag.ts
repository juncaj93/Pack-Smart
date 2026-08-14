import type { AirTravel, BagPlan, CarriedBag } from './bags'
import { BAG_LABELS, BAG_MEANING, type BagKey, type ChecklistEntry } from './checklist'
import { isPacked } from './rules'

/**
 * The packing list, cut by the bag Alex is standing over (P4a).
 *
 * ## A lens, not a second list
 *
 * Everything here is derived from `planBags` and the checklist rows that
 * `GET /trips/:id/checklist` already returns. Nothing is stored, nothing is
 * assigned, and no row exists here that does not exist on the master list — so
 * ticking something in a bag view and ticking it on the packing list are the
 * same write to the same row, and there is no state that can drift.
 *
 * That is the whole design constraint. A "pack by bag" screen that kept its own
 * rows would be a second source of truth about what is in the suitcase, which is
 * the one thing a packing app must not have.
 *
 * ## Every row lands somewhere
 *
 * `recommendBag` is deliberately quiet: it returns null for anything it has
 * nothing useful to say about, which on a normal trip is most of the clothing.
 * A view that only showed placed rows would therefore hide the bulk of the list
 * behind a lens that claims to show the bag — the failure mode being "I packed
 * by bag and three t-shirts are still in the wardrobe".
 *
 * So the unplaced rows get a group of their own rather than a bag. It is
 * deliberately NOT a default placement: guessing that a t-shirt goes in the hold
 * would be a second bag planner disagreeing with the first one, and Pack Smart
 * genuinely has no opinion about where a t-shirt goes. `Anywhere` says that
 * honestly, and the row's own sheet is where Alex records an answer if he wants
 * one.
 *
 * ## The one row that appears twice
 *
 * `either` means *the personal bag or the carry-on, whichever has room* — so the
 * answer to "does this go in here" is yes for both of them, and it appears under
 * both. This is the same rule `filterChecklist` has always applied to the bag
 * filters, and the two must not disagree about one garment.
 *
 * It is the only exception. Nothing else may appear in two groups, and nothing
 * at all may appear in none.
 */

/** A place rows can be grouped under. `either` is never a group; see above. */
export type BagGroupKey = 'wear' | CarriedBag | 'unplaced'

export interface BagGroup {
  key: BagGroupKey
  /** The heading, already in the right vocabulary for this trip. */
  label: string
  /** One short sentence, or null when the heading says it all. */
  hint: string | null
  entries: ChecklistEntry[]
  packed: number
  total: number
}

/**
 * What each carried bag is called on a trip Alex has said has no flight.
 *
 * ## Why this is not a rename of the column
 *
 * `BAG_MEANING` argues — correctly — that renaming the bags per trip would give
 * the data model a second vocabulary, and it settles that by saying what each
 * one MEANS instead. Nothing here reopens that: `BAG_LABELS` is still the one
 * name for the chips that CHOOSE a bag, in the entry sheet and the trip sheet,
 * on every trip.
 *
 * This is a different job. A heading on this screen is not a value in a control
 * — it names the physical thing on the bed in front of him, and *Checked bag* on
 * a drive to the coast names something that does not exist. The wording is taken
 * straight from the glosses `BAG_MEANING` already carries, so there is one
 * description of each bag and this is the short form of it.
 *
 * Gated by `aviation === 'no'`, which is the same explicit answer that already
 * silences liquid limits and the flight-hours question — never by a guess.
 */
const PLAIN_BAG_LABELS: Record<CarriedBag, string> = {
  personal_item: 'Small bag',
  carry_on: 'Main bag',
  checked: 'Large bag',
}

export function bagGroupLabel(key: BagGroupKey, aviation: AirTravel): string {
  if (key === 'wear') return 'Wearing it'
  if (key === 'unplaced') return 'Anywhere'
  return aviation === 'no' ? PLAIN_BAG_LABELS[key] : BAG_LABELS[key]
}

function bagGroupHint(key: BagGroupKey, aviation: AirTravel): string | null {
  if (key === 'wear') return 'On you when you leave, rather than in a bag.'
  if (key === 'unplaced') {
    return 'Pack Smart has no view on where these go. Put them wherever there is room.'
  }
  // The same one-sentence gloss the entry sheet shows, so a bag means the same
  // thing wherever it is named. Aviation wording is already softened above; the
  // meaning below is true on a drive as well as in a terminal.
  return aviation === 'no' && key === 'checked'
    ? 'A larger bag stored away from you.'
    : (BAG_MEANING[key] ?? null)
}

/**
 * Which group a resolved bag belongs to, for one particular group.
 *
 * Written as a predicate rather than a map because of `either`, which is true of
 * two groups at once and false of the hold.
 */
function belongs(resolved: BagKey | null, group: BagGroupKey): boolean {
  if (group === 'unplaced') return resolved === null
  if (resolved === null) return false
  if (resolved === group) return true
  return resolved === 'either' && (group === 'carry_on' || group === 'personal_item')
}

/**
 * The trip's bags, in the order you fill them, with the rows in each.
 *
 * `plan` is the trip's ONE bag plan — the same `planBags` result the packing
 * list, the entry sheet and the crowding warning read — so this cannot reach a
 * different answer about a garment than the screen Alex came from.
 *
 * A bag the trip is bringing appears even when it is empty: an empty carry-on is
 * a fact worth seeing beside a full one, and it is where things go when he moves
 * them. `Wearing it` and `Anywhere` appear only when they hold something,
 * because neither is a bag he is packing into.
 */
export function packByBag(plan: BagPlan, entries: ChecklistEntry[]): BagGroup[] {
  const bringing = entries.filter((entry) => entry.excludedAt === null)

  /*
   * `wear` first, then the bags in `BAG_ORDER`'s order: what is on you, what
   * stays with you, the overhead bin, the hold. That is the order the morning
   * actually happens in, and it is the order the bag chips are offered in
   * everywhere else in the product.
   */
  const keys: BagGroupKey[] = [
    'wear',
    ...(['personal_item', 'carry_on', 'checked'] as const).filter((bag) =>
      plan.context.bags.includes(bag),
    ),
    'unplaced',
  ]

  const groups: BagGroup[] = []

  for (const key of keys) {
    const rows = bringing.filter((entry) => belongs(plan.advice.get(entry.id)?.bag ?? null, key))
    // A trip's own bags stay visible when empty; these two are not bags.
    if (rows.length === 0 && (key === 'wear' || key === 'unplaced')) continue

    groups.push({
      key,
      label: bagGroupLabel(key, plan.context.aviation),
      hint: bagGroupHint(key, plan.context.aviation),
      entries: rows,
      packed: rows.filter(isPacked).length,
      total: rows.length,
    })
  }

  return groups
}

/**
 * The next bag with something still in it, after this one.
 *
 * The *light sequential progression* half of P4a, and deliberately light: it is
 * an offer that appears once a bag is done, not a wizard that decides what Alex
 * looks at. Returns null when there is nothing left to move on to, which is the
 * state that should end the screen rather than loop it.
 */
export function nextBagWithWork(groups: BagGroup[], after: BagGroupKey): BagGroup | null {
  const at = groups.findIndex((group) => group.key === after)
  if (at === -1) return null
  return groups.slice(at + 1).find((group) => group.packed < group.total) ?? null
}
