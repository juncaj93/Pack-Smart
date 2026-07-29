import { execFileSync } from 'node:child_process'

/**
 * Prepares the local environment the e2e run needs:
 *   1. a `.dev.vars` with a known development passphrase (never overwritten)
 *   2. the D1 migrations applied to the local database
 *
 * Both are idempotent, so repeated runs are safe.
 */
export default function globalSetup() {
  execFileSync('node', ['scripts/write-dev-vars.mjs'], { stdio: 'inherit' })
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'migrations', 'apply', 'pack-smart', '--local'],
    { stdio: 'inherit' },
  )
}
