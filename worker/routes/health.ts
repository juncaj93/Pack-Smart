import { Hono } from 'hono'
import type { HealthResponse } from '@shared/types'
import type { AppBindings } from '../env'

export const healthRoutes = new Hono<AppBindings>()

/**
 * Liveness plus a real D1 read.
 *
 * Counting applied migrations rather than returning a constant means a Worker
 * that deployed with a broken or unmigrated database binding fails loudly here
 * instead of at the first product query.
 */
healthRoutes.get('/', async (c) => {
  try {
    const row = await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM d1_migrations',
    ).first<{ count: number }>()

    return c.json<HealthResponse>({
      ok: true,
      database: 'ok',
      migrationsApplied: row?.count ?? 0,
    })
  } catch {
    return c.json<HealthResponse>({ ok: false, database: 'unavailable', migrationsApplied: 0 }, 503)
  }
})
