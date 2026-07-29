import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/**
 * The iPhone constraints, applied to every screen rather than to the shell only.
 *
 * Doc 06 §1's list is not a one-off check on the four tabs — a sheet that zooms
 * the viewport or a row too small to hit is just as broken on the trip screen as
 * on Home, and those screens did not exist when the original checks were written.
 */

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
}

/** Every screen reachable without creating data. */
const SCREENS = ['/', '/trips', '/my-stuff', '/settings', '/import']

test.describe('iPhone constraints hold on every screen', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('nothing scrolls sideways at 390 wide', async ({ page }) => {
    for (const path of SCREENS) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0)
    }
  })

  test('every input is at least 16px, so focusing never zooms the page', async ({ page }) => {
    for (const path of SCREENS) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      const sizes = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input, select, textarea')).map((el) =>
          Number.parseFloat(getComputedStyle(el).fontSize),
        ),
      )
      for (const size of sizes) {
        expect(size, `${path} has an input below 16px`).toBeGreaterThanOrEqual(16)
      }
    }
  })

  test('every control is big enough to hit with a thumb', async ({ page }) => {
    for (const path of SCREENS) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      const tooSmall = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button, a[href], input[type="search"]'))
          .filter((el) => {
            const rect = el.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) return false
            return rect.height < 40
          })
          .map((el) => (el.textContent ?? '').trim().slice(0, 40)),
      )
      expect(tooSmall, `${path} has controls under 40px tall`).toEqual([])
    }
  })

  test('every control says what it does, for a screen reader', async ({ page }) => {
    for (const path of SCREENS) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      const unnamed = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button'))
          .filter((el) => {
            const rect = el.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) return false
            const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()
            return name.length === 0
          })
          .map((el) => el.className),
      )
      expect(unnamed, `${path} has an unlabelled control`).toEqual([])
    }
  })

  test('a sheet traps focus and returns it on close', async ({ page }) => {
    await page.goto('/settings')
    const trigger = page.getByRole('button', { name: 'Packing rules' })
    await trigger.click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('aria-modal', 'true')

    // Focus is inside the sheet, not left behind on the page.
    const inside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')
      return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement))
    })
    expect(inside).toBe(true)

    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('motion is removable', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/settings')
    await page.getByRole('button', { name: 'About' }).click()

    const seconds = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')
      if (!dialog) return 0
      return Number.parseFloat(getComputedStyle(dialog).animationDuration)
    })

    // Doc 06 §3: nothing decorative may slow a routine action. Browsers report
    // a suppressed animation as an epsilon rather than exactly zero.
    expect(seconds).toBeLessThan(0.01)
  })
})
