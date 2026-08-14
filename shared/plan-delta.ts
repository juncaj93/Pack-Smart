import type { ChecklistEntry } from './checklist'
import type { CoverageGap } from './essentials'

/**
 * What actually changed about the plan — computed, never narrated.
 *
 * ## Why this exists
 *
 * `replan.ts` answers a different question and answers it well: did the INPUTS
 * move enough to be worth acting on — a warmth band crossed, rain becoming
 * likely. That is the trigger. It cannot say what the trigger did, because a
 * changed input does not imply a changed plan: adding a pool day to a trip that
 * already packs a swimsuit changes nothing at all, and colder weather that
 * stays inside the same band changes nothing either.
 *
 * So every surface that wanted to say "here is what changed" had to guess from
 * the action, and a message written from the action is a message that can be
 * wrong. `Added a swimsuit` after adding a pool day is a sentence the app can
 * produce without ever checking whether it added one.
 *
 * This module takes two authoritative snapshots and diffs them. The message is
 * then a report rather than a prediction, and the awkward cases — the ones
 * where the honest answer is "nothing" — fall out for free instead of needing a
 * special case on each screen.
 *
 * ## What it deliberately does not notice
 *
 * A diff that reports everything reports nothing. Regenerating a plan against
 * unchanged inputs rewrites `sortOrder` on most rows and `reason` on some, and
 * a delta that surfaced those would announce a change every single time and
 * teach Alex to ignore it. Ordering, reasons, quantity breakdowns and every
 * other derivation-of-a-derivation are invisible here on purpose: they are how
 * the plan explains itself, not what the plan IS.
 */

/** Which side of the plan a change is about, for grouping in the UI. */
export type PlanDeltaKind =
  | 'item_added'
  | 'item_removed'
  | 'quantity_changed'
  | 'bag_changed'
  | 'timing_changed'
  | 'outfit_changed'
  | 'gap_opened'
  | 'gap_resolved'
  | 'approved_outfit_review_required'

interface Base {
  kind: PlanDeltaKind
  /**
   * What this is about, in Alex's words.
   *
   * The row's own name, never an id and never a rule key. Every consumer of
   * this is user-facing, and a delta that has to be joined against something
   * else to be readable is a delta each screen will join differently.
   */
  label: string
}

export interface ItemAdded extends Base {
  kind: 'item_added'
  entryId: string
  quantity: number
}

export interface ItemRemoved extends Base {
  kind: 'item_removed'
  entryId: string
}

export interface QuantityChanged extends Base {
  kind: 'quantity_changed'
  entryId: string
  from: number
  to: number
}

export interface BagChanged extends Base {
  kind: 'bag_changed'
  entryId: string
  from: string | null
  to: string | null
}

export interface TimingChanged extends Base {
  kind: 'timing_changed'
  entryId: string
  from: string
  to: string
}

export interface OutfitChanged extends Base {
  kind: 'outfit_changed'
  groupId: string
  /** The slot's role label, so the sentence can name what was swapped. */
  role: string
  from: string | null
  to: string | null
}

export interface GapOpened extends Base {
  kind: 'gap_opened'
  gapKind: string
}

export interface GapResolved extends Base {
  kind: 'gap_resolved'
  gapKind: string
}

export interface ApprovedOutfitReviewRequired extends Base {
  kind: 'approved_outfit_review_required'
  groupId: string
  reason: string
}

export type PlanDelta =
  | ItemAdded
  | ItemRemoved
  | QuantityChanged
  | BagChanged
  | TimingChanged
  | OutfitChanged
  | GapOpened
  | GapResolved
  | ApprovedOutfitReviewRequired

/** The outfit shape this module needs, and nothing more. */
export interface DeltaOutfitGroup {
  id: string
  name: string
  status: string
  reviewReason?: string | null
  slots: Array<{
    role: string
    roleLabel: string
    itemId: string | null
    itemName: string | null
  }>
}

/**
 * Everything the plan is, at one instant.
 *
 * Deliberately the three things Alex can see rather than the tables they come
 * from: the list, the outfits, and what the trip knows it is not covering.
 */
export interface PlanSnapshot {
  entries: ChecklistEntry[]
  groups: DeltaOutfitGroup[]
  gaps: CoverageGap[]
}

