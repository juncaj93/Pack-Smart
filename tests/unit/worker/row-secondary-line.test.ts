import { describe, expect, it } from 'vitest'
import {
  rowBrandLabel,
  rowColorLabel,
  rowExplanationParts,
  rowQuantityLabel,
  rowSecondaryLine,
  type ChecklistEntry,
} from '@shared/checklist'

/**
 * What a checklist row says, and what it keeps behind a tap.
 *
 * This exists because the judgement it encodes is the easiest thing in C1 to
 * undo by accident. "Every row has a reason, so show it on every row" is a
 * reasonable-sounding change that would put `One per trip` on nineteen
 * consecutive rows of the seeded catalog — nineteen identical lines, restating
 * a quantity the row already shows, which is the vague-filler failure wearing a
 * true sentence.
 *
 * The V1.1 visual pass drew the line in a second place as well. `24 needed` is
 * the answer and belongs on the row; `12 nights × 2 = 24` is the derivation and
 * belongs on the row's sheet, under `Why this many`, where it already was. The
 * arithmetic on the row made it wrap to two lines and stand 88px tall beside
 * 49px neighbours — an explanation nobody asked for at the cost of the evenness
 * that makes forty rows scannable (§16).
 *
 * So every case below is asserted TWICE: what the list shows, and what the
 * sheet can still be asked for. Progressive disclosure is only progressive if
 * the second half is still there, and half of these assertions exist to prove
 * it is.
 *
 * The rule is in `shared/checklist.ts` so both sides agree, and asserted here
 * so the next person changing it has to change a test that says why.
 */

function entry(partial: Partial<ChecklistEntry> = {}): ChecklistEntry {
  return {
    id: 'e1', tripId: 't1', itemId: 'i1', name: 'Toothbrush', detail: null, brand: null, color: null, category: 'Toiletries',
    requiredQty: 1, qtyBreakdown: null, qtyOverride: null, packedQty: 0,
    packingTiming: 'anytime', requiresFinalCheck: false, finalCheckedAt: null,
    excludedAt: null, source: 'always_packed', reason: 'One per trip',
    isCritical: false, tripOnly: false, sortOrder: 0, bag: null, bagSource: null,
    updatedAt: 0,
    ...partial,
  }
}

describe('what the row says beside the name', () => {
  it('stays silent for a single always-packed item', () => {
    /*
     * The row already shows exactly one of the item and no quantity, so
     * `One per trip` would restate what is on screen. The reason still exists
     * and the ⋯ sheet still shows it — this is about the list, not the data.
     */
    expect(rowSecondaryLine(entry())).toBeNull()
  })

  it('no longer carries the quantity, which moved to the end of the row', () => {
    /*
     * The count was the commonest reason a row had a second line at all — most
     * rows carry no brand, no colour and no bag — so eight characters were
     * making a forty-row list uneven. It is the same string, on the same rows,
     * at the right-hand end instead of underneath. See `rowQuantityLabel`
     * below, which asserts every case this used to.
     */
    expect(rowSecondaryLine(entry({ requiredQty: 24, qtyBreakdown: '12 nights × 2 = 24' }))).toBeNull()
  })

  it('keeps the brand, because that is how two quarter-zips are told apart', () => {
    /*
     * Identity rather than explanation, so it stays on the list while the
     * arithmetic leaves it. The COLOUR is no longer in this string — it is a
     * swatch on the row and `rowColorLabel` for a listener — because a colour
     * word is something you decode and a dot is something you see (§13).
     */
    expect(
      rowSecondaryLine(entry({ detail: 'Patagonia · Navy', brand: 'Patagonia', color: 'Navy', requiredQty: 2 })),
    ).toBe('Patagonia')
  })

  it('abbreviates only the brands long enough to push the item name off the row', () => {
    /*
     * §16 wants conservative and readable, and rules out inventing cryptic
     * abbreviations — so the table names the few that matter and everything
     * else is left exactly as Alex wrote it, to truncate with an ellipsis if
     * the row is genuinely out of room. Presentation only: `item.brand` is
     * untouched and search still matches the stored spelling.
     */
    expect(rowBrandLabel(entry({ brand: 'Banana Republic' }))).toBe('Banana Rep.')
    expect(rowBrandLabel(entry({ brand: 'New Balance' }))).toBe('New Bal.')
    expect(rowBrandLabel(entry({ brand: 'Abercrombie & Fitch' }))).toBe('Abercrombie')
    expect(rowBrandLabel(entry({ brand: 'Vuori' }))).toBe('Vuori')
    expect(rowBrandLabel(entry({ brand: null }))).toBeNull()
  })

  it('spells the colour the way the screen spells it, for the listener', () => {
    /*
     * The swatch is `aria-hidden` — it is a second rendering of this string —
     * so this is the only thing that tells somebody who cannot see the dot what
     * colour the garment is (§14). Respelled here rather than at import: the
     * column is a SNAPSHOT and holds whatever the catalog said at the time.
     */
    expect(rowColorLabel(entry({ color: 'Heather Gray' }))).toBe('Heather Grey')
    expect(rowColorLabel(entry({ color: null }))).toBeNull()
  })

  it('does not print the derivation, however interesting it is', () => {
    /*
     * §4, and the assertion that holds it. P4f put the arithmetic back on the
     * rows whose count was surprising, and this now covers that case too: the
     * quantity is 24 on a 12-night trip, which `quantityIsSurprising` says yes
     * to, and the row still carries no `×`.
     */
    expect(
      rowSecondaryLine(
        entry({
          name: 'Contacts',
          detail: 'Acuvue',
          brand: 'Acuvue',
          requiredQty: 24,
          qtyBreakdown: '12 nights × 2 = 24',
          reason: '12 nights × 2',
        }),
      ),
    ).not.toContain('×')
  })

  it('does not print a reason either, on any of the sources that carry one', () => {
    for (const partial of [
      { source: 'trip_triggered' as const, reason: 'International trip' },
      { source: 'dependency_triggered' as const, reason: 'Because you are packing Apple Watch' },
      { source: 'user_added' as const, tripOnly: true, reason: 'You added this for this trip' },
    ]) {
      expect(rowSecondaryLine(entry(partial))).toBeNull()
    }
  })

  it('never runs to more than one separator', () => {
    /*
     * The height guard, as an assertion. Two facts is a line; three is a card,
     * and doc 02 §2 has already rejected oversized multi-line rows once.
     */
    const line = rowSecondaryLine(
      entry({
        brand: 'Patagonia',
        color: 'Navy',
        bag: 'checked',
        bagSource: 'user',
        requiredQty: 24,
        packedQty: 6,
        qtyBreakdown: '12 nights × 2 = 24',
        reason: '12 nights × 2 · International trip',
      }),
    )
    expect((line ?? '').split('·').length).toBeLessThanOrEqual(2)
  })
})

