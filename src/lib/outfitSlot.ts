import type { OutfitGroup, SwapOption } from './trips'

/**
 * What a slot looks like the instant Alex picks a garment, before the server
 * has been told.
 *
 * Pure, and separate from the hook that persists, because the interesting part
 * is *which fields the client legitimately knows* — and that is a product
 * question rather than a React one. It is tested directly.
 *
 * Three fields are set from the choice because the client genuinely knows them:
 * `itemId`, `itemName` and `itemDetail` all come from the row Alex tapped.
 *
 * Three are deliberately reset rather than guessed:
 *
 * - `unmetReason` — the slot was empty or wrong; it is neither now. Leaving the
 *   old sentence would caption the new garment with the old one's problem.
 * - `reason` — the recommendation text described the garment being replaced.
 *   `SwapOption.reason` is the one the list gave for *this* garment, so it is
 *   used when there is one.
 * - `wearings` — a count the server derives across the whole trip. The client
 *   cannot know it, so it holds the previous value until the response arrives
 *   rather than inventing a number.
 *
 * `setAside` is left alone for the same reason: it is a fact about the trip's
 * Not-bringing list, not about the swap.
 */
export function applySlotChoice(
  groups: OutfitGroup[],
  groupId: string,
  slotId: string,
  option: SwapOption | null,
): OutfitGroup[] {
  return groups.map((group) => {
    if (group.id !== groupId) return group
    return {
      ...group,
      slots: group.slots.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              itemId: option?.id ?? null,
              itemName: option?.name ?? null,
              itemDetail: option?.detail ?? null,
              unmetReason: null,
              reason: option?.reason ?? null,
            }
          : slot,
      ),
    }
  })
}
