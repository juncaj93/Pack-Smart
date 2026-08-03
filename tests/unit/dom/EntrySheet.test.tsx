// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EntrySheet } from '@/components/EntrySheet'
import type { ChecklistEntry } from '@shared/checklist'
import type * as TripsNamespace from '@/lib/trips'

/** The module's own shape, for `importOriginal`. `import()` types are linted out. */
type TripsModule = typeof TripsNamespace

/**
 * A11-1: the selection state of the entry sheet's chips.
 *
 * Selection was colour plus font weight and nothing else, so VoiceOver
 * announced a chosen chip and an unchosen one identically — "2, button" either
 * way. The whole state of the control was invisible to anyone not looking at
 * it, on the sheet that decides how much of something goes in the bag.
 *
 * Asserted against the accessibility TREE rather than against a class name.
 * `is-on` is the visual half; `getByRole(..., { pressed })` and `{ checked }`
 * are the half a screen reader reads, and only the second one was missing.
 */

const patch = vi.hoisted(() => ({ calls: [] as unknown[] }))

vi.mock('@/lib/trips', async (importOriginal) => {
  const actual = await importOriginal<TripsModule>()
  return {
    ...actual,
    patchEntry: (_trip: string, _id: string, body: unknown) => {
      patch.calls.push(body)
      return Promise.resolve({ ...entry(), ...(body as object) })
    },
  }
})

function entry(over: Partial<ChecklistEntry> = {}): ChecklistEntry {
  return {
    id: 'e1',
    tripId: 't1',
    itemId: 'i1',
    name: 'Contact lenses',
    category: 'Toiletries',
    requiredQty: 24,
    qtyBreakdown: null,
    qtyOverride: null,
    packedQty: 0,
    packingTiming: 'anytime',
    requiresFinalCheck: false,
    finalCheckedAt: null,
    excludedAt: null,
    source: 'rule_generated',
    reason: null,
    isCritical: false,
    tripOnly: false,
    sortOrder: 0,
    bag: null,
    bagSource: null,
    ...over,
  } as ChecklistEntry
}

function open(over: Partial<ChecklistEntry> = {}) {
  return render(
    <EntrySheet
      open
      tripId="t1"
      entry={entry(over)}
      onClose={() => {}}
      onChanged={() => {}}
      onExcluded={() => {}}
    />,
  )
}

afterEach(() => {
  patch.calls.length = 0
  document.body.classList.remove('is-locked')
  document.body.style.top = ''
})

describe('how many to bring', () => {
  it('says which number is chosen, and which are not', async () => {
    open({ qtyOverride: 3 })

    await waitFor(() => expect(screen.getByRole('button', { name: '3' })).toBeTruthy())

    // The chosen one reports pressed…
    expect(screen.getByRole('button', { name: '3', pressed: true })).toBeTruthy()
    // …and the others report NOT pressed, which is the half that carries the
    // information. A control with no `aria-pressed` at all would fail this,
    // because the query would find nothing rather than finding `false`.
    for (const other of ['1', '2', '5', '10']) {
      expect(screen.getByRole('button', { name: other, pressed: false })).toBeTruthy()
    }
  })

  it('reports nothing pressed when Alex has not overridden the number', () => {
    open({ qtyOverride: null })

    for (const n of ['1', '2', '3', '5', '10']) {
      expect(screen.getByRole('button', { name: n, pressed: false })).toBeTruthy()
    }
  })

  it('moves the pressed state when a different number is chosen', async () => {
    const user = userEvent.setup()
    open({ qtyOverride: 1 })

    await user.click(screen.getByRole('button', { name: '5' }))

    // The intent reached the API. The re-render is the parent's job, so what is
    // asserted here is that the control asked for the right thing.
    expect(patch.calls).toEqual([{ qtyOverride: 5 }])
  })

  /*
   * `Use suggested` clears the override. It is an ACTION among the choices, not
   * one of them — which is exactly why this group is `aria-pressed` buttons in a
   * plain group rather than a `radiogroup`, which may not contain one.
   */
  it('does not give the clear-the-override action a pressed state', () => {
    open({ qtyOverride: 3 })

    const action = screen.getByRole('button', { name: 'Use suggested' })
    expect(action.getAttribute('aria-pressed')).toBeNull()
  })

  it('is reachable and operable from the keyboard', async () => {
    const user = userEvent.setup()
    open({ qtyOverride: null })

    const two = screen.getByRole('button', { name: '2' })
    two.focus()
    expect(document.activeElement).toBe(two)

    await user.keyboard('{Enter}')
    expect(patch.calls).toEqual([{ qtyOverride: 2 }])
  })
})