/**
 * Whether a row is part of the plan at all.
 *
 * `excludedAt` is the honest boundary. A row Alex has said he is not bringing
 * is still stored — that is what makes putting it back possible — but it is not
 * something the trip is packing, so it leaves the plan and comes back the same
 * way anything else does. Treating exclusion as a mere attribute change would
 * report `Not bringing changed` where the truthful sentence is `Removed`.
 */
const inPlan = (entry: ChecklistEntry): boolean => entry.excludedAt === null

/**
 * How a row is identified across a regeneration.
 *
 * By row id, because `generateChecklist` UPDATEs surviving rows in place rather
 * than deleting and reinserting them — so the id is stable for exactly the rows
 * whose identity is stable, and genuinely new rows genuinely have new ids. A
 * diff keyed on the item id instead would lose trip-only rows, which have none.
 */
const byId = (entries: ChecklistEntry[]): Map<string, ChecklistEntry> =>
  new Map(entries.map((entry) => [entry.id, entry]))

/**
 * The plan, before and after, as the things that changed about it.
 *
 * Order is by kind rather than by row, because that is how it is read: what
 * arrived, what left, then the adjustments. Within a kind the input order is
 * preserved, so a caller that sorted its entries gets a stable answer.
 */
export function planDelta(before: PlanSnapshot, after: PlanSnapshot): PlanDelta[] {
  const wasIn = byId(before.entries.filter(inPlan))
  const isIn = byId(after.entries.filter(inPlan))

  const added: PlanDelta[] = []
  const removed: PlanDelta[] = []
  const changed: PlanDelta[] = []

  for (const [id, entry] of isIn) {
    if (!wasIn.has(id)) {
      added.push({
        kind: 'item_added',
        label: entry.name,
        entryId: id,
        quantity: entry.requiredQty,
      })
    }
  }

  for (const [id, entry] of wasIn) {
    if (!isIn.has(id)) {
      removed.push({ kind: 'item_removed', label: entry.name, entryId: id })
    }
  }

  for (const [id, now] of isIn) {
    const then = wasIn.get(id)
    if (!then) continue

    /*
     * Quantity, and NOT the breakdown that explains it.
     *
     * `12 nights × 2 = 24` changing to `11 nights × 2 = 22` is already reported
     * as 24 → 22. Reporting the sentence as well would be the same fact twice,
     * and reporting it INSTEAD would make a row whose arithmetic was reworded
     * look like a row whose count moved.
     */
    if (now.requiredQty !== then.requiredQty) {
      changed.push({
        kind: 'quantity_changed',
        label: now.name,
        entryId: id,
        from: then.requiredQty,
        to: now.requiredQty,
      })
    }

    if (now.bag !== then.bag) {
      changed.push({
        kind: 'bag_changed',
        label: now.name,
        entryId: id,
        from: then.bag,
        to: now.bag,
      })
    }

    if (now.packingTiming !== then.packingTiming) {
      changed.push({
        kind: 'timing_changed',
        label: now.name,
        entryId: id,
        from: then.packingTiming,
        to: now.packingTiming,
      })
    }
  }

  return [...added, ...removed, ...changed, ...outfitDeltas(before, after), ...gapDeltas(before, after)]
}

/**
 * What changed inside the outfits, and what an approval now needs looked at.
 *
 * Groups are matched by NAME rather than by id, for the same reason the replan
 * does: ids are minted fresh on every plan and the template a group came from
 * is the thing that persists. A group whose name is gone is not reported as a
 * changed outfit — its garments leaving the list are already reported as
 * removals, and `Beach outfit changed` about an outfit that no longer exists is
 * a sentence with nothing behind it.
 */
function outfitDeltas(before: PlanSnapshot, after: PlanSnapshot): PlanDelta[] {
  const was = new Map(before.groups.map((group) => [group.name, group]))
  const out: PlanDelta[] = []

  for (const group of after.groups) {
    const then = was.get(group.name)
    if (!then) continue

    for (const slot of group.slots) {
      const thenSlot = then.slots.find((candidate) => candidate.role === slot.role)
      if (!thenSlot) continue
      if (thenSlot.itemId === slot.itemId) continue

      out.push({
        kind: 'outfit_changed',
        label: group.name,
        groupId: group.id,
        role: slot.roleLabel,
        from: thenSlot.itemName,
        to: slot.itemName,
      })
    }

    /*
     * A flag that has just gone up, not one that was already up.
     *
     * The screen shows the reason for as long as it stands, so re-reporting it
     * on every subsequent replan would turn a one-time "this needs you" into a
     * recurring announcement about a decision Alex has already seen.
     */
    if (group.reviewReason && group.reviewReason !== then.reviewReason) {
      out.push({
        kind: 'approved_outfit_review_required',
        label: group.name,
        groupId: group.id,
        reason: group.reviewReason,
      })
    }
  }

  return out
}

