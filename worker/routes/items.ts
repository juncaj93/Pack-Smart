import { Hono } from 'hono'
import type { ItemInput, ItemListResponse } from '@shared/items'
import { isRating, validateItemInput } from '@shared/items'
import { canonicalise, isDressinessContext, type DressinessContext } from '@shared/dressiness'
import { isProvenancedField, type ProvenancedField } from '@shared/provenance'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import {
  archiveItem,
  clearFieldValue,
  confirmFields,
  countItems,
  createItem,
  distinctCategories,
  getItem,
  listItems,
  packedTripCounts,
  patchItem,
  restoreItem,
  revertFieldValue,
  updateItem,
} from '../repos/items'

export const itemRoutes = new Hono<AppBindings>()

/** Everything under here is already behind the session guard mounted in index.ts. */

itemRoutes.get('/', async (c) => {
  const includeArchived = c.req.query('archived') === 'true'
  const category = c.req.query('category') ?? undefined
  const search = c.req.query('search') ?? undefined

  const [items, categories, counts, packed] = await Promise.all([
    listItems(c.env.DB, { includeArchived, category, search }),
    distinctCategories(c.env.DB),
    countItems(c.env.DB),
    packedTripCounts(c.env.DB),
  ])

  return c.json<ItemListResponse>({
    items,
    categories,
    activeCount: counts.active,
    archivedCount: counts.archived,
    packedTripCounts: packed,
  })
})

itemRoutes.get('/:id', async (c) => {
  const item = await getItem(c.env.DB, c.req.param('id'))
  return item ? c.json(item) : c.json(apiError('bad_request', 'No such item.'), 404)
})

itemRoutes.post('/', async (c) => {
  let body: Partial<ItemInput>
  try {
    body = await c.req.json<Partial<ItemInput>>()
  } catch {
    return c.json(apiError('bad_request', 'Expected a JSON body.'), 400)
  }

  const validation = validateItemInput(body)
  if (!validation.ok) {
    return c.json(
      { error: { code: 'bad_request', message: 'Check the highlighted fields.' }, fields: validation.errors },
      400,
    )
  }

  const item = await createItem(c.env.DB, body as ItemInput, nowSeconds())
  return c.json(item, 201)
})

itemRoutes.put('/:id', async (c) => {
  let body: Partial<ItemInput>
  try {
    body = await c.req.json<Partial<ItemInput>>()
  } catch {
    return c.json(apiError('bad_request', 'Expected a JSON body.'), 400)
  }

  const validation = validateItemInput(body)
  if (!validation.ok) {
    return c.json(
      { error: { code: 'bad_request', message: 'Check the highlighted fields.' }, fields: validation.errors },
      400,
    )
  }

  const item = await updateItem(c.env.DB, c.req.param('id'), body as ItemInput, nowSeconds())
  return item ? c.json(item) : c.json(apiError('bad_request', 'No such item.'), 404)
})

/* ------------------------------------------------------------------ */
/* one answer at a time — what the review queue writes (H1d)           */
/* ------------------------------------------------------------------ */

/**
 * The fields a single tap may move, and deliberately only these four.
 *
 * `PUT` still owns the whole row and the editor still uses it. This door exists
 * for Review Closet Items, where Alex answers ONE question and the screen must
 * not send back a garment it never read — sending the whole row from a card
 * that only knows a comfort score is how the importer used to reset seven
 * columns nobody mentioned (H1a).
 *
 * A wide-open patch over every provenanced field would have been the smaller
 * diff. It would also have been an endpoint that can rewrite a category from a
 * screen that never shows one. Adding a field here is one line, on the day
 * something actually needs it.
 */
const PATCHABLE = new Set<ProvenancedField>([
  'comfort',
  'versatility',
  'dressinessContexts',
  'displayName',
])

interface PatchResult {
  patch: Partial<Record<ProvenancedField, unknown>>
  errors: Record<string, string>
}

/**
 * Reads a patch body, and treats PRESENCE as the whole question.
 *
 * `'comfort' in body` and `body.comfort === undefined` mean different things
 * here and the difference is load-bearing: a key that is present with `null` is
 * Alex CLEARING a rating, which H1b lists as one of the actions the feature was
 * asked for. A validator that only admitted values would have made clearing
 * quietly impossible, which is the trap `validateItemInput` had to avoid for
 * the same two fields.
 */
