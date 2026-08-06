// @vitest-environment jsdom
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { DressinessContexts } from '@/components/DressinessContexts'
import type { DressinessContext } from '@shared/dressiness'

/**
 * The dressiness multi-select, as a screen reader meets it (H1c).
 *
 * The brief rules out radio buttons, a single dropdown, a star rating and an
 * exclusive segmented control by name — every one of them says *pick the one
 * that is most true*, and an Oxford shirt is honestly Smart casual AND Dressy.
 * So the assertions here are about INDEPENDENCE: each option has its own state,
 * ticking one leaves the rest alone, and VoiceOver hears each on its own terms.
 */

function Harness({ initial = [] as DressinessContext[] }) {
  const [value, setValue] = useState<DressinessContext[]>(initial)
  return <DressinessContexts value={value} onChange={setValue} />
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the dressiness multi-select', () => {
  it('is a named group of five INDEPENDENT checkboxes', () => {
    render(<Harness />)
    const group = screen.getByRole('group', { name: 'Where it works' })
    expect(within(group).getAllByRole('checkbox')).toHaveLength(5)

    // Not radios, and not one exclusive control wearing checkbox clothes.
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  })

  it('names every context', () => {
    render(<Harness />)
    /*
     * EXACT names, one word each. The hint is a DESCRIPTION rather than part of
     * the name — the first draft of this component wrapped both in the label,
     * and VoiceOver announced "CasualEveryday, nothing to dress up for".
     */
    for (const label of ['Loungewear', 'Casual', 'Smart casual', 'Dressy', 'Formal']) {
      screen.getByRole('checkbox', { name: label })
    }
  })

  it('announces each option independently, checked and unchecked', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('checkbox', { name: 'Smart casual' }))
    await user.click(screen.getByRole('checkbox', { name: 'Dressy' }))

    // The exact shape the brief asks VoiceOver to produce.
    expect(screen.getByRole('checkbox', { name: 'Smart casual' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Dressy' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Formal' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Casual' })).not.toBeChecked()
  })

  it('selects several without any of them cancelling another', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('checkbox', { name: 'Casual' }))
    await user.click(screen.getByRole('checkbox', { name: 'Smart casual' }))
    await user.click(screen.getByRole('checkbox', { name: 'Dressy' }))

    // Three at once. A radio group could not hold this state at all.
    expect(
      screen.getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked),
    ).toHaveLength(3)
  })

  it('adds a context later, leaving the earlier one alone', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['smart_casual']} />)

    await user.click(screen.getByRole('checkbox', { name: 'Dressy' }))

    expect(screen.getByRole('checkbox', { name: 'Smart casual' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Dressy' })).toBeChecked()
  })

  it('removes ONE context without clearing the others', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['smart_casual', 'dressy']} />)

    await user.click(screen.getByRole('checkbox', { name: 'Smart casual' }))

    expect(screen.getByRole('checkbox', { name: 'Smart casual' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Dressy' })).toBeChecked()
  })

  it('says what is recorded, and that nothing is', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const summary = screen.getByText(/Not set/)
    expect(summary).toHaveAttribute('aria-live', 'polite')

    await user.click(screen.getByRole('checkbox', { name: 'Dressy' }))
    // Same node, new text, so the live region announces rather than being
    // replaced by a fresh one nobody is watching.
    expect(summary.textContent).toBe('Works for Dressy')
  })

  it('clears everything, and offers that only when there is something to clear', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()

    await user.click(screen.getByRole('checkbox', { name: 'Casual' }))
    await user.click(screen.getByRole('checkbox', { name: 'Formal' }))
    await user.click(screen.getByRole('button', { name: 'Clear all' }))

    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked()
    expect(screen.getByText(/Not set/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()
  })

  it('reports the set in canonical order however it was clicked', async () => {
    const user = userEvent.setup()
    const seen: DressinessContext[][] = []
    function Capture() {
      const [value, setValue] = useState<DressinessContext[]>([])
      return (
        <DressinessContexts
          value={value}
          onChange={(next) => {
            seen.push(next)
            setValue(next)
          }}
        />
      )
    }
    render(<Capture />)

    // Clicked dressiest-first on purpose.
    await user.click(screen.getByRole('checkbox', { name: 'Formal' }))
    await user.click(screen.getByRole('checkbox', { name: 'Casual' }))

    expect(seen[seen.length - 1]).toEqual(['casual', 'formal'])
  })

  it('keeps the hint as a description, so the name is not a run-on', () => {
    render(<Harness />)
    const casual = screen.getByRole('checkbox', { name: 'Casual' })
    expect(casual).toHaveAccessibleDescription('Everyday, nothing to dress up for')
  })

  it('does not imply that Formal is the best answer', () => {
    render(<Harness initial={['loungewear']} />)
    // No progressbar, no meter, no "up to" language — the five are peers, and a
    // control that ranked them would be back to the ladder H1c removes.
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0)
    expect(screen.queryAllByRole('meter')).toHaveLength(0)
    expect(screen.getByText(/Works for Loungewear/)).toBeTruthy()
  })
})
