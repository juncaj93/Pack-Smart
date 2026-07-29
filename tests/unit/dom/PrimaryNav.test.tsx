// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PrimaryNav } from '@/components/PrimaryNav'

/**
 * The four destinations, and which one says "you are here".
 *
 * Replaces TabBar.test.tsx. The component moved from a fixed bottom bar to a
 * sticky row at the top (09_IMPLEMENTATION_NOTES.md §12) but what it must
 * GUARANTEE did not change, so neither did most of this file.
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PrimaryNav />
    </MemoryRouter>,
  )
}

describe('PrimaryNav', () => {
  it('offers exactly the four destinations from doc 02 §3', () => {
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent)

    expect(labels).toEqual(['Home', 'Trips', 'My Stuff', 'Settings'])
  })

  it('marks the current section, and only that one', () => {
    renderAt('/my-stuff')
    const nav = screen.getByRole('navigation', { name: 'Primary' })

    expect(within(nav).getByRole('link', { name: 'My Stuff' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  })

  /*
   * `end` on the Home link. Without it every route matches "/" as a prefix and
   * Home is permanently marked current, which is the same as marking nothing.
   */
  it('does not call Home the current section from somewhere else', () => {
    renderAt('/trips')
    const nav = screen.getByRole('navigation', { name: 'Primary' })

    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    expect(within(nav).getByRole('link', { name: 'Trips' })).toHaveAttribute('aria-current', 'page')
  })

  // Doc 02 §10: these live inside My Stuff, not beside it.
  it('does not promote Clothing or Non-Clothing to a destination', () => {
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: 'Primary' })

    expect(within(nav).queryByRole('link', { name: /clothing/i })).toBeNull()
  })
})
