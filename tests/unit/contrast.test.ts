import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Text contrast, as arithmetic.
 *
 * A11-1's second half was `.check-critical` — the "· Essential" marker — at
 * **2.79:1** in Light. The one word on the packing list that says "do not
 * forget this" was the hardest word on it to read.
 *
 * A unit test rather than a screenshot review, because contrast is a
 * calculation and a calculation should not need a human to look at a picture.
 * The visual gate catches layout and hierarchy; it has never caught a ratio,
 * and this defect sat in the repository through two accessibility reviews
 * before one measured it.
 *
 * Reads the REAL token values out of `tokens.css`, so a change to a colour is
 * what fails this — not a copy of the numbers that drifts from them.
 */

const TOKENS = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8')

/**
 * The first definition of a variable, which is the Light one.
 *
 * `tokens.css` declares Light at `:root` and then overrides for dark inside a
 * media query and a `[data-theme]` block, so document order separates them.
 */
function token(name: string, occurrence = 0): string {
  const matches = [...TOKENS.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, 'g'))]
  const found = matches[occurrence]?.[1]
  if (!found) throw new Error(`contrast: --${name} #${occurrence} is not a hex token`)
  return found
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ]
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function ratio(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)]
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

/** WCAG AA for text below 18pt / 14pt bold — which is all of ours. */
const AA_BODY = 4.5

describe('every colour text is actually printed in', () => {
  it('reads the real tokens, in both appearances', () => {
    // Light first, dark second — if that ever stops being true, every
    // expectation below is measuring the wrong pair and would still pass.
    expect(luminance(token('color-text', 0))).toBeLessThan(luminance(token('color-surface', 0)))
    expect(luminance(token('color-text', 1))).toBeGreaterThan(luminance(token('color-surface', 1)))
  })

  /*
   * The A11-1 defect, as a number — and read from the RULE, not from a token.
   *
   * The first version of this test asserted that `--color-text-secondary`
   * meets AA, which is true and proves nothing: putting `.check-critical` back
   * on tertiary would leave it green. It has to start from the stylesheet and
   * find out which variable that class actually uses, or it is testing a colour
   * nobody was ever accused of misusing.
   */
  /*
   * The marker stopped being painted, so the ratio it was painted at is no
   * longer the question — but the class must not simply reappear in a colour.
   *
   * `Essential` sorts to the top, which means it lands on a RUN of consecutive
   * rows and distinguishes nothing within that run; the ordering already says
   * it. It is now visually hidden rather than deleted, so a screen reader still
   * hears it in the row's accessible name and `list-order.spec.ts` still has
   * the DOM hook it uses to assert essentials sort first.
   *
   * What this guards is the way back: anyone who gives `.check-critical` a
   * colour again has un-hidden it, and inherits the A11-1 contrast problem this
   * test was written for. So it asserts the clip is intact, and that IF a colour
   * ever comes back it still meets AA.
   */
  it('does not paint the Essential marker, and could not do so below AA', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'routes', 'Trip.css'), 'utf8')
    const rule = /\.check-critical\s*\{([^}]*)\}/.exec(css)?.[1]
    expect(rule, '.check-critical is gone from Trip.css').toBeTruthy()

    expect(rule, `.check-critical is no longer clipped out of the page: ${rule}`).toMatch(
      /clip:\s*rect\(0 0 0 0\)/,
    )

    const variable = /color:\s*var\(--([a-z0-9-]+)\)/.exec(rule!)?.[1]
    if (!variable) return

    const light = ratio(token(variable, 0), token('color-surface', 0))
    const dark = ratio(token(variable, 1), token('color-surface', 1))

    expect(light, `--${variable} on the row is ${light}:1 in Light`).toBeGreaterThanOrEqual(AA_BODY)
    expect(dark, `--${variable} on the row is ${dark}:1 in Dark`).toBeGreaterThanOrEqual(AA_BODY)
  })

  /*
   * The colour the marker used to be, pinned as the reason it moved.
   *
   * Tertiary is not banned — a chevron that repeats what the text beside it
   * already says is fine at any ratio, because nothing is lost by not seeing
   * it. What this records is that it CANNOT carry text, so the next person
   * reaching for it for a label knows why they should not.
   */
  it('knows tertiary cannot carry body text, which is why the marker moved off it', () => {
    const light = ratio(token('color-text-tertiary', 0), token('color-surface', 0))
    expect(light, `tertiary measures ${light}:1 in Light`).toBeLessThan(AA_BODY)
  })

  it('prints ordinary secondary text at AA on the page background too', () => {
    // `--color-bg`, not `--color-surface`: several screens put secondary text
    // straight on the page rather than inside a card.
    const light = ratio(token('color-text-secondary', 0), token('color-bg', 0))
    const dark = ratio(token('color-text-secondary', 1), token('color-bg', 1))

    expect(light, `Light is ${light}:1`).toBeGreaterThanOrEqual(AA_BODY)
    expect(dark, `Dark is ${dark}:1`).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('prints primary text far above AA, since everything else leans on it', () => {
    expect(ratio(token('color-text', 0), token('color-surface', 0))).toBeGreaterThan(7)
    expect(ratio(token('color-text', 1), token('color-surface', 1))).toBeGreaterThan(7)
  })

  it('prints the danger colour at AA, because it carries real warnings', () => {
    const light = ratio(token('color-danger', 0), token('color-surface', 0))
    const dark = ratio(token('color-danger', 1), token('color-surface', 1))

    expect(light, `Light is ${light}:1`).toBeGreaterThanOrEqual(AA_BODY)
    expect(dark, `Dark is ${dark}:1`).toBeGreaterThanOrEqual(AA_BODY)
  })
})
