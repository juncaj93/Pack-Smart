import { expect, test } from '@playwright/test'
import { ownedName } from './fixtures'
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
    // Any sheet will do — this is about the transition, not the contents. It was
    // About until that was removed as not-a-setting (doc 09 §20).
    await page.getByRole('button', { name: 'Packing rules' }).click()

    const seconds = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')
      if (!dialog) return 0
      return Number.parseFloat(getComputedStyle(dialog).animationDuration)
    })

    // Doc 06 §3: nothing decorative may slow a routine action. Browsers report
    // a suppressed animation as an epsilon rather than exactly zero.
    expect(seconds).toBeLessThan(0.01)
  })

  /*
   * Navigation reaches every screen, including the ones that only exist once
   * there is a trip. The bottom bar appeared everywhere; the row that replaced
   * it has to as well, or a trip becomes a place Alex can get stuck.
   */
  test('the navigation is on every screen, and nothing is pinned to the bottom', async ({
    page,
  }) => {
    for (const path of SCREENS) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      await expect(
        page.getByRole('navigation', { name: 'Primary' }),
        `${path} has no primary navigation`,
      ).toBeVisible()

      const pinned = await page.evaluate(() =>
        Array.from(document.body.querySelectorAll('*'))
          .filter((el) => {
            if (getComputedStyle(el).position !== 'fixed') return false
            if (el.classList.contains('undo-bar')) return false // transient, not chrome
            const box = el.getBoundingClientRect()
            return box.height > 0 && Math.abs(box.bottom - window.innerHeight) <= 1
          })
          .map((el) => el.className || el.tagName),
      )
      expect(pinned, `${path} pins something to the bottom edge`).toEqual([])
    }
  })

  /*
   * A SHORT page is where a leftover bottom reservation shows itself: on a long
   * page the band is below the fold and invisible, which is how the old one
   * survived three rounds of review.
   */
  test('a short page ends in ordinary padding', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // The reservation itself — see the note in shell.spec.ts. It was 93px.
    const padding = await page.evaluate(() =>
      Number.parseFloat(
        getComputedStyle(document.querySelector('.screen-inner') as HTMLElement).paddingBottom,
      ),
    )

    expect(padding, `Settings reserves ${padding}px at the bottom`).toBeLessThanOrEqual(40)
  })
})

/*
 * The screens that need a trip to exist. Alex named trip detail, outfits and the
 * packing checklist specifically, and those are exactly the ones a sweep over
 * static routes cannot reach.
 */
test.describe('the trip screens', () => {
  test('carry the navigation and pin nothing to the bottom', async ({ page }) => {
    await signIn(page)

    const name = ownedName('Layout')
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Trip name').fill(name)
    await sheet.getByLabel('Destination').fill('Cape Town')
    /*
     * Relative, because this test is about the chrome on a LIVE trip's screens.
     *
     * The dates here were 1–5 Aug 2026 and went past on 6 Aug, after which the
     * trip screen renders its finished variant — a different set of controls
     * from the one this assertion is aimed at, and the test would have gone on
     * passing while checking the wrong screen.
     */
    const day = 86_400_000
    const iso = (offset: number) =>
      new Date(Date.now() + offset * day).toISOString().slice(0, 10)
    await sheet.getByLabel('Leaving').fill(iso(7))
    await sheet.getByLabel('Returning').fill(iso(11))
    await sheet.getByRole('button', { name: 'Safari' }).click()
    await sheet.getByRole('button', { name: 'Create trip' }).click()

    await expect(page.getByRole('heading', { name })).toBeVisible()
    const tripUrl = page.url()

    // Trip detail (which is also the packing checklist) and Outfits.
    for (const url of [tripUrl, `${tripUrl}/outfits`]) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')

      await expect(
        page.getByRole('navigation', { name: 'Primary' }),
        `${url} has no primary navigation`,
      ).toBeVisible()

      const pinned = await page.evaluate(() =>
        Array.from(document.body.querySelectorAll('*'))
          .filter((el) => {
            if (getComputedStyle(el).position !== 'fixed') return false
            if (el.classList.contains('undo-bar')) return false
            const box = el.getBoundingClientRect()
            return box.height > 0 && Math.abs(box.bottom - window.innerHeight) <= 1
          })
          .map((el) => el.className || el.tagName),
      )
      expect(pinned, `${url} pins something to the bottom edge`).toEqual([])
    }
  })
})
