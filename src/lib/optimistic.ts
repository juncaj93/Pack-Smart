import { useRef } from 'react'

/**
 * The P1A guard, extracted so a second screen can have it without a second
 * implementation of it (H1d).
 *
 * `useSlotChoice` proved this shape on the outfit picker: apply the change
 * locally, return control immediately, persist behind it, and apply the reply
 * ONLY IF nothing newer has happened since. Measured there before it was
 * changed — `PUT /slots/:slotId` spends 82% of its work after the write the
 * choice actually needs, so tap-to-closed scaled linearly with latency: 155 ms
 * on a desk, 1368 ms at 1000 ms RTT.
 *
 * Rating a garment in Review Closet Items has exactly the same shape and
 * exactly the same failure mode, so it gets exactly the same mechanism rather
 * than a second async pattern that has to be reasoned about separately. That
 * was the brief's instruction and it is also the honest engineering answer:
 * two implementations of "ignore a stale reply" is two places for the guard to
 * be subtly wrong.
 *
 * ## Why a ticket, and not a `busy` flag
 *
 * The entry-sheet defect this release fixed is the pattern being avoided: a
 * reply that landed after the sheet closed called `setDetail(entry)` and put
 * the sheet back. A `busy` flag would not have caught it, because the problem
 * is not concurrency — it is a stale reply arriving after the state it
 * describes has moved on. Blocking the second tap would also have been the
 * wrong fix: Alex tapping 3 then 4 must end on 4, not be told to wait.
 *
 * So every edit takes a number, and a reply is applied only while its number is
 * still the newest for its key:
 *
 * - two rapid taps settle on the second, whichever reply arrives first;
 * - a slow success cannot overwrite a newer value;
 * - a slow FAILURE cannot roll back a newer successful edit — it is dropped,
 *   because rolling back would undo something Alex did afterwards;
 * - a reply for a card he has already moved past changes nothing on screen.
 *
 * **Latest user intent wins**, deliberately above request ordering.
 *
 * ## The ticket alone was not enough, and a slow network proved it
 *
 * The guard above protects the SCREEN. It does not protect the DATABASE, and
 * for a while nothing did. Measured, in a real browser with every rating write
 * held open for 1500 ms: ticking two dressiness contexts in quick succession
 * put both requests in flight at once, they completed out of order, and the
 * OLDER one landed last — so the card showed `Loungewear, Casual, Smart casual`
 * while D1 held `Loungewear, Casual`. The screen was right, the row was wrong,
 * and a reload would have silently taken the tick away.
 *
 * That is a lost write, and §8.1's rule is explicit that fast must still be
 * correct. So writes for one key are now **serialised**: at most one is in
 * flight, and an edit made while one is running becomes the PENDING edit,
 * replacing any earlier pending one. When the in-flight write settles, the
 * pending edit goes out.
 *
 * Coalescing is safe here because every write this hook carries is **absolute**
 * — *set comfort to 4*, *set this slot to that garment* — never a delta. Three
 * rapid taps therefore produce two requests, not three, and the second one
 * carries the third tap's value. Dropping the middle request is not losing an
 * edit; it is declining to spend a round trip on a value Alex has already
 * replaced.
 *
 * One honest limitation, stated rather than hidden: if the in-flight write
 * fails AND the pending write then fails too, the screen keeps the newer value
 * while the row keeps the older one. Both failures are reported through
 * `onError`, and the next load reconciles. Holding a shadow copy of the last
 * known-persisted value to roll back to would be a second model of the row,
 * maintained for a case that needs two consecutive network failures.
 *
 * ## Why the ticket has a KEY
 *
 * `useSlotChoice` keeps one counter for the whole picker, because there the
 * unit of intent is *the outfit* — a rollback restores the groups it captured,
 * and a partial rollback of one slot would be wrong once the server's reply is
 * the authority on the rest.
 *
 * A review card is the other case. Comfort, versatility and the dressiness
 * contexts are three independent answers about one garment, and a failed
 * comfort write must roll back comfort alone — undoing a versatility rating
 * Alex gave a second later would be the same defect class in miniature. One
 * counter per key gives each answer its own timeline; passing a constant key
 * gives back the single-counter behaviour, which is what the picker does.
 */
export interface OptimisticEdit<T> {
  /** Show it now. Runs synchronously, before anything is sent. */
  apply: () => void
  /** Send it. */
  persist: () => Promise<T>
  /** The server's answer, applied only while this edit is still the newest. */
  settle?: (result: T) => void
  /** Put it back, only while this edit is still the newest AND it failed. */
  rollback: () => void
  /** Told only about a failure that was still current. */
  onError?: () => void
}

export interface OptimisticWriter {
  /**
   * Runs one edit. Returns immediately — the caller never awaits persistence,
   * which is the entire point.
   */
  <T>(key: string, edit: OptimisticEdit<T>): void
}

export function useOptimisticWrite(): OptimisticWriter {
  /*
   * A ref rather than state, and a Map rather than an object.
   *
   * The counter must be readable AFTER an await, where a captured state value
   * is whatever it was when the request started — the same reason `App`'s
   * `ended` latch is a ref. Nothing here should ever cause a render: a ticket
   * is bookkeeping about a request, not something on screen.
   */
  const tickets = useRef(new Map<string, number>())
  /** Keys with a request out. At most one per key, which is the whole point. */
  const running = useRef(new Set<string>())
  /** The one edit waiting behind it. A newer edit REPLACES it rather than queueing. */
  const pending = useRef(new Map<string, () => void>())

  function send<T>(key: string, edit: OptimisticEdit<T>, mine: number): void {
    running.current.add(key)
    const current = () => tickets.current.get(key) === mine

    void edit
      .persist()
      .then((result) => {
        if (!current()) return
        edit.settle?.(result)
      })
      .catch(() => {
        if (!current()) return
        edit.rollback()
        edit.onError?.()
      })
      .finally(() => {
        running.current.delete(key)
        const next = pending.current.get(key)
        if (next) {
          pending.current.delete(key)
          next()
        }
      })
  }

  return function write<T>(key: string, edit: OptimisticEdit<T>): void {
    const mine = (tickets.current.get(key) ?? 0) + 1
    tickets.current.set(key, mine)

    /*
     * The local update happens NOW, in every case — including while an earlier
     * write is still in flight. Serialising the requests must not serialise the
     * interaction; that would be the blocking UI this whole hook exists to
     * remove, arriving through the back door.
     */
    edit.apply()

    if (running.current.has(key)) {
      pending.current.set(key, () => send(key, edit, mine))
      return
    }

    send(key, edit, mine)
  }
}
