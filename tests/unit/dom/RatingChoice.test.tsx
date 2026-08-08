// @vitest-environment jsdom
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { RatingChoice } from '@/components/RatingChoice'
import { COMFORT_LABELS } from '@shared/items'

/**
 * The rating control, as a screen reader meets it (H1b).
 *
 * The requirement is specific and it is not "has five buttons": VoiceOver has to
 * announce the FIELD NAME, the SELECTED RATING, what that rating MEANS, and the
 * current state. A row of stars satisfies none of that on its own — "3, button"
 * tells Alex nothing about what he just agreed to — so the meaning travels in
 * `aria-label` and in a line of visible text, and the glyphs are hidden.
 */

function Harness({ initial = null as number | null }) {
  const [value, setValue] = useState<number | null>(initial)
  return (
    <RatingChoice
      id="comfort"
      label="Comfort"
      value={value}
      labels={COMFORT_LABELS}
      onChange={setValue}
    />
  )
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the rating control', () => {
  it('is a named radio group with exactly five options', () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: 'Comfort' })
    expect(within(group).getAllByRole('radio')).toHaveLength(5)
  })

  it('says what each value MEANS, not just what number it is', () => {
    render(<Harness />)
    // The whole accessibility argument for the component, one assertion.
    screen.getByRole('radio', { name: '1 of 5 — Uncomfortable' })
    screen.getByRole('radio', { name: '3 of 5 — Comfortable' })
    screen.getByRole('radio', { name: '5 of 5 — One of my most comfortable items' })
  })

  it('announces nothing as chosen until something is', () => {
    render(<Harness />)
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false')
    }
    // And says so in words, rather than leaving five unlit stars to be read as
    // "one star, badly".
    expect(screen.getByText('Not rated')).toBeTruthy()
  })

  it('marks exactly one radio checked, and prints its meaning', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('radio', { name: '4 of 5 — Very comfortable' }))

    const checked = screen.getAllByRole('radio').filter(
      (radio) => radio.getAttribute('aria-checked') === 'true',
    )
    expect(checked).toHaveLength(1)
    expect(checked[0]).toHaveAttribute('aria-label', '4 of 5 — Very comfortable')
    expect(screen.getByText('Very comfortable')).toBeTruthy()
  })

  it('changes the rating on a second tap', async () => {
    const user = userEvent.setup()
    render(<Harness initial={2} />)

    expect(screen.getByText('Limited comfort')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: '5 of 5 — One of my most comfortable items' }))
    expect(screen.getByText('One of my most comfortable items')).toBeTruthy()
    expect(screen.queryByText('Limited comfort')).toBeNull()
  })

  it('offers Clear rating only once there is a rating to clear', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    // Nothing to clear, so nothing to read past.
    expect(screen.queryByRole('button', { name: 'Clear rating' })).toBeNull()

    await user.click(screen.getByRole('radio', { name: '3 of 5 — Comfortable' }))
    const clear = screen.getByRole('button', { name: 'Clear rating' })

    await user.click(clear)
    expect(screen.getByText('Not rated')).toBeTruthy()
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false')
    }
    expect(screen.queryByRole('button', { name: 'Clear rating' })).toBeNull()
  })

  it('announces a change without moving focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const meaning = screen.getByText('Not rated')
    expect(meaning).toHaveAttribute('aria-live', 'polite')

    await user.click(screen.getByRole('radio', { name: '2 of 5 — Limited comfort' }))
    // Same node, new text — so the live region actually announces rather than
    // being replaced by a fresh one nobody is watching.
    expect(meaning.textContent).toBe('Limited comfort')
  })

  it('hides the star glyphs from the accessibility tree', () => {
    render(<Harness initial={3} />)
    for (const radio of screen.getAllByRole('radio')) {
      const glyph = radio.querySelector('[aria-hidden="true"]')
      expect(glyph).not.toBeNull()
      expect(glyph!.textContent).toMatch(/[★☆]/)
    }
    /*
     * And the name never contains one. The glyphs are decoration whose meaning
     * lives in the label — which is also what lets them use
     * `--color-text-tertiary`, the one exception doc 09 §7 (A11-1) allows.
     */
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.getAttribute('aria-label')).not.toMatch(/[★☆]/)
    }
  })

  it('gives two controls on one sheet two different groups', () => {
    render(
      <>
        <Harness />
        <RatingChoice
          id="versatility"
          label="Versatility"
          value={null}
          labels={COMFORT_LABELS}
          onChange={() => {}}
        />
      </>,
    )
    // Ids are per-instance, so `aria-labelledby` cannot cross-wire the two.
    screen.getByRole('radiogroup', { name: 'Comfort' })
    screen.getByRole('radiogroup', { name: 'Versatility' })
  })

  it('keeps every target at 44pt', () => {
    render(<Harness />)
    for (const radio of screen.getAllByRole('radio')) {
      // Asserted against the class contract rather than a computed style, which
      // jsdom does not resolve from a stylesheet. `RatingChoice.css` fixes both
      // dimensions at 44px and the visual suite is what checks it renders so.
      expect(radio.className).toContain('rating-star')
    }
  })
})