/**
 * The same four cases the secondary line used to own, in the place they moved to.
 *
 * Moved verbatim rather than rewritten: the wording, the branch order and the
 * "24 of 24 packed is noise" judgement are all decisions that were argued once
 * and should not be re-argued by a relocation. What changed is where the string
 * is rendered, and nothing here is about rendering.
 */
describe('how many, at the end of the row', () => {
  it('leads with the quantity, which is the answer', () => {
    expect(rowQuantityLabel(entry({ requiredQty: 24, qtyBreakdown: '12 nights × 2 = 24' }))).toBe(
      '24 needed',
    )
  })

  it('reports progress once some are packed, ahead of the total', () => {
    expect(
      rowQuantityLabel(entry({ requiredQty: 24, packedQty: 6, qtyBreakdown: null, reason: null })),
    ).toBe('6 of 24 packed')
  })

  it('drops back to the total once everything is packed', () => {
    // "24 of 24 packed" is noise beside a ticked row.
    expect(rowQuantityLabel(entry({ requiredQty: 24, packedQty: 24, reason: null }))).toBe(
      '24 needed',
    )
  })

  it('says nothing at all when the row wants one of something', () => {
    /*
     * The reason this is null and not `1 needed`. Nineteen rows of the seeded
     * catalog want exactly one, and a column reading `1` down the right of the
     * list would be the vague-filler failure with a number instead of a
     * sentence — worth printing only where it is not the number you assume.
     */
    expect(rowQuantityLabel(entry())).toBeNull()
    expect(rowQuantityLabel(entry({ requiredQty: 1, packedQty: 1 }))).toBeNull()
  })
})

describe('what the row keeps for its sheet', () => {
  it('prefers the arithmetic over repeating it as a reason', () => {
    /*
     * For a counted row the breakdown IS the reason. Offering both would put
     * `12 nights × 2 = 24` and `12 nights × 2` under two different labels in
     * the same sheet.
     */
    expect(
      rowExplanationParts(
        entry({
          name: 'Contacts',
          requiredQty: 24,
          qtyBreakdown: '12 nights × 2 = 24',
          reason: '12 nights × 2',
        }),
      ),
    ).toEqual(['12 nights × 2 = 24'])
  })

  it('drops the arithmetic once Alex has set the number himself', () => {
    /*
     * `7 needed` beside `11 nights × 2 = 22` is a sheet arguing with itself.
     * The breakdown derives a quantity that is no longer on the row, so it
     * falls back to why the item is on the trip — which an override does not
     * change.
     */
    expect(
      rowExplanationParts(
        entry({
          name: 'Contacts',
          requiredQty: 7,
          qtyOverride: 7,
          qtyBreakdown: '11 nights × 2 = 22',
          source: 'trip_triggered',
          reason: 'International trip',
        }),
      ),
    ).toEqual(['International trip'])
  })

  it('still holds the trip-specific reason the list stopped printing', () => {
    expect(
      rowExplanationParts(entry({ source: 'trip_triggered', reason: 'International trip' })),
    ).toEqual(['International trip'])
  })

  it('still holds the dependency, which differs from row to row', () => {
    expect(
      rowExplanationParts(
        entry({ source: 'dependency_triggered', reason: 'Because you are packing Apple Watch' }),
      ),
    ).toEqual(['Because you are packing Apple Watch'])
  })

  it('still says a hand-added item is one', () => {
    expect(
      rowExplanationParts(
        entry({ source: 'user_added', tripOnly: true, reason: 'You added this for this trip' }),
      ),
    ).toEqual(['You added this for this trip'])
  })

  it('says nothing about an always-packed item, which is the one case with nothing to say', () => {
    /*
     * `One per trip` is true of nineteen rows at once. It was never shown on
     * the list and it is not worth a labelled paragraph in the sheet either —
     * the sheet falls through to what it says about the item itself.
     */
    expect(rowExplanationParts(entry())).toEqual([])
  })
})
