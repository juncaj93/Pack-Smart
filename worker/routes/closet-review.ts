import { Hono } from 'hono'
import { buildReviewQueue, type ReviewDecision, type ReviewQueue } from '@shared/closet-review'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import { listDecisions, recordDecision, reopenNotSure, reviewSignals } from '../repos/closet-review'
import { archiveItem, getItem, listItems, packedTripCounts } from '../repos/items'

export const closetReviewRoutes = new Hono<AppBindings>()

/**
 * Review Closet Items (H1d). Mounted under /api/closet-review.
 *
 * `GET` returns the WHOLE queue, not the next card, and that is the
 * responsiveness decision rather than a convenience. A card-at-a-time endpoint
 * would put a round trip between every tap and the next question — which is
 * precisely the architecture P1A spent a release taking out of the outfit
 * picker, where "the menu takes too long to return me" turned out to be the
 * interaction waiting on persistence. The wardrobe is ~119 rows; the whole
 * queue is the same order of payload My Stuff already fetches on open, and it
 * buys a screen where Save-and-next never touches the network to advance.
 *
 * The writes are somewhere else on purpose. Rating a garment is
 * `PATCH /api/items/:id`, confirming a name is `POST /api/items/:id/confirm`,
 * and putting a spreadsheet value back is `POST /api/items/:id/revert` — all of
 * them doors that existed for the catalog and are unchanged by this screen.
 * Only the DECISIONS that are not edits land here, because only they have
 * nowhere else to live.
 */

closetReviewRoutes.get('/', async (c) => {
  const [items, packed] = await Promise.all([
    // Archived rows are excluded by `buildReviewQueue` rather than by the query,
    // so the exclusion is stated once, in the module that owns the rules.
    listItems(c.env.DB, { includeArchived: false }),
    packedTripCounts(c.env.DB),
  ])

  const [signals, decisions] = await Promise.all([
    reviewSignals(c.env.DB, packed),
    listDecisions(c.env.DB),
  ])

  return c.json<ReviewQueue>(buildReviewQueue({ items, signals, decisions }))
})

const DECISIONS: ReviewDecision[] = ['answered', 'not_sure', 'skipped']

function isDecision(value: unknown): value is ReviewDecision {
  return typeof value === 'string' && (DECISIONS as string[]).includes(value)
}

/**
 * Skip, Not sure, and every *keep what I have* answer.
 *
 * One endpoint for all three because they are one decision with three values,
 * and splitting them would let a future change teach one path something the
 * other two never learned — the same argument `routes/review.ts` makes for
 * accept and decline.
 */
closetReviewRoutes.post('/decisions', async (c) => {
  const body = await c.req
    .json<{ itemId?: unknown; topic?: unknown; decision?: unknown }>()
    .catch(() => ({}) as Record<string, unknown>)

  const itemId = typeof body.itemId === 'string' ? body.itemId : ''
  const topic = typeof body.topic === 'string' ? body.topic.trim() : ''

  if (!itemId || !topic || !isDecision(body.decision)) {
    return c.json(apiError('bad_request', 'Say which question, and what you decided.'), 400)
  }
  /*
   * The topic is free-form TEXT — it carries an item id or a field name — so it
   * is capped rather than checked against a list. A length limit is the honest
   * guard for a value whose shape is owned by `shared/closet-review.ts`; a
   * regular expression here would be a second, weaker copy of that vocabulary.
   */
  if (topic.length > 120) {
    return c.json(apiError('bad_request', 'That is not a question Pack Smart asked.'), 400)
  }

  // The foreign key would catch this, but a 404 says something a 500 does not.
  const item = await getItem(c.env.DB, itemId)
  if (!item) return c.json(apiError('bad_request', 'No such item.'), 404)

  await recordDecision(c.env.DB, itemId, topic, body.decision, nowSeconds())
  return c.json({ ok: true })
})

/**
 * *Ask me again about the ones I was not sure about.*
 *
 * The escape hatch that makes *Not sure* safe to offer. Without it, one
 * uncertain tap retires a question permanently, and a queue that can lose a
 * question is not one to trust with a closet.
 */
closetReviewRoutes.post('/reopen', async (c) => {
  const reopened = await reopenNotSure(c.env.DB)
  return c.json({ reopened })
})

/**
 * *Same item* — and the honest answer about what that can safely do today.
 *
 * Merging two rows is H1e, and doc 09 §8.0 puts it AFTER this slice for a
 * reason: a merge has to preserve packing history, outfit history, checklist
 * references, provenance, ratings, capabilities, learning evidence and archive
 * state, and none of that is proven yet. §7's ruling is explicit — "do not
 * delete either record until merge is proven", and deferring is an acceptable
 * outcome.
 *
 * So this archives the copy Alex did not keep, which is the strongest thing
 * that is provably safe. Archiving is the retirement path this whole schema was
 * built around: the row survives, every trip and outfit pointing at it still
 * resolves, past trips still show it, and `POST /api/items/:id/restore` undoes
 * it completely. Nothing is merged and nothing is lost — Alex simply stops
 * being offered the duplicate.
 */
closetReviewRoutes.post('/archive-duplicate', async (c) => {
  const body = await c.req
    .json<{ keepItemId?: unknown; archiveItemId?: unknown }>()
    .catch(() => ({}) as Record<string, unknown>)

  const keepItemId = typeof body.keepItemId === 'string' ? body.keepItemId : ''
  const archiveItemId = typeof body.archiveItemId === 'string' ? body.archiveItemId : ''

  if (!keepItemId || !archiveItemId || keepItemId === archiveItemId) {
    return c.json(apiError('bad_request', 'Say which one to keep and which to archive.'), 400)
  }

  const [keep, drop] = await Promise.all([
    getItem(c.env.DB, keepItemId),
    getItem(c.env.DB, archiveItemId),
  ])
  if (!keep || !drop) return c.json(apiError('bad_request', 'No such item.'), 404)

  const now = nowSeconds()
  const archived = await archiveItem(c.env.DB, archiveItemId, now)

  /*
   * Both sides of the pair are recorded as settled, and both are needed.
   *
   * The archived row leaves the queue on its own — `buildReviewQueue` drops
   * archived items — but the KEPT one would still see a duplicate group of one
   * and, if a third copy exists, be asked about this pair again. Recording the
   * decision against the survivor is what makes the answer stick.
   */
  await Promise.all([
    recordDecision(c.env.DB, keepItemId, `duplicate:${archiveItemId}`, 'answered', now),
    recordDecision(c.env.DB, archiveItemId, `duplicate:${keepItemId}`, 'answered', now),
  ])

  return c.json({ archived })
})
