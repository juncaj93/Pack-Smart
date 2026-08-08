// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ApiModule from '@/lib/api'
import type { ChecklistEntry } from '@shared/checklist'

/**
 * The narrow offline write queue (F2).
 *
 * The whole slice, measured here rather than through a screen, because every
 * question that matters is about the QUEUE — what it holds, what order it sends
 * it in, whose session it belongs to, and what it does when the server
 * disagrees. A DOM test would prove the tick renders and take all of that on
 * trust.
 *
 * Two things this file is deliberately strict about:
 *
 * 1. **Every test fails against the defect it names.** The mutations are
 *    recorded beside the groups they break, in doc 09.
 * 2. **The session guard is tested from both ends** — that a record from an
 *    ended session is not sent, AND that a session ending mid-replay stops the
 *    rest of it. One without the other is a queue that only looks safe.
 */

const UNLOCKED_KEY = 'pack-smart:unlocked-before'
const SESSION_ID_KEY = 'pack-smart:session-id'
const STORAGE_KEY = 'pack-smart:pending-writes'

const patchEntry = vi.fn()

vi.mock('@/lib/trips', () => ({
  patchEntry: (...args: unknown[]) => patchEntry(...args),
}))

/**
 * A fresh module graph, which is how "the app was closed and reopened" is
 * spelled — and the reason `ApiRequestError` is re-imported with it.
 *
 * `vi.resetModules()` gives the queue a NEW copy of `@/lib/api`, so an error
 * built from a class imported at the top of this file would not be an
 * `instanceof` the class the queue is comparing against. It would look exactly
 * like a request that never reached the server, and every "the server answered"
 * test would silently be testing the offline path instead.
 */
let apiModule: typeof ApiModule

async function loadQueue({ confirmed = true } = {}) {
  vi.resetModules()
  apiModule = await import('@/lib/api')
  const queue = await import('@/lib/writeQueue')
  // `App` calls this once the server has answered that the session is real.
  // Every test below is about a signed-in app, except the one that is not.
  if (confirmed) queue.allowReplay()
  return queue
}

function entry(over: Partial<ChecklistEntry> = {}): ChecklistEntry {
  return {
    id: 'e1',
    tripId: 't1',
    itemId: 'i1',
    name: 'Sunscreen',
    detail: null,
    category: 'Toiletries',
    requiredQty: 1,
    qtyBreakdown: null,
    qtyOverride: null,
    packedQty: 0,
    packingTiming: 'anytime',
    requiresFinalCheck: false,
    finalCheckedAt: null,
    excludedAt: null,
    source: 'rule',
    reason: null,
    isCritical: false,
    tripOnly: false,
    sortOrder: 0,
    bag: null,
    bagSource: null,
    updatedAt: 100,
    ...over,
  }
}

function stored(): Array<Record<string, unknown>> {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : []
}

/** The request never arrived. Anything else means the server answered. */
function offline() {
  patchEntry.mockRejectedValue(new TypeError('Failed to fetch'))
}

function refused(status: number, code = 'bad_request', message = 'no') {
  // The call history is reset with the behaviour: the interesting count is
  // always how many requests the REPLAY made, never how many the setup did.
  patchEntry.mockClear()
  patchEntry.mockRejectedValue(
    new apiModule.ApiRequestError(status, { code: code as never, message }),
  )
}

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(UNLOCKED_KEY, '1')
  window.localStorage.setItem(SESSION_ID_KEY, 'session-a')
  patchEntry.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

/* ------------------------------------------------------------------ */

