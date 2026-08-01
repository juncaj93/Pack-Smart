// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SwapSheet } from '@/components/SwapSheet'
import type { SwapContext, SwapOption } from '@/lib/trips'
import type * as TripsNamespace from '@/lib/trips'

/** The module's own shape, for `importOriginal`. `import()` types are linted out. */
type TripsModule = typeof TripsNamespace

/**
 * "Show when no eligible replacement exists" (doc 09 §7), at the layer where
 * that sentence actually lives.
 *
 * Two failures are easy to confuse and the sheet must not: owning **nothing**
 * that could fill the slot, and owning several and none of them suiting the
 * occasion. Before C2 only the first had a message. The second rendered as a
 * bare divider whose sentence began "Everything **else** you own" — with
 * nothing above it for "else" to refer to, which reads as a bug rather than an
 * answer.
 *
 * A DOM test rather than an end-to-end one on purpose: arranging a wardrobe
 * where every candidate fails the filters is a fixture problem, and what is
 * being asserted here is copy and branching, not persistence. The engine half
 * — that `swapCandidates` marks them unsuitable at all — is proved against real
 * SQL in `tests/integration/outfit-review.test.ts`.
 */

const options = vi.hoisted(() => ({
  current: [] as SwapOption[],
  context: null as SwapContext | null,
}))

vi.mock('@/lib/trips', async (importOriginal) => ({
  ...(await importOriginal<TripsModule>()),
  fetchSwapOptions: () =>
    Promise.resolve({ candidates: options.current, context: options.context }),
  setSlotItem: () => Promise.resolve({ groups: [], sync: { added: 0, updated: 0, removed: 0 } }),
}))

const TARGET = { groupId: 'g1', slotId: 's1', roleLabel: 'Jacket', itemId: null }

function option(over: Partial<SwapOption> & { id: string; name: string }): SwapOption {
  return {
    subcategory: 'Outerwear',
    color: null,
    favorite: false,
    suitable: true,
    reason: null,
    ...over,
  }
}

function open() {
  return render(
    <SwapSheet open tripId="t1" target={TARGET} onClose={() => {}} onChanged={() => {}} />,
  )
}

afterEach(() => {
  options.current = []
  options.context = null
  document.body.classList.remove('is-locked')
  document.body.style.top = ''
})

describe('choosing a different garment', () => {
  it('says so when nothing you own suits the occasion', async () => {
    options.current = [
      option({ id: 'a', name: 'Linen Shirt', suitable: false, reason: 'wrong level of dress' }),
      option({ id: 'b', name: 'Summer Shell', suitable: false, reason: 'wrong warmth for the conditions' }),
    ]

    open()

    await waitFor(() => expect(screen.getByText(/Nothing you own suits this/i)).toBeTruthy())

    /*
     * And the divider stops saying "else". With no suitable list above it, the
     * word had nothing to point at.
     */
    expect(screen.queryByText(/Everything else you own/i)).toBeNull()
    expect(screen.getByText(/Everything you own that could go here/i)).toBeTruthy()

    // The reasons are still shown — the answer is honest about WHY, not just
    // that there is nothing. Doc 04 §7: it is still Alex's call.
    expect(screen.getByText('wrong level of dress')).toBeTruthy()
    expect(screen.getByText('wrong warmth for the conditions')).toBeTruthy()
  })

  it('keeps quiet about it when something does suit', async () => {
    options.current = [
      option({ id: 'a', name: 'Rain Shell' }),
      option({ id: 'b', name: 'Linen Shirt', suitable: false, reason: 'wrong level of dress' }),
    ]

    open()

    await waitFor(() => expect(screen.getByText('Rain Shell')).toBeTruthy())
    expect(screen.queryByText(/Nothing you own suits this/i)).toBeNull()
    // The original wording, which is correct once there IS something above it.
    expect(screen.getByText(/Everything else you own/i)).toBeTruthy()
  })

  /*
   * The other empty state, kept distinct. "You own nothing for this slot" sends
   * Alex to My Stuff; "nothing you own suits this" does not, because the
   * garment he needs may well be in the list right below.
   */
  it('sends you to My Stuff only when you own nothing for the slot at all', async () => {
    options.current = []

    open()

    await waitFor(() =>
      expect(screen.getByText(/You do not own anything that could go here/i)).toBeTruthy(),
    )
    expect(screen.queryByText(/Nothing you own suits this/i)).toBeNull()
  })
})


