import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

function uniqueName(prefix: string) {
  return `${prefix} ${Math.floor(performance.now())}`
}

/**
 * Waits until the shell is genuinely cached, not merely until a worker exists.
 *
 * `controller` being set says a worker is in charge; it says nothing about
 * whether precaching has finished. Cutting the network in that window fails the
 * navigation outright, which looks like a broken feature but is really the test
 * jumping the gun.
 */
async function serviceWorkerReady(page: Page) {
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration?.active || !navigator.serviceWorker.controller) return false

      const names = await caches.keys()
      const shell = names.find((name) => name.startsWith('pack-smart-shell'))
      if (!shell) return false

      const cache = await caches.open(shell)
      const keys = await cache.keys()
      const paths = keys.map((request) => new URL(request.url).pathname)

      // index.html plus the hashed script and stylesheet it needs to run.
      return (
        paths.includes('/') &&
        paths.some((path) => path.endsWith('.js')) &&
        paths.some((path) => path.endsWith('.css'))
      )
    },
    undefined,
    { timeout: 30_000 },
  )
}

/**
 * Offline reads of the active trip are non-negotiable for v1
 * (01_ARCHITECTURE.md §5). These run in a real browser with the network cut,
 * because a service worker cannot be meaningfully unit-tested.
 */
test.describe('offline', () => {
  test('the trip stays readable with the network cut', async ({ page, context }) => {
    const name = uniqueName('E2E Offline')

    await page.goto('/')
    await page.getByLabel('Passphrase').fill(PASSPHRASE)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await serviceWorkerReady(page)

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Trip name').fill(name)
    await sheet.getByLabel('Destination').fill('Cape Town')
    await sheet.getByLabel('Leaving').fill('2026-07-31')
    await sheet.getByLabel('Returning').fill('2026-08-11')
    await sheet.getByRole('button', { name: 'Create trip' }).click()

    await expect(page.getByRole('heading', { name })).toBeVisible()
    const url = page.url()
    await expect(page.locator('.check-main').first()).toBeVisible()
    const itemsWhileOnline = await page.locator('.check-name').count()

    // Cut the network entirely, then reload from scratch.
    await context.setOffline(true)
    await page.reload()

    // The shell loads from the cache, the trip is readable, and the app says so.
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.check-name')).toHaveCount(itemsWhileOnline)
    await expect(page.getByText(/Offline — showing what you last saw/)).toBeVisible()

    expect(page.url()).toBe(url)
    await context.setOffline(false)
  })

  test('a trip never opened offline says so rather than looking empty', async ({ page, context }) => {
    await page.goto('/')
    await page.getByLabel('Passphrase').fill(PASSPHRASE)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await serviceWorkerReady(page)

    // Navigate inside the running app rather than cold-loading a URL: this is
    // the real case — Pack Smart is already open and you tap a trip you have
    // not looked at since losing signal.
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible()

    await context.setOffline(true)
    await page.goto('/trips/a-trip-that-was-never-loaded', { waitUntil: 'commit' }).catch(() => {})
    await page.evaluate(() => {
      window.history.pushState({}, '', '/trips/a-trip-that-was-never-loaded')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    // An honest failure, not a screen that reads as "this trip has nothing in it".
    await expect(page.getByText(/Could not load that trip|offline/i).first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('button', { name: 'Back to trips' })).toBeVisible()

    await context.setOffline(false)
  })
})
