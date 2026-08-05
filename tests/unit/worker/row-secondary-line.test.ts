import { describe, expect, it } from 'vitest'
import { rowSecondaryLine, type ChecklistEntry } from '@shared/checklist'

/**
 * The one secondary line a checklist row shows.
 *
 * This exists because the judgement it encodes is the easiest thing in C1 to
 * undo by accident. "Every row has a reason, so show it on every row" is a
 * reasonable-sounding change that would put `One per trip` on nineteen
 * consecutive rows of the seeded catalog — nineteen identical lines, restating
 * a quantity the row already shows, which is the vague-filler failure wearing a
 * true sentence.
 *
 * The rule is in `shared/checklist.ts` so both sides agree, and asserted here
 * so the next person changing it has to change a test that says why.
 */

function entry(partial: Partial<ChecklistEntry> = {}): ChecklistEntry {
  return {
    id: 'e1', tripId: 't1', itemId: 'i1', name: 'Toothbrush', category: 'Toiletries',
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

  it('shows a trip-specific reason, because that one is worth the line', () => {
    expect(
      rowSecondaryLine(entry({ source: 'trip_triggered', reason: 'International trip' })),
    ).toBe('International trip')
  })

  it('shows a dependency, which differs from row to row', () => {
    expect(
      rowSecondaryLine(
        entry({ source: 'dependency_triggered', reason: 'Because you are packing Apple Watch' }),
      ),
    ).toBe('Because you are packing Apple Watch')
  })

  it('prefers the arithmetic over repeating it as a reason', () => {
    /*
     * For a counted row the breakdown IS the reason. Printing both would read
     * `24 needed · 12 nights × 2 = 24 · 12 nights × 2`.
     */
    expect(
      rowSecondaryLine(
        entry({
          name: 'Contacts',
          requiredQty: 24,
          qtyBreakdown: '12 nights × 2 = 24',
          reason: '12 nights × 2',
        }),
      ),
    ).toBe('24 needed · 12 nights × 2 = 24')
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

  it('says a hand-added item is one, since that is a fact about this row', () => {
    expect(
      rowSecondaryLine(
        entry({ source: 'user_added', tripOnly: true, reason: 'You added this for this trip' }),
      ),
    ).toBe('You added this for this trip')
  })

  it('drops the arithmetic once Alex has set the number himself', () => {
    /*
     * `7 needed · 11 nights × 2 = 22` is a row arguing with itself. The
     * breakdown derives a quantity that is no longer on screen, so the row
     * falls back to why the item is on the trip — which an override does not
     * change.
     */
    expect(
      rowSecondaryLine(
        entry({
          name: 'Contacts',
          requiredQty: 7,
          qtyOverride: 7,
          qtyBreakdown: '11 nights × 2 = 22',
          source: 'trip_triggered',
          reason: 'International trip',
        }),
      ),
    ).toBe('7 needed · International trip')
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
