import { expect, test } from '@playwright/test'
import { ownedName, signIn } from './fixtures'
import type { Locator, Page } from '@playwright/test'

/**
 * Getting out of a sheet without reaching the top of the screen.
 *
 * The unit suite (`SheetGestures.test.tsx`) owns the arithmetic — thresholds,
 * damping, the viewport shortfall. This file owns the part only an engine can
 * answer: that the gesture survives a real compositor, that the sheet's own
 * scrolling region does not compete with it, and that a form holding an unsaved
 * draft cannot be thrown away by a thumb on any of the casual routes.
 *
 * Real pointer events through `page.mouse`, for the reason `swipe.spec.ts`
 * gives: a synthesised event carries no timeStamp, so the velocity path could
 * never be exercised, and a hand-built event dictionary is exactly the kind of
 * test that passes while the gesture is broken.
 */

const pageErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
  await signIn(page)
})

test.afterEach(({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([])
})

/**
 * Drags downward from the middle of `handle`.
 *
 * `steps` is the whole difference between the two gestures this file cares
 * about: many steps is a deliberate drag, one step is a flick, and Playwright
 * spends real time on each so the velocity the sheet measures is real.
 */
async function dragDown(page: Page, handle: Locator, dy: number, steps = 12): Promise<void> {
  const box = await handle.boundingBox()
  if (!box) throw new Error('sheet-gestures: the drag handle is not on screen')

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + dy, { steps })
  await page.mouse.up()
}

/** Opens the packing-rules sheet in Settings: long, scrollable, nothing unsaved. */
async function openLongSheet(page: Page): Promise<Locator> {
  await page.goto('/settings')
  await page.getByRole('button', { name: /Packing rules/ }).first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  return sheet
}

test.describe('a sheet with nothing to lose', () => {
  test('a downward drag from the grabber dismisses it', async ({ page }) => {
    const sheet = await openLongSheet(page)
    await dragDown(page, sheet.getByTestId('sheet-grabber'), 220)
    await expect(sheet).toBeHidden()
  })

  test('a downward drag from the title dismisses it too', async ({ page }) => {
    /*
     * The reachability change. 32px of grabber was the only drag surface, and
     * on a 390×844 phone it is the strip furthest from where a thumb rests.
     */
    const sheet = await openLongSheet(page)
    await dragDown(page, sheet.getByRole('heading', { name: 'Packing rules' }), 220)
    await expect(sheet).toBeHidden()
  })

  test('a nudge does not, however fast it is', async ({ page }) => {
    // One step, so Playwright covers the distance in a single event: fast enough
    // to clear the velocity threshold and far too short to have been meant.
    const sheet = await openLongSheet(page)
    await dragDown(page, sheet.getByTestId('sheet-grabber'), 15, 1)
    await expect(sheet).toBeVisible()
  })

  test('a short deliberate drag springs back', async ({ page }) => {
    const sheet = await openLongSheet(page)
    await dragDown(page, sheet.getByTestId('sheet-grabber'), 50, 20)
    await expect(sheet).toBeVisible()
  })

  test('the backdrop dismisses it', async ({ page }) => {
    const sheet = await openLongSheet(page)
    await page.getByTestId('sheet-backdrop').click({ position: { x: 195, y: 40 } })
    await expect(sheet).toBeHidden()
  })
})

test.describe('the sheet body still scrolls', () => {
  test('dragging the content does not dismiss the sheet', async ({ page }) => {
    /*
     * The defect the drag region exists to avoid. If the sheet claimed every
     * downward gesture, scrolling a long list back to its top would collapse
     * the sheet under the thumb — `INTERACTION_PATTERNS.md` §3 requires the
     * content to scroll inside the sheet, not to move it.
     */
    const sheet = await openLongSheet(page)
    const body = sheet.locator('.sheet-body')

    await dragDown(page, body, 200)
    await expect(sheet).toBeVisible()
  })

  test('the content scrolls rather than the page behind it', async ({ page }) => {
    const sheet = await openLongSheet(page)
    const body = sheet.locator('.sheet-body')

    const scrollable = await body.evaluate((el) => el.scrollHeight > el.clientHeight + 8)
    test.skip(!scrollable, 'the rules sheet is short on this database')

    const box = await body.boundingBox()
    if (!box) throw new Error('sheet-gestures: the sheet body is not on screen')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 160)

    await expect
      .poll(async () => body.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0)

    // The page behind stays exactly where it was, and the sheet stays open.
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await expect(sheet).toBeVisible()
  })
})

