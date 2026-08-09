import { type Dispatch, type SetStateAction } from 'react'
import { useOptimisticWrite } from './optimistic'
import { applySlotChoice } from './outfitSlot'
import { setSlotItem, type OutfitGroup, type SwapOption } from './trips'

/**
 * Choosing a garment, without waiting for the database to agree.
 *
 * P1A. Measured before it was changed: `PUT /slots/:slotId` spends **82% of its
 * work after the write the choice actually needs** — `syncChecklistFromOutfits`
 * and a full `listOutfits` — and the picker used to close only once all of it
 * came back. So tap-to-closed scaled linearly with network latency: 155 ms on a
 * desk, 857 ms at 300 ms RTT, 1368 ms at 1000 ms. Alex's complaint was the
 * architecture, not a slow query.
 *
 * The write still happens, still transactionally, and the checklist is still
 * synchronised by the server exactly as before. What changed is that the
 * INTERACTION no longer waits for the PERSISTENCE.
 *
 * ## The guard, and why it is a sequence rather than a boolean
 *
 * The entry-sheet defect fixed earlier in this release is the pattern being
 * avoided: a reply that landed after the sheet closed called `setDetail(entry)`
 * and put the sheet back. A `busy` flag would not have caught it, because the
 * problem is not concurrency — it is a stale reply arriving after the state it
 * describes has moved on.
 *
 * Every choice takes a ticket. A response is applied only if its ticket is still
 * the newest one, so:
 *
 * - two rapid swaps settle on the second, whichever reply arrives first;
 * - a slow success cannot overwrite a newer selection;
 * - a slow FAILURE cannot roll back a newer successful edit — it is dropped,
 *   because rolling back would undo something Alex did afterwards;
 * - a reply for a picker that has since closed changes nothing on screen.
 *
 * "Latest user intent wins" is the rule, deliberately above request ordering.
 *
 * Rollback restores the exact groups captured before the change, and only when
 * the failing edit is still the current one. Partial rollback of one slot would
 * be wrong: by then the server's own reply is the authority on everything else.
 *
 * ## The ticket now lives in `useOptimisticWrite`
 *
 * H1d needed the same guard for rating a garment, and the brief was explicit:
 * do not invent a second async pattern, generalise this one. So the counter and
 * the still-current check moved out verbatim and this became its first caller.
 *
 * **One key for the whole picker**, deliberately, because that is what this
 * hook always did and what its rollback depends on: the unit of intent here is
 * the outfit, not the slot. Two rapid swaps in DIFFERENT slots still settle on
 * the second — the earlier reply is dropped rather than applied over it —
 * which is correct, because each reply carries the server's whole view of the
 * trip and applying the older one would undo the newer swap.
 */
const PICKER = 'outfit-picker'

export function useSlotChoice(
  tripId: string,
  setGroups: Dispatch<SetStateAction<OutfitGroup[] | null>>,
  onError?: (message: string) => void,
) {
  const write = useOptimisticWrite()

  return function choose(
    groupId: string,
    slotId: string,
    option: SwapOption | null,
  ): void {
    /** What to go back to if the write fails and nothing newer has happened. */
    let before: OutfitGroup[] | null = null

    write(PICKER, {
      apply: () =>
        setGroups((previous) => {
          before = previous
          return previous === null ? previous : applySlotChoice(previous, groupId, slotId, option)
        }),
      persist: () => setSlotItem(tripId, groupId, slotId, option?.id ?? null),
      settle: (result) => setGroups(() => result.groups),
      rollback: () => setGroups(before),
      onError: () => onError?.('Could not save that change.'),
    })
  }
}
