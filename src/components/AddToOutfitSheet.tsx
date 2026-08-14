import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import { StuffPicker } from '@/components/StuffPicker'
import { addOutfitItem, type OutfitEditResult, type OutfitGroup } from '@/lib/trips'
import { deltaLines } from '@shared/plan-delta'
import type { Item } from '@shared/items'
import './AddToOutfitSheet.css'

interface AddToOutfitSheetProps {
  open: boolean
  tripId: string
  /** The outfit being added to, or null when the sheet is closed. */
  group: OutfitGroup | null
  /** The search text, kept by the screen so it survives the sheet (§41). */
  search: string
  onSearch: (value: string) => void
  onClose: () => void
  /** The server's whole view of the plan, plus what the addition cost the bag. */
  onAdded: (result: OutfitEditResult & { slotId: string }, item: Item) => void
}

/**
 * Putting one more garment into an outfit — without taking another out (§18).
 *
 * ## Why this is not the swap sheet
 *
 * They look alike and answer different questions. `SwapSheet` asks *which of my
 * clothes should fill THIS slot*, so it needs the slot's role, the outfit's
 * other garments, that group's weather and the planner's eligibility filter —
 * and it marks what is in the slot now as `Current`. This sheet is adding a
 * slot that does not exist yet: there is no role to recommend for, nothing to
 * be current, and §20 says so explicitly.
 *
 * What it does reuse is `StuffPicker`, which is the wardrobe browser the packing
 * list's Add flow uses. One list, one row shape, one search — §7's instruction
 * not to build a second wardrobe browser applies here just as much.
 *
 * ## Adding several, without reopening anything
 *
 * The sheet stays open and each added garment marks itself, which is the
 * repeated-add pattern §27 asks for: one, then another, then another. Closing
 * is how Alex says he is done, and there is no Save — the additions have already
 * happened, one round trip each.
 */
export function AddToOutfitSheet({
  open,
  tripId,
  group,
  search,
  onSearch,
  onClose,
  onAdded,
}: AddToOutfitSheetProps) {
  const [added, setAdded] = useState<Set<string>>(new Set())
  /**
   * What the last addition cost the packing list (§23).
   *
   * From the shared plan-delta engine over two authoritative snapshots, never
   * written from the action — so a garment three approved outfits already wear
   * produces no lines at all, and a card that would have said "1 added" for it
   * says nothing instead. Shown in the sheet because that is where Alex is
   * looking when it happens.
   */
  const [deltas, setDeltas] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  /** Said inside the sheet: the screen it would report to is behind it. */
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setAdded(new Set())
    setDeltas([])
    setError(null)
  }, [open])

  /*
   * The garments this outfit is already wearing.
   *
   * Adding a second slot for the same shirt is not a thing Alex can want: the
   * outfit already has it, and the packing list would count it once either way.
   * So the row says where it is rather than offering itself again.
   */
  const taken = new Set((group?.slots ?? []).map((slot) => slot.itemId).filter(Boolean) as string[])

  /**
   * Awaited rather than optimistic, and this is the one place in the pass where
   * that is the right answer.
   *
   * A slot does not exist until the server mints its id, and the outfit card
   * behind the sheet renders slots by id — so an optimistic row would need an
   * invented one, which is exactly the fabricated state `useOptimisticWrite`
   * exists to avoid rather than to enable. The write is one round trip and the
   * row it produces is real.
   *
   * Latest intent is still honoured: `busy` refuses a second tap while one is
   * in flight, so two garments cannot race to become the same `sort_order`, and
   * the reply carries the server's whole view of the plan rather than a patch
   * that could be applied out of order.
   */
  async function choose(item: Item) {
    if (!group || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await addOutfitItem(tripId, group.id, item.id)
      setAdded((prev) => new Set(prev).add(item.id))
      setDeltas(deltaLines(result.deltas ?? []))
      onAdded(result, item)
    } catch {
      setError(`Could not add ${item.displayName}.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={`Add to ${group?.name ?? 'this outfit'}`}>
      <div className="form">
        {error ? <p className="field-error">{error}</p> : null}

        {/*
          * What it did to the bag, in the same breath as the addition (§23).
          *
          * Silent when the packing list did not move, which is the common case
          * for a garment another approved outfit already wears — and saying
          * "no packing change" every time would be the sheet reporting its own
          * non-events.
          */}
        {deltas.length > 0 ? (
          <ul className="outfit-deltas add-outfit-deltas" role="status">
            {deltas.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}

        <StuffPicker
          open={open}
          kind="clothing"
          search={search}
          onSearch={onSearch}
          taken={taken}
          takenLabel="In this outfit"
          added={added}
          onChoose={(item) => void choose(item)}
          emptyMessage="You have no clothes in My Stuff yet."
        />
      </div>
    </BottomSheet>
  )
}
