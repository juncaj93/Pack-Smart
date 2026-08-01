// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SwapSheet } from '@/components/SwapSheet'
import type { SwapOption } from '@/lib/trips'
import type * as TripsNamespace from '@/lib/trips'

/** The module's own shape, for `importOriginal`. `import()` types are linted out. */
type TripsModule = typeof TripsNamespace

/**
 * "Show when no eligible replacement exists" (doc 09 §7), at the layer where
 * that sentence actually lives.
 *
 * Two failures are easy to confuse and the sheet must not: owning **nothing**
 * that could fill the slot, and owning several and none of them suiting the
 * occasion. Before C2 only the first had a message. The second rendered as a
 * bare divider whose sentence began "Everything **else** you own" — with
 * nothing above it for "else" to refer to, which reads as a bug rather than an
 * answer.
 *
 * A DOM test rather than an end-to-end one on purpose: arranging a wardrobe
 * where every candidate fails the filters is a fixture problem, and what is
 * being asserted here is copy and branching, not persistence. The engine half
 * — that `swapCandidates` marks them unsuitable at all — is proved against real
 * SQL in `tests/integration/outfit-review.test.ts`.
 */

const options = vi.hoisted(() => ({ current: [] as SwapOption[] }))

vi.mock('@/lib/trips', async (importOriginal) => ({
  ...(await importOriginal<TripsModule>()),
  fetchSwapOptions: () => Promise.resolve({ candidates: options.current }),
  setSlotItem: () => Promise.resolve({ groups: [], sync: { added: 0, updated: 0, removed: 0 } }),
}))

const TARGET = { groupId: 'g1', slotId: 's1', roleLabel: 'Jacket', itemId: null }

function option(over: Partial<SwapOption> & { id: string; name: string }): SwapOption {
  return {
    subcategory: 'Outerwear',
    color: null,
    favorite: false,
    suitable: true,
    reason: null,
    ...over,
  }
}

function open() {
  return render(
    <SwapSheet open tripId="t1" target={TARGET} onClose={() => {}} onChanged={() => {}} />,
  )
}

afterEach(() => {
  options.current = []
  document.body.classList.remove('is-locked')
  document.body.style.top = ''
})

describe('choosing a different garment', () => {
  it('says so when nothing you own suits the occasion', async () => {
    options.current = [
      option({ id: 'a', name: 'Linen Shirt', suitable: false, reason: 'wrong level of dress' }),
      option({ id: 'b', name: 'Summer Shell', suitable: false, reason: 'wrong warmth for the conditions' }),
    ]

    open()

    await waitFor(() => expect(screen.getByText(/Nothing you own suits this/i)).toBeTruthy())

    /*
     * And the divider stops saying "else". With no suitable list above it, the
     * word had nothing to point at.
     */
    expect(screen.queryByText(/Everything else you own/i)).toBeNull()
    expect(screen.getByText(/Everything you own that could go here/i)).toBeTruthy()

    // The reasons are still shown — the answer is honest about WHY, not just
    // that there is nothing. Doc 04 §7: it is still Alex's call.
    expect(screen.getByText('wrong level of dress')).toBeTruthy()
    expect(screen.getByText('wrong warmth for the conditions')).toBeTruthy()
  })

  it('keeps quiet about it when something does suit', async () => {
    options.current = [
      option({ id: 'a', name: 'Rain Shell' }),
      option({ id: 'b', name: 'Linen Shirt', suitable: false, reason: 'wrong level of dress' }),
    ]

    open()

    await waitFor(() => expect(screen.getByText('Rain Shell')).toBeTruthy())
    expect(screen.queryByText(/Nothing you own suits this/i)).toBeNull()
    // The original wording, which is correct once there IS something above it.
    expect(screen.getByText(/Everything else you own/i)).toBeTruthy()
  })

  /*
   * The other empty state, kept distinct. "You own nothing for this slot" sends
   * Alex to My Stuff; "nothing you own suits this" does not, because the
   * garment he needs may well be in the list right below.
   */
  it('sends you to My Stuff only when you own nothing for the slot at all', async () => {
    options.current = []

    open()

    await waitFor(() =>
      expect(screen.getByText(/You do not own anything that could go here/i)).toBeTruthy(),
    )
    expect(screen.queryByText(/Nothing you own suits this/i)).toBeNull()
  })
})
