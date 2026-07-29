import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

function uniqueName(prefix: string) {
  return `${prefix} ${Math.floor(performance.now())}`
}

/** Waits for the service worker to be installed and controlling the page. */
async function serviceWorkerReady(page: Page) {
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    return Boolean(registration?.active) && Boolean(navigator.serviceWorker.controller)
  }, undefined, { timeout: 20_000 })
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

    await context.setOffline(true)
    await page.goto('/trips/a-trip-that-was-never-loaded')

    // An honest failure, not a screen that reads as "this trip has nothing in it".
    await expect(page.getByText(/Could not load that trip|offline/i).first()).toBeVisible({
      timeout: 15_000,
    })
    await context.setOffline(false)
  })
})