describe('what may be queued', () => {
  it('keeps a pack, an unpack, a final check and a bag when the request never arrives', async () => {
    const queue = await loadQueue()
    offline()

    for (const patch of [
      { packedQty: 1 },
      { packedQty: 0 },
      { finalChecked: true },
      { bag: 'carry_on' },
    ]) {
      const result = await queue.patchEntryOrQueue(entry(), patch)
      expect(result.queued).toBe(true)
    }

    expect(stored().map((write) => write.field).sort()).toEqual([
      'bag',
      'finalChecked',
      'packedQty',
    ])
  })

  it('refuses to queue a plan edit, offline or not', async () => {
    const queue = await loadQueue()
    offline()

    // Both are absolute values on one row and BOTH are still refused: they feed
    // regeneration, and they are made at a desk rather than beside a suitcase.
    await expect(queue.patchEntryOrQueue(entry(), { qtyOverride: 3 })).rejects.toThrow()
    await expect(
      queue.patchEntryOrQueue(entry(), { packingTiming: 'day_of' }),
    ).rejects.toThrow()

    expect(stored()).toHaveLength(0)
  })

  it('refuses a mixed patch outright rather than queueing half of it', async () => {
    const queue = await loadQueue()
    offline()

    await expect(
      queue.patchEntryOrQueue(entry(), { packedQty: 1, qtyOverride: 3 }),
    ).rejects.toThrow()
    expect(stored()).toHaveLength(0)
  })

  it('does not queue anything the server actually answered', async () => {
    const queue = await loadQueue()
    refused(400)

    await expect(queue.patchEntryOrQueue(entry(), { packedQty: 1 })).rejects.toThrow(
      apiModule.ApiRequestError,
    )
    // A refusal is a decision. Retrying it later behind Alex's back is how a
    // checklist quietly stops matching the bag.
    expect(stored()).toHaveLength(0)
  })
})

describe('desired state, not a log of taps', () => {
  it('collapses repeated taps on one row and field to a single record', async () => {
    const queue = await loadQueue()
    offline()

    for (const packedQty of [1, 0, 1, 0, 1]) {
      await queue.patchEntryOrQueue(entry(), { packedQty })
    }

    const records = stored()
    expect(records).toHaveLength(1)
    // The value Alex last chose, not the middle of a sequence he has moved past.
    expect(records[0]?.value).toBe(1)
  })

  it('keeps the version the FIRST tap was made against', async () => {
    const queue = await loadQueue()
    offline()

    await queue.patchEntryOrQueue(entry({ updatedAt: 100 }), { packedQty: 1 })
    // A later tap sees the same stale cached row; nothing has refreshed it.
    await queue.patchEntryOrQueue(entry({ updatedAt: 100, packedQty: 1 }), { packedQty: 0 })

    expect(stored()[0]?.baseUpdatedAt).toBe(100)
  })

  it('keeps two fields on one row as two records that replay as one request', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })
    await queue.patchEntryOrQueue(entry({ packedQty: 1 }), { bag: 'checked' })
    expect(stored()).toHaveLength(2)

    patchEntry.mockReset()
    patchEntry.mockResolvedValue(entry({ packedQty: 1, bag: 'checked' }))
    await queue.replay()

    expect(patchEntry).toHaveBeenCalledTimes(1)
    expect(patchEntry.mock.calls[0]?.[2]).toMatchObject({ packedQty: 1, bag: 'checked' })
  })

  it('replays several rows oldest first', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-05T09:00:00Z'))
    const queue = await loadQueue()
    offline()

    await queue.patchEntryOrQueue(entry({ id: 'second' }), { packedQty: 1 })
    vi.setSystemTime(new Date('2026-08-05T08:00:00Z'))
    await queue.patchEntryOrQueue(entry({ id: 'first' }), { packedQty: 1 })
    vi.useRealTimers()

    patchEntry.mockReset()
    patchEntry.mockResolvedValue(entry())
    await queue.replay()

    expect(patchEntry.mock.calls.map((call) => call[1])).toEqual(['first', 'second'])
  })
})

