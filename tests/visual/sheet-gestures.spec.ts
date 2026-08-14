import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { capture, collected, writeReport } from './gates'
import type { Restage } from './gates'

/**
 * The interaction states a still screenshot of a closed sheet cannot show.
 *
 * `screens.spec.ts` captures every surface at rest. This captures the four
 * states this pass introduced — a sheet under a finger, a sheet refusing to be
 * dragged away from an unsaved draft, and a sheet sitting on top of the
 * software keyboard — at all four widths and in both appearances, with the same
 * mechanical gates running on each.
 *
 * ## What the keyboard captures are, and are not
 *
 * There is no way to raise a real software keyboard in a headless browser, so
 * these do not prove that iOS reports the inset. They set the inset the app
 * would set and assert what the LAYOUT then does — the primary action clear of
 * the keyboard line, the sheet's top edge where it was. The other half, that the
 * number is computed correctly from `visualViewport`, is unit-tested in
 * `SheetGestures.test.tsx`. What neither can cover is iOS Safari's own reporting,
 * and that stays on the phone checklist rather than being claimed here.
 */

/** A keyboard roughly the height of an iPhone's, in the 664px Safari viewport. */
const KEYBOARD_PX = 336

test.describe.configure({ mode: 'serial' })

async function openApp(page: Page, path = '/') {
  await page.goto(path)
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
  await page.waitForLoadState('networkidle')
}

/** Puts a finger on the sheet and leaves it there, so the drag can be captured. */
async function holdDrag(page: Page, handle: Locator, dy: number): Promise<void> {
  const box = await handle.boundingBox()
  if (!box) throw new Error('visual: the drag handle is not on screen')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + dy, { steps: 10 })
  // Not released: the capture below is of a gesture in progress.
}

/** How far the sheet has been translated from its resting position. */
async function sheetOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>('.sheet')
    const match = /translateY\((-?[\d.]+)px\)/.exec(sheet?.style.transform ?? '')
    return match?.[1] ? Number(match[1]) : 0
  })
}

/** Stands the keyboard up by publishing the inset the app itself publishes. */
async function raiseKeyboard(page: Page, px: number): Promise<void> {
  await page.evaluate((inset) => {
    document
      .querySelector<HTMLElement>('.sheet')
      ?.style.setProperty('--sheet-keyboard-inset', `${inset}px`)
  }, px)
  await page.waitForTimeout(80)
}

/**
 * Puts the keyboard back after each viewport change.
 *
 * `capture` resizes the window at every width, and the app's own
 * `visualViewport` listener answers that resize by recomputing the inset — to
 * zero, because there is no real keyboard. Without this the images would be of
 * a sheet at rest under a filename that says otherwise.
 */
const keyboardStaysUp: Restage = async (page) => {
  await raiseKeyboard(page, KEYBOARD_PX)
}

/**
 * Refuses to photograph a drag that the resize let go of.
 *
 * The transform is an inline style and survives a viewport change, but "should
 * survive" is not evidence. This fails the capture rather than producing an
 * image of a sheet at rest labelled as a sheet mid-drag.
 */
function dragStaysHeld(min: number): Restage {
  return async (page, width) => {
    const offset = await sheetOffset(page)
    expect(offset, `the drag was lost at ${width}px`).toBeGreaterThanOrEqual(min)
  }
}

