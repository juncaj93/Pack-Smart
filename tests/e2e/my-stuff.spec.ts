import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

async function openMyStuff(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /My Stuff/ }).click()
  await expect(page.getByRole('heading', { name: 'My Stuff' })).toBeVisible()
}

/** Names are unique per run so repeated runs against the same local DB stay independent. */
function uniqueName(prefix: string) {
  return `${prefix} ${Math.floor(performance.now())}`
}

test.describe('My Stuff', () => {
  test.beforeEach(async ({ page }) => {
    await openMyStuff(page)
  })

  test('adds a garment and shows it in the list', async ({ page }) => {
    const name = uniqueName('Test Zip-Up')

    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    await sheet.getByLabel('Name').fill(name)
    await sheet.getByLabel('Category').selectOption('Tops & Outerwear')
    await sheet.getByLabel('Colour').fill('Black')
    await sheet.getByRole('button', { name: 'Add to My Stuff' }).click()

    await expect(sheet).toHaveCount(0)
    await expect(page.getByText(name)).toBeVisible()
  })

  /*
   * The regression Alex hit, and how it is fixed now.
   *
   * Add used to sit at the bottom of the list, so with a full wardrobe loaded
   * the screen's primary action was 118 rows below the fold and he reported it
   * as missing. It is a compact control on the heading's line now (product doc
   * 02 §10): visible the moment the screen opens, taking no row of its own.
   */
  test('puts Add in the header, on screen and 44pt, with no second one below', async ({ page }) => {
    const viewport = page.viewportSize()!
    const add = page.getByRole('button', { name: 'Add item', exact: true })

    await expect(add).toBeVisible()

    const box = await add.boundingBox()
    expect(box).not.toBeNull()

    // Visible without scrolling.
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)

    // The TAP area clears 44pt even though the drawn chip is smaller.
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)

    // On the heading's line rather than in a row of its own.
    const heading = await page.getByRole('heading', { name: 'My Stuff' }).boundingBox()
    expect(Math.abs((box!.y + box!.height / 2) - (heading!.y + heading!.height / 2))).toBeLessThan(30)

    // And exactly one Add on the page — no large persistent button lower down.
    await expect(page.getByRole('button', { name: /^Add item$/ })).toHaveCount(1)

    await add.click()
    await expect(page.getByRole('dialog').getByLabel('Name')).toBeVisible()
  })

  test('refuses to save an item with no name, and says why on the field', async ({ page }) => {
    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')

    await sheet.getByRole('button', { name: 'Add to My Stuff' }).click()

    await expect(sheet.getByText('Give this a name.')).toBeVisible()
    // Still open, so nothing typed is lost.
    await expect(sheet).toBeVisible()
  })

  test('keeps optional detail behind More details', async ({ page }) => {
    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')

    // Product doc 02 §10: progressive disclosure, not every field at once.
    await expect(sheet.getByLabel('Brand')).toHaveCount(0)
    await sheet.getByRole('button', { name: 'More details' }).click()
    await expect(sheet.getByLabel('Brand')).toBeVisible()
  })

  test('finds an item by search', async ({ page }) => {
    const name = uniqueName('Searchable Parka')

    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Name').fill(name)
    await sheet.getByRole('button', { name: 'Add to My Stuff' }).click()
    await expect(sheet).toHaveCount(0)

    await page.getByLabel('Search your items').fill('Searchable Parka')
    await expect(page.getByText(name)).toBeVisible()

    await page.getByLabel('Search your items').fill('nothing-matches-this-at-all')
    await expect(page.getByText('Nothing matches')).toBeVisible()
  })

  test('archives an item and can restore it', async ({ page }) => {
    const name = uniqueName('Archivable Tee')

    await page.getByRole('button', { name: /^Add/ }).first().click()
    let sheet = page.getByRole('dialog')
    await sheet.getByLabel('Name').fill(name)
    await sheet.getByRole('button', { name: 'Add to My Stuff' }).click()
    await expect(sheet).toHaveCount(0)

    await page.getByRole('button', { name: new RegExp(name) }).click()
    sheet = page.getByRole('dialog')
    await sheet.getByRole('button', { name: 'Archive' }).click()
    await expect(sheet).toHaveCount(0)

    // Gone from the default list — archived items must not appear in future
    // recommendations (product doc 05 §11).
    await expect(page.getByRole('button', { name: new RegExp(name) })).toHaveCount(0)

    // But recoverable, not destroyed.
    await page.getByRole('button', { name: /Show archived/ }).click()
    await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()

    await page.getByRole('button', { name: new RegExp(name) }).click()
    sheet = page.getByRole('dialog')
    await sheet.getByRole('button', { name: 'Restore to My Stuff' }).click()
    await expect(sheet).toHaveCount(0)
  })

  test('every field in the add sheet is at least 16px', async ({ page }) => {
    // Below 16px iOS Safari zooms on focus and never zooms back.
    await page.getByRole('button', { name: /^Add/ }).first().click()
    await page.getByRole('button', { name: 'More details' }).click()

    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea'))
        .map((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
    )

    expect(sizes.length).toBeGreaterThan(3)
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16)
  })
})
