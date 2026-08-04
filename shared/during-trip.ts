import { tripDateRange } from './trips'

/**
 * During Trip.
 *
 * One rule outranks everything else here (product doc 04 §10):
 *
 *   During Trip may recommend only clothing and gear CONFIRMED AS PACKED.
 *
 * Not Bringing, unpacked, and archived items can never appear. The rule is
 * enforced in `packedOnly`, which every recommendation path goes through, so it
 * cannot be forgotten at one call site.
 *
 * The second rule is continuity (risk R12): the plan is persisted, not
 * regenerated. Opening the app twice on the same morning must show the same
 * clothes, or the app looks like it changed its mind.
 */

export type WearAction = 'will_wear' | 'already_wore' | 'not_available' | 'too_warm' | 'too_cold'

export const WEAR_ACTION_LABELS: Record<WearAction, string> = {
  will_wear: 'Wearing this',
  already_wore: 'Already wore it',
  not_available: 'Not available',
  too_warm: 'Too warm',
  too_cold: 'Too cold',
}

/** An item is a candidate only if the trip actually has it in the bag. */
export function packedOnly<T extends { itemId: string | null; packedQty: number; excludedAt: number | null }>(
  entries: T[],
): Set<string> {
  const packed = new Set<string>()
  for (const entry of entries) {
    if (!entry.itemId) continue
    if (entry.excludedAt !== null) continue
    if (entry.packedQty <= 0) continue
    packed.add(entry.itemId)
  }
  return packed
}

/* ------------------------------------------------------------------ */
/* which outfit goes on which day                                      */
/* ------------------------------------------------------------------ */

export interface DayAssignment {
  date: string
  outfitGroupId: string | null
  groupName: string | null
}

export interface AssignableGroup {
  id: string
  name: string
  occurrences: number
  activityTag: string | null
}

/**
 * Spreads the approved outfit groups across the trip's dates.
 *
 * When Alex has said which days are what, that is simply honoured: the safari
 * outfit lands on the safari days, not on whichever days the spread happened to
 * reach. Everything else falls back to the older behaviour — travel days take
 * the first and last dates, and the rest fill the middle in planned order.
 *
 * Either way this runs once and is then stored. The assignment must not shuffle
 * between openings (risk R12).
 */
export function assignDays(
  startDate: string,
  endDate: string,
  groups: AssignableGroup[],
  days: Array<{ date: string; activityTag: string | null }> = [],
): DayAssignment[] {
  const dates = tripDateRange(startDate, endDate)
  const assignments: DayAssignment[] = dates.map((date) => ({
    date,
    outfitGroupId: null,
    groupName: null,
  }))

  const stated = new Map(
    days.filter((d) => d.activityTag).map((d) => [d.date, d.activityTag as string]),
  )

  if (stated.size > 0) {
    const byTag = new Map<string, AssignableGroup>()
    for (const group of groups) {
      if (group.activityTag && !byTag.has(group.activityTag)) byTag.set(group.activityTag, group)
    }

    const travel = groups.find((g) => g.name === 'Travel days')
    const casual = groups.find((g) => g.name === 'Casual days')

    dates.forEach((date, index) => {
      const tag = stated.get(date)
      const group = tag
        ? byTag.get(tag)
        : (index === 0 || index === dates.length - 1) && travel
          ? travel
          : casual

      // A date whose group was never approved stays empty, and Today says so.
      // Substituting the nearest approved outfit would put Alex in clothes he
      // did not choose for that day.
      if (group) assignments[index] = { date, outfitGroupId: group.id, groupName: group.name }
    })

    return assignments
  }

  const travel = groups.find((g) => g.name === 'Travel days')
  const others = groups.filter((g) => g !== travel)

  const taken = new Set<number>()

  if (travel && dates.length > 0) {
    const first = 0
    const last = dates.length - 1
    const slots = travel.occurrences >= 2 && last !== first ? [first, last] : [first]
    for (const index of slots) {
      assignments[index] = { date: dates[index]!, outfitGroupId: travel.id, groupName: travel.name }
      taken.add(index)
    }
  }

  const free = dates.map((_, index) => index).filter((index) => !taken.has(index))
  let cursor = 0

  for (const group of others) {
    for (let n = 0; n < group.occurrences; n += 1) {
      const index = free[cursor]
      if (index === undefined) break
      assignments[index] = { date: dates[index]!, outfitGroupId: group.id, groupName: group.name }
      cursor += 1
    }
  }

  return assignments
}

/* ------------------------------------------------------------------ */
/* the day's plan                                                      */
/* ------------------------------------------------------------------ */

export interface PlannedItem {
  itemId: string
  name: string
  role: string
  roleLabel: string
  /** Why this is here, when there is something worth saying. */
  reason: string | null
}

export interface DayPlan {
  date: string
  groupName: string | null
  /** What to put on. */
  wear: PlannedItem[]
  /** What to take along — packed gear that is not clothing. */
  bring: PlannedItem[]
  /**
   * Garments in the plan that are not actually in the bag.
   *
   * Named rather than quietly dropped: "your rain jacket is not packed" is
   * useful; a silently shorter outfit is not.
   */
  missing: Array<{
    role: string
    roleLabel: string
    name: string
    /**
     * The garment the plan named, so the screen can offer to fix it.
     *
     * Null only when the approved slot never held one. With the id, "your linen
     * shirt is not packed" can carry a control that marks it packed or puts it
     * back on the list; without it, the only honest thing left to say is the
     * sentence — which is the E1 dead end this field exists to end.
     */
    itemId: string | null
    alternatives: PlannedItem[]
  }>
}

