import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ownedName } from './fixtures'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/**
 * Writing, changing and unwriting a packing rule, on the phone.
 *
 * The integration tests prove the endpoints and the engine agree. This proves
 * Alex can reach them: doc 09 §18's named failure is a rule that appears saved
 * and is not used, and its twin is a rule the interface cannot express at all.
 *
 * Every test here works on an item it creates itself and tidies up after. The
 * seeded catalog is shared with eleven other specs, and a test that leaves a
 * rule behind on the Passport is a test that breaks one of them.
 */

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
}

/** A thing of Alex's that no other spec knows about. */
async function ownSomething(page: Page, name: string): Promise<void> {
  const response = await page.request.post('/api/items', {
    data: { kind: 'gear', displayName: name, category: 'Travel Gear' },
  })
  expect(response.ok(), `could not create ${name}`).toBe(true)
}

async function openRules(page: Page) {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Packing rules' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  return sheet
}

test.describe('a rule of your own', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('can be written, and then removed with an undo', async ({ page }) => {
    const name = ownedName('Sleep Mask')
    await ownSomething(page, name)

    const sheet = await openRules(page)
    await sheet.getByRole('button', { name: 'Add a rule' }).click()
    await sheet.getByPlaceholder('Search your things').fill(name)
    await sheet.getByRole('button', { name: new RegExp(name) }).click()

    await sheet.getByRole('button', { name: 'At least', exact: true }).click()
    await sheet.getByRole('button', { name: 'More', exact: true }).click()
    await sheet.getByRole('button', { name: 'Save this rule' }).click()

    // Written, and described in words rather than a rule type.
    await sheet.getByPlaceholder('Search').fill(name)
    await expect(sheet.locator('.rule-what').first()).toHaveText('At least 2')

    // Removed, with the way back offered rather than a confirmation asked for.
    await sheet.getByRole('button', { name: `Remove the rule for ${name}` }).click()
    await expect(sheet.getByText(`Rule for ${name} removed.`)).toBeVisible()
    await sheet.getByRole('button', { name: 'Undo' }).click()
    await expect(sheet.locator('.rule-what').first()).toHaveText('At least 2')

    // And gone for good this time, so the next run starts where this one did.
    await sheet.getByRole('button', { name: `Remove the rule for ${name}` }).click()
    await expect(sheet.locator('.rule-row')).toHaveCount(0)
  })

  test('cannot be written twice for the same thing', async ({ page }) => {
    const name = ownedName('Ear Plugs')
    await ownSomething(page, name)

    const sheet = await openRules(page)

    for (const attempt of [1, 2]) {
      await sheet.getByRole('button', { name: 'Add a rule' }).click()
      await sheet.getByPlaceholder('Search your things').fill(name)
      // Scoped to the picker: once the first rule exists, its row carries the
      // same name and an unscoped match finds two buttons.
      await sheet.locator('.picker-row', { hasText: name }).click()
      await sheet.getByRole('button', { name: 'Save this rule' }).click()

      if (attempt === 2) {
        // In Alex's words, and pointing at what to do instead.
        await expect(sheet.getByText(/already has a rule like that/)).toBeVisible()
      }
    }

    // Back out of the form the refusal left open — the chosen item is still
    // chosen, which is the right place to be after being told to change the
    // rule that exists rather than being dropped back to an empty search.
    await sheet.getByRole('button', { name: 'Pick something else' }).click()
    await sheet.getByRole('button', { name: 'Cancel' }).click()

    await sheet.getByPlaceholder('Search').fill(name)
    await expect(sheet.locator('.rule-row')).toHaveCount(1)

    await sheet.getByRole('button', { name: `Remove the rule for ${name}` }).click()
  })
})

test.describe('a default Alex has changed', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  /*
   * Hairspray, not Passport. Both carry a seeded default, and Passport's is the
   * one `shell.spec.ts` toggles — two specs turning the same rule off and on is
   * the shared-state problem that spec's own `mode: 'serial'` comment is about,
   * and it does not reach across files.
   *
   * The rule is changed and put back within the test, which is also the
   * behaviour under test: a default must survive being edited, and that is only
   * true if `Use the default` restores the original rather than approximating it.
   */
  test('says what it changed from, and offers the original back', async ({ page }) => {
    const sheet = await openRules(page)
    await sheet.getByPlaceholder('Search').fill('Hairspray')

    const row = sheet.locator('.rule-row').first()
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    const before = await sheet.locator('.rule-what').first().textContent()

    // Turning a default off is a change TO it, not a deletion of it.
    await row.click()
    await expect(row).toHaveAttribute('aria-pressed', 'false')
    await expect(sheet.getByText(/^Turned off/)).toBeVisible()

    await sheet.getByRole('button', { name: 'Use the default' }).click()

    await expect(sheet.getByText(/^Turned off/)).toHaveCount(0)
    await expect(sheet.locator('.rule-row').first()).toHaveAttribute('aria-pressed', 'true')
    await expect(sheet.locator('.rule-what').first()).toHaveText(before ?? '')

    // A default is never offered a delete — it is turned off instead, which is
    // reversible and keeps the wording it was imported with.
    await expect(sheet.getByRole('button', { name: /^Remove the rule/ })).toHaveCount(0)
  })
})
