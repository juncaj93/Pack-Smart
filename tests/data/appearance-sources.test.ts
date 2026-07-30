import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_KEY,
  THEME_ATTRIBUTE,
  THEME_COLORS,
  isAppearance,
  resolveAppearance,
} from '@shared/appearance'

/**
 * The boot script in `index.html` is a deliberate duplicate of `appearance.ts`.
 *
 * Lives in `tests/data/` because it reads real project files off disk, which needs
 * Node types the app project deliberately does not carry — the same reason the
 * workbook tests are here.
 *
 * It has to be. A module is deferred by definition, so anything imported runs
 * after the document has been parsed and painted — one frame of white on a phone
 * in Dark, every launch. Avoiding that means running inline, before the body, with
 * no imports available.
 *
 * A duplicate is only safe if something checks it, so these read both real files
 * and fail if they disagree about the storage key, the attribute, or the three
 * allowed values. Without this the two drift the first time one is edited, and the
 * symptom is a flash nobody can reproduce on a desktop.
 */

const HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8')

/** The inline classic script, which is the only <script> without a `src`. */
const BOOT = HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''

describe('the theme is set before the first paint', () => {
  it('has an inline classic script, not a module', () => {
    expect(BOOT.trim().length).toBeGreaterThan(0)
    // A module here would be deferred, which defeats the entire purpose.
    expect(HTML).not.toMatch(/<script type="module">[\s\S]*data-theme/)
  })

  it('runs before the app bundle', () => {
    expect(HTML.indexOf('data-theme')).toBeLessThan(HTML.indexOf('/src/main.tsx'))
  })

  it('reads the same storage key the module writes', () => {
    expect(BOOT).toContain(APPEARANCE_KEY)
  })

  it('sets the same attribute the palette keys off', () => {
    expect(BOOT).toContain(THEME_ATTRIBUTE)
  })

  it('knows the same three choices', () => {
    for (const choice of ['system', 'light', 'dark']) {
      expect(isAppearance(choice)).toBe(true)
      expect(BOOT).toContain(`'${choice}'`)
    }
  })

  it('cannot stop the app loading when storage throws', () => {
    // Private browsing makes localStorage throw rather than return null.
    expect(BOOT).toContain('try')
    expect(BOOT).toContain('catch')
  })

  it('consults the device only to resolve System', () => {
    expect(BOOT).toContain('prefers-color-scheme: dark')
  })

  it('tells Safari the same chrome colours the module does', () => {
    for (const colour of Object.values(THEME_COLORS)) expect(BOOT).toContain(colour)
  })
})

describe('resolving a choice', () => {
  it('takes an explicit choice over the device', () => {
    expect(resolveAppearance('light', true)).toBe('light')
    expect(resolveAppearance('dark', false)).toBe('dark')
  })

  it('follows the device only for System', () => {
    expect(resolveAppearance('system', true)).toBe('dark')
    expect(resolveAppearance('system', false)).toBe('light')
  })

  it('rejects anything that is not one of the three', () => {
    for (const value of ['Dark', 'night', '', null, undefined, 1]) {
      expect(isAppearance(value)).toBe(false)
    }
  })
})

describe('the palette can actually be overridden', () => {
  const TOKENS = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')

  it('declares both themes as attributes, not only as a media query', () => {
    expect(TOKENS).toContain(":root[data-theme='dark'] {")
    /*
     * The light block is the one that is easy to forget, and its absence is
     * invisible on a light phone: without it, choosing Light on a Dark device
     * applies nothing, because the dark media query still matches.
     */
    expect(TOKENS).toContain(":root[data-theme='light'] {")
  })

  it('puts the attribute blocks after the media query, so a choice wins', () => {
    /*
     * The selectors are matched WITH their brace. Both are named in the comment
     * above the media query too, and an `indexOf` that found the prose would pass
     * while the cascade was wrong — which is the only thing this asserts.
     */
    expect(TOKENS.indexOf('@media (prefers-color-scheme: dark)')).toBeLessThan(
      TOKENS.indexOf(":root[data-theme='light'] {"),
    )
    expect(TOKENS.indexOf('@media (prefers-color-scheme: dark)')).toBeLessThan(
      TOKENS.indexOf(":root[data-theme='dark'] {"),
    )
  })

  it('tells the platform which scheme it is in', () => {
    // Otherwise a Dark page renders a white native date wheel.
    expect(TOKENS).toContain('color-scheme: dark')
    expect(TOKENS).toContain('color-scheme: light')
  })
})
