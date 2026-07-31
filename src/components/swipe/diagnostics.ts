/**
 * Preview-only gesture diagnostics.
 *
 * **This module is compiled out of the production bundle.** `import.meta.env.MODE`
 * is replaced by Vite with a string literal at build time, so in the default
 * build `DIAGNOSTICS` is `false === true` and every branch guarded by it — and
 * the panel component itself — is dropped by the minifier. The production build
 * is checked for the marker string below by
 * `tests/unit/dom/diagnostics-are-preview-only.test.ts`.
 *
 * Why this exists at all: PR #30's swipe fix passed every automated gate and was
 * still unusable on Alex's iPhone. The gap is not more tests, it is that nothing
 * could report what the *phone* was doing. This reports it on screen, in words,
 * so that diagnosing a failure never depends on Alex opening developer tools.
 *
 * What it may never contain: item names, trip names, anything typed, anything
 * fetched. The row is identified by its position in the list and nothing else.
 */

import type { Axis } from './recognizer'

export const DIAGNOSTICS = import.meta.env.MODE === 'preview'

/** Appears verbatim in the bundle only when diagnostics were built in. */
export const DIAGNOSTICS_MARKER = 'pack-smart-gesture-diagnostics'

export interface GestureTrace {
  /** Position of the row in its section. Never its name. */
  row: number
  /** Measured row width, so a zero-width row is visible as the cause it is. */
  width: number
  /** Touches on the screen when the gesture began. >1 is rejected. */
  touches: number
  dx: number
  dy: number
  axis: Axis
  /** Moves seen, and how many of those we were still allowed to veto. */
  moves: number
  cancelable: number
  /** Moves where the browser's pan was actually vetoed. */
  vetoed: number
  /** True once the row travelled far enough that releasing would commit. */
  threshold: boolean
  /** Set when something other than a release ended the gesture. */
  cancelled: string | null
  /** How the gesture finished, once it has. */
  ended: string | null
  /** Renders and mounts of this row, which is how a remount mid-gesture shows up. */
  renders: number
  mounts: number
}

const EMPTY: GestureTrace = {
  row: -1,
  width: 0,
  touches: 0,
  dx: 0,
  dy: 0,
  axis: 'undecided',
  moves: 0,
  cancelable: 0,
  vetoed: 0,
  threshold: false,
  cancelled: null,
  ended: null,
  renders: 0,
  mounts: 0,
}

let current: GestureTrace = EMPTY
const listeners = new Set<(trace: GestureTrace) => void>()

/**
 * Mounts per row position, which has to outlive the component to be worth
 * anything: a row that remounts mid-gesture is exactly the failure this is
 * looking for, and a counter inside the row resets when the row does.
 */
const mounts = new Map<number, number>()

export function countMount(row: number): number {
  const next = (mounts.get(row) ?? 0) + 1
  mounts.set(row, next)
  return next
}

export function trace(patch: Partial<GestureTrace>): void {
  if (!DIAGNOSTICS) return
  current = { ...current, ...patch }
  for (const listener of listeners) listener(current)
}

/** Starts a fresh trace. Everything not named here goes back to nothing. */
export function traceStart(patch: Partial<GestureTrace>): void {
  if (!DIAGNOSTICS) return
  current = { ...EMPTY, ...patch }
  for (const listener of listeners) listener(current)
}

export function subscribe(listener: (trace: GestureTrace) => void): () => void {
  listeners.add(listener)
  listener(current)
  return () => listeners.delete(listener)
}
