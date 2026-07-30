import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import { fetchSwapOptions, setSlotItem, type OutfitGroup, type SwapOption } from '@/lib/trips'
import './SwapSheet.css'

/** The one slot being filled. Ids, so a screen without the outfit loaded can ask. */
export interface SwapTarget {
  groupId: string
  slotId: string
  roleLabel: string
  /** What is in the slot now, so it can be marked Current. */
  itemId: string | null
}

interface SwapSheetProps {
  open: boolean
  tripId: string
  target: SwapTarget | null
  onClose: () => void
  onChanged: (groups: OutfitGroup[]) => void
}

/**
 * One Swap action for every slot.
 *
 * Product doc 04 §7 asks for a single Swap rather than a control per garment
 * type. Unsuitable garments are listed too, below a divider and labelled with
 * why — the app's job is to say a linen shirt is wrong for the cold, not to make
 * it unchoosable. Alex knows things about his trip that the app does not.
 *
 * Takes ids rather than the loaded outfit so the packing list can open it too:
 * doc 04 §8 offers a replacement at the moment a garment leaves the list, and
 * that screen has a slot id and no outfits in hand.
 */
export function SwapSheet({ open, tripId, target, onClose, onChanged }: SwapSheetProps) {
  const [options, setOptions] = useState<SwapOption[] | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groupId = target?.groupId
  const slotId = target?.slotId

  useEffect(() => {
    if (!open || !groupId || !slotId) return

    setOptions(null)
    setSearch('')
    setError(null)

    let cancelled = false
    fetchSwapOptions(tripId, groupId, slotId)
      .then((result) => {
        if (!cancelled) setOptions(result.candidates)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your wardrobe.')
      })

    return () => {
      cancelled = true
    }
  }, [open, tripId, groupId, slotId])

  async function choose(itemId: string | null) {
    if (!groupId || !slotId || busy) return
    setBusy(true)
    try {
      const result = await setSlotItem(tripId, groupId, slotId, itemId)
      onChanged(result.groups)
    } catch {
      setError('Could not save that change.')
    } finally {
      setBusy(false)
    }
  }

  if (!target) return null

  const needle = search.trim().toLowerCase()
  const matching = (options ?? []).filter(
    (option) => !needle || option.name.toLowerCase().includes(needle),
  )
  const suitable = matching.filter((o) => o.suitable)
  const rest = matching.filter((o) => !o.suitable)

  return (
    <BottomSheet open={open} onClose={onClose} title={target.roleLabel}>
      <div className="form">
        {error ? <p className="field-error">{error}</p> : null}

        {options === null ? (
          <p className="hint">Looking through your wardrobe…</p>
        ) : options.length === 0 ? (
          <p className="hint">
            You do not own anything that could go here. Add something in My Stuff and plan again.
          </p>
        ) : (
          <>
            <label className="field">
              <span className="visually-hidden">Search your wardrobe</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                autoCapitalize="none"
              />
            </label>

            <ul className="swap-list">
              {suitable.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className={`swap-row ${option.id === target.itemId ? 'is-current' : ''}`}
                    onClick={() => void choose(option.id)}
                    disabled={busy}
                  >
                    <span className="swap-name">
                      {option.name}
                      {option.favorite ? <span className="swap-star"> ★</span> : null}
                    </span>
                    {option.id === target.itemId ? <span className="swap-current">Current</span> : null}
                  </button>
                </li>
              ))}
            </ul>

            {rest.length > 0 ? (
              <>
                <p className="swap-divider">
                  Everything else you own that fits here. Pack Smart does not think these suit the
                  occasion, but it is your call.
                </p>
                <ul className="swap-list">
                  {rest.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        className="swap-row is-unsuitable"
                        onClick={() => void choose(option.id)}
                        disabled={busy}
                      >
                        <span className="swap-name">{option.name}</span>
                        <span className="swap-why">{option.reason}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}

        {target.itemId ? (
          <button
            type="button"
            className="button-secondary destructive"
            onClick={() => void choose(null)}
            disabled={busy}
          >
            Leave this empty
          </button>
        ) : null}
      </div>
    </BottomSheet>
  )
}
