import type { ThrottleState } from '@shared/rate-limit'

/**
 * A minimal in-memory stand-in for the D1 binding.
 *
 * Only the three statements the M0 Worker actually issues are supported, and it
 * throws loudly on anything else so a new query cannot silently no-op in tests.
 * Real D1 behaviour is covered by `wrangler d1 migrations apply --local` and the
 * end-to-end run, not by this fake.
 */
export interface FakeD1 {
  binding: D1Database
  throttle: ThrottleState | null
  migrationCount: number
  failEverything: boolean
}

export function createFakeD1(): FakeD1 {
  const state: FakeD1 = {
    throttle: null,
    migrationCount: 1,
    failEverything: false,
    binding: undefined as unknown as D1Database,
  }

  function prepare(sql: string) {
    let bound: unknown[] = []

    const statement = {
      bind(...args: unknown[]) {
        bound = args
        return statement
      },

      async first<T>(): Promise<T | null> {
        if (state.failEverything) throw new Error('D1 unavailable')

        if (sql.includes('FROM d1_migrations')) {
          return { count: state.migrationCount } as T
        }

        if (sql.includes('FROM auth_throttle')) {
          if (!state.throttle) return null
          return {
            failure_count: state.throttle.failureCount,
            window_started_at: state.throttle.windowStartedAt,
            locked_until: state.throttle.lockedUntil,
          } as T
        }

        throw new Error(`fake-d1: unsupported query: ${sql}`)
      },

      async run() {
        if (state.failEverything) throw new Error('D1 unavailable')

        if (sql.includes('INSERT INTO auth_throttle')) {
          const [, failureCount, windowStartedAt, lockedUntil] = bound as [
            string,
            number,
            number,
            number,
          ]
          state.throttle = { failureCount, windowStartedAt, lockedUntil }
          return { success: true }
        }

        throw new Error(`fake-d1: unsupported statement: ${sql}`)
      },
    }

    return statement
  }

  state.binding = { prepare } as unknown as D1Database
  return state
}
