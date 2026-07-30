/**
 * Light and Dark, as a choice rather than a consequence of the phone's setting.
 *
 * The vocabulary and the resolution rule live here, in `shared/`, and the parts
 * that touch the DOM live in `src/lib/appearance.ts`. The split is not tidiness:
 * `index.html` carries a duplicate of this logic that has to run before the app
 * bundle exists, and `tests/data/appearance-sources.test.ts` compares the two —
 * which it can only do from a project that reaches both files.
 */

/** Three values, and `system` is the default because following the phone is
 * usually right. The toggle exists for the times it is not. */
export type Appearance = 'system' | 'light' | 'dark'
export type ResolvedAppearance = 'light' | 'dark'

export const APPEARANCE_KEY = 'pack-smart.appearance'

/**
 * The resolved theme is an ATTRIBUTE on `<html>`, not a media query.
 *
 * A media query cannot be overridden by a stored choice — `prefers-color-scheme`
 * is the device's answer and CSS has no way to say "unless the user said
 * otherwise". So the palette keys off `[data-theme]`, this names that attribute,
 * and `prefers-color-scheme` is consulted only to resolve `system`.
 */
export const THEME_ATTRIBUTE = 'data-theme'

/** What Safari's own chrome is told, so the status bar matches the page. */
export const THEME_COLORS: Record<ResolvedAppearance, string> = {
  light: '#f7f7f8',
  dark: '#0b0b0c',
}

export function isAppearance(value: unknown): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** Resolves a choice against what the device currently reports. */
export function resolveAppearance(choice: Appearance, deviceIsDark: boolean): ResolvedAppearance {
  if (choice === 'light' || choice === 'dark') return choice
  return deviceIsDark ? 'dark' : 'light'
}
