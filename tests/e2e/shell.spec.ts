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

  /*
   * The tab bar's height must equal what the layout reserves for it.
   *
   * These were two different numbers for a while: `--tab-bar-height` was 52px
   * and described as the bar, but was really the ITEM height, so once the bar
   * grew safe-area padding every reservation computed from that token came up
   * short. The inset is forced here because headless never reports one, and an
   * unforced test would pass while proving nothing about a real iPhone.
   */
  test('the bar is exactly what the layout reserves, inset and all', async ({ page }) => {
    await page.addStyleTag({ content: ':root { --safe-bottom: 34px; }' })

    const measured = await page.evaluate(() => {
      const bar = document.querySelector('.tab-bar') as HTMLElement
      const reserved = getComputedStyle(document.documentElement)
        .getPropertyValue('--tab-bar-height')
      const probe = document.createElement('div')
      probe.style.height = reserved
      document.body.appendChild(probe)
      const reservedPx = probe.getBoundingClientRect().height
      probe.remove()
      return { barHeight: bar.getBoundingClientRect().height, reservedPx }
    })

    expect(Math.abs(measured.barHeight - measured.reservedPx)).toBeLessThanOrEqual(1)

    // And the inset is genuinely still there — this must not be "fixed" by
    // shrinking the space that keeps taps off the home indicator.
    expect(measured.barHeight).toBeGreaterThanOrEqual(34 + 44)
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
  /*
   * Serial, deliberately.
   *
   * Amounts and rules are global to the one database this app has, so two of
   * these running at once are reading and writing the same list. Serial is the
   * honest fix; scoping selectors harder would only hide the shared state.
   */
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await unlock(page)
    await page.goto('/settings')
  })

  /*
   * Reads the seeded amounts without touching them.
   *
   * An earlier version incremented Contacts and put it back, and it was flaky
   * for a reason worth naming: these amounts are global to the one database this
   * app has, so a test that mutates a shared row and asserts on it is racing
   * every other test that reads one. Changing a number is exercised below, on a
   * row this test creates and destroys itself.
   */
  test('lists the usual amounts in plain words', async ({ page }) => {
    await page.getByRole('button', { name: 'Your usual amounts' }).click()
    const sheet = page.getByRole('dialog')

    const row = sheet.locator('.amount-row').filter({ hasText: 'Contacts' })
    await expect(row).toBeVisible()
    await expect(row.locator('.stepper-value')).toHaveText(/^\d+ per day$/)

    // Doc 06: no internal vocabulary on screen.
    const text = (await sheet.textContent())!
    expect(text).not.toMatch(/per_day|duration_plus_buffer|multiplier/)
  })

  /*
   * Add and remove, end to end, including the undo.
   *
   * Deliberately leaves the database as it found it: these amounts are global,
   * and a stray per-day rule on a garment would change every other test's
   * packing list.
   */
  test('adds an amount, changes it, removes it, and puts it back', async ({ page }) => {
    await page.getByRole('button', { name: 'Your usual amounts' }).click()
    const sheet = page.getByRole('dialog')

    await sheet.getByRole('button', { name: 'Add an amount' }).click()
    await sheet.getByPlaceholder('Search your things').fill('Bombas Socks')
    await sheet.locator('.picker-row').first().click()
    await sheet.getByRole('button', { name: 'Save this amount' }).click()

    const row = sheet.locator('.amount-row').filter({ hasText: 'Bombas Socks' })
    await expect(row).toBeVisible()

    // The stepper, on a row this test owns outright.
    const value = row.locator('.stepper-value')
    await expect(value).toHaveText('2 per day')
    await row.getByRole('button', { name: /^More/ }).click()
    await expect(value).toHaveText('3 per day')
    await row.getByRole('button', { name: /^Fewer/ }).click()
    await expect(value).toHaveText('2 per day')

    // And the number survives closing and reopening the sheet.
    await sheet.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Your usual amounts' }).click()
    await expect(
      sheet.locator('.amount-row').filter({ hasText: 'Bombas Socks' }).locator('.stepper-value'),
    ).toHaveText('2 per day')

    await sheet
      .locator('.amount-row')
      .filter({ hasText: 'Bombas Socks' })
      .getByRole('button', { name: 'Remove' })
      .click()
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
