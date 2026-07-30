import { Hono } from 'hono'
import type { ItemInput, ItemListResponse } from '@shared/items'
import { validateItemInput } from '@shared/items'
import { apiError, nowSeconds } from '../auth'
import type { AppBindings } from '../env'
import {
  archiveItem,
  countItems,
  createItem,
  distinctCategories,
  getItem,
  listItems,
  packedTripCounts,
  restoreItem,
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