function readPatch(body: Record<string, unknown>): PatchResult {
  const patch: Partial<Record<ProvenancedField, unknown>> = {}
  const errors: Record<string, string> = {}

  for (const [key, value] of Object.entries(body)) {
    if (!isProvenancedField(key) || !PATCHABLE.has(key)) {
      errors[key] = 'That is not something this can change.'
      continue
    }

    if (key === 'comfort' || key === 'versatility') {
      if (value === null || isRating(value)) patch[key] = value
      else errors[key] = 'Ratings run from 1 to 5.'
      continue
    }

    if (key === 'dressinessContexts') {
      // An EMPTY array is legal: it is how *clear all* arrives (H1c).
      if (Array.isArray(value) && value.every(isDressinessContext)) {
        patch[key] = canonicalise(value as DressinessContext[])
      } else {
        errors[key] = 'That is not a situation Pack Smart knows.'
      }
      continue
    }

    // displayName. Never blank — the queue's *Apply* suggestion cannot produce
    // one, but nothing stops a client from trying.
    const name = typeof value === 'string' ? value.trim() : ''
    if (name.length === 0) errors[key] = 'Give this a name.'
    else if (name.length > 120) errors[key] = 'Keep the name under 120 characters.'
    else patch[key] = name
  }

  return { patch, errors }
}

itemRoutes.patch('/:id', async (c) => {
  let body: Record<string, unknown>
  try {
    body = await c.req.json<Record<string, unknown>>()
  } catch {
    return c.json(apiError('bad_request', 'Expected a JSON body.'), 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json(apiError('bad_request', 'Expected a JSON body.'), 400)
  }

  const { patch, errors } = readPatch(body)
  if (Object.keys(errors).length > 0) {
    return c.json(
      { error: { code: 'bad_request', message: 'Check the highlighted fields.' }, fields: errors },
      400,
    )
  }
  if (Object.keys(patch).length === 0) {
    return c.json(apiError('bad_request', 'Nothing to change.'), 400)
  }

  const { item, refused } = await patchItem(c.env.DB, c.req.param('id'), patch, nowSeconds())
  return item ? c.json({ item, refused }) : c.json(apiError('bad_request', 'No such item.'), 404)
})

/**
 * *Keep as is* — Alex confirms a value without editing it.
 *
 * The row's values do not move; only their authority does. From here the field
 * sits at `user_confirmed` and no import may write it, which is the whole
 * transaction the review queue offers on a name it decides is already right.
 */
itemRoutes.post('/:id/confirm', async (c) => {
  const body = await c.req.json<{ fields?: unknown }>().catch(() => ({}) as { fields?: unknown })
  const fields = Array.isArray(body.fields) ? body.fields.filter(isProvenancedField) : []
  if (fields.length === 0) {
    return c.json(apiError('bad_request', 'Say which fields to confirm.'), 400)
  }

  const item = await confirmFields(c.env.DB, c.req.param('id'), fields, nowSeconds())
  return item ? c.json(item) : c.json(apiError('bad_request', 'No such item.'), 404)
})

/**
 * *Use the value from my spreadsheet* — G5's *Use the default*, for a field.
 *
 * Restores the one superseded value AND the source that wrote it, so the field
 * is genuinely back under that source's authority and a later import may write
 * it again. This is the *Use spreadsheet value* action on a disagreement card,
 * and it is the reason that card needs no storage of its own.
 */
itemRoutes.post('/:id/revert', async (c) => {
  const body = await c.req.json<{ field?: unknown }>().catch(() => ({}) as { field?: unknown })
  if (!isProvenancedField(body.field)) {
    return c.json(apiError('bad_request', 'Say which field to put back.'), 400)
  }

  const item = await revertFieldValue(c.env.DB, c.req.param('id'), body.field, nowSeconds())
  return item ? c.json(item) : c.json(apiError('bad_request', 'No such item.'), 404)
})

/**
 * Clearing one field on purpose, and the absence is itself confirmed.
 *
 * Separate from `PATCH … null` because it is a different sentence: PATCH says
 * *the answer is now nothing*, which is what the rating controls send, and this
 * says the same thing for a field whose type has no null in the patch reader.
 * Both land on `user_confirmed` holding nothing, which is what stops the next
 * import refilling it.
 */
itemRoutes.post('/:id/clear', async (c) => {
  const body = await c.req.json<{ field?: unknown }>().catch(() => ({}) as { field?: unknown })
  if (!isProvenancedField(body.field)) {
    return c.json(apiError('bad_request', 'Say which field to clear.'), 400)
  }

  const item = await clearFieldValue(c.env.DB, c.req.param('id'), body.field, nowSeconds())
  return item ? c.json(item) : c.json(apiError('bad_request', 'No such item.'), 404)
})

/**
 * Archive rather than delete.
 *
 * There is deliberately no DELETE endpoint: product doc 05 §11 makes archive the
 * normal retirement path so historical trips keep resolving, and
 * 02_DATA_MODEL.md §1 makes "nothing is ever deleted" a structural rule.
 */
itemRoutes.post('/:id/archive', async (c) => {
  const item = await archiveItem(c.env.DB, c.req.param('id'), nowSeconds())
  return item ? c.json(item) : c.json(apiError('bad_request', 'No such item.'), 404)
})

itemRoutes.post('/:id/restore', async (c) => {
  const item = await restoreItem(c.env.DB, c.req.param('id'), nowSeconds())
  return item ? c.json(item) : c.json(apiError('bad_request', 'No such item.'), 404)
})
