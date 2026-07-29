// @vitest-environment jsdom
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { BottomSheet } from '@/components/BottomSheet'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Edit item">
        <button type="button">Change quantity</button>
        <button type="button">Remove</button>
      </BottomSheet>
    </>
  )
}

afterEach(() => {
  document.body.classList.remove('is-locked')
  document.body.style.top = ''
})

describe('BottomSheet', () => {
  it('is not rendered until opened', () => {
    render(<Harness />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens as a modal dialog labelled by its title', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open sheet' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Edit item')
  })

  // Doc 02 §2: a swipe may be a shortcut but must never be the only way out.
  it('dismisses on backdrop tap', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open sheet' }))
    await user.click(screen.getByTestId('sheet-backdrop'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('dismisses on Escape', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open sheet' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('dismisses via the explicit Done control', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open sheet' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('moves focus into the sheet and restores it on close', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Open sheet' })
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })

  it('traps Tab inside the sheet', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open sheet' }))

    const dialog = screen.getByRole('dialog')
    // Tab through every control and past the end; focus must stay inside.
    for (let i = 0; i < 6; i += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('locks body scroll while open and restores it on close', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Open sheet' }))
    expect(document.body).toHaveClass('is-locked')

    await user.keyboard('{Escape}')
    expect(document.body).not.toHaveClass('is-locked')
    expect(document.body.style.top).toBe('')
  })
})
