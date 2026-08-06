import { describe, expect, it } from 'vitest'
import {
  checklistProgress,
  groupChecklist,
  progressLabel,
  type ChecklistEntry,
} from '@shared/checklist'

function entry(partial: Partial<ChecklistEntry> = {}): ChecklistEntry {
  return {
    id: 'e1', tripId: 't1', itemId: 'i1', name: 'Thing', detail: null, category: 'Travel Gear',
    requiredQty: 1, qtyBreakdown: null, qtyOverride: null, packedQty: 0,
    packingTiming: 'anytime', requiresFinalCheck: false, finalCheckedAt: null,
    excludedAt: null, source: 'always_packed', reason: null, isCritical: false,
    tripOnly: false, sortOrder: 0, bag: null, bagSource: null, updatedAt: 0,
    ...partial,
  }
}

describe('the four checklist sections', () => {
  it('splits rows by timing and exclusion', () => {
    const grouped = groupChecklist([
      entry({ id: 'a' }),
      entry({ id: 'b', packingTiming: 'day_of' }),
      entry({ id: 'c', packingTiming: 'last_minute' }),
      entry({ id: 'd', excludedAt: 100 }),
    ])

    expect(grouped.packNow.map((e) => e.id)).toEqual(['a'])
    expect(grouped.packLater.map((e) => e.id)).toEqual(['b', 'c'])
    expect(grouped.notBringing.map((e) => e.id)).toEqual(['d'])
  })

  it('shows a final-check row in BOTH its timing section and Final check', () => {
    // Product doc 03 §8: when to pack it and whether it made the bag are
    // different questions. Moving the passport out of Pack later would lose the
    // reminder to pack it at all.
    const passport = entry({
      id: 'passport',
      packingTiming: 'last_minute',
      requiresFinalCheck: true,
    })
    const grouped = groupChecklist([passport])

    expect(grouped.packLater.map((e) => e.id)).toEqual(['passport'])
    expect(grouped.finalCheck.map((e) => e.id)).toEqual(['passport'])
  })

  it('drops a row out of Final check once confirmed', () => {
    const grouped = groupChecklist([entry({ requiresFinalCheck: true, finalCheckedAt: 5 })])
    expect(grouped.finalCheck).toHaveLength(0)
  })

  it('never asks to final-check something not being brought', () => {
    const grouped = groupChecklist([entry({ requiresFinalCheck: true, excludedAt: 5 })])
    expect(grouped.finalCheck).toHaveLength(0)
    expect(grouped.notBringing).toHaveLength(1)
  })
})

describe('progress', () => {
  it('counts a row packed only when the full quantity is in the bag', () => {
    const progress = checklistProgress([
      entry({ id: 'a', requiredQty: 24, packedQty: 24 }),
      entry({ id: 'b', requiredQty: 24, packedQty: 14 }),
    ])
    expect(progress).toMatchObject({ packed: 1, total: 2 })
  })

  it('leaves Not Bringing out of the denominator', () => {
    // Otherwise the bar sticks below 100% for the whole trip, which reads as a
    // bug rather than as a decision Alex made.
    const progress = checklistProgress([
      entry({ id: 'a', packedQty: 1 }),
      entry({ id: 'b', excludedAt: 10 }),
    ])
    expect(progress).toMatchObject({ packed: 1, total: 1 })
    expect(progressLabel(progress)).toBe('1 of 1 packed')
  })

  it('names the essential items that are still missing', () => {
    const progress = checklistProgress([
      entry({ id: 'a', name: 'Passport', isCritical: true }),
      entry({ id: 'b', name: 'Synthroid', isCritical: true, requiredQty: 14, packedQty: 14 }),
      entry({ id: 'c', name: 'Socks' }),
    ])
    expect(progress.criticalOutstanding.map((e) => e.name)).toEqual(['Passport'])
  })

  it('does not warn about an essential item you decided not to bring', () => {
    const progress = checklistProgress([
      entry({ name: 'Passport', isCritical: true, excludedAt: 99 }),
    ])
    expect(progress.criticalOutstanding).toHaveLength(0)
  })

  it('counts outstanding final checks', () => {
    const progress = checklistProgress([
      entry({ id: 'a', requiresFinalCheck: true }),
      entry({ id: 'b', requiresFinalCheck: true, finalCheckedAt: 1 }),
    ])
    expect(progress.finalCheckOutstanding).toBe(1)
  })

  it('says so plainly when there is nothing to pack', () => {
    expect(progressLabel(checklistProgress([]))).toBe('Nothing to pack yet')
  })
})
