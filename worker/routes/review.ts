import { Hono } from 'hono'
import type { ReviewAnswerKind } from '@shared/review'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import {
  addAnswer,
  deleteAnswer,
  duplicateAnswer,
  finishReview,
  getAnswer,
  resolveAnswer,
  reviewView,
  type NewAnswer,
} from '../repos/review'
import { getTrip } from '../repos/trips'

export const reviewRoutes = new Hono<AppBindings>()

/**
 * The post-trip review (F1). Mounted under /api/trips/:id/review.
 *
 * One resource, five verbs, and one of them is the whole screen: `GET` returns
 * the summary, the answers, the proposals AND the three pickers, because the
 * performance contract holds every screen but Home to a single serial round
 * trip and a picker fetched on open would be a second one at the moment Alex
 * taps a question.
 *
 * Accept and decline are one endpoint rather than two. They are one decision
 * with two values, and splitting them would let a future change teach one path
 * something the other never learned.
 */

const KINDS: ReviewAnswerKind[] = [
  'forgot',
  'ran_out',
  'too_many',
  'outfit_wrong',
  'missing_from_screen',
]

function isKind(value: unknown): value is ReviewAnswerKind {
  return typeof value === 'string' && (KINDS as string[]).includes(value)
}

/** Trimmed, capped, and empty-as-null. A blank note is not a note. */
function readNote(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().slice(0, 500)
  return text.length > 0 ? text : null
}

reviewRoutes.get('/', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  return c.json(await reviewView(c.env.DB, trip))
})

reviewRoutes.post('/answers', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const body = await c.req
    .json<{ kind?: unknown; itemId?: unknown; outfitGroupId?: unknown; note?: unknown }>()
    .catch(() => ({}) as Record<string, never>)

  if (!isKind(body.kind)) return c.json(apiError('bad_request', 'Say which question this answers.'), 400)

  const answer: NewAnswer = {
    kind: body.kind,
    itemId: typeof body.itemId === 'string' ? body.itemId : null,
    outfitGroupId: typeof body.outfitGroupId === 'string' ? body.outfitGroupId : null,
    note: readNote(body.note),
  }

  /*
   * An answer that names nothing says nothing.
   *
   * `missing_from_screen` is the note-only question, so it needs the note; the
   * other four are about a thing, and a thing is either something Alex owns or
   * something he typed the name of.
   */
  if (answer.kind === 'missing_from_screen') {
    if (!answer.note) return c.json(apiError('bad_request', 'Say what was missing.'), 400)
    answer.itemId = null
    answer.outfitGroupId = null
  } else if (answer.kind === 'outfit_wrong') {
    if (!answer.outfitGroupId) return c.json(apiError('bad_request', 'Pick which outfit.'), 400)
    answer.itemId = null
  } else if (!answer.itemId && !answer.note) {
    return c.json(apiError('bad_request', 'Pick something, or type what it was.'), 400)
  }

  /*
   * The referenced row has to exist and has to belong here.
   *
   * A `note` survives anything; an id that names nothing would produce a
   * proposal about a blank, and an outfit id from a different trip would let
   * one trip's review forget another trip's pairings.
   */
  if (answer.itemId) {
    const item = await c.env.DB.prepare('SELECT id FROM item WHERE id = ? AND archived_at IS NULL')
      .bind(answer.itemId)
      .first<{ id: string }>()
    if (!item) return c.json(apiError('bad_request', 'Pick something you own.'), 400)
  }

  if (answer.outfitGroupId) {
    const group = await c.env.DB.prepare('SELECT id FROM outfit_group WHERE id = ? AND trip_id = ?')
      .bind(answer.outfitGroupId, trip.id)
      .first<{ id: string }>()
    if (!group) return c.json(apiError('bad_request', 'That outfit is not on this trip.'), 400)
  }

  if (await duplicateAnswer(c.env.DB, trip.id, answer)) {
    return c.json(apiError('bad_request', 'You have already said that about this trip.'), 409)
  }

  await addAnswer(c.env.DB, trip.id, answer, nowSeconds())
  return c.json(await reviewView(c.env.DB, trip), 201)
})

/**
 * Accept or decline one proposal.
 *
 * The change is re-derived here rather than taken from the request. The screen
 * holds a proposal it was given some seconds ago, and in between Alex may have
 * changed the very rule it is about in another tab — applying what the screen
 * remembers would write a number nothing had recomputed. Deriving it again
 * means an accept always applies the proposal as it is NOW, or applies nothing
 * because there is nothing left to apply.
 */
reviewRoutes.patch('/answers/:answerId', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const body = await c.req.json<{ resolution?: unknown }>().catch(() => ({}) as Record<string, never>)
  if (body.resolution !== 'accepted' && body.resolution !== 'declined') {
    return c.json(apiError('bad_request', 'Say yes or no to this one.'), 400)
  }

  const answer = await getAnswer(c.env.DB, trip.id, c.req.param('answerId')!)
  if (!answer) return c.json(apiError('bad_request', 'That answer is no longer there.'), 404)

  // Already decided. Answering twice would apply the change twice — two spares
  // for one shortfall, or a second decrement of a pairing count.
  if (answer.resolution !== 'pending') {
    return c.json(apiError('bad_request', 'You have already answered that one.'), 409)
  }

  const view = await reviewView(c.env.DB, trip)
  const proposal = view.proposals.find((p) => p.answerId === answer.id)
  if (!proposal) return c.json(apiError('bad_request', 'That answer is no longer there.'), 404)

  await resolveAnswer(c.env.DB, answer, proposal, body.resolution)

  return c.json(await reviewView(c.env.DB, trip))
})

/** Undo a mis-tap, while it is still undecided. */
reviewRoutes.delete('/answers/:answerId', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const removed = await deleteAnswer(c.env.DB, trip.id, c.req.param('answerId')!)
  if (!removed) {
    /*
     * Either it was never there or it has been accepted, and the second is the
     * one worth a sentence: a change has already been written from it, and
     * quietly dropping the row would leave a learned rule with nothing on
     * screen explaining where it came from. Packing rules is where it is undone.
     */
    return c.json(
      apiError('bad_request', 'That one has already been used. You can change it in Packing rules.'),
      409,
    )
  }

  return c.json(await reviewView(c.env.DB, trip))
})

/**
 * Ends the sitting.
 *
 * Available from the first frame and never gated on the questions — the review
 * must not block, and a Finish button that appears only once every proposal has
 * been answered is a block wearing a different word. Outstanding proposals
 * simply stay outstanding; nothing is applied by finishing.
 */
reviewRoutes.post('/finish', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  if (!trip) return c.json(apiError('bad_request', 'No such trip.'), 404)

  const reviewedAt = await finishReview(c.env.DB, trip.id, nowSeconds())
  return c.json(await reviewView(c.env.DB, { ...trip, reviewedAt }))
})
