import { expect, test } from '@playwright/test'
import { createTrip, deleteTrip, liveDates, signIn, type TripFixture } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * The floating bottom toolbar, on the engine that decides whether it works.
 *
 * The unit suite owns which destination the router calls current and whether
 * the centre Add reaches the screen's handler. This owns everything that needs
 * layout: that nothing ends up underneath the bar, that its targets are real,
 * that it gets out of the way of a sheet and of the keyboard, and that the
 * guided flows which hide it still carry a way out.
 */

const TOOLBAR = { name: 'Primary' }

const toolbar = (page: Page) => page.getByRole('navigation', TOOLBAR)

/**
 * The destination the router says you are on.
 *
 * By `aria-current`, which is the attribute `NavLink` sets and the one a screen
 * reader uses — not by a class. Playwright has no `current` role option, and
 * asserting on the styling hook instead would let the accessible signal rot
 * while the colour kept working.
 */
const current = (page: Page) => toolbar(page).locator('[aria-current="page"]')

test.describe('getting around', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('every destination is reachable and marks itself', async ({ page }) => {
    await page.goto('/')
    await expect(current(page)).toHaveText(/Home/)

    for (const [label, heading] of [
      ['Trips', 'Trips'],
      ['My Stuff', 'My Stuff'],
      ['Settings', 'Settings'],
    ] as const) {
      await toolbar(page).getByRole('link', { name: label }).click()
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
      await expect(current(page)).toHaveText(new RegExp(label))
    }
  })

  test('browser Back and Forward move the active destination with them', async ({ page }) => {
    /*
     * §28/§29. The active state is derived from the router and held nowhere
     * else, so this is really asking whether anything has started caching it.
     */
    await page.goto('/')
    await toolbar(page).getByRole('link', { name: 'My Stuff' }).click()
    await expect(current(page)).toHaveText(/My Stuff/)

    await page.goBack()
    await expect(current(page)).toHaveText(/Home/)

    await page.goForward()
    await expect(current(page)).toHaveText(/My Stuff/)
  })

  test('a cold deep link arrives with the right destination already marked', async ({ page }) => {
    await page.goto('/settings')
    await expect(current(page)).toHaveText(/Settings/)
  })

  test('the old top navigation is gone, not merely hidden', async ({ page }) => {
    // §21: one navigation system, not two.
    await page.goto('/')
    expect(await page.locator('.primary-nav').count()).toBe(0)
    expect(await page.getByRole('navigation', TOOLBAR).count()).toBe(1)
  })
})

test.describe('on a trip', () => {
  let trip: TripFixture | null = null

  test.beforeEach(async ({ page }) => {
    await signIn(page)
    trip = await createTrip(page, { owner: 'Toolbar', ...liveDates(3) })
  })

  test.afterEach(async ({ page }) => {
    if (trip) await deleteTrip(page, trip.id)
    trip = null
  })

  test('nested trip routes keep Trips current', async ({ page }) => {
    // §26. Not one of these may leave the toolbar with nothing marked.
    for (const suffix of ['', '/outfits', '/today', '/bags', '/days']) {
      await page.goto(`/trips/${trip!.id}${suffix}`)
      await expect(toolbar(page)).toBeVisible()
      await expect(current(page), `no active destination on ${suffix || '/'}`).toHaveText(/Trips/)
    }
  })

  test('the centre Add is the trip’s own Add, not a generic one', async ({ page }) => {
    /*
     * The regression this pass could most easily have shipped (§44). `Add to
     * this trip` is a distinct capability on a route where the toolbar shows
     * *Trips* as active, and it is not reachable any other way — a centre button
     * that opened the new-trip sheet here would have removed it silently.
     */
    await page.goto(`/trips/${trip!.id}`)

    const add = toolbar(page).getByRole('button', { name: 'Add to this trip' })
    await expect(add).toBeVisible()
    await add.click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('aria-label', 'Add to this trip')
  })
})

