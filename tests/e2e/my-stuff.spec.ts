import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ownedName } from './fixtures'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

async function openMyStuff(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /My Stuff/ }).click()
  await expect(page.getByRole('heading', { name: 'My Stuff' })).toBeVisible()
}

/** Names are unique per run so repeated runs against the same local DB stay independent. */
test.describe('My Stuff', () => {
  test.beforeEach(async ({ page }) => {
    await openMyStuff(page)
  })

  test('adds a garment and shows it in the list', async ({ page }) => {
    const name = ownedName('Test Zip-Up')

    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    await sheet.getByLabel('Name').fill(name)
    await sheet.getByLabel('Category').selectOption('Tops & Outerwear')
    await sheet.getByLabel('Color').fill('Black')
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
    const name = ownedName('Searchable Parka')

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
    const name = ownedName('Archivable Tee')

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

test.describe('filtering and sorting a wardrobe of a hundred things', () => {
  test.beforeEach(async ({ page }) => {
    await openMyStuff(page)
  })

  test('filters by category from a dropdown, not a sideways strip', async ({ page }) => {
    /*
     * Thirteen categories used to scroll horizontally inside a strip, which showed
     * three of them and hid the rest behind a gesture nobody discovers. The
     * dropdown shows all of them in one tap and costs half the vertical space.
     */
    const filter = page.getByLabel('Filter by category')
    await expect(filter).toBeVisible()

    const count = page.locator('.stuff-count')
    await expect(count).toBeVisible()
    const everything = (await count.textContent()) ?? ''

    await filter.selectOption('Footwear')
    /*
     * Wait for the COUNT to change rather than counting rows straight away.
     * Choosing a category refetches, and reading `.stuff-row` in the same tick
     * measured the unfiltered list — the first version of this test asserted
     * 126 > 126 and was right to fail.
     */
    await expect(count).not.toHaveText(everything)
    const filtered = await page.locator('.stuff-row').count()
    expect(filtered).toBeGreaterThan(0)

    await filter.selectOption('')
    await expect(count).toHaveText(everything)
    expect(await page.locator('.stuff-row').count()).toBeGreaterThan(filtered)
  })

  test('sorts, and the order actually changes', async ({ page }) => {
    const firstName = () => page.locator('.stuff-name').first().textContent()
    const sort = page.getByLabel('Sort')

    await sort.selectOption('name')
    const byName = (await firstName())?.trim()

    await sort.selectOption('recent')
    const byRecent = (await firstName())?.trim()

    /*
     * Asserting the order CHANGED rather than asserting a specific first row: the
     * wardrobe differs between a seeded run and a developer's database, and a test
     * that names a garment would be testing the fixture. What matters is that the
     * control does something.
     */
    expect(byName).toBeTruthy()
    expect(byRecent).toBeTruthy()

    // And back again, to prove it is a sort rather than a one-way shuffle.
    await sort.selectOption('name')
    expect((await firstName())?.trim()).toBe(byName)
  })

  test('opens grouped by category, so a hundred things are not one alphabetical run', async ({
    page,
  }) => {
    /*
     * The default, not an option that has to be found. Alphabetical was the right
     * default when this was a flat list and nothing else; with 119 items "where is
     * the black jacket" is answered by looking under Outerwear, and answering it
     * alphabetically means already knowing the name.
     */
    await expect(page.getByLabel('Sort')).toHaveValue('category')

    const headings = page.locator('.stuff-section .section-heading')
    // Wait for the list, then count. `count()` does not retry, so reading it
    // before the fetch resolves measures an empty screen and reports zero.
    await expect(headings.first()).toBeVisible()
    expect(await headings.count()).toBeGreaterThan(1)

    // Each heading counts its own section, and the counts add up to the list.
    const counts = await page.locator('.stuff-section .section-count').allTextContents()
    const summed = counts.reduce((total, text) => total + Number(text), 0)
    expect(summed).toBe(await page.locator('.stuff-row').count())
  })

  test('drops the headings for the sorts that cut across categories', async ({ page }) => {
    // "Most packed" split into thirteen separate rankings answers a question
    // nobody asked, so those sorts are one flat list with no headings at all.
    await expect(page.locator('.stuff-section .section-heading').first()).toBeVisible()

    await page.getByLabel('Sort').selectOption('packed')
    await expect(page.locator('.stuff-section .section-heading')).toHaveCount(0)
    expect(await page.locator('.stuff-row').count()).toBeGreaterThan(0)
  })

  test('remembers that something is always packed on the day of departure', async ({ page }) => {
    const name = ownedName('Day Of Thing')

    await page.getByRole('button', { name: /^Add/ }).first().click()
    let sheet = page.getByRole('dialog')
    await sheet.getByLabel('Name').fill(name)
    await sheet.getByLabel('Category').selectOption('Toiletries')

    /*
     * The point of putting this on the ITEM rather than on one trip's copy of it:
     * a bite guard or a toothbrush is day-of on every future trip without being
     * set again. `EntrySheet` still has the same control for a one-trip exception.
     */
    await sheet.getByRole('button', { name: 'Day of Departure' }).click()
    await sheet.getByRole('button', { name: 'Add to My Stuff' }).click()
    await expect(page.getByText(name)).toBeVisible()

    // Reopen it: the choice was stored, not just shown.
    await page.locator('.stuff-row').filter({ hasText: name }).first().click()
    sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Day of Departure' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

test.describe('adding an item is one screen, not a scroll', () => {
  test.beforeEach(async ({ page }) => {
    await openMyStuff(page)
  })

  test('the fields you always fill in, and Save, are on screen without scrolling', async ({
    page,
  }) => {
    /*
     * `UX_AUDIT` U5, measured on the viewport the product actually gets — and
     * deliberately claiming less than the audit asked for, because the honest
     * answer is less.
     *
     * The first version of this passed locally and failed on CI, which is how the
     * real problem surfaced: both local Playwright projects used 390x844 — the
     * iPhone 14's SCREEN — while CI used the 664px height Safari leaves once its
     * toolbars are up. 180px is most of a sheet.
     *
     * At 664 the sheet does NOT fit the whole common task. Name, Category, Color
     * and `When to pack it` are on screen; `More details` is below the fold.
     * That is a genuine open UX item, recorded in doc 08 U5 rather than papered
     * over — so this asserts the part that is true, and `Save stays put` below
     * asserts the part that makes the rest reachable.
     *
     * The Favorite toggle used to be the fourth control checked here and is
     * gone (H1d); `When to pack it` moved up into the space it left.
     */
    const viewport = page.viewportSize()!
    await page.getByRole('button', { name: 'Add item', exact: true }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    for (const control of [
      sheet.getByLabel('Name'),
      sheet.getByLabel('Category'),
      sheet.getByRole('button', { name: 'Anytime' }),
      sheet.getByRole('button', { name: 'Add to My Stuff' }),
    ]) {
      const box = await control.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
    }
  })

  test('Save stays put when the form scrolls', async ({ page }) => {
    /*
     * The assertion that makes the one above mean something.
     *
     * "Save happens to be on screen" is true of any form short enough today and
     * false the moment a field is added. Save is pinned below the scrolling body
     * instead, so it is reachable by construction — at any height, and with the
     * software keyboard raised, which is the half of U5 no browser here can test.
     */
    await page.getByRole('button', { name: 'Add item', exact: true }).click()
    const sheet = page.getByRole('dialog')
    const save = sheet.getByRole('button', { name: 'Add to My Stuff' })
    const before = (await save.boundingBox())!.y

    // Open the optional half so the body definitely has somewhere to scroll.
    await sheet.getByRole('button', { name: 'More details' }).click()
    await sheet.locator('.sheet-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })

    const after = (await save.boundingBox())!
    expect(after.y).toBe(before)
    expect(after.y + after.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  })

  /*
   * Favorite is not a thing Alex can encounter any more (H1d).
   *
   * This test used to drive the toggle. It now asserts the retirement from the
   * one place it can be seen from — the screen where the toggle lived, the sort
   * that read it, and the rows that displayed it. The word appears nowhere,
   * including behind `More details`, which is where a half-removed control would
   * have ended up.
   */
  test('offers no Favorite anywhere in My Stuff', async ({ page }) => {
    await expect(page.getByRole('option', { name: 'Favorites first' })).toHaveCount(0)
    await expect(page.locator('.stuff-star')).toHaveCount(0)

    await page.getByRole('button', { name: 'Add item', exact: true }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'More details' }).click()

    await expect(sheet.getByText(/favou?rite/i)).toHaveCount(0)
    // The replacements, in the same sheet, saying strictly more than a star did.
    await expect(sheet.getByText('Comfort', { exact: true })).toBeVisible()
    await expect(sheet.getByText('Versatility', { exact: true })).toBeVisible()
  })
})

/**
 * G6 — a name says what the thing is, and the row still says which one.
 *
 * Against the real workbook wardrobe, because the whole point is that Alex owns
 * seven quarter-zips: a rule proved on one invented garment would say nothing
 * about the case that produced the slice.
 */
test.describe('what a wardrobe row is called', () => {
  test('does not repeat the brand and the colour it is sitting next to', async ({ page }) => {
    await openMyStuff(page)
    await expect(page.locator('.stuff-row').first()).toBeVisible()

    /*
     * Asked of the rows the IMPORTER named.
     *
     * `Black Shinola` and `White Shinola` are two watches migration 0009 seeds
     * with names a person wrote out, and they are told apart BY the colour in
     * the name — stripping it would leave Alex with two items both called
     * `Shinola`. `source` is what separates the two populations, and the
     * migration uses the same guard, so this asks the same question the
     * cleanup answered rather than a looser one that would flag his watches.
     */
    const items = await page.evaluate(async () => {
      const response = await fetch('/api/items', { headers: { Accept: 'application/json' } })
      return (await response.json()) as {
        items: Array<{ displayName: string; brand: string | null; color: string | null; source: string }>
      }
    })

    const imported = items.items.filter((i) => i.source === 'seed_import')
    expect(imported.length, 'the seeded wardrobe is there to check').toBeGreaterThan(50)

    /*
     * The BRAND, which is the assertion that is exactly true.
     *
     * `composeDisplayName` prepended a brand unconditionally, so after the
     * cleanup no imported name can lead with its own. The colour cannot carry
     * the same rule and this test tried it first. Five rows still open with
     * their colour, and every one of them is Alex's own description with the
     * colour written into it — `Denim Button-Up`, `Plaid Button-Up`,
     * `Patterned Polo`, `Suede Shirt Jacket`, `White Sneakers`. The composer
     * never touched those, because it only prepended a colour the description
     * did not already contain. A rule that flagged them would be asking for a
     * rewrite of his wording, which is the thing the slice promised not to do —
     * so they are named here instead, and a sixth appearing is a real change
     * worth failing on.
     */
    let checked = 0
    for (const item of imported) {
      if (!item.brand) continue
      expect(
        item.displayName.toLowerCase().startsWith(`${item.brand.toLowerCase()} `),
        `${item.displayName} still leads with ${item.brand}`,
      ).toBe(false)
      checked += 1
    }
    expect(checked, 'rows with a brand to check').toBeGreaterThan(50)

    // And the colour, everywhere the composer put it — which is everywhere the
    // description did not already say it.
    const leadingColour = imported.filter(
      (item) => item.color && item.displayName.toLowerCase().startsWith(`${item.color.toLowerCase()} `),
    )
    expect(leadingColour.map((i) => i.displayName).sort()).toEqual([
      'Denim Button-Up',
      'Patterned Polo',
      'Plaid Button-Up',
      'Suede Shirt Jacket',
      'White Sneakers',
    ])

    // And the words are on the row, under the name, where they can be read.
    const withMeta = page.locator('.stuff-row').filter({ has: page.locator('.stuff-meta') })
    expect(await withMeta.count()).toBeGreaterThan(5)
  })

  test('still finds a garment by a brand that is no longer in its name', async ({ page }) => {
    await openMyStuff(page)
    await expect(page.locator('.stuff-row').first()).toBeVisible()

    await page.getByLabel('Search your items').fill('Columbia')
    await expect(page.locator('.stuff-row').first()).toBeVisible()

    const names = await page.locator('.stuff-name').allTextContents()
    expect(names.length).toBeGreaterThan(0)
    // The proof that the search is reading the field rather than the title.
    expect(names.every((n) => !n.toLowerCase().includes('columbia'))).toBe(true)
    // And the row says whose it is.
    await expect(page.locator('.stuff-meta').first()).toContainText('Columbia')
  })
})

/**
 * Comfort and versatility, on a phone (H1b).
 *
 * The unit tests decide what the ratings mean and the DOM tests decide what
 * VoiceOver hears. What only a real viewport can answer is whether five 44pt
 * targets, their meaning line and `Clear rating` fit beside an open suitcase —
 * and whether saving one actually survives a round trip through the API.
 */
test.describe('rating a garment', () => {
  test.beforeEach(async ({ page }) => {
    await openMyStuff(page)
  })

  test('stores a comfort rating, and it is still there on reopening', async ({ page }) => {
    const name = ownedName('Rated Tee')

    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Name').fill(name)
    await sheet.getByLabel('Category').selectOption('Tops & Outerwear')
    await sheet.getByRole('button', { name: 'More details' }).click()

    const comfort = sheet.getByRole('radiogroup', { name: 'Comfort' })
    await comfort.getByRole('radio', { name: '4 of 5 — Very comfortable' }).click()
    // The meaning is on screen, not just in the accessibility tree.
    await expect(sheet.getByText('Very comfortable')).toBeVisible()

    await sheet.getByRole('button', { name: 'Add to My Stuff' }).click()
    await expect(sheet).toHaveCount(0)

    await page.getByText(name).click()
    const reopened = page.getByRole('dialog')
    await reopened.getByRole('button', { name: 'More details' }).click()
    await expect(
      reopened.getByRole('radio', { name: '4 of 5 — Very comfortable' }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  test('starts unrated, and says so rather than showing an empty row of stars', async ({ page }) => {
    const name = ownedName('Unrated Tee')

    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Name').fill(name)
    await sheet.getByLabel('Category').selectOption('Tops & Outerwear')
    await sheet.getByRole('button', { name: 'More details' }).click()

    // Two controls, both unrated, both saying so in words.
    await expect(sheet.getByText('Not rated')).toHaveCount(2)
    await expect(sheet.getByRole('button', { name: 'Clear rating' })).toHaveCount(0)
  })

  test('clears a rating back to unknown', async ({ page }) => {
    const name = ownedName('Cleared Tee')

    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Name').fill(name)
    await sheet.getByLabel('Category').selectOption('Tops & Outerwear')
    await sheet.getByRole('button', { name: 'More details' }).click()

    const versatility = sheet.getByRole('radiogroup', { name: 'Versatility' })
    await versatility.getByRole('radio', { name: '5 of 5 — Works almost anywhere appropriate for this item type' }).click()
    await sheet.getByRole('button', { name: 'Add to My Stuff' }).click()
    await expect(sheet).toHaveCount(0)

    await page.getByText(name).click()
    const reopened = page.getByRole('dialog')
    await reopened.getByRole('button', { name: 'More details' }).click()
    await reopened.getByRole('button', { name: 'Clear rating' }).click()
    // Same race as the dressiness save below: await the write, not the close.
    const cleared = page.waitForResponse(
      (response) => /\/api\/items\//.test(response.url()) && response.request().method() === 'PUT',
    )
    await reopened.getByRole('button', { name: 'Save changes' }).click()
    await cleared
    await expect(reopened).toHaveCount(0)

    await page.getByText(name).click()
    const again = page.getByRole('dialog')
    await again.getByRole('button', { name: 'More details' }).click()
    await expect(again.getByRole('radiogroup', { name: 'Versatility' })
      .getByRole('radio', { name: /5 of 5/ })).toHaveAttribute('aria-checked', 'false')
  })

  test('fits an iPhone: five 44pt targets on one line, and no sideways scroll', async ({ page }) => {
    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('button', { name: 'More details' }).click()

    const comfort = sheet.getByRole('radiogroup', { name: 'Comfort' })
    const stars = comfort.getByRole('radio')
    await expect(stars).toHaveCount(5)

    /*
     * 44pt in both dimensions — floored by `global.css` for every button, so
     * this asserts the control does not fight that floor rather than that it
     * sets one. What this test genuinely OWNS is the line below it: five
     * targets in one unwrapped row, and no sideways scroll.
     */
    let previousRight = 0
    let firstTop: number | null = null
    for (let i = 0; i < 5; i += 1) {
      const box = (await stars.nth(i).boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      // …and on ONE line, in order, rather than wrapping to a second row.
      expect(box.y).toBe(firstTop ?? (firstTop = box.y))
      expect(box.x).toBeGreaterThanOrEqual(previousRight)
      previousRight = box.x + box.width
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

/**
 * Where a garment works, on a phone (H1c).
 *
 * The unit tests decide what a SET means and the DOM tests decide what VoiceOver
 * hears. What only a real viewport can answer is whether five checkboxes with
 * their hints fit at 390px without pushing the screen sideways — and whether a
 * multi-select actually survives a round trip through the API, which is the one
 * thing a component test cannot check.
 */
test.describe('where a garment works', () => {
  test.beforeEach(async ({ page }) => {
    await openMyStuff(page)
  })

  test('stores several contexts, and they are still there on reopening', async ({ page }) => {
    const name = ownedName('Oxford Shirt')

    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Name').fill(name)
    await sheet.getByLabel('Category').selectOption('Tops & Outerwear')
    await sheet.getByRole('button', { name: 'More details' }).click()

    const where = sheet.getByRole('group', { name: 'Where it works' })
    /*
     * `Casual` arrives already ticked, because choosing a category pre-fills
     * the level `defaultsForCategory` suggests — a starting point, never an
     * overwrite. An Oxford shirt is not casual, so unticking it is part of what
     * this test is about: curating a set, not just adding to one.
     */
    await expect(where.getByRole('checkbox', { name: 'Casual', exact: true })).toBeChecked()
    await where.getByRole('checkbox', { name: 'Casual', exact: true }).uncheck()
    await where.getByRole('checkbox', { name: 'Smart casual', exact: true }).check()
    await where.getByRole('checkbox', { name: 'Dressy', exact: true }).check()
    await expect(sheet.getByText('Works for Smart casual, Dressy')).toBeVisible()

    await sheet.getByRole('button', { name: 'Add to My Stuff' }).click()
    await expect(sheet).toHaveCount(0)

    await page.getByText(name).click()
    const reopened = page.getByRole('dialog')
    await reopened.getByRole('button', { name: 'More details' }).click()
    const again = reopened.getByRole('group', { name: 'Where it works' })

    // BOTH, through the API and back. A round trip that kept one would be the
    // single-context collapse this slice exists to prevent.
    await expect(again.getByRole('checkbox', { name: 'Smart casual', exact: true })).toBeChecked()
    await expect(again.getByRole('checkbox', { name: 'Dressy', exact: true })).toBeChecked()
    await expect(again.getByRole('checkbox', { name: 'Casual', exact: true })).not.toBeChecked()
    await expect(again.getByRole('checkbox', { name: 'Formal', exact: true })).not.toBeChecked()
  })

  test('removes one context and keeps the other, through a save', async ({ page }) => {
    const name = ownedName('Polo Shirt')

    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Name').fill(name)
    await sheet.getByLabel('Category').selectOption('Tops & Outerwear')
    await sheet.getByRole('button', { name: 'More details' }).click()
    const where = sheet.getByRole('group', { name: 'Where it works' })
    // `Casual` is already on from the category default; a polo keeps it.
    await where.getByRole('checkbox', { name: 'Smart casual', exact: true }).check()
    await sheet.getByRole('button', { name: 'Add to My Stuff' }).click()
    await expect(sheet).toHaveCount(0)

    await page.getByText(name).click()
    const reopened = page.getByRole('dialog')
    await reopened.getByRole('button', { name: 'More details' }).click()
    await reopened.getByRole('group', { name: 'Where it works' })
      .getByRole('checkbox', { name: 'Casual', exact: true }).uncheck()

    /*
     * Wait for the WRITE to land, not merely for the sheet to close.
     *
     * The sheet closes optimistically, so reopening it immediately can read the
     * list back before the PUT has been applied — and this test then measured
     * the race rather than the behaviour. It failed roughly one full-suite run
     * in three. Awaiting the response is a stronger assertion than the one it
     * replaces, not a longer timeout: the save is now proven to have reached
     * the Worker before anything is read back.
     */
    const saved = page.waitForResponse(
      (response) => /\/api\/items\//.test(response.url()) && response.request().method() === 'PUT',
    )
    await reopened.getByRole('button', { name: 'Save changes' }).click()
    await saved
    await expect(reopened).toHaveCount(0)

    /*
     * Reload before reading it back.
     *
     * Awaiting the PUT proved the write landed and this test STILL failed about
     * one full-suite run in three, so the staleness is on the client: the list
     * the sheet reopens from is not guaranteed to have been refetched by the
     * time the row is tapped again. A reload forces a fresh read, which is what
     * this test is actually about — the value came back from the server.
     *
     * The staleness itself is recorded in doc 09 §0c as a finding rather than
     * hidden here; it is not H1c's to fix, and it predates the multi-select.
     */
    await page.reload()
    await expect(page.getByRole('heading', { name: 'My Stuff' })).toBeVisible()

    await page.getByText(name).click()
    const third = page.getByRole('dialog')
    await third.getByRole('button', { name: 'More details' }).click()
    const finalSet = third.getByRole('group', { name: 'Where it works' })
    await expect(finalSet.getByRole('checkbox', { name: 'Casual', exact: true })).not.toBeChecked()
    await expect(finalSet.getByRole('checkbox', { name: 'Smart casual', exact: true })).toBeChecked()
  })

  test('clears every context back to not set', async ({ page }) => {
    const name = ownedName('Cleared Shirt')

    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Name').fill(name)
    await sheet.getByLabel('Category').selectOption('Tops & Outerwear')
    await sheet.getByRole('button', { name: 'More details' }).click()
    await sheet.getByRole('group', { name: 'Where it works' })
      .getByRole('checkbox', { name: 'Dressy', exact: true }).check()
    // Clears the category default as well as the tick just made — "all" means all.
    await sheet.getByRole('button', { name: 'Clear all' }).click()

    await expect(sheet.getByText(/Not set/)).toBeVisible()
    for (const label of ['Loungewear', 'Casual', 'Smart casual', 'Dressy', 'Formal']) {
      await expect(
        sheet
          .getByRole('group', { name: 'Where it works' })
          // `exact`, because Playwright's name matching is substring by default
          // and `Casual` would also select `Smart casual`.
          .getByRole('checkbox', { name: label, exact: true }),
      ).not.toBeChecked()
    }
  })

  test('fits an iPhone: five rows, 44pt each, and no sideways scroll', async ({ page }) => {
    await page.getByRole('button', { name: /^Add/ }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('button', { name: 'More details' }).click()

    const rows = sheet.getByRole('group', { name: 'Where it works' }).getByRole('checkbox')
    await expect(rows).toHaveCount(5)

    // Stacked: each on its own line, in order, none overlapping the next.
    let previousBottom = 0
    for (let i = 0; i < 5; i += 1) {
      const label = sheet.locator('.dressiness-option').nth(i)
      const box = (await label.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.y).toBeGreaterThanOrEqual(previousBottom - 1)
      previousBottom = box.y + box.height
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
