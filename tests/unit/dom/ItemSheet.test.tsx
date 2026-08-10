// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ItemSheet } from '@/components/ItemSheet'
import type { Item } from '@shared/items'
import type * as ItemsNamespace from '@/lib/items'

type ItemsModule = typeof ItemsNamespace

/**
 * The colour field is where the grey mapping either holds or quietly corrupts
 * the catalog.
 *
 * `greySpelling` is applied to what the input RENDERS, not to the draft behind
 * it — so a save that never touched the colour has to send back the exact
 * characters it was given. That is a claim about React state, and it is the
 * kind of claim that reads as obviously true right up until someone "tidies"
 * the effect to seed the draft with the displayed value instead.
 *
 * Why it matters is in `tests/integration/colour-spelling.test.ts`: import
 * reconciliation matches a spreadsheet row to a stored item on
 * `name|brand|colour`, so a colour respelled on its way through this sheet
 * detaches a garment from its own source row, and the next import reads it as
 * new. The repository refuses to canonicalise for exactly that reason, which
 * puts the whole of the round-trip guarantee here.
 */

const saved = vi.hoisted(() => ({ input: null as unknown }))

vi.mock('@/lib/items', async (importOriginal) => ({
  ...(await importOriginal<ItemsModule>()),
  updateItem: (_id: string, input: unknown) => {
    saved.input = input
    return Promise.resolve({ ...(input as object), id: _id } as Item)
  },
}))

function item(over: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    kind: 'clothing',
    displayName: 'Layering T-Shirt',
    category: 'Tops & Outerwear',
    subcategory: 'T-Shirt',
    color: 'Heather Gray',
    pattern: null,
    brand: 'Nordstrom',
    notes: null,
    usageFrequency: 'sometimes',
    warmth: null,
    dressiness: null,
    dressinessContexts: [],
    weatherTags: [],
    typicalUses: [],
    reuseCapacity: null,
    ownedQuantity: null,
    comfort: null,
    versatility: null,
    isCritical: false,
    isLiquid: null,
    liquidSize: null,
    isFragile: null,
    isValuable: null,
    isMedical: null,
    isTransitNeeded: null,
    isBulky: null,
    isDelaySensitive: null,
    requiresFinalCheck: false,
    defaultPackingTiming: 'anytime',
    alwaysInclude: false,
    neverInclude: false,
    archivedAt: null,
    source: 'seed_import',
    fieldProvenance: {},
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Item
}

function open(over: Partial<Item> = {}) {
  return render(
    <ItemSheet
      open
      item={item(over)}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  )
}

afterEach(() => {
  saved.input = null
  vi.clearAllMocks()
})

describe('the colour field', () => {
  it('shows Alex the spelling he uses', () => {
    open()
    expect(screen.getByDisplayValue('Heather Grey')).toBeTruthy()
  })

  /*
   * The load-bearing one. He opened the sheet to change the NAME; nothing about
   * that edit was about the colour, and the colour must reach the API unchanged.
   */
  it('sends back the stored spelling when he never touched the colour', async () => {
    const user = userEvent.setup()
    open()

    const name = screen.getByDisplayValue('Layering T-Shirt')
    await user.clear(name)
    await user.type(name, 'Layering Tee')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(saved.input).not.toBeNull())
    expect((saved.input as { color: string }).color).toBe('Heather Gray')
    expect((saved.input as { displayName: string }).displayName).toBe('Layering Tee')
  })

  /*
   * And when he DOES edit it, what he typed is what is stored. His own spelling
   * is a fact about his wardrobe, not a value to be corrected — the mapping
   * exists to spare him `gray`, not to overrule him.
   */
  it('sends exactly what he typed when he does edit the colour', async () => {
    const user = userEvent.setup()
    open()

    const colour = screen.getByDisplayValue('Heather Grey')
    await user.clear(colour)
    await user.type(colour, 'Charcoal Grey')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(saved.input).not.toBeNull())
    expect((saved.input as { color: string }).color).toBe('Charcoal Grey')
  })
})
