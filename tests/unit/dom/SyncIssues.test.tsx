// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncIssues } from '@/components/SyncIssues'
import { QUEUE_EVENT } from '@/lib/writeQueue'

/**
 * The one line that appears when a queued write needs Alex (F2).
 *
 * Everything about WHEN it appears is the queue's, and is tested there. This is
 * about the two things only a rendered component can answer:
 *
 * 1. **It is silent when there is nothing to answer** — which is the common
 *    case, and the reason this is not a permanent offline banner.
 * 2. **A conflict and a failure read differently**, because they are different
 *    questions. A conflict has two right answers and the sheet asks; a refusal
 *    has none and the sheet offers to try again or let it go.
 */

const UNLOCKED_KEY = 'pack-smart:unlocked-before'
const SESSION_ID_KEY = 'pack-smart:session-id'
const QUEUE_KEY = 'pack-smart:pending-writes'

function queue(
  overrides: Array<Record<string, unknown>>,
): void {
  window.localStorage.setItem(
    QUEUE_KEY,
    JSON.stringify(
      overrides.map((over, index) => ({
        key: `e${index}:packedQty`,
        tripId: 't1',
        entryId: `e${index}`,
        entryName: 'Sunscreen',
        field: 'packedQty',
        value: 1,
        at: 1_780_000_000_000 + index,
        baseUpdatedAt: 100,
        session: 'session-a',
        attempts: 1,
        failure: { kind: 'conflict', message: 'This changed somewhere else since you did.' },
        ...over,
      })),
    ),
  )
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT))
}

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(UNLOCKED_KEY, '1')
  window.localStorage.setItem(SESSION_ID_KEY, 'session-a')
  vi.unstubAllGlobals()
})

describe('when nothing needs answering', () => {
  it('renders nothing at all', () => {
    const { container } = render(<SyncIssues />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stays silent for a write that is merely still waiting', () => {
    queue([{ failure: null }])
    const { container } = render(<SyncIssues />)
    // "Saved on this phone" is the row's job. A write on its way is not a
    // problem and must not read as one.
    expect(container).toBeEmptyDOMElement()
  })
})

describe('a change that was overtaken', () => {
  it('says so quietly, and offers both answers', async () => {
    queue([{ entryName: 'Sunscreen' }])
    render(<SyncIssues />)

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(/overtaken by a newer one/i)
    // Not an alert: both changes worked, they simply disagree. Doc 06 §3 rules
    // out alarm fatigue and this is exactly the case it means.
    expect(banner).toHaveClass('banner-quiet')

    await userEvent.click(screen.getByRole('button', { name: 'Sort it out' }))

    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveTextContent('Sunscreen')
    // What ALEX did, in his words — `packedQty: 1` is not something anyone
    // tapped, and "You packed it" is.
    expect(sheet).toHaveTextContent(/You packed it/)
    expect(sheet).toHaveTextContent(/changed somewhere else after you did/)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Use mine' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Keep the newer one' })).toBeVisible()
    })
  })

  it('forgets it, and closes, when the newer one is kept', async () => {
    queue([{}])
    render(<SyncIssues />)
    await userEvent.click(screen.getByRole('button', { name: 'Sort it out' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Keep the newer one' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('a change the server refused', () => {
  it('reads as something that went wrong, because it did', async () => {
    queue([
      { failure: { kind: 'permanent', message: 'No such checklist item.' } },
    ])
    render(<SyncIssues />)

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('One change did not save.')
    expect(banner).toHaveClass('banner-alert')

    await userEvent.click(screen.getByRole('button', { name: 'Sort it out' }))
    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveTextContent('No such checklist item.')
    // Two honest offers, and neither pretends there is a choice to make about
    // which version is right.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Let it go' })).toBeVisible()
  })

  it('counts them, and offers to clear the lot, only when there is more than one', async () => {
    queue([{}, { failure: { kind: 'permanent', message: 'no' } }])
    render(<SyncIssues />)

    // Mixed, so the alert register wins — one of them genuinely failed.
    expect(screen.getByRole('status')).toHaveTextContent('2 changes did not save.')

    await userEvent.click(screen.getByRole('button', { name: 'Sort it out' }))
    expect(await screen.findByRole('button', { name: 'Let all of them go' })).toBeVisible()
  })

  it('does not offer to clear the lot when there is only one of them', async () => {
    queue([{}])
    render(<SyncIssues />)
    await userEvent.click(screen.getByRole('button', { name: 'Sort it out' }))
    await screen.findByRole('dialog')

    expect(screen.queryByRole('button', { name: 'Let all of them go' })).toBeNull()
  })
})

describe('what it says about a bag and a final check', () => {
  it('names the action rather than the field', async () => {
    queue([
      { key: 'e0:bag', field: 'bag', value: 'checked' },
      { key: 'e1:finalChecked', field: 'finalChecked', value: true },
    ])
    render(<SyncIssues />)
    await userEvent.click(screen.getByRole('button', { name: 'Sort it out' }))

    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveTextContent(/You moved it to another bag/)
    expect(sheet).toHaveTextContent(/You gave it a final check/)
  })
})
