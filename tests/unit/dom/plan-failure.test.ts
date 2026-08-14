import { afterEach, describe, expect, it } from 'vitest'
import { ApiRequestError } from '@/lib/api'
import { planFailureMessage } from '@/routes/Outfits'

/**
 * What the Outfits screen says when a replan does not happen.
 *
 * This exists because of a real failure on a real trip. Alex pressed the replan
 * control, got `Could not plan outfits just now.`, and that sentence was every
 * bit of evidence either of us had — it is what the catch produced for a
 * dropped connection, a rejected trip and an unhandled exception alike, so the
 * screenshot could not distinguish a phone with no signal from a bug in the
 * planner.
 *
 * The three cases below are three different problems with three different
 * answers, and the point of each assertion is that they cannot collapse back
 * into one sentence.
 */

const onLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

afterEach(() => {
  if (onLine) Object.defineProperty(Navigator.prototype, 'onLine', onLine)
})

describe('why a replan did not happen', () => {
  it('blames the network only when the network is actually down', () => {
    setOnline(false)
    const message = planFailureMessage(new Error('anything at all'))
    expect(message).toMatch(/offline/i)
    // And says the thing is not broken, because it is not.
    expect(message).toMatch(/once you have signal/i)
  })

  it('repeats what the server said, and the code that identifies it', () => {
    setOnline(true)
    const message = planFailureMessage(
      new ApiRequestError(400, { code: 'bad_request', message: 'No such trip.' }),
    )
    expect(message).toContain('No such trip.')
    /*
     * The code is the half that makes a screenshot actionable. Alex reports
     * bugs by screenshot, and a message without it identifies a feeling rather
     * than a failure.
     */
    expect(message).toContain('bad_request')
  })

  it('admits an unknown failure instead of blaming the network for it', () => {
    setOnline(true)
    const message = planFailureMessage(new TypeError('slots is not iterable'))
    /*
     * The case the old wording got wrong, and the reason this file exists.
     * `Could not plan outfits just now` implies a passing condition, so the
     * only advice it gives is to try again — precisely wrong for a failure that
     * will repeat every time.
     */
    expect(message).not.toMatch(/offline|signal|just now/i)
    expect(message).toMatch(/not the network/i)
  })
})
