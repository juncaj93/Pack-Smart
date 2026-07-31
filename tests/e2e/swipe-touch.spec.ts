import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { APPEARANCE_KEY } from '@shared/appearance'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/**
 * The swipe gesture driven by TOUCH, on the engine closest to iOS Safari.
 *
 * ## What this can and cannot prove
 *
 * It **can** prove that the row's touch listeners exist, are non-passive, claim
 * the axis from the first move that clears the lock distance, veto the pan for
 * exactly the gestures that are horizontal, and leave every vertical gesture
 * alone — against the real built bundle, in WebKit, at iPhone dimensions.
 *
 * It **cannot** prove the gesture works on a phone. Playwright has no API for a
 * multi-step touch drag, so the moves below are dispatched rather than
 * performed. A dispatched event is untrusted and, more to the point, does not
 * run WebKit's scroll arbitration at all — which is the exact mechanism that
 * broke PR #30. **This suite passing is not evidence that the gesture works on
 * hardware.** PR #30 is the proof: it passed 756 unit tests, 128 WebKit
 * end-to-end tests and the visual gate, and was unusable on Alex's iPhone.
 *
 * The single real-device check in
 * `technical-docs/08_MANUAL_IPHONE_CHECKLIST.md` is the gate. This is the layer
 * that stops obvious breakage reaching it.
 *
 * Written with plain `Event` objects rather than `new TouchEvent(...)`: WebKit
 * refuses `new Touch(...)` outright (`Illegal constructor`), which a previous
 * attempt at this coverage discovered only on CI, having passed on Chromium.
 */

const pageErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  /*
   * A handler that throws breaks nothing a locator can see — the row keeps its
   * classes and the tap still works through the button behind it — so without
   * an explicit listener this file could stay green through an exception on
   * every touch.
   */
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
})