test.describe('the centre Add, per screen', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('opens the new-trip sheet from Trips', async ({ page }) => {
    await page.goto('/trips')
    await toolbar(page).getByRole('button', { name: 'Plan a Trip' }).click()
    await expect(page.getByRole('dialog')).toHaveAttribute('aria-label', 'New trip')
  })

  test('opens the Add item sheet from My Stuff', async ({ page }) => {
    await page.goto('/my-stuff')
    await toolbar(page).getByRole('button', { name: 'Add item' }).click()
    await expect(page.getByRole('dialog')).toHaveAttribute('aria-label', 'Add item')
  })

  test('is disabled on Settings, where there is nothing to add', async ({ page }) => {
    await page.goto('/settings')
    await expect(toolbar(page).getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  test('leaves no second Add behind in the header', async ({ page }) => {
    // §24: one Add affordance, not two.
    await page.goto('/my-stuff')
    await expect(page.getByRole('button', { name: 'Add item' })).toHaveCount(1)
  })
})

test.describe('nothing hides behind it', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('the last row of a long list is fully clear of the toolbar', async ({ page }) => {
    /*
     * §14, and the assertion this whole pass turns on. The wardrobe is the
     * longest list in the product; if anything is going to end up under the bar
     * it is the last row of this one.
     */
    await page.goto('/my-stuff')
    await expect(page.locator('.stuff-row').first()).toBeVisible()
    await page.waitForLoadState('networkidle')

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

    const clearance = await page.evaluate(() => {
      const rows = document.querySelectorAll('.stuff-row')
      const last = rows[rows.length - 1]
      const bar = document.querySelector('.toolbar')
      if (!last || !bar) return null
      return bar.getBoundingClientRect().top - last.getBoundingClientRect().bottom
    })

    expect(clearance, 'the toolbar is sitting on the last wardrobe row').not.toBeNull()
    expect(clearance!).toBeGreaterThanOrEqual(0)
  })

  test('the Undo bar sits above the toolbar, not under it', async ({ page }) => {
    /*
     * Undo is a fixed bar near the bottom and so is the toolbar. It is offered
     * for a few seconds and then gone, so a collision here is invisible in a
     * screenshot of anything else.
     */
    await page.goto('/my-stuff')
    await expect(page.locator('.stuff-row').first()).toBeVisible()

    const row = page.locator('.stuff-row').first()
    const name = (await row.locator('.stuff-name').textContent())?.trim() ?? ''
    await row.click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Archive' }).click()

    const undo = page.locator('.undo-bar')
    await expect(undo).toBeVisible()

    const overlap = await page.evaluate(() => {
      const bar = document.querySelector('.toolbar')
      const undoBar = document.querySelector('.undo-bar')
      if (!bar || !undoBar) return null
      return bar.getBoundingClientRect().top - undoBar.getBoundingClientRect().bottom
    })
    expect(overlap, `Undo for "${name}" is behind the toolbar`).not.toBeNull()
    expect(overlap!).toBeGreaterThanOrEqual(0)

    await undo.getByRole('button', { name: /Undo/ }).click()
  })
})

test.describe('sheets and the keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('an open sheet covers the toolbar rather than sitting under it', async ({ page }) => {
    // §19. The backdrop is at 100 and the toolbar at 30, so this is really
    // asking whether anything has raised the toolbar since.
    await page.goto('/my-stuff')
    await toolbar(page).getByRole('button', { name: 'Add item' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const layering = await page.evaluate(() => {
      const bar = document.querySelector('.toolbar')
      const backdrop = document.querySelector('.sheet-backdrop')
      if (!bar || !backdrop) return null
      return {
        bar: Number(getComputedStyle(bar).zIndex),
        backdrop: Number(getComputedStyle(backdrop).zIndex),
      }
    })
    expect(layering).not.toBeNull()
    expect(layering!.bar).toBeLessThan(layering!.backdrop)
  })

  test('a tap where the toolbar is does not reach it through the backdrop', async ({ page }) => {
    await page.goto('/my-stuff')
    await toolbar(page).getByRole('button', { name: 'Add item' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    const hit = await page.evaluate(() => {
      const bar = document.querySelector('.toolbar')
      if (!bar) return 'no toolbar'
      const box = bar.getBoundingClientRect()
      const el = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return el?.closest('.toolbar') ? 'toolbar' : 'not the toolbar'
    })
    // The sheet or its backdrop is what a thumb finds there while one is open.
    expect(hit).toBe('not the toolbar')
  })
})

test.describe('the guided flows that hide it', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('the closet review hides it and can still be left, by name', async ({ page }) => {
    /*
     * §43. A hidden toolbar plus no exit is a trapped screen — a worse defect
     * than the one hiding it avoids — so a focused route is checked for a way
     * out that says where it goes, not for a count of controls.
     *
     * The first version of this test counted buttons, which would have passed
     * on a screen with no exit at all.
     */
    await page.goto('/my-stuff/review')
    await expect(toolbar(page)).toHaveCount(0)

    /*
     * `Finish for now` while there are questions left, `Back to My Stuff` on the
     * empty state at the end. Either is a named exit; which one is on screen
     * depends on what the wardrobe currently has to ask, so this accepts both
     * rather than depending on the state of the seeded closet.
     */
    await expect(
      page
        .getByRole('button', { name: 'Finish for now' })
        .or(page.getByRole('button', { name: 'Back to My Stuff' })),
    ).toBeVisible()
  })

  test('import keeps the toolbar, because it is the only way off it', async ({ page }) => {
    /*
     * Import reads like a guided flow and deliberately is not treated as one.
     * It has no back link and navigates nowhere: hiding the toolbar there would
     * strand Alex on the screen, which is exactly the regression §43 names.
     */
    await page.goto('/import')
    await expect(page.getByRole('heading', { name: 'Import', level: 1 })).toBeVisible()
    await expect(toolbar(page)).toBeVisible()

    await toolbar(page).getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  })
})

test.describe('the shape of it', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('every control clears 44px at every supported width', async ({ page }) => {
    await page.goto('/my-stuff')
    await expect(toolbar(page)).toBeVisible()

    for (const width of [360, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 664 })
      await page.waitForTimeout(120)

      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.toolbar-item, .toolbar-add'))
          .map((el) => {
            const r = el.getBoundingClientRect()
            return { name: el.textContent?.trim() || 'Add', w: Math.round(r.width), h: Math.round(r.height) }
          })
          .filter((c) => c.h < 44 || c.w < 44),
      )
      expect(small, `undersized toolbar controls at ${width}px`).toEqual([])
    }
  })

  test('My Stuff stays on one line at 360', async ({ page }) => {
    // §31. Two-line labels would change the bar's height on one screen only.
    await page.setViewportSize({ width: 360, height: 664 })
    await page.goto('/my-stuff')
    await expect(toolbar(page)).toBeVisible()

    const lines = await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll('.toolbar-label')).find(
        (el) => el.textContent?.trim() === 'My Stuff',
      )
      if (!label) return null
      const style = getComputedStyle(label)
      return label.getBoundingClientRect().height / parseFloat(style.fontSize)
    })
    expect(lines).not.toBeNull()
    // One line box: height is about one font-size, never two.
    expect(lines!).toBeLessThan(1.8)
  })

  test('the bar hugs its controls rather than spanning the screen', async ({ page }) => {
    /*
     * The number that decides whether this reads as a floating control or as a
     * full-width bar with rounded ends — which is most of the way back to the
     * thing `09_IMPLEMENTATION_NOTES.md` §12 removed.
     *
     * It shipped at 93–94% of the screen and was rebuilt to 87–89%. Bounded on
     * BOTH sides: too wide is the original defect, and too narrow crowds the
     * labels and is how a later tidy-up would break it the other way.
     */
    await page.goto('/')
    for (const width of [360, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 664 })
      await page.waitForTimeout(120)

      const box = await page.locator('.toolbar').boundingBox()
      expect(box, `no toolbar at ${width}`).not.toBeNull()

      const share = (box!.width / width) * 100
      expect(share, `the toolbar spans ${Math.round(share)}% at ${width}`).toBeLessThanOrEqual(91)
      expect(share, `the toolbar is cramped at ${Math.round(share)}% at ${width}`).toBeGreaterThanOrEqual(84)

      // Even margins, so the pill is centred rather than merely narrow.
      const rightGap = width - (box!.x + box!.width)
      expect(Math.abs(box!.x - rightGap), `uneven margins at ${width}`).toBeLessThanOrEqual(1)

      // Compact: the brief asks for roughly 54–64px, and it came down to 52.
      expect(box!.height).toBeLessThanOrEqual(56)
    }
  })

  test('it sits low, and still clears the bottom edge', async ({ page }) => {
    /*
     * As low as safely possible, not as high as comfortably possible — but never
     * zero, because a bar touching the bottom reads as glued to Safari's chrome
     * rather than floating above it.
     */
    await page.goto('/')
    const gap = await page.evaluate(() => {
      const bar = document.querySelector('.toolbar')!
      return window.innerHeight - bar.getBoundingClientRect().bottom
    })
    expect(gap, 'the toolbar is hovering well above the bottom').toBeLessThanOrEqual(8)
    expect(gap, 'the toolbar is glued to the bottom edge').toBeGreaterThan(0)
  })

  test('the centre Add is on the exact middle at every width', async ({ page }) => {
    // §9/§31: the composition stays symmetric even though the labels differ.
    await page.goto('/')
    for (const width of [360, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 664 })
      await page.waitForTimeout(120)

      const offset = await page.evaluate(() => {
        const add = document.querySelector('.toolbar-add')!.getBoundingClientRect()
        return add.left + add.width / 2 - window.innerWidth / 2
      })
      expect(Math.abs(offset), `Add is off centre at ${width}`).toBeLessThanOrEqual(1)
    }
  })

  test('the page reserves the tightened bar and nothing more', async ({ page }) => {
    /*
     * §15. Lowering the bar only counts as recovered viewport if the shared
     * inset came down with it; padding left at the old bar's size would spend
     * the gain on empty background.
     */
    await page.goto('/my-stuff')
    await expect(toolbar(page)).toBeVisible()

    const measured = await page.evaluate(() => {
      const inner = document.querySelector('.screen-inner') as HTMLElement
      const bar = document.querySelector('.toolbar')!
      return {
        padding: parseFloat(getComputedStyle(inner).paddingBottom),
        occupied: window.innerHeight - bar.getBoundingClientRect().top,
      }
    })
    expect(measured.padding).toBeGreaterThanOrEqual(measured.occupied)
    expect(
      measured.padding - measured.occupied,
      `${Math.round(measured.padding - measured.occupied)}px reserved beyond the bar`,
    ).toBeLessThanOrEqual(20)
  })
})

