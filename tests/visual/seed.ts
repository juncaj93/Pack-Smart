import { request, type FullConfig } from '@playwright/test'

/**
 * Seeds representative data, then saves one signed-in session for the whole run.
 *
 * Delegates the data to `scripts/seed-demo.mjs` rather than reimplementing it: one
 * seeding path means the screens a reviewer looks at are the same ones a developer
 * sees after `npm run seed:demo`, and a divergence between the two cannot quietly
 * appear. Importing the script runs it — it is idempotent by trip name.
 *
 * The saved session matters for more than speed. Signing in inside every spec put
 * a race in front of every screenshot — `goto('/')` resolves before React has
 * decided whether to show Unlock or the shell, so a test could look for the
 * navigation while the passphrase field was still on its way. Authenticating once
 * here removes that question from twelve specs.
 */
export const STORAGE_STATE = '.visual/state.json'

export default async function seed(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL
  if (baseURL) process.env.SEED_BASE_URL = baseURL

  // A plain Node script with no types of its own. The import is the whole point —
  // running it IS the seeding — so there is nothing to type.
  await import(/* @vite-ignore */ '../../scripts/seed-demo.mjs' as string)

  const context = await request.newContext({ baseURL })
  const response = await context.post('/api/auth/login', {
    data: { passphrase: process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase' },
  })
  if (!response.ok()) throw new Error(`visual: sign-in answered ${response.status()}`)

  await context.storageState({ path: STORAGE_STATE })
  await context.dispose()
}
