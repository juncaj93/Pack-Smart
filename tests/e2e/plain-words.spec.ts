import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * No internal vocabulary reaches the screen, on any of them.
 *
 * `CLAUDE.md` and doc 06 both forbid it, and until now that was enforced one
 * string at a time — `shell.spec.ts` checks the packing-rule descriptions, and
 * nothing checked anything else. The gap it leaves is the shape of the reported
 * `listAll` sighting (`08_PACK_SMART_V2_PRODUCT_COMPLETION.md` U6): a string that
 * does not exist anywhere in this repository or its history, so it came from an
 * older deployment or was already fixed. Patching a string nobody can find would
 * have fixed nothing. A test that fails on *any* identifier-shaped run of text
 * is the only thing that would have caught it, and the only thing that catches
 * the next one.
 *
 * This walks every screen and reads the text a person actually sees.
 *
 * **What counts as an identifier, and why the rule is narrow.** `camelCase` and
 * `snake_case` in a word that is otherwise prose — `qtyPerDay`, `pack_later`,
 * `conditional_include`. It is deliberately not "any unusual word": brand names,
 * garment names and Alex's own item names are free text he typed, and a guard
 * that flagged "Zip-Up" would be turned off within a week. A rule nobody trusts
 * is worse than no rule, so this one only fires on shapes that no English word
 * has.
 */

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/**
 * Every screen reachable without creating data, and what "loaded" means on each.
 *
 * The readiness selector is not ceremony. The first version waited only for the
 * navigation, which renders instantly — so on Home and Trips the scan ran against
 * 42 characters of chrome and found no identifiers in text that was not there
 * yet. It passed, and covered nothing. The length floor in `visibleText` is what
 * caught it.
 */
const SCREENS: Array<{ path: string; ready: string }> = [
  { path: '/', ready: '.home-actions, .empty-state, .trip-list' },
  { path: '/trips', ready: '.trip-list, .empty-state' },
  { path: '/my-stuff', ready: '.stuff-row, .empty-state' },
  { path: '/settings', ready: '.settings-row' },
  { path: '/import', ready: '.screen-subtitle' },
]

/**
 * `snake_case` or `camelCase` inside a single word.
 *
 * The `snake` half requires letters on both sides of the underscore, so a date or
 * a file name in Alex's own text does not trip it. The `camel` half requires a
 * lower-then-upper transition inside a word of at least three characters, which
 * excludes initialisms ("PDF"), title case, and "iPhone".
 */
const SNAKE = /\b[a-z]+_[a-z][a-z_]*\b/
const CAMEL = /\b[a-z]+[A-Z][a-zA-Z]*\b/

/**
 * Words that look like identifiers and are not.
 *
 * Kept explicit and short. Anything added here has to be a real English word
 * that happens to fit the pattern, never "this one string we could not be
 * bothered to rewrite".
 */
const ALLOWED = new Set(['iPhone', 'iPad', 'iOS', 'macOS'])

function offenders(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}_]+$/gu, ''))
    .filter((word) => word.length > 2 && !ALLOWED.has(word))
    .filter((word) => SNAKE.test(word) || CAMEL.test(word))
}

async function visibleText(page: Page): Promise<string> {
  /*
   * `innerText`, not `textContent`. The difference is exactly the point: it
   * returns what is rendered, so a `visually-hidden` label or a `display: none`
   * template does not count as being on screen — and neither does the boot
   * script, which is real source code sitting inside the document.
   */
  const text = await page.evaluate(() => document.body.innerText)

  /*
   * A scan of nothing finds nothing.
   *
   * Without this the whole file passes on a blank page — read it a tick early,
   * or after a navigation that quietly failed, and "no identifiers on screen" is
   * true and worthless. `VISUAL_ACCEPTANCE.md` §4: a check that cannot fail is
   * not evidence.
   *
   * The floor is 120 because the chrome alone — the title, the appearance toggle
   * and four navigation labels — is about 42 characters, and the sparsest real
   * screen (Home with no trips planned) is about 170. Anything between the two is
   * a screen whose content did not render.
   */
  expect(text.length).toBeGreaterThan(120)
  return text
}

async function unlock(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
}

test.describe('Pack Smart says things in words', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
  })

  test('no screen shows a field name', async ({ page }) => {
    for (const screen of SCREENS) {
      await page.goto(screen.path)
      await expect(page.locator(screen.ready).first()).toBeVisible()
      expect(offenders(await visibleText(page)), `on ${screen.path}`).toEqual([])
    }
  })

  test('no sheet shows a field name', async ({ page }) => {
    /*
     * Sheets are where it would surface first: they are the closest thing to the
     * data, and the place a value gets rendered before anyone writes a sentence
     * for it. Each of these is opened and read while it is on screen.
     */
    await page.goto('/settings')
    for (const label of ['Your usual amounts', 'Packing rules', 'About']) {
      await page.getByRole('button', { name: label }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      const text = await sheet.innerText()
      // Same reason as `visibleText`: an empty sheet passes every scan.
      expect(text.length, `in ${label}`).toBeGreaterThan(20)
      expect(offenders(text), `in ${label}`).toEqual([])
      await page.keyboard.press('Escape')
    }

    await page.goto('/my-stuff')
    await page.getByRole('button', { name: 'Add item', exact: true }).click()
    const item = page.getByRole('dialog')
    await expect(item).toBeVisible()
    // Including the optional half, which is the part nobody looks at.
    await item.getByRole('button', { name: 'More details' }).click()
    expect(offenders(await item.innerText())).toEqual([])
  })

  test('a packing list explains itself in sentences', async ({ page }) => {
    /*
     * The richest source of internal vocabulary in the product: quantities are
     * derived, rules are named, and every row carries a reason. `sortOrder`,
     * `conditional_include` and `duration_plus_buffer` are all one careless
     * template away from this screen.
     */
    await page.goto('/trips')
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Trip name').fill(`Plain words ${Math.floor(performance.now())}`)
    await sheet.getByLabel('Destination').fill('Cape Town')
    await sheet.getByLabel('Leaving').fill('2026-07-31')
    await sheet.getByLabel('Returning').fill('2026-08-11')
    await sheet.getByRole('button', { name: 'Safari' }).click()
    await sheet.getByRole('button', { name: 'Create trip' }).click()

    await expect(page.locator('.swipe-row').first()).toBeVisible()
    expect(offenders(await visibleText(page))).toEqual([])

    // And the explanation behind a row, which is generated rather than written.
    await page.locator('.swipe-row .check-more').first().click()
    const row = page.getByRole('dialog')
    await expect(row).toBeVisible()
    expect(offenders(await row.innerText())).toEqual([])
  })
})

test.describe('the guard itself', () => {
  /*
   * A test that can only pass is not a test. `VISUAL_ACCEPTANCE.md` §4 is about
   * exactly this failure — a green check that was never capable of being red —
   * and a text scan over screens that happen to be clean is the easiest possible
   * way to write one. So the matcher is checked against the strings it exists to
   * catch, and against the ones it must leave alone.
   */
  test('catches the shapes it is for, and no others', () => {
    for (const bad of ['conditional_include', 'duration_plus_buffer', 'listAll', 'qtyPerDay']) {
      expect(offenders(`Something ${bad} here`), bad).toEqual([bad])
    }

    for (const fine of [
      'Zip-Up',
      'T-Shirt',
      'Heather Gray Undershirts / Hair Tees',
      'Day of Departure',
      'PDF',
      'iPhone',
      '12 days × 2 = 24',
      'Gray, Navy, Short Gray Bombas Socks',
    ]) {
      expect(offenders(fine), fine).toEqual([])
    }
  })
})
