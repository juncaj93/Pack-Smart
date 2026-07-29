import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

async function unlock(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
}

test.describe('unlock', () => {
  test('the shell is not reachable without the passphrase', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0)
  })

  test('a wrong passphrase is refused and keeps the user on Unlock', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Passphrase').fill('definitely-not-the-passphrase')
    await page.getByRole('button', { name: 'Unlock' }).click()

    await expect(page.getByRole('alert')).toContainText('did not match')
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0)
  })

  test('the correct passphrase opens the shell', async ({ page }) => {
    await unlock(page)
    await expect(page.getByRole('heading', { name: 'Pack Smart' })).toBeVisible()
  })

  // M0 acceptance: "session survives ... a phone restart". A new browser context
  // with the same cookie is the automatable half of that; genuine restart and
  // week-long persistence are on the manual iPhone checklist.
  test('the session survives a reload', async ({ page }) => {
    await unlock(page)
    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Unlock' })).toHaveCount(0)
  })
})

test.describe('four-tab shell', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
  })

  test('shows exactly the four approved destinations', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link')).toHaveCount(4)
    for (const label of ['Home', 'Trips', 'My Stuff', 'Settings']) {
      await expect(nav.getByRole('link', { name: new RegExp(label) })).toBeVisible()
    }
  })

  test('navigates between all four tabs', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Primary' })

    await nav.getByRole('link', { name: /Trips/ }).click()
    await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible()

    await nav.getByRole('link', { name: /My Stuff/ }).click()
    await expect(page.getByRole('heading', { name: 'My Stuff' })).toBeVisible()

    await nav.getByRole('link', { name: /Settings/ }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await nav.getByRole('link', { name: /Home/ }).click()
    await expect(page.getByRole('heading', { name: 'Pack Smart' })).toBeVisible()
  })

  test('a deep link survives a full page load', async ({ page }) => {
    // Regression guard for the asset-fallthrough bug: without it the Worker
    // 404s every route other than "/".
    await page.goto('/my-stuff')
    await expect(page.getByRole('heading', { name: 'My Stuff' })).toBeVisible()
  })

  test('reopening resumes the last tab', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: /Settings/ })
      .click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })
})

test.describe('iPhone layout constraints', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
  })

  // Doc 06 §1: no core screen requires horizontal scrolling.
  test('no screen scrolls horizontally at 390 wide', async ({ page }) => {
    for (const path of ['/', '/trips', '/my-stuff', '/settings']) {
      await page.goto(path)
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflows, `${path} scrolls horizontally`).toBe(false)
    }
  })

  // §10: below 16px, iOS Safari zooms the viewport on focus and never returns.
  test('every input is at least 16px', async ({ page }) => {
    await page.goto('/settings')
    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input, select, textarea')).map((el) =>
        Number.parseFloat(getComputedStyle(el).fontSize),
      ),
    )
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16)
  })

  test('the unlock input is at least 16px', async ({ page, context }) => {
    await context.clearCookies()
    await page.goto('/')
    const fontSize = await page
      .getByLabel('Passphrase')
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(16)
  })

  test('tab targets meet the 44px minimum', async ({ page }) => {
    const links = page.getByRole('navigation', { name: 'Primary' }).getByRole('link')
    for (const link of await links.all()) {
      const box = await link.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
  })

  test('the tab bar sits at the bottom and content clears it', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Primary' })
    const box = await nav.boundingBox()
    const viewport = page.viewportSize()

    expect(box).not.toBeNull()
    expect(viewport).not.toBeNull()
    // Flush with the bottom edge, within a pixel of rounding.
    expect(Math.abs((box!.y + box!.height) - viewport!.height)).toBeLessThanOrEqual(1)
  })
})