describe('replay', () => {
  it('sends everything and empties the queue when the server accepts it', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry({ id: 'a' }), { packedQty: 1 })
    await queue.patchEntryOrQueue(entry({ id: 'b' }), { finalChecked: true })

    patchEntry.mockReset()
    patchEntry.mockResolvedValue(entry())
    await queue.replay()

    expect(patchEntry).toHaveBeenCalledTimes(2)
    expect(stored()).toHaveLength(0)
    expect(queue.pendingEntryIds().size).toBe(0)
  })

  it('sends no condition at all for a row whose version is unknown', async () => {
    const queue = await loadQueue()
    offline()
    // A row read before `updatedAt` was surfaced, which reads as 0.
    await queue.patchEntryOrQueue(entry({ updatedAt: 0 }), { packedQty: 1 })

    patchEntry.mockReset()
    patchEntry.mockResolvedValue(entry())
    await queue.replay()

    /*
     * `ifUnmodifiedSince: 0` would be refused forever — every row has been
     * written since 0 — so an unknown version means unconditional rather than
     * impossible.
     */
    expect(patchEntry.mock.calls[0]?.[2]).not.toHaveProperty('ifUnmodifiedSince')
  })

  it('ignores an unknown version when another field on the row has a real one', async () => {
    const queue = await loadQueue()
    offline()
    // Two fields on one row, read at different times — one before `updatedAt`
    // existed on the response, one after.
    await queue.patchEntryOrQueue(entry({ updatedAt: 0 }), { packedQty: 1 })
    await queue.patchEntryOrQueue(entry({ updatedAt: 900 }), { bag: 'checked' })

    patchEntry.mockReset()
    patchEntry.mockResolvedValue(entry())
    await queue.replay()

    // The minimum across BOTH would be 0, and `updated_at > 0` is true of every
    // row that exists — so the whole patch would 409 for ever.
    expect(patchEntry.mock.calls[0]?.[2]).toMatchObject({ ifUnmodifiedSince: 900 })
  })

  it('sends the version it was made against, so a newer row cannot be overwritten', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry({ updatedAt: 4242 }), { packedQty: 1 })

    patchEntry.mockReset()
    patchEntry.mockResolvedValue(entry())
    await queue.replay()

    expect(patchEntry.mock.calls[0]?.[2]).toMatchObject({ ifUnmodifiedSince: 4242 })
  })

  it('survives the app being closed and reopened', async () => {
    const first = await loadQueue()
    offline()
    await first.patchEntryOrQueue(entry(), { packedQty: 1 })

    // A fresh module graph, holding no in-memory state at all — which is what a
    // relaunch actually is.
    const second = await loadQueue()
    expect(second.pendingEntryIds().has('e1')).toBe(true)

    patchEntry.mockReset()
    patchEntry.mockResolvedValue(entry({ packedQty: 1 }))
    await second.replay()
    expect(patchEntry).toHaveBeenCalledTimes(1)
    expect(stored()).toHaveLength(0)
  })

  it('is a no-op with nothing queued, however often it is triggered', async () => {
    const queue = await loadQueue()
    patchEntry.mockResolvedValue(entry())
    await queue.replay()
    await queue.replay()
    expect(patchEntry).not.toHaveBeenCalled()
  })

  it('does not throw away a newer tap that arrived while it was sending', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-05T09:00:00Z'))
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })

    patchEntry.mockReset()
    patchEntry.mockImplementation(async () => {
      /*
       * Flaky wifi: good enough for the replay to go out, not good enough for
       * the tap Alex makes while it is in the air. Resolving by key alone would
       * discard his newer intent because an older request happened to land.
       */
      vi.setSystemTime(new Date('2026-08-05T09:00:05Z'))
      const failing = new TypeError('Failed to fetch')
      const before = patchEntry.getMockImplementation()
      patchEntry.mockRejectedValueOnce(failing)
      await queue.patchEntryOrQueue(entry({ packedQty: 1 }), { packedQty: 0 }).catch(() => {})
      patchEntry.mockImplementation(before!)
      return entry({ packedQty: 1 })
    })
    await queue.replay()
    vi.useRealTimers()

    const remaining = stored()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.value).toBe(0)
  })

  it('keeps a write it still cannot send, and stops rather than working through the rest', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry({ id: 'a' }), { packedQty: 1 })
    await queue.patchEntryOrQueue(entry({ id: 'b' }), { packedQty: 1 })

    patchEntry.mockClear()
    await queue.replay()

    expect(patchEntry).toHaveBeenCalledTimes(1)
    expect(stored()).toHaveLength(2)
    // Still ordinary pending, not a failure Alex is asked about: there is
    // nothing for him to decide while there is no signal.
    expect(queue.unresolvedWrites()).toHaveLength(0)
  })
})

