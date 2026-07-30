import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Light, Dark, and the way back to System.
 *
 * The sun/moon in the header is a **two-state toggle over a three-state
 * preference**: tapping it picks the theme that is not showing and stores it
 * explicitly, so the first tap leaves `system` behind for good. That is
 * deliberate — a choice that silently reverted the next time the phone changed
 * would be worse than no control at all — and it is precisely why Settings has to
 * offer the third state. Without it the header button is a one-way door.
 *
 * The two controls are the same preference wearing two shapes, and they are both
 * reachable in the same session, so most of this file is about them agreeing.
 */

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

async function unlock(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
}

const theme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-theme'))

test.describe('choosing an appearance', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
    await page.goto('/settings')
    await expect(page.getByRole('radiogroup', { name: 'Appearance' })).toBeVisible()
  })

  test('offers exactly System, Light and Dark', async ({ page }) => {
    const group = page.getByRole('radiogroup', { name: 'Appearance' })
    await expect(group.getByRole('radio')).toHaveCount(3)
    for (const label of ['System', 'Light', 'Dark']) {
      await expect(group.getByRole('radio', { name: label })).toBeVisible()
    }
  })

  test('applies a choice immediately, and it survives a reload', async ({ page }) => {
    await page.getByRole('radio', { name: 'Dark' }).click()
    expect(await theme(page)).toBe('dark')

    /*
     * The reload is the assertion that matters. Applying a theme to a live page is
     * one line; carrying it across a launch means it was stored AND read back
     * before the first paint, which is what stops the app flashing the wrong
     * colour every time Alex opens it.
     */
    await page.reload()
    expect(await theme(page)).toBe('dark')
    await expect(page.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('radio', { name: 'Light' }).click()
    expect(await theme(page)).toBe('light')
    await page.reload()
    expect(await theme(page)).toBe('light')
  })

  test('System follows the phone, and says that is what it will do', async ({ page }) => {
    await page.getByRole('radio', { name: 'Dark' }).click()
    expect(await theme(page)).toBe('dark')

    // The way back out of an explicit choice, which the header toggle cannot offer.
    await page.getByRole('radio', { name: 'System' }).click()
    await expect(page.getByText('Follows your phone, changing with it.')).toBeVisible()

    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    expect(await theme(page)).toBe('dark')

    await page.emulateMedia({ colorScheme: 'light' })
    await page.reload()
    expect(await theme(page)).toBe('light')

    // Still System — following the phone is not the same as having been changed.
    await expect(page.getByRole('radio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  test('the header toggle and the setting are one preference, not two', async ({ page }) => {
    /*
     * Both are on this screen at once. They each used to read storage on mount and
     * never again, so changing one left the other showing the previous answer —
     * the moon still offering "switch to dark" after Settings had switched to
     * dark.
     */
    await page.getByRole('radio', { name: 'Dark' }).click()
    await expect(page.getByRole('button', { name: 'Switch to light appearance' })).toBeVisible()

    await page.getByRole('button', { name: 'Switch to light appearance' }).click()
    expect(await theme(page)).toBe('light')
    await expect(page.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  test('the toolbar colour follows the theme', async ({ page }) => {
    /*
     * Without this, Safari's status bar and toolbar stay the colour of the theme
     * the phone is in while the page is the other one — the seam that makes a web
     * app look like a web app, and the one thing here a screenshot of the page
     * cannot catch.
     */
    const toolbar = () =>
      page.evaluate(
        () =>
          document
            .querySelector('meta[name="theme-color"]:not([media])')
            ?.getAttribute('content') ?? null,
      )

    await page.getByRole('radio', { name: 'Dark' }).click()
    const dark = await toolbar()

    await page.getByRole('radio', { name: 'Light' }).click()
    const light = await toolbar()

    expect(dark).toBeTruthy()
    expect(light).toBeTruthy()
    expect(dark).not.toBe(light)
  })
})
