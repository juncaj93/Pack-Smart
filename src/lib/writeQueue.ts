/**
 * The narrow offline write queue (F2).
 *
 * Offline READS have been complete since M10 — `public/sw.js` is network-first
 * for every `GET /api/*`, so the trip, the packing list, Today and the approved
 * outfits are all readable on a plane. What was still missing was the other
 * half of the same evening: ticking things off while the plane is boarding.
 *
 * ## What may be queued, and why it is only three things
 *
 * A write is eligible only when replaying it late cannot produce a state nobody
 * asked for. That rules out almost everything, and what survives is the set of
 * checklist fields that are an **absolute value on one row**:
 *
 *   packedQty      how many of this are in the bag
 *   finalChecked   the last-minute confirmation on `Before you go`
 *   bag            which bag it goes in, or null to hand the row back
 *
 * Everything else stays online-only, and doc 09 §4 records the rule each one
 * fails. The two worth repeating here: `POST …/today/wear` is an INSERT with no
 * unique key, so a duplicate replay is a duplicate row; and Not-bringing owes
 * Alex a list of the outfits it breaks (doc 04 §8), which cannot be produced
 * offline — queueing it would make a visible decision silent.
 *
 * ## Desired state, never a log of taps
 *
 * A record is keyed by `(entryId, field)` and holds the value Alex last chose.
 * Tapping a row twelve times offline is one record, not twelve, so replaying it
 * twice is the same as replaying it once **by construction** rather than
 * because the replay is careful. That is the whole reason the queue is shaped
 * this way.
 *
 * ## It dies with the session
 *
 * Every record carries the session marker current when it was made, and the
 * marker is removed by `lock()` along with the unlock flag. A record from a
 * session that has ended can therefore never replay: not after a sign-out, not
 * after an expiry, not into a new session, and not from a second tab, because
 * `lock()` empties the shared queue outright. The marker is checked again
 * immediately before each request, because a sign-out can land between the
 * trigger and the send.
 *
 * The server is still the authority. Nothing here is a credential, every replay
 * is an ordinary cookie-authenticated PATCH, and a 401 ends the session.
 *
 * ## And it never overwrites something newer
 *
 * Each record remembers the row's `updatedAt` at the moment Alex acted, and the
 * replay sends it as `ifUnmodifiedSince`. A row that has moved on since comes
 * back 409; the queued value is not applied, and the choice is put to Alex
 * rather than resolved by whichever write happened to be last.
 *
 * ## localStorage, not IndexedDB
 *
 * A few dozen records of five short fields. IndexedDB would buy asynchrony
 * nobody needs and cost a schema, an upgrade path and a wrapper. localStorage
 * is also cleared by Safari's *Clear Website Data* along with everything else,
 * which is a requirement here rather than a limitation.
 */

import { ApiRequestError } from '@/lib/api'
import { sessionId } from '@/lib/session'
import { patchEntry, type EntryPatch } from '@/lib/trips'
import type { ChecklistEntry } from '@shared/checklist'

const STORAGE_KEY = 'pack-smart:pending-writes'

/** Fired whenever the queue's contents change, so screens can repaint. */
export const QUEUE_EVENT = 'pack-smart:queue-changed'

/** Fired when a replay actually landed something, so screens can reload. */
export const REPLAYED_EVENT = 'pack-smart:writes-replayed'

/**
 * How many times a replay may fail retryably before it stops being retried on
 * its own and starts asking.
 *
 * Not a backoff: the queue is driven by reconnects, not by a timer, so an
 * unreachable server costs one request per reconnect. The cap exists so that a
 * write the server will never accept surfaces to Alex instead of retrying
 * silently for the rest of the trip.
 */
const MAX_ATTEMPTS = 5

export const QUEUEABLE_FIELDS = ['packedQty', 'finalChecked', 'bag'] as const
export type QueueField = (typeof QUEUEABLE_FIELDS)[number]

export type QueueValue = number | boolean | string | null

export interface QueueFailure {
  /**
   * `conflict` — the row moved on the server and Alex has a real choice.
   * `permanent` — the server refused, or the row is gone, and there is nothing
   * to choose between.
   */
  kind: 'conflict' | 'permanent'
  message: string
}