describe('a row that moved on the server', () => {
  it('does not apply the offline change, and asks instead', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })

    refused(409, 'conflict', 'This changed somewhere else since you did.')
    await queue.replay()

    const unresolved = queue.unresolvedWrites()
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]?.failure?.kind).toBe('conflict')
    // It is no longer claimed as "saved on this phone" — it is claimed as
    // something Alex has to answer.
    expect(queue.pendingEntryIds().has('e1')).toBe(false)
  })

  it('is not retried on its own — a conflict does not resolve itself', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })
    refused(409, 'conflict', 'changed')
    await queue.replay()

    patchEntry.mockClear()
    await queue.replay()
    expect(patchEntry).not.toHaveBeenCalled()
  })

  it('sends it unconditionally when Alex says use mine', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })
    refused(409, 'conflict', 'changed')
    await queue.replay()

    patchEntry.mockReset()
    patchEntry.mockResolvedValue(entry({ packedQty: 1 }))
    await queue.retryWrite('e1:packedQty')

    // The condition existed to stop the app deciding on its own. He has decided.
    expect(patchEntry.mock.calls[0]?.[2]).not.toHaveProperty('ifUnmodifiedSince')
    expect(stored()).toHaveLength(0)
  })

  it('forgets it when Alex keeps the newer one', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })
    refused(409, 'conflict', 'changed')
    await queue.replay()

    patchEntry.mockClear()
    queue.discardWrite('e1:packedQty')

    expect(stored()).toHaveLength(0)
    expect(patchEntry).not.toHaveBeenCalled()
  })
})

describe('failures that are not conflicts', () => {
  it('asks about a write the server refused outright', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })

    refused(404, 'bad_request', 'No such checklist item.')
    await queue.replay()

    const unresolved = queue.unresolvedWrites()
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]?.failure?.kind).toBe('permanent')
    expect(unresolved[0]?.failure?.message).toBe('No such checklist item.')
  })

  it('keeps retrying a server error, until it has tried enough times to say so', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })

    refused(500, 'internal', 'boom')
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await queue.replay()
      // Still ordinary pending: a server having a bad minute is not Alex's
      // problem to solve.
      expect(queue.unresolvedWrites()).toHaveLength(0)
    }

    await queue.replay()
    expect(queue.unresolvedWrites()).toHaveLength(1)
    expect(queue.unresolvedWrites()[0]?.failure?.kind).toBe('permanent')
  })

  it('lets Alex clear them all at once', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry({ id: 'a' }), { packedQty: 1 })
    await queue.patchEntryOrQueue(entry({ id: 'b' }), { packedQty: 1 })
    refused(400, 'bad_request', 'no')
    await queue.replay()
    expect(queue.unresolvedWrites()).toHaveLength(2)

    queue.discardAllFailures()
    expect(stored()).toHaveLength(0)
  })
})

describe('before the server has confirmed the session', () => {
  it('queues, but sends nothing', async () => {
    const queue = await loadQueue({ confirmed: false })
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })

    patchEntry.mockClear()
    patchEntry.mockResolvedValue(entry())
    await queue.replay()

    /*
     * The optimistic first render (P1b) shows the app on a localStorage flag,
     * before anything has established that the cookie is still good. Showing a
     * cached trip on that basis is the accepted trade; SENDING on it is not.
     */
    expect(patchEntry).not.toHaveBeenCalled()
    expect(stored()).toHaveLength(1)

    queue.allowReplay()
    await queue.replay()
    expect(patchEntry).toHaveBeenCalledTimes(1)
  })

  it('stops sending again the moment the session ends', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })

    queue.denyReplay()
    patchEntry.mockClear()
    patchEntry.mockResolvedValue(entry())
    await queue.replay()

    expect(patchEntry).not.toHaveBeenCalled()
  })
})

describe('the session it belongs to', () => {
  it('is emptied when the session ends', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })
    expect(stored()).toHaveLength(1)

    queue.clearQueue()

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(queue.pendingWrites()).toHaveLength(0)
  })

  it('will not replay a record left by an earlier session', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })

    // Signed out and back in: same device, same storage, different session.
    window.localStorage.setItem(SESSION_ID_KEY, 'session-b')

    patchEntry.mockClear()
    await queue.replay()

    expect(patchEntry).not.toHaveBeenCalled()
    expect(queue.pendingWrites()).toHaveLength(0)
    expect(queue.pendingEntryIds().size).toBe(0)
  })

  it('will not replay anything at all once the device is signed out', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })

    // What `lock()` leaves behind if the queue clear somehow did not run: no
    // marker, and no unlock flag to mint one from.
    window.localStorage.removeItem(SESSION_ID_KEY)
    window.localStorage.removeItem(UNLOCKED_KEY)

    patchEntry.mockClear()
    await queue.replay()

    expect(patchEntry).not.toHaveBeenCalled()
    // And the orphan is removed rather than left on the device.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('stops mid-replay when the session ends between two requests', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry({ id: 'a' }), { packedQty: 1 })
    await queue.patchEntryOrQueue(entry({ id: 'b' }), { packedQty: 1 })

    patchEntry.mockReset()
    patchEntry.mockImplementation(async () => {
      // Sign out lands while the first request is in the air.
      window.localStorage.removeItem(SESSION_ID_KEY)
      window.localStorage.removeItem(UNLOCKED_KEY)
      return entry()
    })
    await queue.replay()

    expect(patchEntry).toHaveBeenCalledTimes(1)
  })

  it('stops when the server says the session is over', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry({ id: 'a' }), { packedQty: 1 })
    await queue.patchEntryOrQueue(entry({ id: 'b' }), { packedQty: 1 })

    refused(401, 'unauthorized', 'Sign in again.')
    await queue.replay()

    // One request, and no failure recorded — `lock()` is about to empty the
    // whole queue, and asking Alex to resolve a write from a session that has
    // ended would be asking the wrong question.
    expect(patchEntry).toHaveBeenCalledTimes(1)
    expect(queue.unresolvedWrites()).toHaveLength(0)
  })
})