/**
 * Gaps that opened and gaps that closed.
 *
 * Keyed by kind and message together: `unreachable` names a specific garment,
 * so two unreachable gaps about different items are two different gaps, and
 * keying on the kind alone would report one of them resolving when the other
 * appeared.
 */
function gapDeltas(before: PlanSnapshot, after: PlanSnapshot): PlanDelta[] {
  const key = (gap: CoverageGap) => `${gap.kind} ${gap.message}`
  const was = new Map(before.gaps.map((gap) => [key(gap), gap]))
  const is = new Map(after.gaps.map((gap) => [key(gap), gap]))
  const out: PlanDelta[] = []

  for (const [id, gap] of is) {
    if (!was.has(id)) {
      out.push({ kind: 'gap_opened', label: gap.message, gapKind: gap.kind })
    }
  }

  for (const [id, gap] of was) {
    if (!is.has(id)) {
      out.push({ kind: 'gap_resolved', label: gap.message, gapKind: gap.kind })
    }
  }

  return out
}

/**
 * Whether anything worth telling Alex about happened.
 *
 * The question every caller actually has, and the reason it is here rather than
 * `deltas.length > 0` at each call site: silence is a feature. A replan that
 * changed nothing must say nothing, and a screen that writes its own emptiness
 * check is a screen that will eventually get it subtly different.
 */
export function planChanged(deltas: PlanDelta[]): boolean {
  return deltas.length > 0
}

/**
 * How many consequences are worth printing before the list becomes a document.
 *
 * Three. A replan that touched eleven things has told Alex what kind of replan
 * it was by the third line, and the remaining eight are on the cards
 * underneath, where they can be looked at in context rather than recited. Doc
 * 02 §2 has already rejected oversized multi-line blocks once.
 */
export const DELTA_LINES_SHOWN = 3

/**
 * The deltas as short causal sentences, or nothing at all.
 *
 * Nothing at all is the important half. `replanNotice` can already say `2
 * outfits planned again`, which is a count and not a consequence — it tells
 * Alex work happened without telling him what it did. These lines name the
 * garment and the outfit, and when the plan genuinely did not move they are
 * empty and the screen stays quiet.
 *
 * Phrased as results, never as instructions: `Swapped the top in Nice dinners`
 * describes something already done, and doc 06 §3's ban on dead ends means a
 * line Alex cannot act on must not read as though he should.
 */
export function deltaLines(deltas: PlanDelta[]): string[] {
  const lines: string[] = []

  for (const delta of deltas) {
    switch (delta.kind) {
      case 'item_added':
        lines.push(`Added ${delta.label}`)
        break
      case 'item_removed':
        lines.push(`Removed ${delta.label}`)
        break
      case 'quantity_changed':
        lines.push(`${delta.label} ${delta.from} → ${delta.to}`)
        break
      case 'bag_changed':
        lines.push(`${delta.label} moved bags`)
        break
      case 'timing_changed':
        lines.push(`${delta.label} moved when you pack it`)
        break
      case 'outfit_changed':
        /*
         * Named by what replaced what, because the swap is the fact. `Nice
         * dinners changed` is true of a dozen different edits and says none of
         * them; the garment is what Alex would recognise.
         */
        lines.push(
          delta.to
            ? `${delta.label}: ${delta.role.toLowerCase()} is now ${delta.to}`
            : `${delta.label}: no ${delta.role.toLowerCase()} left that fits`,
        )
        break
      case 'gap_opened':
        lines.push(delta.label)
        break
      case 'gap_resolved':
        lines.push(`Covered: ${delta.label}`)
        break
      case 'approved_outfit_review_required':
        lines.push(`${delta.label} needs another look`)
        break
    }
  }

  return lines.slice(0, DELTA_LINES_SHOWN)
}
