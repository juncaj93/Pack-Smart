// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '@/routes/Settings'

/**
 * Settings ends no session, and that is the whole of the change.
 *
 * ## Why the button went
 *
 * Pack Smart is one private app on one person's phone behind one passphrase he
 * set himself. There is nobody to hand the device to and no second account to
 * switch into — so `Sign out` was a permanent invitation to do the only thing on
 * the screen with a cost: it deletes the offline copy of the trip he may be
 * standing in an airport relying on, and the way back is typing the passphrase
 * again.
 *
 * ## What this file is standing in front of
 *
 * The obvious way to remove a control is to remove the control AND the machinery
 * under it, and that would be the defect: authentication has to be exactly as
 * intact as it was. So this asserts both halves.
 *
 * The paths that still end a session — a 401 from anywhere, a session check that
 * answers `false`, the unlock flag cleared in another tab — are asserted at the
 * `App` level in `pending-writes-and-the-session.test.tsx`, which is where they
 * were already tested and where they belong: none of them was ever this screen's.
 */

const UNLOCKED_KEY = 'pack-smart:unlocked-before'

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Settings />
    </MemoryRouter>,
  )
}

describe('settings and the session', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(UNLOCKED_KEY, '1')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('offers nothing that ends the session', () => {
    renderSettings()

    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /log ?out/i })).toBeNull()
    /*
     * By CLASS as well as by name, because the class is what the stylesheet and
     * the visual gates knew it by. A control renamed rather than removed would
     * pass the two assertions above and still be on the screen.
     */
    expect(document.querySelector('.settings-signout')).toBeNull()
  })

  it('asks the server for nothing while it is on screen', () => {
    renderSettings()

    /*
     * The removal must not have taken a request with it, and must not have added
     * one either. Settings reads no API data of its own — the sheets do, when
     * they open — and `performance.spec.ts` measures exactly that.
     */
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls.map((call) => String(call[0]))).toEqual([])
  })

  it('leaves the device remembered, because nothing here forgets it', () => {
    renderSettings()

    // The flag is what lets a launch skip the passphrase screen. Removing a
    // button must not have started clearing it.
    expect(window.localStorage.getItem(UNLOCKED_KEY)).toBe('1')
  })

  it('still ends on the appearance choice, with no orphaned rule under it', () => {
    const { container } = renderSettings()

    const last = container.querySelector('.screen-inner')?.lastElementChild
    /*
     * `Sign out` sat under a hairline that said "the settings are over". Removing
     * the button and keeping the rule would have left a divider with nothing
     * beneath it, which reads as something that failed to load — §34's "do not
     * leave an awkward empty section".
     */
    expect(last?.className ?? '').not.toContain('settings-signout')
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeVisible()
  })
})
