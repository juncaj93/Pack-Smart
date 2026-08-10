import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { clearAmounts, createOwnedItem } from './fixtures'

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
    await expect(page.getByRole('heading', { name: 'Trips', exact: true })).toBeVisible()

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

  test('every navigation target meets the 44px minimum', async ({ page }) => {
    const links = page.getByRole('navigation', { name: 'Primary' }).getByRole('link')
    for (const link of await links.all()) {
      const box = await link.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
  })

  /*
   * The regression guard for the defect this whole change exists to fix.
   *
   * A fixed bar at the bottom of the viewport lands directly on top of Safari's
   * own toolbar — two navigation bars stacked on one edge. Nothing of ours may
   * live there (product doc 02 §2).
   *
   * The Undo toast is the deliberate exception: it appears for a few seconds and
   * leaves, so it is not chrome. It is excluded by name rather than by loosening
   * the rule, so anything NEW that pins itself to the bottom fails here.
   */
  test('nothing of ours is fixed to the bottom of the screen', async ({ page }) => {
    for (const path of ['/', '/trips', '/my-stuff', '/settings']) {
      await page.goto(path)
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()

      const offenders = await page.evaluate(() => {
        const found: string[] = []
        for (const el of Array.from(document.body.querySelectorAll('*'))) {
          const style = getComputedStyle(el)
          if (style.position !== 'fixed') continue
          if (el.classList.contains('undo-bar')) continue // transient, not chrome
          const box = el.getBoundingClientRect()
          if (box.height === 0) continue
          if (Math.abs(box.bottom - window.innerHeight) <= 1) {
            found.push(el.className || el.tagName)
          }
        }
        return found
      })

      expect(offenders, `${path} pins something to the bottom edge`).toEqual([])
    }
  })

  /*
   * No artificial band at the bottom.
   *
   * `.screen-inner` used to reserve the height of the tab bar. With the bar gone
   * that reservation would be a strip of empty background propping up the page —
   * exactly what Alex reported seeing. The page must end in ordinary padding.
   */
  test('the page ends in ordinary padding, not a reserved band', async ({ page }) => {
    for (const path of ['/', '/trips', '/my-stuff', '/settings']) {
      await page.goto(path)
      // `.screen-inner` does not exist until React has rendered the route.
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()

      /*
       * The RESERVATION itself, rather than the gap below the last element.
       *
       * The first version of this measured `inner.bottom - lastChild.bottom` and
       * failed at 48px on a screen whose last element carries its own 16px
       * bottom margin. That margin is ordinary spacing, not a reserved band, so
       * the assertion was wrong rather than the layout — and a threshold tuned
       * to accommodate it would have stopped meaning anything.
       *
       * `padding-bottom` is exactly the thing that was wrong: it read
       * `calc(--tab-bar-height + --space-6)` = 93px, holding a strip of empty
       * background open for a bar that no longer exists. It is --space-6 now.
       */
      const padding = await page.evaluate(() =>
        Number.parseFloat(
          getComputedStyle(document.querySelector('.screen-inner') as HTMLElement).paddingBottom,
        ),
      )

      expect(padding, `${path} reserves ${padding}px at the bottom`).toBeLessThanOrEqual(40)
    }
  })

  /*
   * The precondition for Safari collapsing its own toolbar.
   *
   * Safari shrinks its toolbar when the PAGE scrolls. The app used to be
   * `height: 100dvh` with an inner scroll region, so `window.scrollY` was always
   * 0 no matter how far Alex scrolled, and the toolbar stayed at full height
   * permanently. This assertion would have failed on every build before this one.
   *
   * CI cannot go further than this — a headless browser has no toolbar to
   * collapse. That half is a device check (technical-docs/08).
   */
  test('the document itself scrolls on a long page', async ({ page }) => {
    await page.goto('/my-stuff')
    await expect(page.getByRole('heading', { name: 'My Stuff' })).toBeVisible()
    // The heading renders before the items do; scrolling a still-loading page
    // proves nothing.
    await page.waitForLoadState('networkidle')

    /*
     * The page's actual measurements, not just the verdict.
     *
     * This read `scrollHeight > innerHeight` and asserted the boolean, so a
     * failure said only "not tall enough" — which cannot distinguish "the
     * wardrobe is empty" from "the list had not rendered yet" from "a filter
     * was left applied by an earlier spec". Those need completely different
     * fixes, and the run that finds it is the only chance to tell them apart.
     */
    const page_ = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      rows: document.querySelectorAll('.stuff-row, .item-row, [data-item-id]').length,
      buttons: document.querySelectorAll('main button').length,
      emptyState: document.querySelector('.empty-state-title')?.textContent ?? null,
      search: (document.querySelector<HTMLInputElement>('input[type="search"]')?.value) ?? null,
    }))
    expect(
      page_.scrollHeight > page_.innerHeight,
      `My Stuff is not tall enough to test scrolling: ${JSON.stringify(page_)}`,
    ).toBe(true)

    await page.evaluate(() => window.scrollTo(0, 300))
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })

  /*
   * Sticky is silently disabled by a clipping ancestor: nothing errors, the row
   * just scrolls away. So it is asserted by scrolling, not by reading the CSS.
   */
  test('the navigation stays put while the page scrolls', async ({ page }) => {
    await page.goto('/my-stuff')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav).toBeVisible()
    await page.waitForLoadState('networkidle')

    await page.evaluate(() => window.scrollTo(0, 400))

    const box = await nav.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeLessThanOrEqual(1)
    await expect(nav).toBeVisible()
  })

  test('the active section is marked on every destination', async ({ page }) => {
    const sections: Array<[string, string]> = [
      ['/', 'Home'],
      ['/trips', 'Trips'],
      ['/my-stuff', 'My Stuff'],
      ['/settings', 'Settings'],
    ]

    for (const [path, label] of sections) {
      await page.goto(path)
      const nav = page.getByRole('navigation', { name: 'Primary' })
      await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
      // Exactly one — two "you are here" markers is the same as none.
      expect(await nav.locator('[aria-current="page"]').count()).toBe(1)
    }
  })
})

