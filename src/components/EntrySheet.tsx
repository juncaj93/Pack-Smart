import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import { excludeEntry, patchEntry, restoreEntry, type AffectedOutfit } from '@/lib/trips'
import type { ChecklistEntry } from '@shared/checklist'
import { PACKING_TIMING_LABELS, type PackingTiming } from '@shared/items'
import './EntrySheet.css'
import { explainEntrySource } from '@shared/explain'

interface EntrySheetProps {
  open: boolean
  tripId: string
  entry: ChecklistEntry | null
  onClose: () => void
  onChanged: (entry: ChecklistEntry) => void
  /** The outfits that were wearing it come back with the row (doc 04 §8). */
  onExcluded: (entry: ChecklistEntry, affected: AffectedOutfit[]) => void
}

const TIMINGS: PackingTiming[] = ['anytime', 'day_of']

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
        {/*
          * Suppressed once Alex has set the number himself: the stored
          * breakdown derives a quantity that is no longer the one on screen,
          * and an explanation that disagrees with the figure beside it is worse
          * than none. *Why it is here* below still answers, because an override
          * changes how many and never why.
          */}
        {entry.qtyOverride === null && entry.qtyBreakdown ? (
          <p className="entry-why">
            <span className="entry-why-label">Why this many</span>
            {entry.qtyBreakdown}
          </p>
        ) : null}
        {/*
          * Never empty for a generated row as of C1, and honest for the rest.
          *
          * `explainEntrySource` prefers the stored reason and otherwise states
          * only what the database actually records — that Alex added this
          * himself, or that an outfit needs it. Where nothing is recorded it
          * returns null and this says nothing, which is the right answer: a
          * system reason invented for a hand-added item would be the product
          * claiming a decision it never made.
          */}
        {explainEntrySource(entry) ? (
          <p className="entry-why">
            <span className="entry-why-label">Why it is here</span>
            {explainEntrySource(entry)}
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
                  const { affectedOutfits, ...excluded } = await excludeEntry(tripId, entry.id)
                  onExcluded(excluded, affectedOutfits)
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
