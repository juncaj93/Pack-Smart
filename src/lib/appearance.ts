import {
  APPEARANCE_KEY,
  THEME_ATTRIBUTE,
  THEME_COLORS,
  isAppearance,
  resolveAppearance,
  type Appearance,
  type ResolvedAppearance,
} from '@shared/appearance'

export type { Appearance, ResolvedAppearance }
export { APPEARANCE_KEY, THEME_ATTRIBUTE, isAppearance }

/**
 * The half of appearance that touches the browser.
 *
 * The vocabulary and the resolution rule are in `@shared/appearance`, so the boot
 * script in `index.html` can be compared against them by a test that reaches both.
 * Everything here needs a `window`.
 */

/** What `system` currently means on this device. */
export function deviceAppearance(): ResolvedAppearance {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolve(choice: Appearance): ResolvedAppearance {
  return resolveAppearance(choice, deviceAppearance() === 'dark')
}

/**
 * Reads the stored choice, treating anything unreadable as `system`.
 *
 * Private browsing and a full storage quota both make `localStorage` throw rather
 * than return null, and a colour preference is not worth a blank screen.
 */
export function storedAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY)
    return isAppearance(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

export function storeAppearance(choice: Appearance): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, choice)
  } catch {
    /* The choice still applies to this session; it just will not survive it. */
  }
}

export function applyAppearance(choice: Appearance): ResolvedAppearance {
  const resolved = resolve(choice)
  document.documentElement.setAttribute(THEME_ATTRIBUTE, resolved)
  /*
   * Keeps Safari's own chrome in step. Without this the status bar and the
   * toolbar stay the colour of the theme the phone is in, which is exactly the
   * seam that makes a web app look like a web app.
   */
  document
    .querySelector('meta[name="theme-color"]:not([media])')
    ?.setAttribute('content', THEME_COLORS[resolved])
  return resolved
}

/*
 * One choice, two controls.
 *
 * The sun/moon in the header and the three-state row in Settings are the same
 * preference wearing two shapes, and they are on screen at the same time. Each
 * reading `localStorage` on mount and never again meant changing one left the
 * other showing the old answer until the screen was rebuilt — the toggle would
 * still say "switch to dark" after Settings had already switched to dark.
 *
 * A module-level value with subscribers, rather than a Context: there is exactly
 * one of these in the application, it is read by two components, and a provider
 * around the whole tree would be more moving parts than the problem has.
 */
let current: Appearance | null = null
const listeners = new Set<() => void>()

/** The current choice, read from storage once and then kept here. */
export function appearanceChoice(): Appearance {
  current ??= storedAppearance()
  return current
}

/** Stores a choice, applies it, and tells every control about it. */
export function setAppearanceChoice(choice: Appearance): ResolvedAppearance {
  current = choice
  storeAppearance(choice)
  const resolved = applyAppearance(choice)
  for (const listener of listeners) listener()
  return resolved
}

export function subscribeToAppearance(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Calls back when the DEVICE changes, which only matters while the choice is
 * `system`. Returns an unsubscribe.
 *
 * `addEventListener` on a MediaQueryList is recent enough that older WebKit only
 * has the deprecated `addListener`, and this app's whole point is old-ish iPhone
 * Safari — so both are wired, and neither is assumed.
 */
export function watchDeviceAppearance(onChange: () => void): () => void {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!query) return () => {}

  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }
  query.addListener(onChange)
  return () => query.removeListener(onChange)
}