describe('the overlay over what the server last said', () => {
  it('keeps offline packing visible when the cached list arrives without it', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })

    // Exactly what `sw.js` serves from cache after a restart: the row as it was
    // before Alex ever tapped it.
    const [row] = queue.applyPending([entry({ packedQty: 0 })])
    expect(row?.packedQty).toBe(1)
  })

  it('shows a queued bag as the choice Alex made, not as a suggestion', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { bag: 'personal' })

    const [row] = queue.applyPending([entry({ bag: null, bagSource: null })])
    expect(row?.bag).toBe('personal')
    expect(row?.bagSource).toBe('user')
  })

  it('marks a final check, and clears it again', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { finalChecked: true })
    expect(queue.applyPending([entry()])[0]?.finalCheckedAt).not.toBeNull()

    await queue.patchEntryOrQueue(entry(), { finalChecked: false })
    expect(queue.applyPending([entry({ finalCheckedAt: 99 })])[0]?.finalCheckedAt).toBeNull()
  })

  it('stops applying a write once it has failed', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })
    refused(409, 'conflict', 'changed')
    await queue.replay()

    /*
     * The server's value is the true one now, and Alex is being asked about it.
     * A row still showing his value with no "saved on this phone" beside it is
     * the silent failure the whole slice exists to avoid.
     */
    const [row] = queue.applyPending([entry({ packedQty: 0 })])
    expect(row?.packedQty).toBe(0)
  })

  it('asks the screen to refetch when a write fails, not only when one lands', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry(), { packedQty: 1 })

    const replayed = vi.fn()
    window.addEventListener(queue.REPLAYED_EVENT, replayed)
    refused(409, 'conflict', 'changed')
    await queue.replay()
    window.removeEventListener(queue.REPLAYED_EVENT, replayed)

    // Without this the rows keep showing a value nothing is claiming any more.
    expect(replayed).toHaveBeenCalledTimes(1)
  })

  it('leaves rows nobody touched exactly as they were', async () => {
    const queue = await loadQueue()
    offline()
    await queue.patchEntryOrQueue(entry({ id: 'touched' }), { packedQty: 1 })

    const untouched = entry({ id: 'untouched', packedQty: 0 })
    expect(queue.applyPending([untouched])[0]).toBe(untouched)
  })
})

describe('storage this app did not write', () => {
  it('ignores a record it cannot understand rather than throwing on launch', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { nonsense: true },
        'a string',
        {
          key: 'e1:packedQty',
          tripId: 't1',
          entryId: 'e1',
          entryName: 'Sunscreen',
          field: 'packedQty',
          value: 1,
          at: 1,
          baseUpdatedAt: 0,
          session: 'session-a',
          attempts: 0,
          failure: null,
        },
        // A field a future release might add, and this one must not act on.
        { key: 'x', tripId: 't', entryId: 'e', session: 'session-a', at: 1, field: 'name' },
      ]),
    )

    const queue = await loadQueue()
    expect(queue.pendingWrites()).toHaveLength(1)
  })

  it('survives storage being unavailable entirely', async () => {
    const queue = await loadQueue()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    offline()

    // Private browsing. The write cannot be remembered, so it is not claimed to
    // be — but nothing throws its way out to the screen either.
    await expect(queue.patchEntryOrQueue(entry(), { packedQty: 1 })).resolves.toBeDefined()
    vi.restoreAllMocks()
  })
})
