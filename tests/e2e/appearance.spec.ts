import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Light, Dark, and System — one control, in Settings.
 *
 * There were two: a three-state radio group here and a two-state sun/moon in
 * every page header. The header copy could reach Light and Dark but never find
 * the way back to System, and it spent 44 points of the first viewport on every
 * screen in the product to save one tap. The V1.1 visual pass removed it (§7).
 *
 * **The toggle is back, on Home and only on Home**, at Alex's request. The
 * finding's arithmetic was about paying for the control four times over — once
 * per tab — beside a navigation row that has since moved to the bottom toolbar;
 * on one screen it shares the title row, which is otherwise empty. So this file
 * is now about three things at once: the toggle existing where it should, NOT
 * existing where it should not, and the two controls being one preference in two
 * shapes.
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

/**
 * Home, and actually Home.
 *
 * `goto('/')` is not enough: `App` resumes the last tab when the app is opened
 * at the root, so a spec that has just been to Settings bounces straight back
 * there and every assertion about Home's header runs against the wrong screen.
 * `performance.spec.ts` was measuring Settings twice for this exact reason.
 *
 * The toolbar link is a client-side navigation after mount, which the resume
 * cannot intercept.
 */
async function goHome(page: Page) {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: /Home/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Pack Smart', level: 1 })).toBeVisible()
}

/**
 * The two controls are one preference, and they must never disagree.
 *
 * This is the defect the header toggle produced the first time it existed:
 * each control read `localStorage` on mount and never again, so changing one
 * left the other showing the old answer until the screen was rebuilt — the
 * toggle still saying "switch to dark" after Settings had already switched.
 * `setAppearanceChoice` notifies subscribers, and this is what proves it.
 */
test.describe('the toggle and the setting are one preference', () => {
  // The unlock screen has no header and no toolbar; without this the helper
  // below waits thirty seconds for navigation that was never going to render.
  test.beforeEach(async ({ page }) => {
    await unlock(page)
  })

  test('a tap on Home moves the choice Settings shows', async ({ page }) => {
    await goHome(page)

    const before = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    )
    await page.getByRole('button', { name: /Switch to (dark|light) appearance/ }).click()

    const after = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    )
    expect(after, 'the toggle did not change the appearance').not.toBe(before)

    /*
     * And the explicit choice it stored is the one Settings reports. The first
     * tap leaves `system` behind for good, which is the honest reading of "I
     * want it light now" — a choice that silently reverted the next time the
     * phone changed would be worse than no control at all.
     */
    await page.goto('/settings')
    const group = page.getByRole('radiogroup', { name: 'Appearance' })
    await expect(
      group.getByRole('radio', { name: after === 'dark' ? 'Dark' : 'Light' }),
    ).toHaveAttribute('aria-checked', 'true')
    await expect(group.getByRole('radio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  test('Settings is still the only way back to System', async ({ page }) => {
    await goHome(page)
    await page.getByRole('button', { name: /Switch to (dark|light) appearance/ }).click()

    await page.goto('/settings')
    await page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: 'System' }).click()
    await expect(
      page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: 'System' }),
    ).toHaveAttribute('aria-checked', 'true')
  })
})

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

  test('is one tap on Home, and absent everywhere else', async ({ page }) => {
    /*
     * Written against the accessible NAMES rather than a class, so the test
     * fails if the control moves or comes back wearing a different stylesheet.
     *
     * The `toHaveCount(0)` half is the more important one: it is what keeps this
     * a deliberate exception on the screen Alex opens in a dark room, rather
     * than the header quietly becoming a toolbar again on all five.
     */
    const toggle = /Switch to (dark|light) appearance/

    await goHome(page)
    await expect(page.getByRole('button', { name: toggle })).toHaveCount(1)

    for (const start of ['/trips', '/my-stuff', '/settings']) {
      await page.goto(start)
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
      await expect(page.getByRole('button', { name: toggle })).toHaveCount(0)
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