test.describe('a sheet under a finger', () => {
  test('follows the drag, and thins the backdrop as it goes', async ({ page }) => {
    await openApp(page, '/settings')
    await page.getByRole('button', { name: 'Packing rules' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await holdDrag(page, page.getByTestId('sheet-grabber'), 140)

    // The sheet is where the finger is, not where it started.
    expect(await sheetOffset(page)).toBeGreaterThan(100)

    const backdrop = await page.evaluate(
      () => document.querySelector<HTMLElement>('.sheet-backdrop')?.style.opacity ?? '',
    )
    expect(Number(backdrop)).toBeGreaterThan(0.4)
    expect(Number(backdrop)).toBeLessThan(1)

    await capture(page, 'sheet-mid-drag', dragStaysHeld(100))
    await page.mouse.up()
  })

  test('shows the grabber at rest, above the title', async ({ page }) => {
    await openApp(page, '/settings')
    await page.getByRole('button', { name: 'Packing rules' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    /*
     * Decorative and unreachable: §6 requires the handle to be unlabelled and
     * unfocusable, because a swipe is an accelerator and never the only way out.
     * Asserted here rather than left to the eye, since a `tabindex` added later
     * would look identical in the image.
     */
    const grabber = page.locator('.sheet-grabber')
    await expect(grabber).toBeVisible()
    expect(await grabber.evaluate((el) => el.hasAttribute('tabindex'))).toBe(false)
    expect(await grabber.evaluate((el) => el.textContent)).toBe('')

    await capture(page, 'sheet-grabber-at-rest')
    await page.keyboard.press('Escape')
  })
})

test.describe('a sheet holding an unsaved draft', () => {
  test('gives a little and stops', async ({ page }) => {
    await openApp(page, '/trips')
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await sheet.getByLabel('Trip name').fill('Lisbon in October')

    await holdDrag(page, page.getByTestId('sheet-grabber'), 300)

    /*
     * The whole difference from the sheet above. 300px of finger, and the sheet
     * has barely left the bottom edge — the refusal is said in the only language
     * a drag has, rather than by tracking the finger all the way down and then
     * snapping back with no explanation.
     */
    const moved = await sheetOffset(page)
    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThanOrEqual(44)

    await capture(page, 'sheet-dirty-held', dragStaysHeld(1))

    await page.mouse.up()
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Cancel' }).click()
  })
})

test.describe('a sheet with the keyboard up', () => {
  test('keeps its primary action above the keyboard', async ({ page }) => {
    await openApp(page, '/my-stuff')
    await page.getByRole('button', { name: /Add (an )?item/i }).first().click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    const restingTop = await sheet.evaluate((el) => el.getBoundingClientRect().top)
    await raiseKeyboard(page, KEYBOARD_PX)

    const box = await sheet.boundingBox()
    if (!box) throw new Error('visual: the sheet is not on screen')

    // Clear of the keyboard line, which is the whole point.
    const keyboardLine = 664 - KEYBOARD_PX
    expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(keyboardLine + 1)

    /*
     * And the top edge has not moved. A sheet that grew upward instead would
     * drag every control in it under a thumb already reaching for one — the same
     * defect `data-reserved` exists to prevent, arriving by another route.
     */
    const raisedTop = await sheet.evaluate((el) => el.getBoundingClientRect().top)
    expect(Math.abs(raisedTop - restingTop)).toBeLessThanOrEqual(2)

    // The footer action is a real, hittable control at the new height.
    const footer = sheet.locator('.sheet-footer button').first()
    const footerBox = await footer.boundingBox()
    expect(footerBox, 'the pinned action is not on screen with the keyboard up').not.toBeNull()
    if (footerBox) {
      expect(Math.round(footerBox.y + footerBox.height)).toBeLessThanOrEqual(keyboardLine + 1)
      expect(footerBox.height).toBeGreaterThanOrEqual(44)
    }

    await capture(page, 'sheet-keyboard-up', keyboardStaysUp)
    await page.keyboard.press('Escape')
  })

  test('reads the same in dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await openApp(page, '/my-stuff')
    await page.getByRole('button', { name: /Add (an )?item/i }).first().click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await raiseKeyboard(page, KEYBOARD_PX)

    await capture(page, 'dark-sheet-keyboard-up', keyboardStaysUp)
    await page.keyboard.press('Escape')
    await page.emulateMedia({ colorScheme: 'light' })
  })
})

test('every mechanical gate passed', () => {
  writeReport()
  const violations = collected()
  expect(violations, `${violations.length} violations — see .visual/report.txt`).toEqual([])
})
