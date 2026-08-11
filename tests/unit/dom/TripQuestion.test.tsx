// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TripQuestion } from '@/components/TripQuestion'
import { openQuestions } from '@shared/readiness'
import type { OpenQuestion } from '@shared/readiness'
import type { Trip } from '@shared/trips'

/**
 * The flight question, on the screen where Alex could not answer it (V1.1).
 *
 * `aviation-gating.test.ts` proves the model offers an escape answer and that
 * recording it silences aviation everywhere. This proves the escape answer
 * reaches the glass — which is the half that was actually broken for Alex, and
 * the half no shared-module test can see.
 *
 * WebKit CI is the authority for the rendered result; this runs in jsdom and is
 * about the wiring: that the button exists when the model offers one, that it
 * writes the model's value rather than a number this component invented, and
 * that it is not confused with deferring.
 */

function question(partial: Partial<OpenQuestion> = {}): OpenQuestion {
  return {
    fact: 'flight_hours',
    question: 'How long is the longest flight?',
    because: 'A long flight is what adds the neck pillow and the compression socks.',
    escape: { label: 'Not flying', value: 0 },
    ...partial,
  }
}

/** The real question the readiness model produces for a trip nobody has asked. */
function realFlightQuestion(): OpenQuestion {
  const unasked = { flightHours: null, international: false, laundryAvailable: true } as Trip
  return openQuestions(unasked).find((q) => q.fact === 'flight_hours')!
}

describe('the flight question offers an answer that is not a number', () => {
  it('shows the escape answer the model asked for', () => {
    render(<TripQuestion question={realFlightQuestion()} onAnswer={vi.fn()} onDefer={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Not flying' })).toBeInTheDocument()
  })

  /*
   * The defect in one assertion.
   *
   * Before V1.1 the only ways out of this card were a number and `Not now`, and
   * `Not now` stores nothing — so on a road trip the question came back on
   * every visit forever. One tap has to WRITE something.
   */
  it('records the value in one tap, without typing', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined)
    render(<TripQuestion question={question()} onAnswer={onAnswer} onDefer={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Not flying' }))

    expect(onAnswer).toHaveBeenCalledWith('flight_hours', 0)
  })

  it('is an answer, not a way of deferring', async () => {
    const onDefer = vi.fn()
    const onAnswer = vi.fn().mockResolvedValue(undefined)
    render(<TripQuestion question={question()} onAnswer={onAnswer} onDefer={onDefer} />)

    await userEvent.click(screen.getByRole('button', { name: 'Not flying' }))

    expect(onDefer).not.toHaveBeenCalled()
  })

  it('still lets a real flight length be typed', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined)
    render(<TripQuestion question={question()} onAnswer={onAnswer} onDefer={vi.fn()} />)

    await userEvent.type(screen.getByRole('textbox'), '11')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onAnswer).toHaveBeenCalledWith('flight_hours', 11)
  })

  /* A question with no escape must not grow a stray button. */
  it('shows no escape answer on a yes/no question', () => {
    const passport = question({
      fact: 'international',
      question: 'Are you leaving the country?',
      escape: undefined,
    })
    render(<TripQuestion question={passport} onAnswer={vi.fn()} onDefer={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Not flying' })).not.toBeInTheDocument()
  })

  it('keeps Not now, because deferring is still a real thing to want', () => {
    render(<TripQuestion question={question()} onAnswer={vi.fn()} onDefer={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
  })
})
