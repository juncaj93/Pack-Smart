// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNDO_VISIBLE_MS, UndoBar, useUndoOffer } from '@/components/UndoBar'

/**
 * The transient strip, and the one thing "transient" cannot mean.
 *
 * `setTimeout` measures how long the PAGE has been running, and iOS Safari stops
 * running a backgrounded tab. Six seconds of timer is therefore six seconds of
 * FOREGROUND: archive something, take a call, come back twenty minutes later,
 * and the strip is still there offering to undo an action from before the call.
 *
 * It would even work — the restore is still valid — which is what makes it worth
 * a test rather than a shrug. The failure is not a broken button, it is an offer
 * that has outlived the moment it was about, sitting on the screen asking Alex to
 * work out whether it still means anything.
 *
 * These tests cannot background a tab, so they do the thing a suspended tab does:
 * move the WALL CLOCK forward without letting the timer run. A version that only
 * had the timer cannot pass them.
 */

function Harness() {
  const undo = useUndoOffer()

  return (
    <>
      <button type="button" onClick={() => undo.offer({ message: 'Field Shell archived', undo: async () => {} })}>
        Archive
      </button>
      <UndoBar offer={undo} />
    </>
  )
}

/** Away from the app for `ms`, with the tab suspended: no timers, clock moves on. */
function backgroundedFor(ms: number) {
  act(() => {
    vi.setSystemTime(new Date(Date.now() + ms))
    fireEvent(document, new Event('visibilitychange'))
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  vi.setSystemTime(new Date('2026-08-11T09:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('an undo offer', () => {
  it('is on screen the moment the action is taken', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    expect(screen.getByText('Field Shell archived')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('goes away on its own once the moment has passed', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    act(() => {
      vi.advanceTimersByTime(UNDO_VISIBLE_MS + 1)
    })

    expect(screen.queryByText('Field Shell archived')).toBeNull()
  })
})

describe('coming back to a tab that was asleep', () => {
  it('does not still offer to undo something from before the interruption', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(screen.getByText('Field Shell archived')).toBeTruthy()

    // Twenty minutes away, and the timer never ran — which is what a suspended
    // tab does, and is exactly why the timer alone is not enough.
    backgroundedFor(20 * 60 * 1000)

    expect(screen.queryByText('Field Shell archived')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('keeps it when the glance away was shorter than the offer', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    // A notification pulled down and dismissed. He is still in the same moment.
    backgroundedFor(UNDO_VISIBLE_MS - 2000)

    expect(screen.getByText('Field Shell archived')).toBeTruthy()
  })

  /*
   * Deliberately not restarted. After an interruption this is no longer "the
   * thing you just did", and a fresh six seconds would be the app deciding his
   * attention had not moved on. The permanent path — My Stuff, Show archived,
   * Restore — is the honest way back by then.
   */
  it('does not hand back a fresh six seconds on return', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    // Half the offer spent in the app, a second away, and the rest in the app.
    // Six seconds have been used up between them, so it goes.
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    backgroundedFor(1000)
    expect(screen.getByText('Field Shell archived')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    // A version that re-armed the clock on return would still be showing this,
    // with three of its fresh six seconds left.
    expect(screen.queryByText('Field Shell archived')).toBeNull()
  })

  it('says nothing about a screen that was never offering anything', () => {
    render(<Harness />)

    // No offer outstanding: returning to the tab must not invent one, and must
    // not throw on the deadline that was never set.
    backgroundedFor(20 * 60 * 1000)

    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})
