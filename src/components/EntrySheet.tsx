import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import { excludeEntry, patchEntry, restoreEntry } from '@/lib/trips'
import type { ChecklistEntry } from '@shared/checklist'
import { PACKING_TIMING_LABELS, type PackingTiming } from '@shared/items'
import './EntrySheet.css'

interface EntrySheetProps {
  open: boolean
  tripId: string
  entry: ChecklistEntry | null
  onClose: () => void
  onChanged: (entry: ChecklistEntry) => void
  onExcluded: (entry: ChecklistEntry) => void
}

const TIMINGS: PackingTiming[] = ['anytime', 'night_before', 'day_of', 'last_minute']

/**
 * Everything you can do to one checklist row.
 *
 * The row itself does the common thing — one tap, packed. This sheet holds the
 * rest, which is the progressive-disclosure rule applied literally: a partial
 * count, a different quantity, when to pack it, and taking it out.
 */
export function EntrySheet({ open, tripId, entry, onClose, onChanged, onExcluded }: EntrySheetProps) {
  const [packed, setPacked] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && entry) setPacked(entry.packedQty)
  }, [open, entry])

  if (!entry) return null

  async function apply(patch: Parameters<typeof patchEntry>[2]) {
    if (busy || !entry) return
    setBusy(true)
    try {
      onChanged(await patchEntry(tripId, entry.id, patch))
    } finally {
      setBusy(false)
    }
  }

  async function setPackedQty(next: number) {
    if (!entry) return
    const clamped = Math.max(0, Math.min(next, entry.requiredQty))
    setPacked(clamped)
    await apply({ packedQty: clamped })
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={entry.name}>
      <div className="form">
        {entry.qtyBreakdown ? (
          <p className="entry-why">
            <span className="entry-why-label">Why this many</span>
            {entry.qtyBreakdown}
          </p>
        ) : null}
        {entry.reason ? (
          <p className="entry-why">
            <span className="entry-why-label">Why it is here</span>
            {entry.reason}
          </p>
        ) : null}

        {entry.excludedAt === null ? (
          <>
            <div className="field">
              <span className="field-label">How many are packed</span>
              <div className="stepper">
                <button
                  type="button"
                  onClick={() => void setPackedQty(packed - 1)}
                  disabled={packed <= 0 || busy}
                  aria-label="One fewer packed"
                >
                  −
                </button>
                <span className="stepper-value" aria-live="polite">
                  {packed} of {entry.requiredQty}
                </span>
                <button
                  type="button"
                  onClick={() => void setPackedQty(packed + 1)}
                  disabled={packed >= entry.requiredQty || busy}
                  aria-label="One more packed"
                >
                  +
                </button>
              </div>
            </div>

            <div className="field">
              <span className="field-label">How many to bring</span>
              <div className="chips">
                {[1, 2, 3, 5, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`chip ${entry.qtyOverride === n ? 'is-on' : ''}`}
                    onClick={() => void apply({ qtyOverride: n })}
                    disabled={busy}
                  >
                    {n}
                  </button>
                ))}
                {entry.qtyOverride !== null ? (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => void apply({ qtyOverride: null })}
                    disabled={busy}
                  >
                    Use suggested
                  </button>
                ) : null}
              </div>
              {entry.qtyOverride !== null ? (
                <span className="hint">
                  Set by you. This trip only — it will not change how future trips are worked out.
                </span>
              ) : null}
            </div>

            <div className="field">
              <span className="field-label">When to pack it</span>
              <div className="chips">
                {TIMINGS.map((timing) => (
                  <button
                    key={timing}
                    type="button"
                    className={`chip ${entry.packingTiming === timing ? 'is-on' : ''}`}
                    onClick={() => void apply({ packingTiming: timing })}
                    disabled={busy}
                  >
                    {PACKING_TIMING_LABELS[timing]}
                  </button>
                ))}
              </div>
            </div>

            {entry.requiresFinalCheck ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => void apply({ finalChecked: entry.finalCheckedAt === null })}
                disabled={busy}
              >
                {entry.finalCheckedAt === null ? 'Confirm it is in the bag' : 'Not confirmed yet'}
              </button>
            ) : null}

            <button
              type="button"
              className="button-secondary destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  onExcluded(await excludeEntry(tripId, entry.id))
                  onClose()
                } finally {
                  setBusy(false)
                }
              }}
            >
              Not bringing this
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                onChanged(await restoreEntry(tripId, entry.id))
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            Bring it after all
          </button>
        )}
      </div>
    </BottomSheet>
  )
}
