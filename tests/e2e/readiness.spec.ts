import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/**
 * Home says one thing to do next, and says why.
 *
 * Doc 09 §4 asks for one derived readiness state producing ONE recommended
 * action; §21 asks Home for one obvious action; §4.1 asks the summary screens
 * to stay calm. These assert the shape of that rather than its wording — the
 * label is derived from whatever state the seeded trip happens to be in, and a
 * test that pinned the sentence would break every time the seed data moved
 * without telling anyone anything true.
 */

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
}

test.describe('the recommended next action', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('is exactly one, and it explains itself', async ({ page }) => {
    const primary = page.locator('.home-primary')
    await expect(primary).toHaveCount(1)

    const label = (await primary.textContent())?.trim() ?? ''
    expect(label.length).toBeGreaterThan(0)

    // The reason sits under the button rather than inside it, and there is one
    // of it. Two would mean a stale render survived a restructure — which is
    // exactly what happened once, and was invisible until a screenshot showed
    // the second one printed behind the button.
    await expect(page.locator('.home-why')).toHaveCount(1)
  })

  test('does not wrap to a second line at the narrowest supported width', async ({ page }) => {
    /*
     * A primary action that wraps does not read as one action, which is the
     * whole point of having only one. This is why the button is full-width:
     * "Build the packing list" and "Pack the essentials" both wrapped inside
     * the half-width button that used to be here.
     */
    await page.setViewportSize({ width: 360, height: 664 })
    await page.reload()

    const primary = page.locator('.home-primary')
    await expect(primary).toBeVisible()

    const lines = await primary.evaluate((el) => {
      const style = getComputedStyle(el)
      const lineHeight = Number.parseFloat(style.lineHeight)
      const inner = el.getBoundingClientRect().height
        - Number.parseFloat(style.paddingTop)
        - Number.parseFloat(style.paddingBottom)
      return Number.isFinite(lineHeight) && lineHeight > 0 ? Math.round(inner / lineHeight) : 1
    })
    expect(lines, 'the recommended action wraps at 360px').toBeLessThanOrEqual(1)
  })

  test('leads somewhere other than the button beneath it', async ({ page }) => {
    // Two controls with one destination is VISUAL_ACCEPTANCE §2's competing
    // actions, and it is easy to reintroduce because the primary's destination
    // moves with the trip's state while the secondary's is written down.
    const primary = page.locator('.home-primary')
    const secondary = page.locator('.button-secondary').first()

    const primaryLabel = (await primary.textContent())?.trim()
    const secondaryLabel = (await secondary.textContent())?.trim()
    expect(primaryLabel).not.toBe(secondaryLabel)

    await primary.click()
    await expect(page).toHaveURL(/\/trips\//)
    const afterPrimary = page.url()

    await page.goBack()
    await expect(page.locator('.home-primary')).toBeVisible()
    await page.locator('.button-secondary').first().click()
    await expect(page).toHaveURL(/\/trips\//)
    expect(page.url(), 'both Home actions go to the same screen').not.toBe(afterPrimary)
  })

  test('Home carries no alarm panel', async ({ page }) => {
    /*
     * Doc 09 §4.1: Home stays calm — readiness, progress, next action,
     * departure timing. No essentials logic is removed by this; the packing
     * list still names them, because that is the screen where naming them is
     * something Alex can act on.
     */
    await expect(page.locator('.banner-alert')).toHaveCount(0)
  })
})