export interface QueuedWrite {
  /** `${entryId}:${field}` — one record per field per row, always. */
  key: string
  tripId: string
  entryId: string
  /** Kept so a failure can name the item without the trip being loaded. */
  entryName: string
  field: QueueField
  value: QueueValue
  /** When Alex acted, from the device clock. Orders the replay. */
  at: number
  /** The row's `updatedAt` when he acted — the version this is conditional on. */
  baseUpdatedAt: number
  /** Which signed-in session this belongs to. */
  session: string
  attempts: number
  failure: QueueFailure | null
}

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

function isQueueField(value: unknown): value is QueueField {
  return QUEUEABLE_FIELDS.includes(value as QueueField)
}

/** Only what this shape actually accepts, because storage is not trusted. */
function parse(raw: string | null): QueuedWrite[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((record): record is QueuedWrite => {
      if (!record || typeof record !== 'object') return false
      const write = record as Partial<QueuedWrite>
      return (
        typeof write.key === 'string' &&
        typeof write.tripId === 'string' &&
        typeof write.entryId === 'string' &&
        typeof write.session === 'string' &&
        typeof write.at === 'number' &&
        isQueueField(write.field)
      )
    })
  } catch {
    return []
  }
}

/**
 * Straight from storage every time, with no in-memory copy.
 *
 * A cache was written first and removed deliberately. localStorage is shared
 * with every other tab and is emptied by things this module does not observe —
 * a sign-out elsewhere, Safari clearing website data — so a copy in a module
 * variable is a second answer to "what is queued" that can be wrong in exactly
 * the situation where being wrong means replaying a write that should be gone.
 *
 * The cost it was avoiding is a `JSON.parse` of a few hundred bytes on each
 * reconnect. That is not a cost.
 */
function readAll(): QueuedWrite[] {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

function writeAll(records: QueuedWrite[]): void {
  try {
    if (records.length === 0) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    /*
     * Private browsing, or the quota is full. The optimistic state on screen is
     * then the only record, and it will be corrected by the next successful
     * read — which is the same outcome as before this existed.
     */
  }
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT))
}

/**
 * Everything queued **under the current session**.
 *
 * Records belonging to any other session are not returned and are not replayed.
 * `lock()` already removes them, so this is the second of two guards rather
 * than the only one — but a queue is exactly the thing that must not depend on
 * one line having run.
 */
export function pendingWrites(): QueuedWrite[] {
  const session = sessionId()
  if (!session) return []
  return readAll().filter((write) => write.session === session)
}

/** Emptied by `lock()`, on every path that ends a session. */
export function clearQueue(): void {
  // Unconditional. "There is nothing to clear" is a belief about storage this
  // module does not exclusively own, and acting on it is how a record survives
  // the sign-out that was supposed to take it.
  writeAll([])
}

/**
 * Another tab changed the queue, so anything showing it should repaint.
 *
 * `storage` does not fire in the tab that wrote, which is exactly right: this
 * only ever needs to react to somebody else.
 */
