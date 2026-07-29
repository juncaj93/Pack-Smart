// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TabBar } from '@/components/TabBar'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TabBar />
    </MemoryRouter>,
  )
}

describe('TabBar', () => {
  it('renders exactly the four approved destinations', () => {
    renderAt('/')
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(4)
    expect(links.map((link) => link.textContent?.replace(/[^\w\s]/g, '').trim())).toEqual([
      'Home',
      'Trips',
      'My Stuff',
      'Settings',
    ])
  })

  // Product doc 02 §3 explicitly forbids these as top-level destinations.
  it('does not expose Clothing or Non-Clothing as tabs', () => {
    renderAt('/')
    expect(screen.queryByRole('link', { name: /clothing/i })).not.toBeInTheDocument()
  })

  it('marks the current destination with aria-current', () => {
    renderAt('/my-stuff')
    expect(screen.getByRole('link', { name: /My Stuff/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Home/ })).not.toHaveAttribute('aria-current')
  })

  it('keeps Home inactive on other routes (exact matching)', () => {
    renderAt('/trips')
    expect(screen.getByRole('link', { name: /Home/ })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: /Trips/ })).toHaveAttribute('aria-current', 'page')
  })

  it('labels the navigation landmark', () => {
    renderAt('/')
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })
})
