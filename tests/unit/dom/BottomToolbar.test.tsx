// @vitest-environment jsdom
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AddActionProvider } from '@/components/AddAction'
import { BottomToolbar, isFocusedRoute } from '@/components/BottomToolbar'
import { Screen } from '@/components/Screen'

/**
 * The floating bottom toolbar.
 *
 * What is asserted here is the part that is pure logic: which destination the
 * router says is active, whether the centre Add reaches the screen's own
 * handler, and which routes hide the bar. Geometry — the height, the 44px
 * targets, that nothing sits underneath it — is measured on a real engine in
 * `tests/e2e/bottom-toolbar.spec.ts` and by the visual gates, because jsdom has
 * no layout to measure.
 */

function mount(path: string, screenProps?: Parameters<typeof Screen>[0]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AddActionProvider>
        <Routes>
          <Route
            path="*"
            element={screenProps ? <Screen {...screenProps} /> : <div />}
          />
        </Routes>
        <BottomToolbar />
      </AddActionProvider>
    </MemoryRouter>,
  )
}

const activeName = () =>
  screen.queryByRole('link', { current: 'page' })?.textContent?.replace(/[^\w ]/g, '').trim()

describe('which destination is current', () => {
  it('marks Home on the root, and only there', () => {
    mount('/')
    expect(activeName()).toBe('Home')
  })

  it('marks Trips on the trips list', () => {
    mount('/trips')
    expect(activeName()).toBe('Trips')
  })

  it.each([
    '/trips/abc',
    '/trips/abc/outfits',
    '/trips/abc/today',
    '/trips/abc/bags',
    '/trips/abc/days',
    '/trips/abc/itinerary',
    '/trips/abc/day-of',
  ])('keeps Trips current on the nested route %s', (path) => {
    /*
     * §26. A nested trip route with no active destination leaves the toolbar
     * looking broken, and Home matching everything would be worse — both are
     * what `end` on Home and prefix matching everywhere else exist to prevent.
     */
    mount(path)
    expect(activeName()).toBe('Trips')
  })

  it('keeps My Stuff current on its own nested route', () => {
    mount('/my-stuff')
    expect(activeName()).toBe('My Stuff')
  })

  it('marks Settings', () => {
    mount('/settings')
    expect(activeName()).toBe('Settings')
  })

  it('never marks two destinations at once', () => {
    for (const path of ['/', '/trips', '/trips/abc/outfits', '/my-stuff', '/settings']) {
      const view = mount(path)
      expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(1)
      view.unmount()
    }
  })
})

describe('the centre Add', () => {
  it('calls the screen’s own handler, whatever that screen is', async () => {
    /*
     * The whole point of the registry (§8, §44). Add is four different actions;
     * the toolbar knows none of them and only invokes what the screen declared.
     */
    const user = userEvent.setup()
    const onClick = vi.fn()
    mount('/my-stuff', { title: 'My Stuff', action: { label: 'Add item', onClick } })

    const add = screen.getByRole('button', { name: 'Add item' })
    await user.click(add)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is named for what it will do, not the word Add', async () => {
    mount('/trips', { title: 'Trips', action: { label: 'Plan a Trip', onClick: vi.fn() } })
    expect(screen.getByRole('button', { name: 'Plan a Trip' })).toBeTruthy()
  })

  it('is present but disabled where there is nothing to add', () => {
    /*
     * Settings. Disabled rather than absent, so the other four controls do not
     * move sideways between routes (§16) — and no action is invented for a
     * screen that has none (§8).
     */
    mount('/settings', { title: 'Settings' })
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add).toBeDisabled()
  })

  it('does not inherit the previous screen’s Add', () => {
    const onClick = vi.fn()
    const view = mount('/my-stuff', { title: 'My Stuff', action: { label: 'Add item', onClick } })
    expect(screen.getByRole('button', { name: 'Add item' })).toBeEnabled()
    view.unmount()

    mount('/settings', { title: 'Settings' })
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })
})

describe('routes that hide the toolbar', () => {
  it.each(['/my-stuff/review', '/trips/abc/review', '/trips/abc/outfits/review'])(
    'hides it in the guided flow %s',
    (path) => {
      mount(path)
      expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
    },
  )

  it.each(['/', '/trips', '/trips/abc', '/trips/abc/outfits', '/my-stuff', '/settings', '/import'])(
    'shows it on the ordinary route %s',
    (path) => {
      mount(path)
      expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy()
    },
  )

  it('recognises the focused routes by shape, not by a hardcoded trip id', () => {
    expect(isFocusedRoute('/trips/9f3a-77/outfits/review')).toBe(true)
    expect(isFocusedRoute('/trips/9f3a-77/outfits')).toBe(false)
    // Not a prefix match: a route that merely starts the same is not focused.
    expect(isFocusedRoute('/my-stuff/review/extra')).toBe(false)
    /*
     * `/import` reads like a guided flow and is deliberately not one: it has no
     * back link and navigates nowhere, so the toolbar is its only exit. Hiding
     * it there would strand Alex on the screen (§43).
     */
    expect(isFocusedRoute('/import')).toBe(false)
  })
})

describe('the accessible shape', () => {
  it('keeps the name the whole suite selects on', () => {
    mount('/')
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy()
  })

  it('labels every destination in words, not by glyph alone', () => {
    mount('/')
    for (const label of ['Home', 'Trips', 'My Stuff', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy()
    }
  })
})
