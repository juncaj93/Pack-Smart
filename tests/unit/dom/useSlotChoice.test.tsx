// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutfitGroup, SwapOption } from '@/lib/trips'
import type * as TripsNamespace from '@/lib/trips'
import { useSlotChoice } from '@/lib/useSlotChoice'

/**
 * The rule P1A turns on: **latest user intent wins.**
 *
 * These are the concurrency tests, and they are the reason the guard is a
 * sequence rather than a `busy` flag. The entry-sheet defect fixed earlier in
 * this release is the failure being designed against — a reply that landed
 * after the state had moved on, and put the old state back.
 *
 * Every case here is a *timing* case, so the resolution of each write is held
 * open deliberately and released by the test. Nothing waits on a clock.
 */

const deferred: Array<{
  resolve: (groups: OutfitGroup[]) => void
  reject: () => void
}> = []

vi.mock('@/lib/trips', async (importOriginal) => ({
  ...(await importOriginal<typeof TripsNamespace>()),
  setSlotItem: vi.fn(
    () =>
      new Promise((resolve, reject) => {
        deferred.push({
          resolve: (groups) => resolve({ groups, sync: { added: [], removed: [] } }),
          reject: () => reject(new Error('offline')),
        })
      }),
  ),
}))

function option(id: string, name: string): SwapOption {
  return {
    id,
    name,
    subcategory: null,
    color: null,
    brand: null,
    detail: null,
    favorite: false,
    suitable: true,
    reason: null,
  } as SwapOption
}

function groupsWith(itemId: string | null, itemName: string | null): OutfitGroup[] {
  return [
    {
      id: 'g1',
      tripId: 't1',
      name: 'Nice dinners',
      activityTag: null,
      occurrences: 1,
      slots: [
        {
          id: 's1',
          role: 'top',
          roleLabel: 'Top',
          required: true,
          itemId,
          itemName,
          itemDetail: null,
          wearings: 0,
          setAside: false,
          unmetReason: null,
          reason: null,
          sortOrder: 0,
        },
      ],
    } as unknown as OutfitGroup,
  ]
}

/** Renders the slot's current name, plus buttons that make choices. */
function Harness({ onError }: { onError?: (m: string) => void }) {
  const [groups, setGroups] = useState<OutfitGroup[] | null>(groupsWith('old', 'Old Shirt'))
  const choose = useSlotChoice('t1', setGroups, onError)
  return (
    <div>
      <p data-testid="slot">{groups?.[0]?.slots[0]?.itemName ?? 'empty'}</p>
      <button onClick={() => choose('g1', 's1', option('a', 'Shirt A'))}>A</button>
      <button onClick={() => choose('g1', 's1', option('b', 'Shirt B'))}>B</button>
      <button onClick={() => choose('g1', 's1', null)}>Clear</button>
    </div>
  )
}

beforeEach(() => {
  deferred.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('choosing a garment', () => {
  it('shows the choice before the write resolves', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'A' }))

    // Nothing has been resolved. The screen has already moved.
    expect(deferred).toHaveLength(1)
    expect(screen.getByTestId('slot')).toHaveTextContent('Shirt A')
  })

  it('takes the server’s answer once it arrives', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'A' }))

    deferred[0]!.resolve(groupsWith('a', 'Shirt A, as the server has it'))
    await waitFor(() =>
      expect(screen.getByTestId('slot')).toHaveTextContent('as the server has it'),
    )
  })

  it('lets a late success be overtaken by a newer choice', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'A' }))
    await userEvent.click(screen.getByRole('button', { name: 'B' }))

    /*
     * The FIRST write now finishes, last. It must change nothing.
     *
     * Flushed and then asserted SYNCHRONOUSLY, deliberately. `waitFor` succeeds
     * on its first check — which happens before the late reply has been applied
     * — so it passes whether or not the guard exists. Mutation caught exactly
     * that: removing the guard left this test green.
     */
    await act(async () => {
      deferred[0]!.resolve(groupsWith('a', 'Shirt A'))
    })
    expect(screen.getByTestId('slot')).toHaveTextContent('Shirt B')

    await act(async () => {
      deferred[1]!.resolve(groupsWith('b', 'Shirt B'))
    })
    expect(screen.getByTestId('slot')).toHaveTextContent('Shirt B')
  })

  it('does not let a late failure roll back a newer success', async () => {
    const onError = vi.fn()
    render(<Harness onError={onError} />)
    await userEvent.click(screen.getByRole('button', { name: 'A' }))
    await userEvent.click(screen.getByRole('button', { name: 'B' }))

    // A fails, after B was chosen. Undoing to 'Old Shirt' would discard
    // something Alex did afterwards.
    await act(async () => {
      deferred[0]!.reject()
    })
    expect(screen.getByTestId('slot')).toHaveTextContent('Shirt B')
    expect(onError).not.toHaveBeenCalled()
  })

  it('rolls back, and says so, when the current write fails', async () => {
    const onError = vi.fn()
    render(<Harness onError={onError} />)
    await userEvent.click(screen.getByRole('button', { name: 'A' }))

    deferred[0]!.reject()
    await waitFor(() => expect(screen.getByTestId('slot')).toHaveTextContent('Old Shirt'))
    expect(onError).toHaveBeenCalledWith('Could not save that change.')
  })

  it('clears a slot, and a removal is just another choice', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'A' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('slot')).toHaveTextContent('empty')

    // The add's reply lands after the removal. It must not put the garment back.
    await act(async () => {
      deferred[0]!.resolve(groupsWith('a', 'Shirt A'))
    })
    expect(screen.getByTestId('slot')).toHaveTextContent('empty')
  })

  it('writes exactly once per choice — no duplicates, none lost', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'A' }))
    await userEvent.click(screen.getByRole('button', { name: 'B' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(deferred).toHaveLength(3)
  })
})
