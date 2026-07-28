/**
 * Remember where Alex was, so reopening the app resumes exactly there.
 *
 * CLAUDE.md: "Preserve the user's exact location and progress when reopening
 * the app." M0 covers the route; scroll position and in-trip context land with
 * the polish milestone.
 */

const KEY = 'packsmart.lastRoute'

/** Routes we are willing to resume into. Login is never a resume target. */
const RESUMABLE = ['/', '/trips', '/my-stuff', '/settings']

export function rememberRoute(pathname: string): void {
  try {
    if (RESUMABLE.includes(pathname)) localStorage.setItem(KEY, pathname)
  } catch {
    // Private mode or storage pressure. Resuming is a nicety, never a failure.
  }
}

export function recallRoute(): string | null {
  try {
    const value = localStorage.getItem(KEY)
    return value && RESUMABLE.includes(value) ? value : null
  } catch {
    return null
  }
}