test.afterEach(({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([])
})

async function openChecklist(page: Page): Promise<Locator> {
  const { trips } = await page.evaluate(() =>
    fetch('/api/trips').then((r) => r.json() as Promise<{ trips: Array<{ id: string }> }>),
  )
  const trip = trips[0]
  if (!trip) throw new Error('swipe-touch: no seeded trip to open')

  await page.goto(`/trips/${trip.id}`)
  const rows = page.locator('.swipe-row')
  await expect(rows.first()).toBeVisible()
  return rows
}

interface TouchResult {
  /** Moves on which the row vetoed the browser's pan. */
  vetoed: number
  moves: number
  /** The surface's translateX after the last event. */
  offset: number
  classes: string
}

/**
 * Drives a touch across a row, one move per animation frame.
 *
 * `cancelable: true` matters: `preventDefault()` on an uncancelable event has
 * done nothing at all, so reading `defaultPrevented` back is the only honest
 * way to know the veto landed rather than merely being attempted.
 *
 * One move per frame is both faithful — a real finger produces one — and
 * necessary, since the transform is written inside the handler and read back
 * here.
 */
async function touchSwipe(
  row: Locator,
  {
    dx,
    dy = 0,
    steps = 10,
    duration = 260,
    release = true,
  }: { dx: number; dy?: number; steps?: number; duration?: number; release?: boolean },
): Promise<TouchResult> {
  await row.scrollIntoViewIfNeeded()

  return row.evaluate(
    async (
      node: HTMLElement,
      opts: { dx: number; dy: number; steps: number; duration: number; release: boolean },
    ) => {
      const box = node.getBoundingClientRect()
      // Start from whichever edge leaves room to travel, so a left swipe does
      // not run off the viewport within a few pixels.
      const x0 = opts.dx < 0 ? box.right - 12 : box.left + 12
      const y0 = box.top + box.height / 2
      /*
       * Anchored so the gesture ENDS at now, rather than starting at it.
       *
       * The timestamps decide the velocity, so a slow release has to claim a
       * long duration — but claiming it forwards puts the whole gesture in the
       * future, and the row then treats a real click arriving milliseconds
       * later as one that preceded the release. Ending at `now` keeps the
       * velocity honest and the clock sane.
       */
      const origin = performance.now() - opts.duration

      function touch(type: string, points: Array<{ x: number; y: number }>, time: number): Event {
        const event = new Event(type, { bubbles: true, cancelable: true })
        const list = points.map((point) => ({ clientX: point.x, clientY: point.y, target: node }))
        Object.defineProperties(event, {
          touches: { value: type === 'touchend' ? [] : list },
          changedTouches: { value: list },
          timeStamp: { value: time },
        })
        return event
      }

      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

      node.dispatchEvent(touch('touchstart', [{ x: x0, y: y0 }], origin))

      let vetoed = 0
      for (let step = 1; step <= opts.steps; step += 1) {
        const event = touch(
          'touchmove',
          [{ x: x0 + (opts.dx * step) / opts.steps, y: y0 + (opts.dy * step) / opts.steps }],
          origin + (opts.duration * step) / opts.steps,
        )
        node.dispatchEvent(event)
        if (event.defaultPrevented) vetoed += 1
        await frame()
      }

      if (opts.release) {
        node.dispatchEvent(
          touch('touchend', [{ x: x0 + opts.dx, y: y0 + opts.dy }], origin + opts.duration),
        )
        await frame()
      }

      const surface = node.querySelector<HTMLElement>('.swipe-surface')
      const match = /translateX\((-?[\d.]+)px\)/.exec(surface?.style.transform ?? '')

      return {
        vetoed,
        moves: opts.steps,
        offset: match ? Number(match[1]) : 0,
        classes: node.className,
      }
    },
    { dx, dy, steps, duration, release },
  )
}

const packed = (row: Locator) => row.locator('.check-main')
const firstRow = (page: Page) => page.locator('.swipe-row').first()

/**
 * The item's name, from the ⋯ control's label rather than from the row's text.
 *
 * `.check-name` also carries the category emoji and, on an essential, the word
 * "Essential" — so using its text as a search term finds nothing, which is a
 * test that fails for a reason that has nothing to do with the gesture.
 */
async function itemName(row: Locator): Promise<string> {
  const label = (await row.locator('.check-more').getAttribute('aria-label')) ?? ''
  return label.replace(/^Options for /, '').trim()
}

/**
 * A real touch tap, which is what a follow-up interaction has to be.
 *
 * `locator.click()` sends only mouse events, and a mouse event arriving within
 * half a second of a touch is exactly what the row suppresses — because on a
 * phone that IS the emulated click that follows a tap. After a swipe, therefore,
 * the honest way to press something is to press it with a finger.
 */
/** The tick control of the row carrying this item, wherever the list moved it. */
function rowNamed(page: Page, name: string): Locator {
  return page
    .locator('.swipe-row', { has: page.getByRole('button', { name: `Options for ${name}` }) })
    .first()
    .locator('.check-main')
}

async function tap(page: Page, target: Locator) {
  const box = await target.boundingBox()
  if (!box) throw new Error('swipe-touch: nothing to tap')
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

async function ensurePacked(row: Locator, wanted: boolean) {
  if (((await packed(row).getAttribute('aria-pressed')) === 'true') === wanted) return
  await packed(row).click()
  await expect(packed(row)).toHaveAttribute('aria-pressed', String(wanted))
}

test.describe('the axis, and who gets it', () => {
  test('a horizontal touch takes the axis and stops the browser panning', async ({ page }) => {
    /*
     * The regression, as an assertion.
     *
     * PR #30 decided the axis in a POINTER handler and vetoed from a TOUCH
     * handler, so the veto needed an ordering between two event streams that
     * nothing guaranteed — and it never landed inside the 8px lock window,
     * which is the window the browser makes its own decision in. Here one
     * handler does both, from one event, so every move is vetoed.
     */
    const rows = await openChecklist(page)
    const result = await touchSwipe(rows.first(), { dx: 160, release: false })

    expect(result.vetoed).toBe(result.moves)
    expect(result.offset).toBeGreaterThan(100)
    expect(result.classes).toContain('is-dragging')
  })

  test('a vertical touch is left entirely alone', async ({ page }) => {
    /*
     * The half that must keep working. A list that will not scroll because
     * every row grabs the gesture is a worse product than one with no swipe at
     * all — which is why this is `toBe(0)` rather than "mostly".
     */
    const result = await touchSwipe((await openChecklist(page)).first(), { dx: 8, dy: 200 })

    expect(result.vetoed).toBe(0)
    expect(result.offset).toBe(0)
    expect(result.classes).not.toContain('is-dragging')
  })

  test('a diagonal touch goes to whichever axis is clearly winning', async ({ page }) => {
    // 1.4× is the contract in INTERACTION_PATTERNS.md §2: a thumb arcing while
    // it scrolls stays a scroll, and one arcing while it swipes stays a swipe.
    const rows = await openChecklist(page)

    const scrolling = await touchSwipe(rows.first(), { dx: 60, dy: 70 })
    expect(scrolling.vetoed).toBe(0)
    expect(scrolling.offset).toBe(0)

    const swiping = await touchSwipe(rows.first(), { dx: 140, dy: 40, release: false })
    expect(swiping.vetoed).toBeGreaterThan(0)
    expect(swiping.offset).toBeGreaterThan(0)
  })

  test('leaves the page scrollable from a row, by the only means that decide it', async ({
    page,
  }) => {
    /*
     * This test was first written with `page.mouse.wheel`, and it failed on CI
     * with "Mouse wheel is not supported in mobile WebKit" — reaching for a
     * Chromium-only capability to make a claim about the engine the product
     * ships on. That is the same mistake, in a smaller way, as the one this
     * whole hotfix exists to correct, so it is recorded rather than quietly
     * rewritten.
     *
     * There is no way to perform a touch scroll here. What CAN be asserted is
     * every condition that decides whether one will happen, and asserting those
     * is honest where asserting a scroll would have been theatre:
     *
     *  - the row's effective `touch-action` still permits a vertical pan;
     *  - there is genuinely something to scroll;
     *  - a vertical touch on a row is not vetoed, so the browser keeps the pan.
     *
     * Whether it then FEELS like a scroll is the phone's to answer, and it is
     * action three of the manual check.
     */
    const rows = await openChecklist(page)

    expect(
      await rows.first().evaluate((node) => getComputedStyle(node).touchAction),
    ).toBe('pan-y')

    expect(
      await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight),
    ).toBe(true)

    const vertical = await touchSwipe(rows.first(), { dx: 4, dy: 240 })
    expect(vertical.vetoed).toBe(0)
  })
})

test.describe('what a swipe does', () => {
  test('a partial swipe tracks the finger and commits nothing', async ({ page }) => {
    const rows = await openChecklist(page)
    const row = rows.first()
    await ensurePacked(row, false)

    const held = await touchSwipe(row, { dx: 60, release: false })
    expect(held.offset).toBeGreaterThan(40)

    // Released short and slow: below the commit threshold, so cancelling is free.
    await touchSwipe(row, { dx: 60, duration: 900 })
    await expect(packed(firstRow(page))).toHaveAttribute('aria-pressed', 'false')
    await expect(firstRow(page)).not.toHaveClass(/is-dragging/)
  })

  test('a full swipe packs the row, and the row settles before the list moves', async ({ page }) => {
    /*
     * The reorder timing, which is a product requirement rather than a detail:
     * packing moves the row into another section, so the completion is deferred
     * by exactly the settle duration and the list cannot resort under a finger
     * that is still on the row.
     */
    const rows = await openChecklist(page)
    const row = rows.first()
    await ensurePacked(row, false)
    const name = await itemName(row)

    await touchSwipe(row, { dx: 300, duration: 500 })

    await expect.poll(() => rowNamed(page, name).getAttribute('aria-pressed')).toBe('true')
  })

  test('swiping a packed row again unpacks it', async ({ page }) => {
    const rows = await openChecklist(page)
    const row = rows.first()
    await ensurePacked(row, true)
    const name = await itemName(row)

    await touchSwipe(row, { dx: 300, duration: 500 })

    await expect.poll(() => rowNamed(page, name).getAttribute('aria-pressed')).toBe('false')
  })

  test('a swipe on one row leaves its neighbours where they were', async ({ page }) => {
    const rows = await openChecklist(page)
    expect(await rows.count()).toBeGreaterThan(2)

    const held = await touchSwipe(rows.nth(1), { dx: 140, release: false })
    expect(held.offset).toBeGreaterThan(0)

    for (const index of [0, 2]) {
      const style = await rows.nth(index).locator('.swipe-surface').getAttribute('style')
      expect(style ?? '').not.toContain('translateX')
    }
  })

  test('a left swipe opens the tray, and Remove offers an Undo', async ({ page }) => {
    const rows = await openChecklist(page)
    const name = await itemName(rows.first())

    await touchSwipe(rows.first(), { dx: -140, duration: 500 })
    await expect(firstRow(page)).toHaveClass(/is-tray-open/)

    await tap(page, firstRow(page).getByRole('button', { name: 'Remove' }))

    /*
     * The red ✕ is reversible, and the Undo is what makes that true. A
     * destructive gesture without one would be the thing VISUAL_ACCEPTANCE.md §3
     * rejects — and "Remove" would be the wrong word for it.
     */
    const undo = page.getByRole('button', { name: 'Undo' })
    await expect(undo).toBeVisible()
    await expect(page.getByText(/moved to Not bringing/)).toBeVisible()

    await tap(page, undo)
    await expect(page.locator('.check-name', { hasText: name }).first()).toBeVisible()
  })
})

test.describe('the gesture in the states Alex actually uses', () => {
  test('works with a search narrowing the list', async ({ page }) => {
    /*
     * Search and filters re-derive `sections`, which is where a row's key comes
     * from. A gesture that depended on a React render surviving that would
     * behave differently with a filter on, so this runs the same swipe against
     * a narrowed list.
     */
    const rows = await openChecklist(page)
    const name = await itemName(rows.first())
    await page.getByRole('searchbox', { name: 'Search this list' }).fill(name)

    const row = firstRow(page)
    await expect(row).toBeVisible()
    await ensurePacked(row, false)

    await touchSwipe(row, { dx: 300, duration: 500 })
    await expect.poll(() => rowNamed(page, name).getAttribute('aria-pressed')).toBe('true')
  })

  for (const appearance of ['light', 'dark'] as const) {
    test(`behaves identically in ${appearance}`, async ({ page }) => {
      // Appearance changes what a row looks like. It may not change what the
      // gesture does, and a theme-dependent gesture would be a real defect.
      await page.evaluate(
        ([key, value]) => localStorage.setItem(String(key), String(value)),
        [APPEARANCE_KEY, appearance],
      )
      const rows = await openChecklist(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', appearance)

      await ensurePacked(rows.first(), false)
      const name = await itemName(rows.first())

      const result = await touchSwipe(rows.first(), { dx: 300, duration: 500 })
      expect(result.vetoed).toBe(result.moves)
      await expect.poll(() => rowNamed(page, name).getAttribute('aria-pressed')).toBe('true')
    })
  }

  test('the tap path still works, which is what the gesture accelerates', async ({ page }) => {
    /*
     * A real touch, not a dispatched one — `page.touchscreen.tap` is the one
     * genuine touch this harness has. Everything reachable by swiping must be
     * reachable this way, and that is what would let the gesture be removed
     * tomorrow without removing a single capability.
     */
    const rows = await openChecklist(page)
    await ensurePacked(rows.first(), false)
    const name = await itemName(rows.first())

    const box = await rows.first().locator('.check-main').boundingBox()
    if (!box) throw new Error('swipe-touch: the row control has no box')
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)

    /*
     * Followed by NAME rather than by position. Packing moves the row into
     * another section, and these specs share one database with the rest of the
     * suite — so "the first row" after the tap is not reliably the row that was
     * tapped, and asserting on it makes this test report on the run order.
     */
    await expect.poll(() => rowNamed(page, name).getAttribute('aria-pressed')).toBe('true')
  })
})
