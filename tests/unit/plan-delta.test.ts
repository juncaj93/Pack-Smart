import { describe, expect, it } from 'vitest'
import type { ChecklistEntry } from '@shared/checklist'
import type { CoverageGap } from '@shared/essentials'
import {
  planChanged,
  planDelta,
  type DeltaOutfitGroup,
  type PlanSnapshot,
} from '@shared/plan-delta'

/**
 * What changed about the plan, and — the harder half — what did not.
 *
 * The failure this module exists to prevent is a sentence written from the
 * ACTION rather than the result: `Added a swimsuit` after adding a pool day,
 * produced without ever checking whether one was added. So roughly half of the
 * assertions below are silence assertions. A delta engine that reports
 * something on every regeneration is worse than none, because it teaches Alex
 * that the line means nothing.
 */

function entry(overrides: Partial<ChecklistEntry> = {}): ChecklistEntry {
  return {
    id: 'e1', tripId: 't1', itemId: 'i1', name: 'Quarter-Zip', detail: null, brand: null, color: null,
    category: 'Tops', requiredQty: 1, qtyBreakdown: null, qtyOverride: null,
    packedQty: 0, packingTiming: 'anytime', requiresFinalCheck: false,
    finalCheckedAt: null, excludedAt: null, source: 'always_packed',
    reason: null, isCritical: false, tripOnly: false, sortOrder: 0,
    bag: null, bagSource: null, updatedAt: 0,
    ...overrides,
  }
}

function group(overrides: Partial<DeltaOutfitGroup> = {}): DeltaOutfitGroup {
  return {
    id: 'g1', name: 'Nice dinners', status: 'draft', reviewReason: null,
    slots: [
      { role: 'top', roleLabel: 'Top', itemId: 'i1', itemName: 'Button-Up Shirt' },
      { role: 'bottom', roleLabel: 'Bottoms', itemId: 'i2', itemName: 'Dark Jeans' },
    ],
    ...overrides,
  }
}

const snapshot = (over: Partial<PlanSnapshot> = {}): PlanSnapshot => ({
  entries: [], groups: [], gaps: [], ...over,
})

describe('what the plan says changed', () => {
  it('says nothing at all when nothing moved', () => {
    const state = snapshot({ entries: [entry()], groups: [group()] })
    expect(planDelta(state, state)).toEqual([])
    expect(planChanged(planDelta(state, state))).toBe(false)
  })

  it('names what arrived and what left', () => {
    const before = snapshot({ entries: [entry()] })
    const after = snapshot({
      entries: [entry(), entry({ id: 'e2', itemId: 'i2', name: 'Rain Shell', requiredQty: 1 })],
    })

    expect(planDelta(before, after)).toEqual([
      { kind: 'item_added', label: 'Rain Shell', entryId: 'e2', quantity: 1 },
    ])
    expect(planDelta(after, before)).toEqual([
      { kind: 'item_removed', label: 'Rain Shell', entryId: 'e2' },
    ])
  })

  it('treats Not bringing as leaving the plan, because that is what it means', () => {
    /*
     * The row is still stored — that is what makes putting it back possible —
     * but the trip is not packing it. `Not bringing changed` would be an
     * accurate description of a column and a useless description of the plan.
     */
    const before = snapshot({ entries: [entry()] })
    const after = snapshot({ entries: [entry({ excludedAt: 1_780_000_000 })] })

    expect(planDelta(before, after)).toEqual([
      { kind: 'item_removed', label: 'Quarter-Zip', entryId: 'e1' },
    ])
  })

  it('reports a count moving, in both directions', () => {
    const before = snapshot({ entries: [entry({ requiredQty: 24 })] })
    const after = snapshot({ entries: [entry({ requiredQty: 22 })] })

    expect(planDelta(before, after)).toEqual([
      { kind: 'quantity_changed', label: 'Quarter-Zip', entryId: 'e1', from: 24, to: 22 },
    ])
  })

  it('reports a bag and a timing change as themselves', () => {
    const before = snapshot({ entries: [entry({ bag: 'checked', packingTiming: 'anytime' })] })
    const after = snapshot({ entries: [entry({ bag: 'carry_on', packingTiming: 'day_of' })] })

    expect(planDelta(before, after)).toEqual([
      { kind: 'bag_changed', label: 'Quarter-Zip', entryId: 'e1', from: 'checked', to: 'carry_on' },
      { kind: 'timing_changed', label: 'Quarter-Zip', entryId: 'e1', from: 'anytime', to: 'day_of' },
    ])
  })
})

