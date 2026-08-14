import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createTrip, deleteTrip, signIn, todayForTrip, type TripFixture } from './fixtures'

/**
 * What to pack NEXT, rather than everything the trip involves (P4b).
 *
 * The packing screen used to render all four sections expanded, so the answer to
 * *what do I pack tonight* sat above three sections of not-yet — including
 * `Final check`, which on the seeded catalog is a dozen rows every one of which
 * is a second copy of a row further up.
 *
 * The stage rules themselves are unit-tested against `sectionStage`. What only a
 * browser can prove is the part Alex touches: that the work is open, that the
 * waiting sections are still one tap away rather than gone, that they open on
 * the day they become the work, and that narrowing the list never hides a match
 * behind a closed heading.
 */

let trip: TripFixture

test.afterEach(async ({ page }) => {
  if (trip) await deleteTrip(page, trip.id)
})

const heading = (page: Page, label: string) =>
  page.getByRole('button', { name: new RegExp(`^${label}`) }).first()

/** Puts a row into Pack later, so the section exists at all. */
async function packLater(page: Page, tripId: string): Promise<void> {
  await page.evaluate(
    async ([id]) => {
      const listed = (await (await fetch(`/api/trips/${id}/checklist`)).json()) as {
        entries: Array<{ id: string; packingTiming: string }>
      }
      const row = listed.entries.find((entry) => entry.packingTiming !== 'day_of')
      if (!row) throw new Error('packing-stages: no row to move')
      await fetch(`/api/trips/${id}/checklist/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packingTiming: 'day_of' }),
      })
    },
    [tripId],
  )
}

test.describe('while there are still days to go', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    trip = await createTrip(page, {
      owner: 'Stages',
      startDate: '2027-06-01',
      endDate: '2027-06-08',
    })
    await packLater(page, trip.id)
    await page.goto(`/trips/${trip.id}`)
    await expect(page.locator('.swipe-row').first()).toBeVisible()
  })

  test('opens the work and leaves the rest one tap away', async ({ page }) => {
    // Pack now is the answer, and it is not something to be collapsed.
    await expect(page.getByRole('heading', { name: /^Pack now/ })).toBeVisible()
    await expect(page.locator('.checklist-section', { hasText: 'Pack now' }).first()
      .locator('.swipe-row').first()).toBeVisible()

    // The rest keep their heading and their count, closed.
    const later = heading(page, 'Pack later')
    await expect(later).toBeVisible()
    await expect(later).toHaveAttribute('aria-expanded', 'false')

    // Nothing is hidden — one tap and the rows are there.
    await later.click()
    await expect(later).toHaveAttribute('aria-expanded', 'true')
    await expect(
      page.locator('.checklist-section', { hasText: 'Pack later' }).locator('.swipe-row').first(),
    ).toBeVisible()
  })

  /*
   * The failure this guards against is the worst one available on this screen:
   * searching for something that exists, and being shown what looks like "no
   * matches" because the only section holding it was closed.
   */
  test('opens everything the moment the list is narrowed', async ({ page }) => {
    const later = heading(page, 'Pack later')
    await expect(later).toHaveAttribute('aria-expanded', 'false')

    const name = await page
      .locator('.checklist-section', { hasText: 'Pack later' })
      .locator('.check-name-text')
      .first()
      .textContent()

    await page.getByPlaceholder('Search this list').fill((name ?? '').trim())
    await expect(heading(page, 'Pack later')).toHaveAttribute('aria-expanded', 'true')
    await expect(
      page.locator('.checklist-section', { hasText: 'Pack later' }).locator('.swipe-row').first(),
    ).toBeVisible()
  })
})

test.describe('on the day he leaves', () => {
  test('makes Pack later and Final check the work', async ({ page }) => {
    await signIn(page)
    trip = await createTrip(page, { owner: 'StagesToday' })

    /*
     * The traveller's own calendar day, asked of the app.
     *
     * `resolveTodayDate` in `shared/today.ts` is authoritative and the date is
     * deliberately not derived here — `new Date().toISOString().slice(0, 10)` is
     * UTC, and that derivation is exactly what the date-authority work removed
     * from user-facing dates.
     */
    const today = await todayForTrip(page, trip.id)

    await page.evaluate(
      async ([id, day]) => {
        const current = (await (await fetch(`/api/trips/${id}`)).json()) as { name: string }
        const response = await fetch(`/api/trips/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: current.name,
            startDate: day,
            endDate: day,
            destinations: [{ name: 'Cape Town', country: 'South Africa' }],
            activities: ['safari'],
            flightHours: 15,
          }),
        })
        if (!response.ok) throw new Error(`leaving today: ${response.status}`)
      },
      [trip.id, today] as const,
    )

    await packLater(page, trip.id)
    await page.goto(`/trips/${trip.id}`)
    await expect(page.locator('.swipe-row').first()).toBeVisible()

    // Both are plain headings now, not disclosures: they are today's work.
    await expect(page.getByRole('heading', { name: /^Pack later/ })).toBeVisible()
    await expect(
      page.locator('.checklist-section', { hasText: 'Pack later' }).locator('.swipe-row').first(),
    ).toBeVisible()
    await expect(page.locator('.section-disclosure', { hasText: 'Pack later' })).toHaveCount(0)

    // And the departure screen is still the one being recommended for the door.
    await expect(page.getByRole('button', { name: /^Before you go/ })).toBeVisible()
  })
})
