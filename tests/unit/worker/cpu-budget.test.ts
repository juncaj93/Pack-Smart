import { describe, expect, it } from 'vitest'
import {
  MAX_VERIFY_ITERATIONS,
  createPassphraseHash,
  derivePassphraseHash,
  fromBase64Url,
  parsePassphraseHash,
} from '@shared/crypto'

/**
 * Pins the login path to the Cloudflare Workers free plan's CPU budget.
 *
 * The first deployed version used 210,000 PBKDF2 iterations — correct for a
 * password database, and roughly 106 ms of CPU. The free plan allows 10 ms per
 * request, so the runtime killed every login before any handler could respond
 * and the app showed a generic failure with nothing to act on.
 *
 * Nothing caught it: the unit tests run in Node with no CPU ceiling, and the
 * Playwright suite exercises a local dev server that has none either. Neither
 * runs in a metered workerd isolate. These tests are the cheap standing guard;
 * `@cloudflare/vitest-pool-workers` (deferred at M0) is the thorough one.
 */

/** Cloudflare Workers free plan, per invocation. */
const FREE_PLAN_CPU_BUDGET_MS = 10

/**
 * Keep well clear of the ceiling: CI runners and Workers isolates are slower and
 * more variable than a developer machine, and the derivation is not the only
 * work in the request.
 */
const DERIVATION_BUDGET_MS = FREE_PLAN_CPU_BUDGET_MS / 2

describe('login CPU budget', () => {
  it('derives a passphrase hash well inside the free-plan budget', async () => {
    const stored = await createPassphraseHash('a-representative-passphrase')
    const salt = fromBase64Url(stored.salt)

    const measure = async () => {
      const started = performance.now()
      await derivePassphraseHash('a-representative-passphrase', salt, stored.iterations)
      return performance.now() - started
    }

    // Warm up, then take the FASTEST of several runs.
    //
    // A single wall-clock reading here measures whatever else the machine is
    // doing: this assertion flaked at 7-15ms while the other eight test files
    // ran in parallel, against ~1.3ms unloaded. The best-of-N is the cost the
    // code can actually achieve, which is what the budget is about — and it
    // still catches the regression this test exists for, since 210,000
    // iterations costs ~106ms even completely unloaded.
    await measure()
    const samples = [await measure(), await measure(), await measure(), await measure()]
    const fastest = Math.min(...samples)

    expect(
      fastest,
      `fastest of ${samples.length} derivations was ${fastest.toFixed(1)}ms ` +
        `(samples: ${samples.map((s) => s.toFixed(1)).join(', ')}); the free plan ` +
        `allows ${FREE_PLAN_CPU_BUDGET_MS}ms for the entire request`,
    ).toBeLessThan(DERIVATION_BUDGET_MS)
  })

  it('caps the iterations a stored hash may request', () => {
    expect(MAX_VERIFY_ITERATIONS).toBeLessThanOrEqual(20_000)
  })

  it('rejects a stored hash too expensive to verify, rather than crashing on it', () => {
    // Exactly the secret the first deploy shipped with.
    const legacy = JSON.stringify({
      algorithm: 'pbkdf2-sha256',
      iterations: 210_000,
      salt: 'AAAAAAAAAAAAAAAAAAAAAA',
      hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    })

    // null routes to `not_configured`, which tells the user to re-run the setup
    // script — instead of the request being killed with no explanation.
    expect(parsePassphraseHash(legacy)).toBeNull()
  })

  it('rejects a nonsensical iteration count', () => {
    const withIterations = (iterations: number) =>
      JSON.stringify({
        algorithm: 'pbkdf2-sha256',
        iterations,
        salt: 'AAAAAAAAAAAAAAAAAAAAAA',
        hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      })

    expect(parsePassphraseHash(withIterations(0))).toBeNull()
    expect(parsePassphraseHash(withIterations(-1))).toBeNull()
  })

  it('still accepts a hash at the current cost', async () => {
    const stored = await createPassphraseHash('another-passphrase-entirely')
    expect(parsePassphraseHash(JSON.stringify(stored))).not.toBeNull()
  })
})
