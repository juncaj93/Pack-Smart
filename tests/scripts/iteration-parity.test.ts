import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_VERIFY_ITERATIONS } from '@shared/crypto'

/**
 * The PBKDF2 cost is written in three places: the Worker's verifier and the two
 * setup scripts that produce secrets for it. They must agree.
 *
 * They already drifted once. When the Worker dropped to 2,000 iterations,
 * write-dev-vars.mjs kept generating 210,000 — so the local development secret
 * was rejected by the very guard added alongside it, and both `npm run dev` and
 * the whole Playwright suite would have failed to log in. Nothing connected the
 * two files, so nothing complained.
 */
function iterationsIn(path: string): number {
  const source = readFileSync(path, 'utf8')
  const match = source.match(/const PBKDF2_ITERATIONS = ([\d_]+)/)
  if (!match?.[1]) throw new Error(`no PBKDF2_ITERATIONS found in ${path}`)
  return Number(match[1].replace(/_/g, ''))
}

describe('PBKDF2 iteration parity', () => {
  const shared = iterationsIn('shared/crypto.ts')

  it('hash-passphrase.mjs matches the Worker', () => {
    expect(iterationsIn('scripts/hash-passphrase.mjs')).toBe(shared)
  })

  it('write-dev-vars.mjs matches the Worker', () => {
    expect(iterationsIn('scripts/write-dev-vars.mjs')).toBe(shared)
  })

  it('the shared value stays under the verifier cap', () => {
    // Otherwise the app would reject the secrets its own scripts produce.
    expect(shared).toBeLessThanOrEqual(MAX_VERIFY_ITERATIONS)
    expect(shared).toBeGreaterThan(0)
  })
})
