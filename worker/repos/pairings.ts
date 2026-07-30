import type { PairingIndex } from '@shared/outfits'

/**
 * Which garments Alex has approved together (product doc 04 §5 criterion 3).
 *
 * The only place a per-trip action writes lasting catalog state, which is why
 * `CLAUDE.md`'s "permanent preference changes must be explicit" applies and why
 * every write here has an exact inverse — the UI offers Undo, and un-approving
 * an outfit forgets what approving it taught.
 */

/**
 * Canonical pair ordering: the lower id first, always.
 *
 * One row per pair however it is looked up. Storing both directions would let
 * the two halves disagree, and nothing would notice until a recommendation came
 * out wrong.
 */
function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

/**
 * Map key for an already-ordered pair.
 *
 * Separated by U+0000, written as an escape rather than a literal so this file
 * stays plain text. An id cannot contain a NUL, so unlike a space or a dash the
 * two halves can never run together into a key that means something else.
 */
function key(a: string, b: string): string {
  return `${a}\u0000${b}`
}

/** Every distinct unordered pair among the garments in one outfit. */
function pairsOf(itemIds: string[]): Array<[string, string]> {
  // De-duplicated first: a garment worn twice in one outfit (two wearings of the
  // same shirt) is still one garment, and must not pair with itself or count
  // double.
  const unique = [...new Set(itemIds)]
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      pairs.push(orderPair(unique[i]!, unique[j]!))
    }
  }
  return pairs
}

/** The garments in an outfit group. Empty slots contribute nothing. */
async function itemsInGroup(db: D1Database, groupId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT item_id FROM outfit_slot WHERE outfit_group_id = ? AND item_id IS NOT NULL')
    .bind(groupId)
    .all<{ item_id: string }>()
  return results.map((row) => row.item_id)
}

/**
 * Records that everything in this outfit was approved together.
 *
 * Callers must only invoke this on a genuine draft -> approved transition.
 * Re-approving an already-approved outfit would otherwise inflate the counts
 * without Alex having done anything new.
 */
export async function rememberGroup(
  db: D1Database,
  groupId: string,
  now: number,
): Promise<number> {
  const pairs = pairsOf(await itemsInGroup(db, groupId))
  if (pairs.length === 0) return 0

  await db.batch(
    pairs.map(([a, b]) =>
      db
        .prepare(
          `INSERT INTO outfit_pairing (item_a_id, item_b_id, times_approved, last_approved_at)
           VALUES (?, ?, 1, ?)
           ON CONFLICT (item_a_id, item_b_id) DO UPDATE
             SET times_approved   = times_approved + 1,
                 last_approved_at = excluded.last_approved_at`,
        )
        .bind(a, b, now),
    ),
  )

  return pairs.length
}

/**
 * The exact inverse of `rememberGroup`.
 *
 * Used by un-approve and by Undo. Rows reaching zero are deleted: a count of
 * zero and an absent row mean the same thing, and this table records a current
 * belief rather than history, so Rule 2 ("nothing is ever deleted") is not in
 * play — no trip loses anything.
 *
 * `MAX(0, ...)` rather than trusting the count, so a double undo cannot drive a
 * pair negative and quietly invert its meaning.
 */
export async function forgetGroup(db: D1Database, groupId: string): Promise<number> {
  const pairs = pairsOf(await itemsInGroup(db, groupId))
  if (pairs.length === 0) return 0

  await db.batch(
    pairs.map(([a, b]) =>
      db
        .prepare(
          `UPDATE outfit_pairing SET times_approved = MAX(0, times_approved - 1)
           WHERE item_a_id = ? AND item_b_id = ?`,
        )
        .bind(a, b),
    ),
  )

  await db.prepare('DELETE FROM outfit_pairing WHERE times_approved <= 0').run()

  return pairs.length
}

/**
 * Loads the whole pairing table into memory for one planning run.
 *
 * One read rather than a query per candidate per slot: ranking touches every
 * surviving garment for every slot of every group, and the Worker has a 10ms CPU
 * budget. The table holds one row per approved garment pair — for a single
 * user's wardrobe that is small enough that paging it would cost more than it
 * saved.
 */
export async function loadPairings(db: D1Database): Promise<PairingIndex> {
  const { results } = await db
    .prepare('SELECT item_a_id, item_b_id, times_approved FROM outfit_pairing')
    .all<{ item_a_id: string; item_b_id: string; times_approved: number }>()

  const counts = new Map<string, number>()
  for (const row of results) {
    counts.set(key(row.item_a_id, row.item_b_id), row.times_approved)
  }

  return {
    count(a, b) {
      if (a === b) return 0 // A garment is not paired with itself.
      const [lo, hi] = orderPair(a, b)
      return counts.get(key(lo, hi)) ?? 0
    },
  }
}