describe('when to pack it', () => {
  /*
   * A radio group rather than pressed buttons, because exactly one timing is
   * always true — `packingTiming` is never null and never outside the set. That
   * is a fact about the data, not a convention the screen keeps, which is the
   * test for whether radio is the honest role.
   */
  it('says which timing is chosen, as a radio group', async () => {
    open({ packingTiming: 'day_of' })

    await waitFor(() =>
      expect(screen.getByRole('radiogroup', { name: 'When to pack it' })).toBeTruthy(),
    )

    const chosen = screen.getAllByRole('radio', { checked: true })
    expect(chosen).toHaveLength(1)

    const unchosen = screen.getAllByRole('radio', { checked: false })
    expect(unchosen.length).toBeGreaterThan(0)
  })

  it('names the group, so the choice is not five loose words', () => {
    open()
    expect(screen.getByRole('radiogroup', { name: 'When to pack it' })).toBeTruthy()
  })

  it('is operable from the keyboard', async () => {
    const user = userEvent.setup()
    open({ packingTiming: 'anytime' })

    const options = screen.getAllByRole('radio')
    const other = options.find((o) => o.getAttribute('aria-checked') === 'false')!
    other.focus()
    await user.keyboard('{Enter}')

    expect(patch.calls).toHaveLength(1)
  })
})

describe('while a change is in flight', () => {
  /*
   * `disabled` is on every chip while a patch is saving. A disabled control
   * must still report its state — a screen reader user who tabs onto it during
   * the round trip should not be told less than one who arrives a moment later.
   */
  it('keeps reporting which chip is chosen', async () => {
    const user = userEvent.setup()
    open({ qtyOverride: 2 })

    await user.click(screen.getByRole('button', { name: '5' }))

    // Whatever the busy state does to `disabled`, the pressed state survives it.
    const chips = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))
    expect(chips.length).toBe(5)
    expect(chips.some((c) => c.getAttribute('aria-pressed') === 'true')).toBe(true)
  })
})

/**
 * Which bag it goes in (doc 09 §11), in the sheet rather than on the row.
 *
 * §11 asks that a recommendation, a hard restriction and an explicit choice be
 * told apart. Pack Smart has no approved hard rule, so there are two states to
 * distinguish — and a highlighted chip alone cannot say which one it is, which
 * is why the sentence beside it is part of the feature rather than decoration.
 */
describe('choosing a bag', () => {
  it('is a radio group, because exactly one bag is true at a time', () => {
    open()

    const group = screen.getByRole('radiogroup', { name: 'Which bag' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(5)
    for (const radio of radios) expect(radio.getAttribute('aria-checked')).toBeTruthy()
  })

  it('marks the one Alex chose, and only that one', () => {
    open({ bag: 'checked', bagSource: 'user' })

    const group = screen.getByRole('radiogroup', { name: 'Which bag' })
    const on = within(group)
      .getAllByRole('radio')
      .filter((radio) => radio.getAttribute('aria-checked') === 'true')

    expect(on).toHaveLength(1)
    expect(on[0]!.textContent).toContain('Checked bag')
  })

  /*
   * A suggestion is shown as chosen — it IS the answer until Alex says
   * otherwise — but it says whose answer it is, and why.
   */
  it('says a suggestion is a suggestion, and explains itself', () => {
    open({ category: 'Medication' })

    expect(screen.getByText(/Pack Smart suggests this/i)).toBeTruthy()
    const group = screen.getByRole('radiogroup', { name: 'Which bag' })
    const on = within(group)
      .getAllByRole('radio')
      .find((radio) => radio.getAttribute('aria-checked') === 'true')
    expect(on?.textContent).toContain('Personal item')
  })

  it('offers the way back to the suggestion once Alex has overruled it', () => {
    open({ category: 'Medication', bag: 'checked', bagSource: 'user' })

    expect(screen.queryByText(/Pack Smart suggests this/i)).toBeNull()
    expect(screen.getByRole('button', { name: /Use what Pack Smart suggests/i })).toBeTruthy()
  })

  it('says nothing at all about an ordinary thing', () => {
    open({ category: 'Travel Gear' })

    expect(screen.queryByText(/Pack Smart suggests this/i)).toBeNull()
    const group = screen.getByRole('radiogroup', { name: 'Which bag' })
    expect(
      within(group)
        .getAllByRole('radio')
        .filter((radio) => radio.getAttribute('aria-checked') === 'true'),
    ).toHaveLength(0)
  })
})