/**
 * The line that says what the list was filtered BY (C2b).
 *
 * Without it a sheet that has rejected most of the wardrobe is
 * indistinguishable from a broken one. With it, "not recorded as keeping rain
 * out" stops being an odd refusal and becomes an answer.
 *
 * Every part is conditional, and the interesting cases are the absences: a trip
 * with no forecast, a group with no activity tag, an outfit whose days Alex
 * never named. None of those may produce a guess, a placeholder, or a stray
 * separator.
 */
describe('the line that says what was filtered for', () => {
  function context(over: Partial<SwapContext> = {}): SwapContext {
    return {
      roleLabel: 'Jacket',
      when: '3–5 Aug',
      place: 'Kruger',
      activity: 'Safari',
      travelDay: false,
      formality: 'Casual to Smart casual',
      conditions: '46–57°F · rain likely',
      ...over,
    }
  }

  const line = () => document.querySelector('.swap-context')

  it('states the days, the place, the occasion and the conditions', async () => {
    options.context = context()
    options.current = [option({ id: 'a', name: 'Field Jacket' })]

    open()

    await waitFor(() => expect(line()).toBeTruthy())
    const text = line()!.textContent!
    for (const part of ['3–5 Aug', 'Kruger', 'Safari', 'Casual to Smart casual', 'rain likely']) {
      expect(text, part).toContain(part)
    }
  })

  /*
   * A middot for the eye and a comma for the ear. `·` is not announced at
   * VoiceOver's default punctuation level, so a line separated by it alone runs
   * the parts together into one phrase.
   */
  it('separates the parts for a listener as well as for a reader', async () => {
    options.context = context()
    options.current = [option({ id: 'a', name: 'Field Jacket' })]

    open()

    await waitFor(() => expect(line()).toBeTruthy())
    expect(line()!.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
    expect(line()!.querySelectorAll('.visually-hidden').length).toBe(
      line()!.querySelectorAll('[aria-hidden="true"]').length,
    )
  })

  it('says nothing at all about what it does not know', async () => {
    options.context = context({ place: null, activity: null, conditions: null })
    options.current = [option({ id: 'a', name: 'Field Jacket' })]

    open()

    await waitFor(() => expect(line()).toBeTruthy())

    // Two parts, and exactly one separator between them — an absent place must
    // not leave a hanging middot where the name would have been.
    expect(line()!.querySelectorAll(':scope > span')).toHaveLength(2)
    expect(line()!.textContent!.match(/·/g)).toHaveLength(1)

    // And no placeholder standing in for what is not recorded.
    expect(line()!.textContent).not.toMatch(/unknown|probably|not recorded|—/i)
  })

  it('calls a travel outfit one, and an ordinary day nothing', async () => {
    options.context = context({ travelDay: true, activity: null })
    options.current = [option({ id: 'a', name: 'Field Jacket' })]

    const { unmount } = open()
    await waitFor(() => expect(line()!.textContent).toContain('Travel day'))
    unmount()

    options.context = context({ travelDay: false, activity: null })
    open()
    await waitFor(() => expect(line()).toBeTruthy())
    expect(line()!.textContent).not.toContain('Travel day')
  })

  /*
   * On a trip whose days Alex never named, `when` is a count rather than a date
   * — and for the untagged groups the count would otherwise be printed twice,
   * once as the occasion and once as the days.
   */
  it('does not say the same thing twice', async () => {
    options.context = context({ when: 'Once', activity: 'Once' })
    options.current = [option({ id: 'a', name: 'Field Jacket' })]

    open()

    await waitFor(() => expect(line()).toBeTruthy())
    expect(line()!.textContent!.match(/Once/g)).toHaveLength(1)
  })

  it('shows no line at all on a request that carried no context', async () => {
    options.context = null
    options.current = [option({ id: 'a', name: 'Field Jacket' })]

    open()

    await waitFor(() => expect(screen.getByText('Field Jacket')).toBeTruthy())
    expect(line()).toBeNull()
  })
})