test.describe('the same place on every route', () => {
  /*
   * The bug this exists for: the toolbar rested visibly higher on a route opened
   * cold, and dropped to its proper place only after a long page had been
   * scrolled — after which it stayed correct.
   *
   * The cause was `min-height: 100dvh` on the document. `dvh` is the currently
   * VISIBLE height, so while Safari's chrome is expanded a short page given that
   * floor is exactly viewport-tall, cannot scroll, and therefore never gives
   * Safari a reason to collapse its chrome — `09_IMPLEMENTATION_NOTES.md` §12's
   * defect, reintroduced for short pages only. The toolbar sits just above that
   * chrome, so it rested higher until some long page collapsed it. `lvh` — the
   * chrome-collapsed height — makes every page scrollable while the chrome is up
   * and exactly viewport-tall once it is down.
   *
   * ## What these can and cannot prove
   *
   * The mechanism is iOS Safari's, and this harness has a STATIC viewport where
   * `lvh`, `dvh` and `svh` are all the same number — so no test here can
   * reproduce the drop, and none of these would have failed while the bug was
   * live. Said plainly rather than dressed up: real confirmation is on the phone
   * (`08_MANUAL_IPHONE_CHECKLIST.md`).
   *
   * What they DO hold is the invariant the fix has to preserve, and the shape of
   * the wrong fix: a per-route bottom offset would satisfy the eye on a
   * screenshot and fail here immediately.
   */
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  const PRIMARY = ['/', '/trips', '/my-stuff', '/settings'] as const

  async function restingTop(page: Page): Promise<number> {
    return page.evaluate(() => {
      const bar = document.querySelector('.toolbar')
      if (!bar) return -1
      // Relative to the viewport bottom, so this is independent of scroll.
      return Math.round(window.innerHeight - bar.getBoundingClientRect().bottom)
    })
  }

  test('a cold load rests in the same place on every primary route', async ({ page }) => {
    const seen: Record<string, number> = {}

    for (const route of PRIMARY) {
      // A fresh navigation each time, never a tab click: the whole point is the
      // FIRST render of a route, not the state after another page has already
      // settled the viewport.
      await page.goto(route)
      await expect(toolbar(page)).toBeVisible()
      await page.waitForLoadState('networkidle')
      seen[route] = await restingTop(page)
    }

    const values = Object.values(seen)
    const spread = Math.max(...values) - Math.min(...values)
    expect(spread, `the toolbar rests differently per route: ${JSON.stringify(seen)}`).toBeLessThanOrEqual(1)
  })

  test('navigating between routes does not move it', async ({ page }) => {
    await page.goto('/settings')
    await expect(toolbar(page)).toBeVisible()
    const settled = await restingTop(page)

    for (const label of ['Home', 'Trips', 'My Stuff'] as const) {
      await toolbar(page).getByRole('link', { name: label }).click()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(
        Math.abs((await restingTop(page)) - settled),
        `the toolbar shifted vertically on the way to ${label}`,
      ).toBeLessThanOrEqual(1)
    }
  })

  test('the resting offset comes from one shared rule, not per route', async ({ page }) => {
    /*
     * §12's guard. The wrong fix is a route-specific bottom, and it would look
     * right in every screenshot — so the computed value is compared directly.
     */
    const offsets = new Set<string>()
    for (const route of PRIMARY) {
      await page.goto(route)
      await expect(toolbar(page)).toBeVisible()
      offsets.add(
        await page.evaluate(() => getComputedStyle(document.querySelector('.toolbar')!).bottom),
      )
    }
    expect(offsets.size, `more than one bottom offset in use: ${[...offsets].join(', ')}`).toBe(1)
  })
})
