// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNRECORDED_TRAITS, type Item } from '@shared/items'
import type * as ItemsNamespace from '@/lib/items'

/** The module's own shape, for `importOriginal`. `import()` types are linted out. */
type ItemsModule = typeof ItemsNamespace
import MyStuff from '@/routes/MyStuff'

/**
 * "I did not mean that", ten seconds after archiving.
 *
 * Restore already existed behind *Show archived*, and it stays — it is the right
 * answer for something Alex finds a week later. This is the other case, and the
 * reason it needs its own path is that the existing one is a dead end in the
 * moment: reversing a tap you have just made should not require finding another
 * view first (doc 02 §2 prefers undo over exactly that kind of tax).
 *
 * ## Why there is no optimistic ticket here, unlike the duplicate undo
 *
 * The archive is AWAITED inside the item sheet and the sheet closes on its
 * reply, so by the time this offer exists the write has already settled. There
 * is no in-flight request for a late response to defeat. The duplicate-review
 * undo is the case that genuinely races — its archive is optimistic — and it
 * shares that write's mutation key precisely because the hazard is real there.
 *
 * Building a ticket for a race that cannot happen would be ceremony, and it
 * would imply a hazard that a reader would then go looking for.
 */

const archived: string[] = []
const restored: string[] = []

function garment(id: string, partial: Partial<Item> = {}): Item {
  return {
    id,
    kind: 'clothing',
    displayName: id,
    category: 'Tops & Outerwear',
    subcategory: 'T-Shirt',
    color: null,
    pattern: null,
    brand: null,
    notes: null,
    usageFrequency: 'sometimes',
    warmth: null,
    dressiness: 1,
    dressinessContexts: [],
    weatherTags: [],
    typicalUses: [],
    reuseCapacity: null,
    ownedQuantity: null,
    comfort: null,
    versatility: null,
    ...UNRECORDED_TRAITS,
    isCritical: false,
    requiresFinalCheck: false,
    defaultPackingTiming: 'anytime',
    alwaysInclude: false,
    neverInclude: false,
    archivedAt: null,
    source: 'manual',
    fieldProvenance: {},
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

vi.mock('@/lib/items', async (importOriginal) => ({
  ...(await importOriginal<ItemsModule>()),
  fetchItems: vi.fn(() =>
    Promise.resolve({
      items: [garment('linen-shirt', { displayName: 'Linen Shirt' })],
      categories: ['Tops & Outerwear'],
      activeCount: 1,
      archivedCount: 0,
      packedTripCounts: {},
    }),
  ),
  archiveItem: vi.fn((id: string) => {
    archived.push(id)
    return Promise.resolve(garment(id, { displayName: 'Linen Shirt', archivedAt: 1 }))
  }),
  restoreItem: vi.fn((id: string) => {
    restored.push(id)
    return Promise.resolve(garment(id, { displayName: 'Linen Shirt' }))
  }),
}))

beforeEach(() => {
  archived.length = 0
  restored.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

async function openAndArchive() {
  render(
    <MemoryRouter>
      <MyStuff />
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /Linen Shirt/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Archive' }))
  await waitFor(() => expect(archived).toEqual(['linen-shirt']))
}

describe('archiving from My Stuff', () => {
  it('offers to take it back, naming what went', async () => {
    await openAndArchive()
    expect(await screen.findByText('Linen Shirt archived')).toBeTruthy()
  })

  it('puts it back on the list', async () => {
    await openAndArchive()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(restored).toEqual(['linen-shirt']))
  })

  it('takes the offer away once it has been used', async () => {
    await openAndArchive()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(screen.queryByText('Linen Shirt archived')).toBeNull())
  })

  /*
   * Restoring is not an action anyone needs to take back, and offering to undo
   * it would be a loop with no exit — so the sheet reports the archive and stays
   * quiet about the other direction.
   *
   * A real restore, not an assertion that nothing happened: the earlier version
   * of this test only checked that `restoreItem` had not been called on load,
   * which is true whatever the sheet does and caught nothing.
   */
  it('says nothing when an item is restored rather than archived', async () => {
    const { fetchItems } = await import('@/lib/items')
    vi.mocked(fetchItems).mockResolvedValue({
      items: [garment('linen-shirt', { displayName: 'Linen Shirt', archivedAt: 1 })],
      categories: ['Tops & Outerwear'],
      activeCount: 0,
      archivedCount: 1,
      packedTripCounts: {},
    })

    render(
      <MemoryRouter>
        <MyStuff />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: /Linen Shirt/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore to My Stuff' }))

    await waitFor(() => expect(restored).toEqual(['linen-shirt']))
    expect(archived).toEqual([])
    expect(screen.queryByText('Linen Shirt archived')).toBeNull()
  })
})