test.describe('BottomSheet', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
    await page.goto('/settings')
  })

  test('opens, and dismisses by backdrop tap', async ({ page }) => {
    // Packing rules rather than About: About was removed as not-a-setting
    // (doc 09 §20), and these three are about the SHEET, not about what is in it.
    await page.getByRole('button', { name: 'Packing rules' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Tap well above the sheet so the backdrop receives it.
    await page.mouse.click(195, 60)
    await expect(dialog).toHaveCount(0)
  })

  test('dismisses via the Done control', async ({ page }) => {
    // Packing rules rather than About: About was removed as not-a-setting
    // (doc 09 §20), and these three are about the SHEET, not about what is in it.
    await page.getByRole('button', { name: 'Packing rules' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('stays within the viewport and above the bottom edge', async ({ page }) => {
    // Packing rules rather than About: About was removed as not-a-setting
    // (doc 09 §20), and these three are about the SHEET, not about what is in it.
    await page.getByRole('button', { name: 'Packing rules' }).click()
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

  /*
   * Every item these tests create an amount for, cleaned up whatever happened.
   *
   * `packing_rule` is global — not scoped to a trip — so an amount left behind
   * changes the quantity on every other spec's list, and the picker then hides
   * the item so the test can never repeat. Both halves of that are doc 09 §5a's
   * worst isolation defect, and both are closed by owning the item and tearing
   * it down on the failure path as well as the success one.
   */
  const owned: string[] = []

  test.afterEach(async ({ page }) => {
    while (owned.length > 0) await clearAmounts(page, owned.pop()!)
  })

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

    /*
     * The stepper carries the number and the sentence beneath it carries the
     * unit. They used to be one string — "2 per day" inside the stepper — which
     * restated the paragraph at the top of the sheet on every row and made the
     * stepper the widest thing in the control, in a sheet four amounts could
     * fill. The plain-words half of this test is what matters and is unchanged:
     * whichever element says it, it has to be a sentence.
     */
    // A field now, not a label — the number is typed as well as stepped.
    await expect(row.locator('.stepper-value')).toHaveValue(/^\d+$/)
    await expect(row.locator('.amount-fact')).toHaveText(/^\d+ per day(, plus \d+ spare)?$/)

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
    /*
     * On an item this test creates, not on a shared one.
     *
     * It used to use *Bombas Socks* and clean up in the last line of the test
     * body. A failure anywhere above that left the amount behind — and the
     * picker hides items that already have one, so every later run of this test
     * timed out looking for a `.picker-row` that could no longer exist. Not a
     * flake: permanent, until the local database was deleted (doc 09 §5a).
     */
    const item = await createOwnedItem(page, 'Amounts')
    owned.push(item.id)

    await page.getByRole('button', { name: 'Your usual amounts' }).click()
    const sheet = page.getByRole('dialog')

    await sheet.getByRole('button', { name: 'Add an amount' }).click()
    await sheet.getByPlaceholder('Search your things').fill(item.name)
    await sheet.locator('.picker-row').first().click()
    await sheet.getByRole('button', { name: 'Save this amount' }).click()

    const row = sheet.locator('.amount-row').filter({ hasText: item.name })
    await expect(row).toBeVisible()

    /*
     * The stepper, on a row this test owns outright. It carries the number
     * alone now — the unit is in the sentence under the name, once per row
     * rather than inside the control.
     */
    const value = row.locator('.stepper-value')
    await expect(value).toHaveValue('2')
    await expect(row.locator('.amount-fact')).toHaveText('2 per day')
    await row.getByRole('button', { name: /^More/ }).click()
    await expect(value).toHaveValue('3')
    await row.getByRole('button', { name: /^Fewer/ }).click()
    await expect(value).toHaveValue('2')

    // And the number survives closing and reopening the sheet.
    await sheet.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Your usual amounts' }).click()
    await expect(
      sheet.locator('.amount-row').filter({ hasText: item.name }).locator('.stepper-value'),
    ).toHaveValue('2')

    await sheet
      .locator('.amount-row')
      .filter({ hasText: item.name })
      .getByRole('button', { name: /^Remove / })
      .click()
    await expect(sheet.getByText(`${item.name} removed.`)).toBeVisible()

    await sheet.getByRole('button', { name: 'Undo' }).click()
    await expect(sheet.locator('.amount-row').filter({ hasText: item.name })).toBeVisible()

    // Removed for real. The `afterEach` is what makes the FAILURE path safe.
    await sheet
      .locator('.amount-row')
      .filter({ hasText: item.name })
      .getByRole('button', { name: /^Remove / })
      .click()
    await expect(sheet.locator('.amount-row').filter({ hasText: item.name })).toHaveCount(0)
  })

  test('a typed amount is saved, and it is a number a stepper could not reach', async ({ page }) => {
    /*
     * The ceiling moved from 10 to 99, and the real complaint was never the
     * ceiling — it was that reaching even 10 took eight taps of a `+`. So the
     * assertion is that a number can be TYPED, and that it is one no reasonable
     * amount of tapping would have produced.
     */
    /*
     * On an owned row, not on Contacts.
     *
     * Setting the GLOBAL Contacts amount to 42 meant that for as long as this
     * test held it, every other spec's packing list was reading a number that
     * was about to change back — including `necessity-reasons.spec.ts`, which
     * asserts the `12 nights × 2 = 24` arithmetic. Restoring it at the end
     * narrowed the window and never closed it. Typing a large number is what
     * this test is about, and an owned row types the same way.
     */
    const item = await createOwnedItem(page, 'Typed')
    owned.push(item.id)

    await page.getByRole('button', { name: 'Your usual amounts' }).click()
    const sheet = page.getByRole('dialog')

    await sheet.getByRole('button', { name: 'Add an amount' }).click()
    await sheet.getByPlaceholder('Search your things').fill(item.name)
    await sheet.locator('.picker-row').first().click()
    await sheet.getByRole('button', { name: 'Save this amount' }).click()

    const row = sheet.locator('.amount-row').filter({ hasText: item.name })
    const field = row.getByLabel(/^How many/)
    await expect(field).toBeVisible()

    await field.fill('42')
    await field.press('Enter')
    await expect(row.locator('.amount-fact')).toHaveText('42 per day')

    // Stored, not just shown: it survives closing and reopening the sheet.
    await sheet.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Your usual amounts' }).click()
    await expect(
      sheet.locator('.amount-row').filter({ hasText: item.name }).getByLabel(/^How many/),
    ).toHaveValue('42')
  })

  test('refuses what is not a quantity, and keeps the number that was there', async ({ page }) => {
    /*
     * Paste is the case worth pinning. `parseInt('77kg')` is 77 and `Number('')`
     * is 0, so a coercing field would store a quantity Alex never typed — and
     * for a per-day rule, 0 quietly removes the item from every future list.
     */
    const item = await createOwnedItem(page, 'Refuses')
    owned.push(item.id)

    await page.getByRole('button', { name: 'Your usual amounts' }).click()
    const sheet = page.getByRole('dialog')

    await sheet.getByRole('button', { name: 'Add an amount' }).click()
    await sheet.getByPlaceholder('Search your things').fill(item.name)
    await sheet.locator('.picker-row').first().click()
    await sheet.getByRole('button', { name: 'Save this amount' }).click()

    const row = sheet.locator('.amount-row').filter({ hasText: item.name })
    const field = row.getByLabel(/^How many/)

    /*
     * Read rather than hard-coded, even on an owned row: the assertion is that
     * a refusal leaves the value UNCHANGED, which does not care what it was.
     */
    const before = await field.inputValue()

    for (const bad of ['0', '100', '2.5', '77kg', '']) {
      await field.fill(bad)
      await field.press('Enter')
      await expect(field).toHaveValue(before)
      await expect(row.locator('.amount-fact')).toHaveText(`${before} per day`)
    }

    await expect(sheet.getByText(/between 1 and 99/)).toBeVisible()
  })

  /*
   * A suggestion panel that shows nothing must say so, rather than looking
   * broken (doc 02 §11). With a fresh database nothing has been removed three
   * times, so the empty state is the honest one to assert here — and it is the
   * state Alex sees first.
   */
  test('says plainly when it has noticed nothing yet', async ({ page }) => {
    await page.getByRole('button', { name: 'What Pack Smart has noticed' }).click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('Nothing yet')
    // Never developer language, and never a fake confidence score.
    await expect(sheet).not.toContainText('rule_engine')
  })

  test('holds settings, not a second way to navigate', async ({ page }) => {
    /*
     * Doc 09 §20. Settings had a `My wardrobe` section whose one row navigated to
     * My Stuff — a primary tab, permanently on screen, one tap away from
     * everywhere. A second door to the same room is not a setting; it makes the
     * screen longer and teaches Alex that this is where you go to find things.
     *
     * `About` went too. It said Pack Smart is private, uses no paid service and
     * keeps its data in Alex's own database — all true, all things he decided,
     * none of them a control. An app someone built for themselves does not need
     * to introduce itself to them, and nothing in it is legally required.
     */
    await expect(page.getByRole('button', { name: 'About' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'My wardrobe' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'My Stuff' })).toHaveCount(0)

    // Still reachable in one tap, which is the reason it did not need a row.
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /My Stuff/ }),
    ).toBeVisible()
  })

  test('every row on Settings goes somewhere', async ({ page }) => {
    /*
     * The other half of §20: "audit every control to confirm it affects real
     * behaviour; remove or repair dead settings." A row that opens nothing is
     * worse than a missing one, because it looks like a feature.
     */
    const rows = page.locator('.settings-row')
    /*
     * Waited for, not counted in the same tick. `page.goto` resolves on load;
     * React renders after it, so reading the count immediately measures an
     * empty screen — which passed alone and failed in the suite, on timing
     * rather than on anything about the rows. The same lesson as the two notes
     * below, one step earlier.
     */
    await expect(rows.first()).toBeVisible()
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i += 1) {
      /*
       * A fresh Settings each time. The loop used to depend on the previous
       * iteration having fully closed its sheet or navigated back, which passed
       * alone and failed in the suite — a test about dead rows should not also
       * be a test of its own cleanup.
       */
      await page.goto('/settings')
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
      const row = rows.nth(i)
      const label = (await row.locator('.settings-label').textContent())?.trim() ?? ''

      // The backup row is an anchor with a download, not a sheet or a route.
      if (label === 'Download a backup') {
        await expect(row).toHaveAttribute('href', /export/)
        continue
      }

      await row.click()

      /*
       * Waited for, not read in the same tick. A sheet mounts and a route change
       * renders asynchronously, so counting immediately after the click measures
       * the screen before either has happened — which passed alone and failed in
       * the suite, on timing rather than on anything about the rows.
       */
      const dialog = page.getByRole('dialog')
      const wentSomewhere = await Promise.race([
        dialog.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true),
        page
          .getByRole('heading', { name: 'Settings' })
          .waitFor({ state: 'detached', timeout: 5_000 })
          .then(() => true),
      ]).catch(() => false)
      expect(wentSomewhere, `${label} does nothing`).toBe(true)
    }
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
