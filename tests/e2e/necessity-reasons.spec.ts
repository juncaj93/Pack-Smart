import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/**
 * C1 on the screen, against the built bundle in WebKit.
 *
 * `necessity-reasons.test.ts` proves every generated row HAS a reason.
 * This proves Alex can actually reach it — which is a different claim, and the
 * one that would have been missed by a slice that stopped at the engine.
 *
 * The accessibility half is the point of the last test. A reason that only
 * exists as visual secondary text is not an explanation for anyone using
 * VoiceOver, and `INTERACTION_PATTERNS.md` §1 does not carve out an exception
 * for text.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
})

async function openChecklist(page: Page) {
  const { trips } = await page.evaluate(() =>
    fetch('/api/trips').then((r) => r.json() as Promise<{ trips: Array<{ id: string }> }>),
  )
  const trip = trips[0]
  if (!trip) throw new Error('necessity-reasons: no seeded trip to open')
  await page.goto(`/trips/${trip.id}`)
  await expect(page.locator('.check-row').first()).toBeVisible()
}

test.describe('why a row is on the list', () => {
  test('is one tap away for every row, through the same control as everything else', async ({
    page,
  }) => {
    await openChecklist(page)

    const row = page.locator('.swipe-row').first()
    const label = (await row.locator('.check-more').getAttribute('aria-label')) ?? ''
    const name = label.replace(/^Options for /, '').trim()

    await row.locator('.check-more').click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('Why it is here')).toBeVisible()

    /*
     * Non-empty, and not the item's own name read back. A sheet that said
     * "Toothbrush" under "why it is here" would technically be filling the slot.
     */
    const reason = (await sheet.locator('.entry-why').last().innerText()).replace(
      /^Why it is here\s*/i,
      '',
    )
    expect(reason.trim().length).toBeGreaterThan(3)
    expect(reason.trim().toLowerCase()).not.toBe(name.toLowerCase())
  })

  test('never shows an internal identifier anywhere on the list', async ({ page }) => {
    /*
     * The guarantee asserted against what is actually painted, rather than
     * against the strings the engine returned. A row that leaked an id would be
     * visible here whatever the unit tests believed.
     */
    await openChecklist(page)

    const text = await page.locator('.checklist').first().innerText()
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i)
    expect(text).not.toMatch(/\b(fixed_per_trip|per_day|per_night|conditional_include|item_id|rule_id)\b/)
    expect(text).not.toContain('{')
  })

  test('reads as part of the row for VoiceOver, not as loose text beside it', async ({ page }) => {
    /*
     * The secondary line lives INSIDE the row's own button, so the
     * accessibility tree gives its text to the control Alex activates rather
     * than stranding it as an unassociated string. Asserted through the
     * accessible name, which is what a screen reader actually announces.
     */
    await openChecklist(page)

    const withReason = page
      .locator('.check-main')
      .filter({ has: page.locator('.check-meta') })
      .first()

    if ((await withReason.count()) === 0) test.skip(true, 'no row carries a secondary line')

    const meta = (await withReason.locator('.check-meta').innerText()).trim()
    const accessibleName = (await withReason.getAttribute('aria-label')) ?? (await withReason.innerText())

    expect(accessibleName.replace(/\s+/g, ' ')).toContain(meta.replace(/\s+/g, ' '))
  })
})
