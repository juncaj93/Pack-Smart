import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import { excludeEntry, restoreEntry, type AffectedOutfit, type EntryPatch } from '@/lib/trips'
import { patchEntryOrQueue } from '@/lib/writeQueue'
import { BAG_LABELS, BAG_MEANING, BAG_ORDER, bagFor, type ChecklistEntry } from '@shared/checklist'
import type { BagContext } from '@shared/bags'
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
  /**
   * Which bags the trip is bringing, and whether it is a flight (P3).
   *
   * Optional, and omitting it is not a degraded mode: `bagFor` falls back to a
   * trip that has said nothing, which produces exactly the answer this sheet
   * gave before P3 existed.
   */
  bagContext?: BagContext
}

const TIMINGS: PackingTiming[] = ['anytime', 'day_of']

/**
 * Everything you can do to one checklist row.
 *
 * The row itself does the common thing — one tap, packed. This sheet holds the
 * rest, which is the progressive-disclosure rule applied literally: a partial
 * count, a different quantity, when to pack it, and taking it out.
 */
export function EntrySheet({
  open,
  tripId,
  entry,
  onClose,
  onChanged,
  onExcluded,
  bagContext,
}: EntrySheetProps) {
  const [packed, setPacked] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && entry) setPacked(entry.packedQty)
  }, [open, entry])

  if (!entry) return null

  /** The resolved answer: Alex's choice if he made one, else the suggestion. */
  const bag = bagFor(entry, bagContext, entry.traits)

  /**
   * Saves the edit, or remembers it until there is signal (F2).
   *
   * `patchEntryOrQueue` only queues a patch whose every field is eligible —
   * `packedQty` and `bag` here. A quantity override or a timing change is not,
   * so those still fail offline exactly as they did, which is the honest
   * outcome: both feed regeneration, and neither is something Alex does beside
   * an open suitcase on a plane.
   */
  async function apply(patch: EntryPatch) {
    if (busy || !entry) return
    setBusy(true)
    try {
      onChanged((await patchEntryOrQueue(entry, patch)).entry)
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

            {/*
              * `aria-pressed`, not a radio group — and the difference is real.
              *
              * Selection here was colour plus font weight and nothing else, so
              * VoiceOver announced a chosen chip and an unchosen one
              * identically: "2, button". The whole state of the control was
              * invisible to anyone not looking at it.
              *
              * A radio group would be the better mapping for a set where
              * exactly one is always chosen — and that is what the timing chips
              * below get. This set is not one: `qtyOverride` can be null (none
              * pressed) or a number these five do not offer, and *Use suggested*
              * is an ACTION sitting among them, which a `radiogroup` may not
              * contain. Pressed/not-pressed describes each chip honestly on its
              * own, which is exactly the case `aria-pressed` exists for.
              */}
            <div className="field">
              <span className="field-label" id="entry-qty-label">
                How many to bring
              </span>
              <div className="chips" role="group" aria-labelledby="entry-qty-label">
                {[1, 2, 3, 5, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={entry.qtyOverride === n}
                    className={`chip ${entry.qtyOverride === n ? 'is-on' : ''}`}
                    onClick={() => void apply({ qtyOverride: n })}
                    disabled={busy}
                  >
                    {n}
                  </button>
                ))}
                {entry.qtyOverride !== null ? (
                  /* An action, not a choice — so no pressed state to report. */
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

            {/*
              * A radio group, because exactly one timing is always true.
              *
              * `packingTiming` is never null and never anything outside
              * `TIMINGS`, so "one of these is chosen" is a fact about the data
              * rather than a convention the screen keeps — which is the test
              * for whether radio is the honest role. It also matches
              * `AppearanceChoice`, the pattern already in this codebase.
              *
              * The quantity chips above are deliberately NOT this; see there.
              */}
            <div className="field">
              <span className="field-label" id="entry-timing-label">
                When to pack it
              </span>
              <div className="chips" role="radiogroup" aria-labelledby="entry-timing-label">
                {TIMINGS.map((timing) => (
                  <button
                    key={timing}
                    type="button"
                    role="radio"
                    aria-checked={entry.packingTiming === timing}
                    className={`chip ${entry.packingTiming === timing ? 'is-on' : ''}`}
                    onClick={() => void apply({ packingTiming: timing })}
                    disabled={busy}
                  >
                    {PACKING_TIMING_LABELS[timing]}
                  </button>
                ))}
              </div>
            </div>

            {/*
              * Which bag it goes in (doc 09 §11).
              *
              * In this sheet rather than on the row, because §11 asks for it to
              * be compact and doc 02 §2 keeps uncommon controls out of the way —
              * a permanent five-way control on every row of a forty-row list is
              * the dense dashboard the iPhone rules exist to prevent. The row
              * shows the answer; this is where it changes.
              *
              * A radio group like the timing above, and for the same reason:
              * exactly one of these is true of a bag at a time. `Pack Smart
              * suggests` is a sixth button and deliberately sits OUTSIDE the
              * group — it is an action that hands the row back to the
              * recommendation, not a sixth bag.
              */}
            <div className="field">
              <span className="field-label" id="entry-bag-label">
                Which bag
              </span>
              <div className="chips" role="radiogroup" aria-labelledby="entry-bag-label">
                {BAG_ORDER.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={bag.bag === key}
                    className={`chip ${bag.bag === key ? 'is-on' : ''} ${
                      bag.bag === key && bag.source === 'recommended' ? 'is-suggested' : ''
                    }`}
                    onClick={() => void apply({ bag: key })}
                    disabled={busy}
                  >
                    {BAG_LABELS[key]}
                  </button>
                ))}
              </div>

              {/*
                * Says whose answer it is, and why — because §11 asks that a
                * recommendation and a choice be told apart, and a highlighted
                * chip alone cannot say which it is. Nothing here is enforced:
                * every one of these can be overridden, and saying so is what
                * keeps a suggestion from reading as a rule.
                */}
              {bag.source === 'recommended' && bag.why ? (
                <p className="hint">Pack Smart suggests this. {bag.why}</p>
              ) : null}

              {/*
                * `Either cabin bag` is the one choice whose label cannot carry
                * its own meaning — it has to say WHICH two, and it has to be
                * distinguishable from a row nobody has assigned at all.
                */}
              {bag.bag && BAG_MEANING[bag.bag] ? (
                <p className="hint">{BAG_MEANING[bag.bag]}</p>
              ) : null}

              {bag.source === 'user' ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void apply({ bag: null })}
                  disabled={busy}
                >
                  Use what Pack Smart suggests
                </button>
              ) : null}
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
