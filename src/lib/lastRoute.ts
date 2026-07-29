import { TAB_PATHS, type TabPath } from '@shared/types'

const STORAGE_KEY = 'pack-smart:last-route'

/**
 * Remembers which tab Alex was on so reopening the app resumes there rather
 * than bouncing to Home — CLAUDE.md: "preserve the user's exact location and
 * progress when reopening the app."
 *
 * localStorage is deliberate here even though WebKit may evict it after ~7 days
 * of disuse (risk R7). Losing this value costs one tab of context; the session
 * itself lives in a server-set cookie precisely because it must NOT be subject
 * to that eviction. Per-screen scroll restoration is M5 work, not M0.
 */

function isTabPath(value: string): value is TabPath {
  return (TAB_PATHS as readonly string[]).includes(value)
}

export function readLastRoute(): TabPath | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored && isTabPath(stored) ? stored : null
  } catch {
    // Private mode or a disabled store — resuming is a nicety, never a failure.
    return null
  }
}

export function writeLastRoute(path: string): void {
  if (!isTabPath(path)) return
  try {
    window.localStorage.setItem(STORAGE_KEY, path)
  } catch {
    /* ignore */
  }
}
