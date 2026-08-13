import { describe, expect, it } from 'vitest'
import { rowExplanationParts, rowSecondaryLine, type ChecklistEntry } from '@shared/checklist'

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
    id: 'e1', tripId: 't1', itemId: 'i1', name: 'Toothbrush', detail: null, category: 'Toiletries',
    requiredQty: 1, qtyBreakdown: null, qtyOverride: null, packedQty: 0,
    packingTiming: 'anytime', requiresFinalCheck: false, finalCheckedAt: null,
    excludedAt: null, source: 'always_packed', reason: 'One per trip',
    isCritical: false, tripOnly: false, sortOrder: 0, bag: null, bagSource: null,
    updatedAt: 0,
    ...partial,
  }
}

describe('what the row says underneath the name', () => {
  it('stays silent for a single always-packed item', () => {
    /*
     * The row already shows exactly one of the item and no quantity, so
     * `One per trip` would restate what is on screen. The reason still exists
     * and the ⋯ sheet still shows it — this is about the list, not the data.
     */
    expect(rowSecondaryLine(entry())).toBeNull()
  })

  it('leads with the quantity, which is the answer', () => {
    expect(rowSecondaryLine(entry({ requiredQty: 24, qtyBreakdown: '12 nights × 2 = 24' }))).toBe(
      '24 needed',
    )
  })

  it('reports progress once some are packed, ahead of the total', () => {
    expect(
      rowSecondaryLine(entry({ requiredQty: 24, packedQty: 6, qtyBreakdown: null, reason: null })),
    ).toBe('6 of 24 packed')
  })

  it('drops back to the total once everything is packed', () => {
    // "24 of 24 packed" is noise beside a ticked row.
    expect(
      rowSecondaryLine(entry({ requiredQty: 24, packedQty: 24, reason: null })),
    ).toBe('24 needed')
  })

  it('keeps which one of them this is, because that is how rows are told apart', () => {
    /*
     * `detail` is the brand and colour, and Alex owns seven quarter-zips. It is
     * identity rather than explanation, so it stays on the list while the
     * arithmetic leaves it.
     */
    expect(rowSecondaryLine(entry({ detail: 'Patagonia · Navy', requiredQty: 2 }))).toBe(
      'Patagonia · Navy · 2 needed',
    )
  })

  it('does not print the derivation, however interesting it is', () => {
    expect(
      rowSecondaryLine(
        entry({
          name: 'Contacts',
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
        requiredQty: 24,
        packedQty: 6,
        qtyBreakdown: '12 nights × 2 = 24',
        reason: '12 nights × 2 · International trip',
      }),
    )
    expect((line ?? '').split('·').length).toBeLessThanOrEqual(2)
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
