import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import {
  QUEUE_EVENT,
  REPLAYED_EVENT,
  discardAllFailures,
  discardWrite,
  retryWrite,
  unresolvedWrites,
  type QueuedWrite,
} from '@/lib/writeQueue'
import './SyncIssues.css'

/**
 * The one place a queued write that could not be saved is answered (F2).
 *
 * **One line, and only when there is something to answer.** The brief is
 * explicit that offline must not put a banner on every screen, and it is right:
 * the ordinary case is that everything Alex tapped on the plane lands silently
 * at the gate and he never learns there was a queue. This appears only for the
 * cases where the app genuinely cannot decide on his behalf.
 *
 * Two of those exist, and they read differently because they are different
 * questions:
 *
 * - **Something changed here since.** The row moved on the server after Alex
 *   tapped it offline, so applying his change would undo a newer one. Both
 *   answers are legitimate and neither is a failure, so the sheet asks rather
 *   than picking.
 * - **It could not be saved.** The server refused, or the row is gone. There is
 *   nothing to choose between; the honest offer is to try again or let it go.
 */
export function SyncIssues() {
  const [writes, setWrites] = useState<QueuedWrite[]>(() => unresolvedWrites())
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const sync = () => setWrites(unresolvedWrites())
    window.addEventListener(QUEUE_EVENT, sync)
    window.addEventListener(REPLAYED_EVENT, sync)
    return () => {
      window.removeEventListener(QUEUE_EVENT, sync)
      window.removeEventListener(REPLAYED_EVENT, sync)
    }
  }, [])

  // Nothing left to answer closes the sheet rather than leaving an empty one.
  useEffect(() => {
    if (writes.length === 0) setOpen(false)
  }, [writes.length])

  if (writes.length === 0) return null

  const conflicts = writes.filter((write) => write.failure?.kind === 'conflict').length
  const allConflicts = conflicts === writes.length
  const count = writes.length === 1 ? 'One change' : `${writes.length} changes`

  async function keepMine(write: QueuedWrite) {
    setBusy(write.key)
    try {
      await retryWrite(write.key)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {/*
        * Quiet when nothing is wrong, and an alert only when something is.
        *
        * A conflict is not a failure — both changes worked, they simply
        * disagree, and doc 06 §3 rules out alarm fatigue. A write the server
        * refused is a different matter and looks like one.
        */}
      <p
        className={`banner ${allConflicts ? 'banner-quiet' : 'banner-alert'} sync-issues`}
        role="status"
      >
        <span className="banner-text">
          {/*
            * Says which kind, because the answer differs. "2 changes need you"
            * with no hint of why is a notification, not a sentence.
            */}
          {allConflicts
            ? `${count} you made offline ${
                writes.length === 1 ? 'was' : 'were'
              } overtaken by a newer one.`
            : `${count} did not save.`}
        </span>
        <button
          type="button"
          className="button-secondary button-compact"
          onClick={() => setOpen(true)}
        >
          Sort it out
        </button>
      </p>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Changes that need you"
        footer={
          writes.length > 1 ? (
            <button
              type="button"
              className="button-quiet"
              onClick={() => discardAllFailures()}
            >
              Let all of them go
            </button>
          ) : undefined
        }
      >
        <ul className="sync-list row-list">
          {writes.map((write) => (
            <li key={write.key} className="sync-item">
              <p className="sync-item-name">{write.entryName}</p>
              <p className="sync-item-why">
                {write.failure?.kind === 'conflict'
                  ? `${describe(write)} — but it changed somewhere else after you did.`
                  : `${describe(write)} — ${write.failure?.message ?? 'it could not be saved.'}`}
              </p>
              <div className="sync-item-actions button-row">
                <button
                  type="button"
                  className="button-secondary button-compact"
                  disabled={busy === write.key}
                  onClick={() => void keepMine(write)}
                >
                  {write.failure?.kind === 'conflict' ? 'Use mine' : 'Try again'}
                </button>
                <button
                  type="button"
                  className="button-quiet button-compact"
                  disabled={busy === write.key}
                  onClick={() => discardWrite(write.key)}
                >
                  {write.failure?.kind === 'conflict' ? 'Keep the newer one' : 'Let it go'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  )
}

/**
 * What Alex actually did, in his words rather than the field's.
 *
 * `packedQty: 0` is not something anyone tapped; "You unpacked it" is.
 */
function describe(write: QueuedWrite): string {
  if (write.field === 'packedQty') {
    return Number(write.value) > 0 ? 'You packed it' : 'You unpacked it'
  }
  if (write.field === 'finalChecked') {
    return write.value ? 'You gave it a final check' : 'You cleared its final check'
  }
  return write.value === null ? 'You handed it back to Pack Smart' : 'You moved it to another bag'
}
