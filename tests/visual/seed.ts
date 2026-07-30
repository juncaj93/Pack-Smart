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

  /*
   * The seed has to have produced a real wardrobe, and nothing else here checks.
   *
   * A migration that seeds a few canonical rows tripped `seed-demo`'s
   * "already populated" guard, so a clean run imported none of the 119 garments —
   * and the visual suite photographed a six-item wardrobe in which every outfit
   * was necessarily incomplete, then reported twenty passes. Every gate is about
   * geometry; not one of them can tell a full closet from an empty one.
   *
   * This is the same rule the empty-state captures learned (`AUTONOMY.md` §8): if
   * the evidence cannot fail, it is not evidence. Failing here rather than in a
   * spec makes the whole run stop, which is right — every screenshot after this
   * point would be of the wrong product.
   */
  const items = (await (await context.get('/api/items')).json()) as { activeCount?: number }
  if ((items.activeCount ?? 0) < 100) {
    throw new Error(
      `visual: the wardrobe holds ${items.activeCount ?? 0} items — the workbook did not import, ` +
        'so every screenshot from this run would be of a product Alex does not have.',
    )
  }

  await context.storageState({ path: STORAGE_STATE })
  await context.dispose()
}