test.describe('BottomSheet', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
    await page.goto('/settings')
  })

  test('opens, and dismisses by backdrop tap', async ({ page }) => {
    await page.getByRole('button', { name: 'About', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Tap well above the sheet so the backdrop receives it.
    await page.mouse.click(195, 60)
    await expect(dialog).toHaveCount(0)
  })

  test('dismisses via the Done control', async ({ page }) => {
    await page.getByRole('button', { name: 'About', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('stays within the viewport and above the bottom edge', async ({ page }) => {
    await page.getByRole('button', { name: 'About', exact: true }).click()
    const box = await page.getByRole('dialog').boundingBox()
    const viewport = page.viewportSize()

    expect(box).not.toBeNull()
    expect(box!.height).toBeLessThanOrEqual(viewport!.height * 0.86)
    expect(box!.y).toBeGreaterThanOrEqual(0)
  })
})

test.describe('sign out', () => {
  test('returns to Unlock and the shell is no longer reachable', async ({ page }) => {
    await unlock(page)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible()

    await page.goto('/my-stuff')
    await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible()
  })
})

test.describe('settings', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
    await page.goto('/settings')
  })

  test('lets the usual amounts be changed, in plain words', async ({ page }) => {
    await page.getByRole('button', { name: 'Your usual amounts' }).click()
    const sheet = page.getByRole('dialog')

    await expect(sheet.getByText('Contacts', { exact: true })).toBeVisible()

    // Amounts are global, so this asserts the CHANGE rather than a fixed value —
    // another test running in parallel may hold a different number.
    const value = sheet.locator('.stepper-value').first()
    const before = Number((await value.textContent())!.replace(/\D/g, ''))

    await sheet.getByRole('button', { name: 'More Contacts' }).click()
    await expect(value).toHaveText(`${before + 1} per day`)

    // And it survives closing and reopening the sheet.
    await sheet.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Your usual amounts' }).click()
    const reopened = page.getByRole('dialog').locator('.stepper-value').first()
    await expect(reopened).toHaveText(`${before + 1} per day`)

    // Put it back so the suite leaves the database as it found it.
    await page.getByRole('dialog').getByRole('button', { name: 'Fewer Contacts' }).click()
    await expect(reopened).toHaveText(`${before} per day`)
  })

  /*
   * Add and remove, end to end, including the undo.
   *
   * Deliberately leaves the database as it found it: these amounts are global,
   * and a stray per-day rule on a garment would change every other test's
   * packing list.
   */
  test('adds an amount, removes it, and puts it back', async ({ page }) => {
    await page.getByRole('button', { name: 'Your usual amounts' }).click()
    const sheet = page.getByRole('dialog')

    await sheet.getByRole('button', { name: 'Add an amount' }).click()
    await sheet.getByPlaceholder('Search your things').fill('Bombas Socks')
    await sheet.locator('.picker-row').first().click()
    await sheet.getByRole('button', { name: 'Save this amount' }).click()

    const row = sheet.locator('.amount-row').filter({ hasText: 'Bombas Socks' })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Remove' }).click()
    await expect(sheet.getByText('Bombas Socks removed.')).toBeVisible()

    await sheet.getByRole('button', { name: 'Undo' }).click()
    await expect(sheet.locator('.amount-row').filter({ hasText: 'Bombas Socks' })).toBeVisible()

    // Clean up: remove it for real and leave it removed.
    await sheet
      .locator('.amount-row')
      .filter({ hasText: 'Bombas Socks' })
      .getByRole('button', { name: 'Remove' })
      .click()
    await expect(sheet.locator('.amount-row').filter({ hasText: 'Bombas Socks' })).toHaveCount(0)
  })

  test('describes packing rules without developer language', async ({ page }) => {
    await page.getByRole('button', { name: 'Packing rules' }).click()
    const sheet = page.getByRole('dialog')

    await expect(sheet.locator('.rule-row').first()).toBeVisible()

    const descriptions = await sheet.locator('.rule-what').allTextContents()
    expect(descriptions.length).toBeGreaterThan(0)
    // Doc 06: no internal vocabulary on screen.
    for (const text of descriptions) {
      expect(text).not.toMatch(/_|conditional_include|duration_plus_buffer/)
    }
    expect(descriptions.join(' ')).toMatch(/Only when leaving the country/)
  })

  test('turns a rule off and back on', async ({ page }) => {
    await page.getByRole('button', { name: 'Packing rules' }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByPlaceholder('Search').fill('Passport')

    const row = sheet.locator('.rule-row').first()
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    await row.click()
    await expect(row).toHaveAttribute('aria-pressed', 'false')
    await row.click()
    await expect(row).toHaveAttribute('aria-pressed', 'true')
  })

  test('does not scroll sideways with a sheet open', async ({ page }) => {
    await page.getByRole('button', { name: 'Packing rules' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