test.describe('closing a sheet returns you to where you were', () => {
  /*
   * The body scroll lock is `position: fixed`, which is the only thing that
   * reliably stops iOS scrolling the page behind a sheet — and it resets the
   * page to the top as a side effect. `BottomSheet` captures the offset and puts
   * it back on close, and until now nothing checked that it did: jsdom has no
   * layout, so the unit suite stubs `scrollTo` to a no-op and could not tell a
   * working restore from a missing one.
   *
   * Without it, closing a sheet on row 40 of the wardrobe puts Alex back at row
   * one — which is `INTERACTION_PATTERNS.md` §3 and doc 02's state continuity,
   * lost on every sheet in the product at once.
   */
  test('the page is where it was, not back at the top', async ({ page }) => {
    await page.goto('/my-stuff')
    await expect(page.getByRole('heading', { name: 'My Stuff' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await page.evaluate(() => window.scrollTo(0, 600))
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(400)
    const before = await page.evaluate(() => window.scrollY)

    /*
     * Opened from a row that is already on screen, deliberately.
     *
     * Playwright scrolls a target into view before clicking it, so opening the
     * sheet from the `+` in the page header would scroll the page to the top
     * BEFORE the sheet ever mounted — and the test would then be measuring its
     * own setup rather than the restore. A row under the current scroll position
     * needs no scrolling to reach.
     */
    const index = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.stuff-row')).findIndex((el) => {
        const top = el.getBoundingClientRect().top
        return top > 120 && top < 400
      }),
    )
    expect(index, 'no wardrobe row is on screen at this scroll position').toBeGreaterThanOrEqual(0)

    await page.locator('.stuff-row').nth(index).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    // The page behind is pinned while the sheet is open.
    expect(await page.evaluate(() => document.body.classList.contains('is-locked'))).toBe(true)

    await sheet.getByRole('button', { name: 'Cancel' }).click()
    await expect(sheet).toBeHidden()

    await expect
      .poll(async () => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(before - 8)
  })
})

test.describe('a form holding an unsaved draft', () => {
  /** The new-trip sheet, with a name typed into it and nothing saved. */
  async function openDirtyTripSheet(page: Page): Promise<{ sheet: Locator; name: string }> {
    const name = ownedName('Gesture')
    await page.goto('/trips')
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await sheet.getByLabel('Trip name').fill(name)
    return { sheet, name }
  }

  test('a drag cannot take it, and barely moves the sheet', async ({ page }) => {
    const { sheet } = await openDirtyTripSheet(page)

    await dragDown(page, sheet.getByTestId('sheet-grabber'), 300)

    await expect(sheet).toBeVisible()
    // Back at rest, not left hanging where the finger stopped.
    await expect
      .poll(async () => sheet.evaluate((el) => el.style.transform))
      .toBe('')
  })

  test('a backdrop tap cannot take it either', async ({ page }) => {
    const { sheet, name } = await openDirtyTripSheet(page)

    await page.getByTestId('sheet-backdrop').click({ position: { x: 195, y: 30 } })

    await expect(sheet).toBeVisible()
    await expect(sheet.getByLabel('Trip name')).toHaveValue(name)
  })

  test('the deliberate exit is on screen and still works', async ({ page }) => {
    /*
     * The guard is only defensible because leaving is never blocked — it is
     * moved onto a control that says what it does. Doc 02 §2 prefers undo to a
     * confirmation, and there is nothing to undo once a draft is gone.
     */
    const { sheet } = await openDirtyTripSheet(page)

    await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Cancel' }).click()
    await expect(sheet).toBeHidden()
  })

  test('an untouched form is not treated as a draft', async ({ page }) => {
    /*
     * "Dirty" has to mean edited, not opened. A trip sheet opens pre-filled from
     * a template, so a guard that asked whether the form had content would hold
     * every sheet shut from the moment it appeared.
     */
    await page.goto('/trips')
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await dragDown(page, sheet.getByTestId('sheet-grabber'), 300)
    await expect(sheet).toBeHidden()
  })
})

test.describe('with motion turned down', () => {
  /*
   * `prefers-reduced-motion` is honoured globally in `global.css`, and nothing
   * in this pass adds a transition outside that — but "nothing should have"
   * was not checked anywhere in the repository until now. A new keyframe or an
   * inline duration would sail past every other test in the suite.
   *
   * The gesture itself is deliberately NOT reduced. A sheet following a finger
   * is direct manipulation, not decoration; iOS does not stop tracking a drag
   * when motion is reduced, and a sheet that ignored the thumb would be a worse
   * answer than one that moves.
   */
  test('the sheet does not animate, and still drags away', async ({ page }) => {
    /*
     * `emulateMedia` rather than the `reducedMotion` fixture, which does not
     * reach the page in this environment — `matchMedia` still reported
     * `no-preference` under it, so the whole test would have run against an
     * ordinary page and passed without ever reducing anything. Asserted below
     * for the same reason: an emulation that silently stops working must fail
     * the test rather than quietly empty it.
     */
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const sheet = await openLongSheet(page)

    expect(
      await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
      'reduced motion is not actually emulated — this test proves nothing',
    ).toBe(true)

    const durations = await sheet.evaluate((el) => {
      /*
       * Milliseconds, parsed — not the string. `transitionDuration` reports
       * seconds, so `0.24s` and `0.00001s` differ by one character and a naive
       * pattern match calls the animated one reduced. The first version of this
       * assertion did exactly that and stayed green with the global rule
       * deleted.
       */
      const ms = (node: Element | null) => {
        if (!node) return null
        const raw = getComputedStyle(node).transitionDuration.split(',')[0]?.trim() ?? '0s'
        return raw.endsWith('ms') ? parseFloat(raw) : parseFloat(raw) * 1000
      }
      return { sheet: ms(el), backdrop: ms(document.querySelector('.sheet-backdrop')) }
    })

    // The global rule collapses every transition to 0.01ms.
    expect(durations.sheet).toBeLessThan(1)
    expect(durations.backdrop).toBeLessThan(1)

    await dragDown(page, sheet.getByTestId('sheet-grabber'), 220)
    await expect(sheet).toBeHidden()
  })
})

test.describe('Safari keeps its own gestures', () => {
  test('nothing claims the screen edges', async ({ page }) => {
    /*
     * `touch-action: none` belongs to the sheet's ~76px drag region and nowhere
     * else. A larger claim — the backdrop, the body, the page — would take
     * Safari's back-swipe gutters with it, and the browser's own navigation is
     * not this app's to override.
     */
    const sheet = await openLongSheet(page)

    const claimed = await sheet.evaluate(() => {
      const wide: string[] = []
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        if (getComputedStyle(el).touchAction !== 'none') continue
        const rect = el.getBoundingClientRect()
        // Anything tall enough to swallow a vertical edge swipe.
        if (rect.height > 120) wide.push(`${el.className} ${Math.round(rect.height)}px`)
      }
      return wide
    })

    expect(claimed).toEqual([])
  })
})
