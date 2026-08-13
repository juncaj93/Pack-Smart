// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '@/components/BottomSheet'

/**
 * Two completion-like controls, and a swipe that could take a draft with it.
 *
 * A sheet with an authoritative primary action in its footer used to put `Done`
 * at the top right as well — two controls that both read as finishing, one of
 * which discarded the edit. And a downward drag dismissed unconditionally, so a
 * thumb that meant to scroll a half-filled Add Item form could throw it away
 * with nothing to undo (§9a, §9f).
 *
 * These assert the semantics rather than the styling: what the top-right SAYS,
 * and which dismissals are still allowed while there is something to lose.
 */

function open(props: Partial<React.ComponentProps<typeof BottomSheet>> = {}) {
  const onClose = vi.fn()
  render(
    <BottomSheet open onClose={onClose} title="A sheet" {...props}>
      <p>Body</p>
    </BottomSheet>,
  )
  return onClose
}

/** A drag well past both the distance and velocity thresholds. */
function swipeDown(): void {
  const grabber = screen.getByTestId('sheet-grabber')
  fireEvent.pointerDown(grabber, { clientY: 0, pointerId: 1 })
  fireEvent.pointerMove(grabber, { clientY: 400, pointerId: 1 })
  fireEvent.pointerUp(grabber, { clientY: 400, pointerId: 1 })
}

describe('what the top-right control claims to do', () => {
  it('says Done where the sheet saves as you go', () => {
    open()
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('says Cancel where a footer action is the one that finishes', () => {
    open({ dismiss: 'cancel', footer: <button type="button">Save changes</button> })
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
  })

  it('closes the sheet either way, because it is the same control', () => {
    const onClose = open({ dismiss: 'cancel' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('a sheet holding unsaved edits', () => {
  it('can still be dismissed casually when there is nothing to lose', () => {
    const onClose = open()
    swipeDown()
    expect(onClose).toHaveBeenCalled()
  })

  it('does not let a swipe take the draft with it', () => {
    const onClose = open({ dirty: true })
    swipeDown()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not let a backdrop tap take it either', () => {
    const onClose = open({ dirty: true })
    fireEvent.click(screen.getByTestId('sheet-backdrop'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still closes on the deliberate exits, which are both on screen', () => {
    /*
     * The distinction the whole guard rests on. A drag and a backdrop tap are
     * things a thumb does by accident; pressing the control labelled `Cancel`
     * is not, and neither is a key.
     */
    const onClose = open({ dirty: true, dismiss: 'cancel' })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
