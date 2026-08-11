import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * What the luggage cannot safely hold, and what it is protecting (P3c).
 *
 * The rules are proved in `tests/integration/bag-planning.test.ts`. What only a
 * browser can prove is that Alex is TOLD — and that he is told the right thing
 * on the right trip, which is the half most likely to go wrong quietly:
 *
 *   - a checked-only flight must say the conflict and how to fix it;
 *   - a drive must say nothing about checked baggage at all;
 *   - a flight with a hold must name the small set kept out of it.
 *
 * A version that showed the hold warning on a road trip would pass every unit
 * test and be wrong in the one place Alex reads it.
 */

let trip: TripFixture

test.afterEach(async ({ page }) => {
  if (trip) await deleteTrip(page, trip.id)
})

/** Sets the bags and the flight on a trip, through the real editor endpoint. */
async function configure(
  page: Page,
  tripId: string,
  bags: string[] | null,
  flightHours: number | null,
) {
  await page.evaluate(
    async ([id, bagList, hours]) => {
      const current = (await (await fetch(`/api/trips/${id as string}`)).json()) as {
        name: string
        startDate: string
        endDate: string
      }
      const response = await fetch(`/api/trips/${id as string}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: current.name,
          startDate: current.startDate,
          endDate: current.endDate,
          destinations: [{ name: 'Cape Town', country: 'South Africa' }],
          activities: ['safari'],
          bags: bagList,
          flightHours: hours,
        }),
      })
      if (!response.ok) throw new Error(`configure: ${response.status} ${await response.text()}`)
    },
    [tripId, bags, flightHours] as const,
  )
}

async function openTrip(page: Page, tripId: string) {
  await page.goto(`/trips/${tripId}`)
  await page.locator('.swipe-row').first().waitFor()
}

const conflict = (page: Page) => page.locator('.banner-alert', { hasText: /should not go in a checked bag/ })
const backup = (page: Page) => page.locator('.trip-backup')

test.describe('when the only bag is the hold', () => {
  test('says what is wrong and the two ways out, without inventing a bag', async ({ page }) => {
    await signIn(page)
    trip = await createTrip(page, { owner: 'BagSafety' })
    await configure(page, trip.id, ['checked'], 11)
    await openTrip(page, trip.id)

    await expect(conflict(page)).toBeVisible()
    await expect(conflict(page)).toContainText('Add a personal item or carry-on, or choose a bag yourself')

    /*
     * And the planner still refuses to name a bag for those rows. The warning
     * exists BECAUSE nothing safe was assigned; a checked-bag suggestion beside
     * it would mean the screen had quietly overruled the floor.
     */
    const stranded = await page.evaluate(async ([id]) => {
      const body = (await (await fetch(`/api/trips/${id}/checklist`)).json()) as {
        entries: Array<{ category: string; bag: string | null }>
      }
      return body.entries.filter((e) => e.category === 'Medication').map((e) => e.bag)
    }, [trip.id] as const)
    expect(stranded.every((bag) => bag !== 'checked')).toBe(true)
  })
})

test.describe('on a trip with no flight', () => {
  test('says nothing about checked baggage, and shows no backup set', async ({ page }) => {
    await signIn(page)
    trip = await createTrip(page, { owner: 'BagSafety' })
    // A drive carrying none of these: the case that used to be warned at.
    await configure(page, trip.id, [], null)
    await openTrip(page, trip.id)

    await expect(conflict(page)).toHaveCount(0)
    await expect(backup(page)).toHaveCount(0)
  })
})

test.describe('on a flight with a checked bag', () => {
  test('names the small set it is keeping out of the hold', async ({ page }) => {
    await signIn(page)
    trip = await createTrip(page, { owner: 'BagSafety' })
    await configure(page, trip.id, ['personal_item', 'carry_on', 'checked'], 11)
    await openTrip(page, trip.id)

    /*
     * Collapsed by default since §0u — it answers a question asked once, and
     * open it took ninety points of the first viewport above the packing list on
     * every visit. The count is what says there is anything to open.
     */
    await expect(backup(page)).toBeVisible()
    await expect(backup(page).getByRole('button')).toContainText(/24-hour backup · \d+/)
    await expect(page.locator('.trip-backup-names')).toHaveCount(0)

    await backup(page).getByRole('button').click()

    await expect(backup(page)).toContainText('in case your checked bag is delayed')
    // Bounded: a heading with nothing under it would be decoration.
    await expect(page.locator('.trip-backup-names')).not.toBeEmpty()
    // And no conflict, because there is somewhere safe for everything.
    await expect(conflict(page)).toHaveCount(0)
  })

  test('does not push the screen sideways at iPhone width', async ({ page }) => {
    await signIn(page)
    trip = await createTrip(page, { owner: 'BagSafety' })
    await configure(page, trip.id, ['personal_item', 'carry_on', 'checked'], 11)
    await openTrip(page, trip.id)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
