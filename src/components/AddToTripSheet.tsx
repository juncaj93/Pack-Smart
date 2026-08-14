import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import { StuffPicker } from '@/components/StuffPicker'
import { useOptimisticWrite } from '@/lib/optimistic'
import { addFromWardrobe, addTripOnlyItem } from '@/lib/trips'
import type { ChecklistEntry } from '@shared/checklist'
import type { Item } from '@shared/items'
import './AddToTripSheet.css'

interface AddToTripSheetProps {
  open: boolean
  tripId: string
  /** Every row already on the trip, so the picker can say what is on the list. */
  entries: ChecklistEntry[]
  /** The search text, kept by the screen so it survives the sheet (§41). */
  search: string
  onSearch: (value: string) => void
  onClose: () => void
  /** A row that now exists, applied to the list behind the sheet. */
  onAdded: (entry: ChecklistEntry) => void
}

/**
 * One way to put something on this trip's packing list.
 *
 * ## What it replaced
 *
 * Two things, in two different places, neither of which said it was the other's
 * sibling: a `Pack by bag` chip in the screen's one header action slot, and an
 * `Add a unique item` button below forty packing rows at the very bottom of the
 * page. Adding something Alex owns was not offered at all on this screen — the
 * only route was `One last look`, inside `Trip setup`, which is a pre-packing
 * wardrobe review rather than an add flow.
 *
 * So the top-right action is now Add, and both answers to *add what* live
 * inside it (§6–§9): the wardrobe, which is the common case and therefore the
 * default, and a one-off for this trip alone, which is one tap away rather than
 * a scroll to the end of the list away.
 *
 * ## The unique item is still trip-only
 *
 * `addTripOnlyItem` writes a `checklist_entry` with a null `item_id` and never
 * touches the catalog (doc 05 §10) — exactly what the control at the bottom of
 * the page did, through exactly the same endpoint. Nothing about the capability
 * changed, only where it is offered from; §9 asks for that to be confirmed
 * before the old control is removed, and this is the confirmation.
 */
export function AddToTripSheet({
  open,
  tripId,
  entries,
  search,
  onSearch,
  onClose,
  onAdded,
}: AddToTripSheetProps) {
  /** Rows added in this sitting, so a tapped row says so without a round trip. */
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [unique, setUnique] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  /**
   * Whether the wardrobe has landed, so the sheet can hold its frame until it
   * has. Measured before this existed: the Add sheet's top edge went from 419
   * to 100 when the reply arrived, taking every row in it 319px up with it.
   */
  const [ready, setReady] = useState(false)
  /**
   * Said INSIDE the sheet, not handed to the screen behind it.
   *
   * The trip screen's own error state is a full-page takeover — it is how a
   * failed LOAD is reported — so raising an add failure through it would
   * replace the packing list with "Could not load this trip" while the sheet is
   * still open over it. A failure here is about one tap in this sheet, and it
   * belongs where the tap was.
   */
  const [error, setError] = useState<string | null>(null)
  const write = useOptimisticWrite()

  useEffect(() => {
    if (open) return
    // The search survives (§41); what was added in the last sitting does not.
    // "Added" is feedback about a tap Alex just made, and a sheet reopened
    // tomorrow saying it about six rows would be a history panel.
    setAdded(new Set())
    setUnique(false)
    setName('')
    setError(null)
    setReady(false)
  }, [open])

  /*
   * What is already on this trip, and therefore not offered again.
   *
   * Only rows that are actually being brought. A garment on `Not bringing` is
   * NOT taken: `POST /checklist/from-wardrobe` restores such a row rather than
   * writing a second one, so tapping it here is the way back — which is a real
   * capability, and hiding it would make the picker claim Alex cannot add
   * something he can.
   */
  const taken = new Set(
    entries.filter((entry) => entry.itemId && entry.excludedAt === null).map((e) => e.itemId!),
  )

  /**
   * Adds a garment, at once, without waiting for the database to agree (§42).
   *
   * Keyed per item so two quick taps on two rows are two independent timelines
   * — the shared `useOptimisticWrite` guard then means a slow reply for the
   * first cannot land over the second, and a failure rolls back only its own
   * row.
   */
  function choose(item: Item) {
    write(`add:${item.id}`, {
      apply: () => setAdded((prev) => new Set(prev).add(item.id)),
      persist: () => addFromWardrobe(tripId, item.id),
      settle: (entry) => onAdded(entry),
      rollback: () =>
        setAdded((prev) => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        }),
      onError: () => setError(`Could not add ${item.displayName}.`),
    })
  }

  /**
   * The one-off, and the sheet closes behind it.
   *
   * Unlike a wardrobe row this is not a repeated action — Alex is not going to
   * type six unique items in a row — and the field cannot show an `Added`
   * marker the way a wardrobe row can, so leaving the sheet open would leave
   * him looking at an empty box wondering whether it took.
   *
   * Awaited rather than optimistic, deliberately: the row does not exist until
   * the server mints it, so there is nothing to show optimistically that would
   * not be an invented id.
   */
  async function addUnique() {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    try {
      onAdded(await addTripOnlyItem(tripId, trimmed, 'Travel Gear', 1))
      setName('')
      setUnique(false)
      onClose()
    } catch {
      setError('Could not add that.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Add to this trip"
      /*
       * A half-typed unique item is a draft, and the sheet says so.
       *
       * `dirty` stops the two CASUAL dismissals — a downward drag and a
       * backdrop tap — so a thumb that meant to scroll cannot take the name
       * with it. The picker is never dirty: a tap there has already been sent.
       */
      dirty={unique && name.trim().length > 0}
      loading={!ready}
    >
      <div className="form add-trip-form">
        {error ? <p className="field-error">{error}</p> : null}

        {/*
          * The way to a one-off, above the results rather than below them (§8).
          *
          * Below forty search results is exactly where it used to be — the
          * bottom of a long list — and moving it into this sheet would have
          * meant nothing if it had landed there again. It is one quiet row,
          * and it opens in place rather than navigating, which is the same
          * disclosure idiom `Trip setup` uses on the screen behind it.
          */}
        {unique ? (
          <div className="add-unique reveal">
            <label className="field">
              <span className="field-label">Unique item for this trip</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Wedding invitation, rental key…"
                autoFocus
                enterKeyHint="done"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addUnique()
                }}
              />
            </label>
            <p className="hint">Stays with this trip. My Stuff is not changed.</p>
            <div className="button-row">
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setUnique(false)
                  setName('')
                }}
              >
                Back to My Stuff
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={() => void addUnique()}
                disabled={saving || name.trim().length === 0}
              >
                {saving ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        ) : (
          <StuffPicker
            open={open}
            search={search}
            onSearch={onSearch}
            taken={taken}
            takenLabel="On the list"
            added={added}
            onChoose={choose}
            emptyMessage="My Stuff is empty. Add something there, or add a unique item for this trip."
            onReady={() => setReady(true)}
            belowSearch={
              <button
                type="button"
                className="add-unique-open"
                onClick={() => setUnique(true)}
              >
                Unique item for this trip
              </button>
            }
          />
        )}
      </div>
    </BottomSheet>
  )
}
