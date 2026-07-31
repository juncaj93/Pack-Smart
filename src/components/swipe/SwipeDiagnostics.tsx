import { useEffect, useState } from 'react'
import { DIAGNOSTICS, DIAGNOSTICS_MARKER, subscribe, type GestureTrace } from './diagnostics'
import './SwipeDiagnostics.css'

/**
 * A temporary, Preview-only readout of what the last gesture actually did.
 *
 * **Why this exists.** PR #30's swipe fix passed typecheck, lint, 756 unit
 * tests, 128 WebKit end-to-end tests and the visual gate, and was still
 * unusable on Alex's iPhone. The missing signal was never another assertion: it
 * was that nothing could report what the *phone* was doing. This reports it on
 * the screen, in words, so that diagnosing a failure never depends on Alex
 * opening developer tools or reading a log.
 *
 * **What it may never show.** No item names, no trip names, nothing typed,
 * nothing fetched, no identifiers. A row is named by its position in its
 * section and by nothing else.
 *
 * **Where it runs.** Only in a build made with `--mode preview`. In the
 * production build `DIAGNOSTICS` folds to `false`, this component is
 * tree-shaken out entirely, and
 * `tests/unit/dom/diagnostics-are-preview-only.test.ts` fails the build if the
 * marker string below is ever found in a production bundle.
 *
 * **This is scaffolding.** It comes out before the hotfix merges.
 */
export function SwipeDiagnostics() {
  const [trace, setTrace] = useState<GestureTrace | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => subscribe(setTrace), [])

  if (!DIAGNOSTICS) return null

  if (!open) {
    return (
      <button type="button" className="swipe-diagnostics-pill" onClick={() => setOpen(true)}>
        Gesture check
      </button>
    )
  }

  const idle = !trace || trace.row < 0

  return (
    <aside className="swipe-diagnostics" data-marker={DIAGNOSTICS_MARKER} aria-live="off">
      <div className="swipe-diagnostics-head">
        <strong>Gesture check</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="Hide the gesture check">
          Hide
        </button>
      </div>

      {/*
        * Says out loud what this build gave up to be testable.
        *
        * The Preview Worker skips the passphrase, and its URL is public and
        * bound to the real database — so a screen that looked like ordinary
        * Pack Smart would be the most misleading thing here. It is stated on
        * the one panel that only exists in this build, which is also the panel
        * that disappears when the scaffolding is removed.
        */}
      <p className="swipe-diagnostics-warning">
        Preview build — no passphrase, real data. Anyone with this link is signed in.
      </p>

      {idle ? (
        <p className="swipe-diagnostics-idle">Touch a packing-list row to see what happens.</p>
      ) : (
        <dl className="swipe-diagnostics-grid">
          <Line label="Row" value={`#${trace.row} · ${trace.width}px wide`} />
          <Line label="Fingers" value={String(trace.touches)} />
          <Line label="Sideways" value={`${trace.dx}px`} />
          <Line label="Up or down" value={`${trace.dy}px`} />
          <Line label="Claimed" value={trace.axis} />
          <Line
            label="Moves"
            value={`${trace.moves} seen · ${trace.cancelable} still stoppable · ${trace.vetoed} stopped`}
          />
          <Line label="Far enough" value={trace.threshold ? 'yes' : 'not yet'} />
          <Line label="Interrupted" value={trace.cancelled ?? 'no'} />
          <Line label="Finished" value={trace.ended ?? 'still going'} />
          <Line label="Row renders" value={String(trace.renders)} />
          <Line label="Row mounts" value={String(trace.mounts)} />
        </dl>
      )}

      <p className="swipe-diagnostics-key">
        A healthy right-swipe: claimed <em>horizontal</em>, every move stoppable and stopped, one
        mount. A vertical scroll: claimed <em>vertical</em>, nothing stopped.
      </p>
    </aside>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}