export interface PlanSlot {
  role: string
  roleLabel: string
  itemId: string | null
  itemName: string | null
  reason: string | null
  /** How many of the group's days this garment covers. */
  wearings: number
}

export interface DayPlanInput {
  date: string
  groupName: string | null
  /** The approved outfit's slots, before the packed-only rule is applied. */
  slots: PlanSlot[]
  /**
   * Which of the group's days this is, counting from zero.
   *
   * A "Casual days x 5" group holds five days' worth of tops. Without this,
   * Today would show all five at once, which reads as "wear these nine things"
   * rather than "here is today's outfit".
   */
  occurrenceIndex: number
  /** Everything confirmed packed for this trip. */
  packed: Map<string, { name: string; kind: string; role: string | null; roleLabel: string | null }>
  /** Item ids swapped out for this day, with what replaced them. */
  adjustments: Record<string, string | null>
  /** Items already worn on other days, so a shirt is not proposed twice. */
  wornItemIds: Set<string>
  /**
   * Gear that belongs in the Bring list.
   *
   * Only gear this trip specifically triggered — binoculars for the safari, a
   * neck pillow for the flight, an adapter for going abroad. Routine gear that
   * simply lives in the bag is not something to carry out for the day, and
   * listing the whole toiletry bag under "Bring" would make the useful entries
   * invisible.
   */
  bringableItemIds: Set<string>
}

/**
 * Picks the one garment per role that belongs to this day.
 *
 * Each slot covers `wearings` days, so laying the slots end to end gives a
 * timeline for the group and this day's index reads straight off it.
 */
function garmentForDay(slots: PlanSlot[], occurrenceIndex: number): PlanSlot | null {
  const timeline: PlanSlot[] = []
  for (const slot of slots) {
    if (!slot.itemId) continue
    for (let i = 0; i < Math.max(1, slot.wearings); i += 1) timeline.push(slot)
  }
  if (timeline.length === 0) return slots[0] ?? null
  // Past the end means the wardrobe ran short; repeating the last is wrong, so
  // the caller sees the unfilled slot instead.
  return timeline[occurrenceIndex] ?? null
}

/**
 * Resolves what to wear today from the approved plan, the bag, and today's
 * adjustments.
 *
 * Adjustments are applied on top of the stored plan rather than replacing it —
 * doc 04 §12: small live changes, never a regeneration, because regenerating is
 * what makes the app look like it has changed its mind.
 */
export function resolveDayPlan(input: DayPlanInput): DayPlan {
  const wear: PlannedItem[] = []
  const missing: DayPlan['missing'] = []

  // One garment per role for this day, not the group's whole allocation.
  const roles = [...new Set(input.slots.map((s) => s.role))]
  const todaysSlots = roles
    .map((role) => garmentForDay(input.slots.filter((s) => s.role === role), input.occurrenceIndex))
    .filter((slot): slot is PlanSlot => slot !== null)

  for (const slot of todaysSlots) {
    // An adjustment for this slot's garment wins, including an explicit removal.
    const adjusted = slot.itemId !== null && slot.itemId in input.adjustments
      ? input.adjustments[slot.itemId]
      : slot.itemId

    if (!adjusted) continue

    const packed = input.packed.get(adjusted)

    if (packed) {
      wear.push({
        itemId: adjusted,
        name: packed.name,
        role: slot.role,
        roleLabel: slot.roleLabel,
        reason: adjusted === slot.itemId ? slot.reason : 'You swapped this in',
      })
      continue
    }

    // Planned but not in the bag. Offer what IS packed for the same role.
    const alternatives: PlannedItem[] = []
    for (const [itemId, candidate] of input.packed) {
      if (candidate.role !== slot.role) continue
      if (wear.some((w) => w.itemId === itemId)) continue
      if (input.wornItemIds.has(itemId)) continue
      alternatives.push({
        itemId,
        name: candidate.name,
        role: slot.role,
        roleLabel: slot.roleLabel,
        reason: null,
      })
    }

    missing.push({
      role: slot.role,
      roleLabel: slot.roleLabel,
      name: slot.itemName ?? slot.roleLabel,
      itemId: adjusted,
      alternatives,
    })
  }

  const bring: PlannedItem[] = []
  for (const [itemId, candidate] of input.packed) {
    if (candidate.kind !== 'gear') continue
    if (!input.bringableItemIds.has(itemId)) continue
    bring.push({
      itemId,
      name: candidate.name,
      role: 'gear',
      roleLabel: 'Bring',
      reason: null,
    })
  }

  return {
    date: input.date,
    groupName: input.groupName,
    wear,
    bring: bring.sort((a, b) => a.name.localeCompare(b.name)),
    missing,
  }
}

/** The honest message when a planned garment did not make the bag. */
export function describeMissing(roleLabel: string, alternatives: number): string {
  const what = roleLabel.toLowerCase()
  if (alternatives === 0) {
    return `No suitable packed ${what} found.`
  }
  return `Your planned ${what} is not packed.`
}
