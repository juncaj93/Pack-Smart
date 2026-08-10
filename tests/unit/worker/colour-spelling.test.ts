import { describe, expect, it } from 'vitest'
import { garmentDetail, greySpelling, storedSpelling } from '@shared/items'
import { rowSecondaryLine, type ChecklistEntry } from '@shared/checklist'

/**
 * Alex spells it grey; the workbook spells it gray.
 *
 * The requirement is one sentence — he should never see `gray` — and the way it
 * is met is the interesting part: a presentation mapping in one direction and a
 * canonicalising mapping in the other, with the stored column untouched.
 *
 * These assert the properties that make that safe rather than the wording,
 * because the failure mode is silent. If `storedSpelling` stopped being applied
 * on write, nothing on screen would change and nothing would throw — the damage
 * would only appear the next time the workbook was imported, as a wardrobe of
 * grey garments that no longer matched their own `identity_hash` and arrived as
 * duplicates.
 */

function entry(partial: Partial<ChecklistEntry> = {}): ChecklistEntry {
  return {
    id: 'e1', tripId: 't1', itemId: 'i1', name: 'Quarter-Zip', detail: null, category: 'Tops & Outerwear',
    requiredQty: 1, qtyBreakdown: null, qtyOverride: null, packedQty: 0,
    packingTiming: 'anytime', requiresFinalCheck: false, finalCheckedAt: null,
    excludedAt: null, source: 'outfit_generated', reason: null,
    isCritical: false, tripOnly: false, sortOrder: 0, bag: null, bagSource: null,
    updatedAt: 0,
    ...partial,
  }
}

describe('the spelling Alex reads', () => {
  it('respells every case the catalog actually holds', () => {
    expect(greySpelling('Gray')).toBe('Grey')
    expect(greySpelling('gray')).toBe('grey')
    expect(greySpelling('GRAY')).toBe('GREY')
  })

  /* The four values in the seeded wardrobe, verbatim. */
  it('respells every gray inside a longer colour, not just the first', () => {
    expect(greySpelling('Heather Gray')).toBe('Heather Grey')
    expect(greySpelling('Gray Heather')).toBe('Grey Heather')
    expect(greySpelling('Gray, Navy, Short Gray')).toBe('Grey, Navy, Short Grey')
  })

  /*
   * Word-anchored, and this is the guard that keeps a spelling preference from
   * becoming a find-and-replace across somebody's surname or a brand.
   */
  it('leaves a longer word that merely contains the letters alone', () => {
    expect(greySpelling('Grayling')).toBe('Grayling')
    expect(greySpelling('Engrayed')).toBe('Engrayed')
    expect(storedSpelling('Greyhound')).toBe('Greyhound')
  })

  it('says nothing about a colour nobody recorded', () => {
    expect(greySpelling(null)).toBeNull()
    expect(greySpelling(undefined)).toBeNull()
    expect(storedSpelling(null)).toBeNull()
  })

  it('is idempotent, so a value that has already been through it is unharmed', () => {
    expect(greySpelling(greySpelling('Heather Gray'))).toBe('Heather Grey')
    expect(storedSpelling(storedSpelling('Heather Grey'))).toBe('Heather Gray')
  })

  /*
   * The property the compatibility rule depends on: a colour that goes out to
   * the sheet and comes back in is byte-identical to what was stored.
   *
   * This asserts the two functions compose. Whether the repository actually
   * CALLS them is a different question and a different failure — a missing call
   * leaves both functions perfect — so it is asserted against the real write
   * path in `tests/integration/colour-spelling.test.ts` instead.
   */
  it('round-trips a stored colour unchanged through the editor', () => {
    for (const stored of ['Gray', 'Heather Gray', 'Gray Heather', 'Gray, Navy, Short Gray']) {
      expect(storedSpelling(greySpelling(stored))).toBe(stored)
    }
  })
})

describe('where the spelling reaches', () => {
  it('respells the colour and the pattern, and never the brand', () => {
    expect(garmentDetail({ brand: 'Nordstrom', color: 'Heather Gray', pattern: null }))
      .toBe('Nordstrom · Heather Grey')
    expect(garmentDetail({ brand: null, color: null, pattern: 'Gray' })).toBe('Grey')
    /*
     * A brand is somebody's name. If a label called itself Gray, respelling it
     * would be the app correcting a proper noun — so the mapping is applied per
     * field rather than to the joined string.
     */
    expect(garmentDetail({ brand: 'Gray Malin', color: 'Black', pattern: null }))
      .toBe('Gray Malin · Black')
  })

  /*
   * A `detail` on a checklist row is a SNAPSHOT taken when the row was written,
   * so every list already on a live trip carries whatever the catalog said at
   * the time. Mapping only where the string is composed would leave those rows
   * saying `Gray` next to a My Stuff that says `Grey`.
   */
  it('respells a detail snapshotted before the mapping existed', () => {
    expect(rowSecondaryLine(entry({ detail: 'Nordstrom · Heather Gray' })))
      .toBe('Nordstrom · Heather Grey')
  })
})
