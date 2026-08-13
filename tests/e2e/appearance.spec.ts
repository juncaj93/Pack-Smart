import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Light, Dark, and System — one control, in Settings.
 *
 * There were two: a three-state radio group here and a two-state sun/moon in
 * every page header. The header copy could reach Light and Dark but never find
 * the way back to System, and it spent 44 points of the first viewport on every
 * screen in the product to save one tap. The V1.1 visual pass removed it (§7),
 * so this file is now about the surviving control doing the whole job — and
 * about the header staying empty.
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

  test('is reachable from anywhere in the app, and costs no header space', async ({ page }) => {
    /*
     * The header used to carry a sun/moon on every screen. It is gone (§7 of the
     * V1.1 visual pass), and the two halves of that decision are both asserted
     * here: nothing offers to switch the appearance from a page header any more,
     * and the full control is still two taps from any screen in the product.
     *
     * Written against the accessible NAMES rather than a class, so the test
     * fails if the control comes back wearing a different stylesheet.
     */
    for (const start of ['/', '/trips', '/my-stuff']) {
      await page.goto(start)
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
      await expect(page.getByRole('button', { name: /Switch to (dark|light) appearance/ })).toHaveCount(0)
    }

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Settings' }).click()
    const group = page.getByRole('radiogroup', { name: 'Appearance' })
    await expect(group).toBeVisible()

    await group.getByRole('radio', { name: 'Dark' }).click()
    expect(await theme(page)).toBe('dark')
    await expect(group.getByRole('radio', { name: 'System' })).toHaveAttribute(
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