describe('what the plan refuses to call a change', () => {
  /*
   * Each of these moves on almost every regeneration. A delta that surfaced
   * them would fire every time and mean nothing by the second trip.
   */
  it('ignores ordering', () => {
    const before = snapshot({ entries: [entry({ sortOrder: 0 })] })
    const after = snapshot({ entries: [entry({ sortOrder: 9 })] })
    expect(planDelta(before, after)).toEqual([])
  })

  it('ignores the reason and the arithmetic that explain a row', () => {
    const before = snapshot({
      entries: [entry({ reason: 'International trip', qtyBreakdown: '12 nights × 2 = 24' })],
    })
    const after = snapshot({
      entries: [entry({ reason: 'Because you are packing Apple Watch', qtyBreakdown: '11 nights × 2 = 22' })],
    })
    expect(planDelta(before, after)).toEqual([])
  })

  it('ignores packing progress, which is Alex doing the plan rather than the plan changing', () => {
    const before = snapshot({ entries: [entry({ packedQty: 0 })] })
    const after = snapshot({ entries: [entry({ packedQty: 3 })] })
    expect(planDelta(before, after)).toEqual([])
  })

  it('reports the count once, not the count and the breakdown that derives it', () => {
    const before = snapshot({ entries: [entry({ requiredQty: 24, qtyBreakdown: '12 × 2 = 24' })] })
    const after = snapshot({ entries: [entry({ requiredQty: 22, qtyBreakdown: '11 × 2 = 22' })] })

    const deltas = planDelta(before, after)
    expect(deltas).toHaveLength(1)
    expect(deltas[0]!.kind).toBe('quantity_changed')
  })
})

describe('outfits', () => {
  it('names the slot that was swapped and both garments', () => {
    const before = snapshot({ groups: [group()] })
    const after = snapshot({
      groups: [
        group({
          id: 'g-new', // ids are minted fresh each plan; the name is the identity
          slots: [
            { role: 'top', roleLabel: 'Top', itemId: 'i9', itemName: 'Linen Shirt' },
            { role: 'bottom', roleLabel: 'Bottoms', itemId: 'i2', itemName: 'Dark Jeans' },
          ],
        }),
      ],
    })

    expect(planDelta(before, after)).toEqual([
      {
        kind: 'outfit_changed',
        label: 'Nice dinners',
        groupId: 'g-new',
        role: 'Top',
        from: 'Button-Up Shirt',
        to: 'Linen Shirt',
      },
    ])
  })

  it('raises a review flag once, not on every replan afterwards', () => {
    const clean = group({ status: 'approved' })
    const flagged = group({ status: 'approved', reviewReason: 'Colder than when you approved it' })

    expect(planDelta(snapshot({ groups: [clean] }), snapshot({ groups: [flagged] }))).toEqual([
      {
        kind: 'approved_outfit_review_required',
        label: 'Nice dinners',
        groupId: 'g1',
        reason: 'Colder than when you approved it',
      },
    ])

    // Still flagged, for the same reason — the screen is already saying so.
    expect(planDelta(snapshot({ groups: [flagged] }), snapshot({ groups: [flagged] }))).toEqual([])
  })

  it('says nothing about an outfit that no longer exists', () => {
    /*
     * Its garments leaving the list are already reported as removals, and
     * "Beach changed" about an outfit that is gone is a sentence with nothing
     * behind it.
     */
    const before = snapshot({ groups: [group({ name: 'Beach' })] })
    expect(planDelta(before, snapshot())).toEqual([])
  })
})

describe('coverage gaps', () => {
  const gap = (over: Partial<CoverageGap> = {}): CoverageGap => ({
    kind: 'missing', message: 'Nothing waterproof', fix: 'Add one', ...over,
  })

  it('reports a gap opening and the same gap closing', () => {
    const none = snapshot()
    const open = snapshot({ gaps: [gap()] })

    expect(planDelta(none, open)).toEqual([
      { kind: 'gap_opened', label: 'Nothing waterproof', gapKind: 'missing' },
    ])
    expect(planDelta(open, none)).toEqual([
      { kind: 'gap_resolved', label: 'Nothing waterproof', gapKind: 'missing' },
    ])
  })

  it('tells two gaps of the same kind apart', () => {
    /*
     * `unreachable` names a specific garment. Keyed on kind alone, one being
     * replaced by another would report a resolution that did not happen.
     */
    const before = snapshot({ gaps: [gap({ kind: 'unreachable', message: 'Navy blazer is archived' })] })
    const after = snapshot({ gaps: [gap({ kind: 'unreachable', message: 'Black tie is archived' })] })

    expect(planDelta(before, after)).toEqual([
      { kind: 'gap_opened', label: 'Black tie is archived', gapKind: 'unreachable' },
      { kind: 'gap_resolved', label: 'Navy blazer is archived', gapKind: 'unreachable' },
    ])
  })
})

describe('the case the whole module exists for', () => {
  it('stays silent when the trigger changed nothing about the plan', () => {
    /*
     * Adding a pool day to a trip that already packs a swimsuit. The INPUT
     * changed — `replan.ts` is right to notice it — and the plan did not. A
     * message written from the action would say `Added a swimsuit`; this says
     * nothing, which is the truth.
     */
    const swimsuit = entry({ id: 'e-swim', itemId: 'i-swim', name: 'Swimsuit' })
    const before = snapshot({ entries: [swimsuit] })
    const after = snapshot({ entries: [swimsuit] })

    expect(planChanged(planDelta(before, after))).toBe(false)
  })
})