export function watchOtherTabs(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return
    window.dispatchEvent(new CustomEvent(QUEUE_EVENT))
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

/* ------------------------------------------------------------------ */
/* enqueueing                                                          */
/* ------------------------------------------------------------------ */

/** Whether every field in this patch is one the queue may hold. */
export function isQueueablePatch(patch: EntryPatch): boolean {
  const fields = Object.keys(patch).filter((field) => field !== 'ifUnmodifiedSince')
  return fields.length > 0 && fields.every(isQueueField)
}

/**
 * Records the change, replacing any earlier one for the same row and field.
 *
 * `baseUpdatedAt` comes from the FIRST version Alex acted against and is
 * deliberately not refreshed by a later tap on the same field: what the
 * conditional write is protecting is "nothing has changed on the server since I
 * last saw this row", and the earliest of those is the honest answer.
 */
export function enqueue(entry: ChecklistEntry, patch: EntryPatch): QueuedWrite[] | null {
  const session = sessionId()
  if (!session) return null

  const existing = readAll()
  const at = Date.now()

  const added: QueuedWrite[] = []
  for (const [field, value] of Object.entries(patch)) {
    if (!isQueueField(field)) continue
    const previous = existing.find(
      (write) => write.session === session && write.entryId === entry.id && write.field === field,
    )
    added.push({
      key: `${entry.id}:${field}`,
      tripId: entry.tripId,
      entryId: entry.id,
      entryName: entry.name,
      field,
      value: value as QueueValue,
      at,
      baseUpdatedAt: previous?.baseUpdatedAt ?? entry.updatedAt,
      session,
      attempts: 0,
      failure: null,
    })
  }
  if (added.length === 0) return null

  /*
   * The earlier record for the same row and field is REPLACED, not appended.
   *
   * This is where "desired state, not a log" is actually enforced: pack,
   * unpack, pack again is one record saying packed, so the replay cannot
   * reproduce the middle of a sequence Alex has already moved past.
   */
  const keys = new Set(added.map((write) => write.key))
  writeAll([...existing.filter((write) => !keys.has(write.key)), ...added])
  return added
}

/* ------------------------------------------------------------------ */
/* showing what is pending                                             */
/* ------------------------------------------------------------------ */

/** The fields of one row that are waiting to sync, in no particular order. */
export function pendingFields(entryId: string): QueueField[] {
  return pendingWrites()
    .filter((write) => write.entryId === entryId && write.failure === null)
    .map((write) => write.field)
}

/** Whether this row has anything at all waiting or unresolved. */
export function hasPending(entryId: string): boolean {
  return pendingWrites().some((write) => write.entryId === entryId)
}

/**
 * Every row with a change still waiting to reach the server.
 *
 * A set, read once per queue change, because the alternative is asking the
 * question per row on every render of a list that can be sixty rows long.
 * Rows with an *unresolved failure* are excluded: those are answered in
 * `SyncIssues`, and marking them "saved on this phone" would be a lie.
 */
export function pendingEntryIds(): Set<string> {
  return new Set(
    pendingWrites()
      .filter((write) => write.failure === null)
      .map((write) => write.entryId),
  )
}

/** Failures Alex has not answered yet. */
export function unresolvedWrites(): QueuedWrite[] {
  return pendingWrites().filter((write) => write.failure !== null)
}

/**
 * Lays the queue over what the server last said.
 *
 * The cached checklist read is the state before Alex went offline, so after a
 * restart — or after the service worker answers a reload from cache — the rows
 * would show his offline packing undone. Applied here, in one place, so every
 * screen that reads the checklist agrees about it.
 *
 * **A write that FAILED is not applied.** It did not land, and the server's
 * value is the true one — a row still showing Alex's value with no marker on it
 * would be the silent failure this whole slice exists to avoid. It is not lost:
 * `SyncIssues` is holding it, and *Use mine* sends it for real.
 */
export function applyPending(entries: ChecklistEntry[]): ChecklistEntry[] {
  const queued = pendingWrites().filter((write) => write.failure === null)
  if (queued.length === 0) return entries

  const byEntry = new Map<string, QueuedWrite[]>()
  for (const write of queued) {
    const list = byEntry.get(write.entryId)
    if (list) list.push(write)
    else byEntry.set(write.entryId, [write])
  }

  return entries.map((entry) => {
    const writes = byEntry.get(entry.id)
    if (!writes) return entry
    let next = entry
    for (const write of writes) {
      if (write.field === 'packedQty') next = { ...next, packedQty: Number(write.value) }
      else if (write.field === 'finalChecked') {
        next = {
          ...next,
          // Seconds, like every other timestamp the server writes. The exact
          // moment is never shown; only whether it is set.
          finalCheckedAt: write.value ? Math.floor(write.at / 1000) : null,
        }
      } else if (write.field === 'bag') {
        const bag = (write.value as ChecklistEntry['bag']) ?? null
        // A queued bag is Alex's choice, exactly as it would be once it lands —
        // otherwise the row would read as a recommendation until it synced.
        next = { ...next, bag, bagSource: bag === null ? null : 'user' }
      }
    }
    return next
  })
}

/* ------------------------------------------------------------------ */
/* replay                                                              */
/* ------------------------------------------------------------------ */

let replaying = false

/*
 * Whether this page load has had a session CONFIRMED by the server.
 *
 * The optimistic first render (P1b) is deliberately allowed to show the app
 * before the session check answers, on the strength of a localStorage flag. That
 * is the right trade for READING a cached trip. It is the wrong basis for
 * sending writes: a device whose cookie expired overnight would otherwise fire
 * a queued PATCH before anything had established that the session still exists.
 *
 * The server would refuse it — every replay is an ordinary guarded request, and
 * a 401 ends the session — so this is not what makes the queue safe. It is what
 * keeps the app from acting on a session it has not yet been told it has.
 *
 * Deliberately module state and NOT storage: it must not survive a reload, so
 * every page load earns it again.
 */
let sessionConfirmed = false

/** Called once the server has answered that this session is real. */
export function allowReplay(): void {
  sessionConfirmed = true
}

/** Called by `lock()`, on every path that ends a session. */
export function denyReplay(): void {
  sessionConfirmed = false
}

export function replayAllowed(): boolean {
  return sessionConfirmed
}

function resolveKeys(keys: Set<string>, session: string): void {
  writeAll(readAll().filter((write) => !(write.session === session && keys.has(write.key))))
}

function markFailure(keys: Set<string>, session: string, failure: QueueFailure | null): void {
  writeAll(
    readAll().map((write) =>
      write.session === session && keys.has(write.key)
        ? { ...write, failure, attempts: write.attempts + 1 }
        : write,
    ),
  )
}

interface EntryGroup {
  tripId: string
  entryId: string
  writes: QueuedWrite[]
  /** The earliest tap in the group; the whole queue is replayed in this order. */
  at: number
}

/** One PATCH per row, in the order the taps happened. */
function groupForReplay(writes: QueuedWrite[]): EntryGroup[] {
  const groups = new Map<string, EntryGroup>()
  for (const write of writes) {
    const group = groups.get(write.entryId)
    if (group) {
      group.writes.push(write)
      group.at = Math.min(group.at, write.at)
    } else {
      groups.set(write.entryId, {
        tripId: write.tripId,
        entryId: write.entryId,
        writes: [write],
        at: write.at,
      })
    }
  }
  // A stable tiebreak, so two taps inside one millisecond replay in the same
  // order every time rather than in whatever order the map was built.
  return [...groups.values()].sort((a, b) => a.at - b.at || a.entryId.localeCompare(b.entryId))
}

function patchFor(group: EntryGroup, conditional: boolean): EntryPatch {
  const patch: EntryPatch = {}
  for (const write of group.writes) {
    if (write.field === 'packedQty') patch.packedQty = Number(write.value)
    else if (write.field === 'finalChecked') patch.finalChecked = Boolean(write.value)
    else if (write.field === 'bag') patch.bag = (write.value as string | null) ?? null
  }
  /*
   * The oldest version any of these was made against — but only among the ones
   * that HAVE a version.
   *
   * A `baseUpdatedAt` of 0 means "unknown", which is what a row written before
   * `updated_at` was surfaced reads as. Including it in the minimum would send
   * `ifUnmodifiedSince: 0`, and every row on earth has been written since 0, so
   * the whole patch would come back 409 forever.
   */
  const versions = group.writes.map((write) => write.baseUpdatedAt).filter((at) => at > 0)
  if (conditional && versions.length > 0) patch.ifUnmodifiedSince = Math.min(...versions)
  return patch
}

/**
 * Sends everything the current session has queued, oldest row first.
 *
 * Stops at the first sign that the network or the server is not ready, rather
 * than working through the rest and collecting the same failure a dozen times.
 * The next reconnect starts again from the front.
 */
export async function replay(): Promise<void> {
  if (replaying || !sessionConfirmed) return
  const session = sessionId()
  if (!session) {
    // No session — anything still here belongs to one that has ended.
    if (readAll().length > 0) clearQueue()
    return
  }

  const ready = readAll().filter((write) => write.session === session && write.failure === null)
  if (ready.length === 0) return

  replaying = true
  /*
   * Whether the screen's idea of the list is now out of date — which a FAILURE
   * changes just as much as a success does. A conflicted write stops being
   * applied by `applyPending` the moment it is marked, so the rows have to be
   * refetched or they keep showing a value that is no longer claimed.
   */
  let changed = false
  try {
    for (const group of groupForReplay(ready)) {
      /*
       * Checked again here, not only at the top.
       *
       * Sign-out is one tap and each of these is a round trip, so the session
       * can end between the trigger and this request. Without this the queue
       * would keep sending on behalf of a session Alex has closed.
       */
      if (sessionId() !== session) return

      const keys = new Set(group.writes.map((write) => write.key))
      const conditional = group.writes.some((write) => write.baseUpdatedAt > 0)
      try {
        await patchEntry(group.tripId, group.entryId, patchFor(group, conditional))
        resolveKeys(keys, session)
        changed = true
      } catch (cause) {
        if (!(cause instanceof ApiRequestError)) {
          // Never reached the server. Still offline; keep everything and stop.
          return
        }
        if (cause.status === 401) {
          // The session is over. `lock()` empties the queue; doing it here as
          // well would race the same removal for no gain.
          return
        }
        if (cause.status === 409) {
          markFailure(keys, session, { kind: 'conflict', message: cause.message })
          changed = true
          continue
        }
        if (cause.status >= 500) {
          const attempts = Math.max(...group.writes.map((write) => write.attempts)) + 1
          const givenUp = attempts >= MAX_ATTEMPTS
          markFailure(
            keys,
            session,
            givenUp ? { kind: 'permanent', message: 'Pack Smart could not save this.' } : null,
          )
          if (givenUp) changed = true
          return
        }
        markFailure(keys, session, { kind: 'permanent', message: cause.message })
        changed = true
      }
    }
  } finally {
    replaying = false
    if (changed) window.dispatchEvent(new CustomEvent(REPLAYED_EVENT))
  }
}

/* ------------------------------------------------------------------ */
/* resolving a failure                                                 */
/* ------------------------------------------------------------------ */

/**
 * Alex's answer to a conflict: send it anyway, unconditionally.
 *
 * Deliberately drops `ifUnmodifiedSince` — the condition existed to stop the
 * app deciding on its own, and he has now decided. Anything else would refuse
 * the same write a second time and offer him the same question.
 */
export async function retryWrite(key: string): Promise<void> {
  const session = sessionId()
  if (!session) return
  const writes = readAll().filter((write) => write.session === session && write.key === key)
  const first = writes[0]
  if (!first) return

  const group: EntryGroup = {
    tripId: first.tripId,
    entryId: first.entryId,
    writes,
    at: first.at,
  }
  const keys = new Set([key])
  try {
    await patchEntry(group.tripId, group.entryId, patchFor(group, false))
    resolveKeys(keys, session)
    window.dispatchEvent(new CustomEvent(REPLAYED_EVENT))
  } catch (cause) {
    markFailure(
      keys,
      session,
      cause instanceof ApiRequestError
        ? { kind: 'permanent', message: cause.message }
        : { kind: 'permanent', message: 'Pack Smart still could not reach the server.' },
    )
  }
}

/** Alex's other answer: keep what the server has, and forget what he tapped. */
export function discardWrite(key: string): void {
  const session = sessionId()
  if (!session) return
  resolveKeys(new Set([key]), session)
  window.dispatchEvent(new CustomEvent(REPLAYED_EVENT))
}

export function discardAllFailures(): void {
  const session = sessionId()
  if (!session) return
  resolveKeys(
    new Set(unresolvedWrites().map((write) => write.key)),
    session,
  )
  window.dispatchEvent(new CustomEvent(REPLAYED_EVENT))
}

/* ------------------------------------------------------------------ */
/* the queue-aware write                                               */
/* ------------------------------------------------------------------ */

/**
 * Saves it, or remembers it until there is signal.
 *
 * The queue is reached only when the request never arrived — a server that
 * answered has decided, and a refusal must still be shown rather than retried
 * later behind Alex's back.
 */
export async function patchEntryOrQueue(
  entry: ChecklistEntry,
  patch: EntryPatch,
): Promise<{ entry: ChecklistEntry; queued: boolean }> {
  try {
    return { entry: await patchEntry(entry.tripId, entry.id, patch), queued: false }
  } catch (cause) {
    const reachedServer = cause instanceof ApiRequestError
    if (reachedServer || !isQueueablePatch(patch) || !enqueue(entry, patch)) throw cause
    // The queue holds it now, so the overlay is the row Alex should be looking
    // at — the same one a reload would produce.
    return { entry: applyPending([entry])[0] ?? entry, queued: true }
  }
}
