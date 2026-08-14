import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ESSENTIAL_MARKER, createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * Packing one bag at a time, in the browser the product ships on (P4a).
 *
 * The grouping rules are proved against real SQL in
 * `tests/integration/pack-by-bag.test.ts`. What only a browser can prove is the
 * part that makes it a LENS rather than a second list:
 *
 *   - a tick made in the bag view is on the master checklist when he goes back,
 *     and vice versa — one row, one write, no per-bag state;
 *   - the bag chooser is a radio group a screen reader can operate;
 *   - a safety conflict is still said here, where it matters most;
 *   - the way in is on the packing list and does not cost a permanent tab.
 */

let trip: TripFixture

test.beforeEach(async ({ page }) => {
  await signIn(page)
  trip = await createTrip(page, { owner: 'ByBag' })
  await page.goto(`/trips/${trip.id}`)
  await expect(page.locator('.swipe-row').first()).toBeVisible()
})

test.afterEach(async ({ page }) => {
  await deleteTrip(page, trip.id)
})

const clean = (text: string) =>
  text
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(ESSENTIAL_MARKER, '')
    .replace(/\s*\d+ (needed|of \d+ packed)\s*$/u, '')
    .trim()

/** Opens one bag's section by its heading, and closes whatever was open. */
async function openBag(page: Page, label: string | RegExp): Promise<void> {
  const heading = page.getByRole('button', { name: label }).first()
  await heading.scrollIntoViewIfNeeded()
  if ((await heading.getAttribute('aria-expanded')) !== 'true') await heading.click()
  await expect(heading).toHaveAttribute('aria-expanded', 'true')
}

/** The section a heading opens. */
const bagSection = (page: Page, label: string | RegExp) =>
  page.locator('.bags-section').filter({ has: page.getByRole('button', { name: label }) })

/** The name of the first row shown in whichever bag is open. */
async function firstBagRow(page: Page, label: string | RegExp): Promise<string> {
  const row = bagSection(page, label).locator('.bags-list .swipe-row').first()
  await expect(row).toBeVisible()
  return clean((await row.locator('.check-name').first().textContent()) ?? '')
}

test('is reachable from the packing list without a permanent tab', async ({ page }) => {
  await page.getByRole('button', { name: 'Pack by bag' }).click()
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/bags$`))
  await expect(page.getByRole('heading', { name: 'Pack by bag', level: 1 })).toBeVisible()

  // And the way back is on the screen, so it is never a dead end.
  await page.getByRole('button', { name: 'Full packing list' }).click()
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}$`))
})

test('offers the trip’s own bags as headings with counts', async ({ page }) => {
  await page.goto(`/trips/${trip.id}/bags`)
  await expect(page.locator('.bags-heading').first()).toBeVisible()

  // A flight with a checked bag carries all three, and nothing else is invented.
  for (const label of ['Personal bag', 'Carry-on', 'Checked bag']) {
    const heading = page.getByRole('button', { name: new RegExp(`^${label}`) }).first()
    await expect(heading).toBeVisible()
    await expect(heading).toContainText(/\d+ of \d+ packed/)

    // Every one is a real target for a thumb.
    const box = await heading.boundingBox()
    expect(box!.height, label).toBeGreaterThanOrEqual(44)
  }

  // Exactly one bag is open at a time, so the screen is one bag rather than five.
  await openBag(page, /^Personal bag/)
  await expect(page.locator('.bags-heading[aria-expanded="true"]')).toHaveCount(1)
  await openBag(page, /^Checked bag/)
  await expect(page.locator('.bags-heading[aria-expanded="true"]')).toHaveCount(1)
})

/**
 * The claim the whole feature rests on.
 *
 * If this ever fails, the bag view has grown a checklist of its own and the
 * product has two answers to "is that packed".
 */
test('a tick in a bag is the same tick on the packing list', async ({ page }) => {
  await page.goto(`/trips/${trip.id}/bags`)
  await openBag(page, /^Personal bag/)
  const name = await firstBagRow(page, /^Personal bag/)

  const row = bagSection(page, /^Personal bag/)
    .locator('.swipe-row', { hasText: name })
    .first()
  await row.locator('.check-main').click()
  await expect(row.locator('.check-main')).toHaveAttribute('aria-pressed', 'true')

  await page.goto(`/trips/${trip.id}`)
  const master = page.locator('.checklist .swipe-row', { hasText: name }).first()
  await expect(master.locator('.check-main')).toHaveAttribute('aria-pressed', 'true')

  // And back the other way: untick on the master list, and the bag agrees.
  await master.locator('.check-main').click()
  await expect(master.locator('.check-main')).toHaveAttribute('aria-pressed', 'false')

  await page.goto(`/trips/${trip.id}/bags`)
  await openBag(page, /^Personal bag/)
  await expect(
    bagSection(page, /^Personal bag/)
      .locator('.swipe-row', { hasText: name })
      .first()
      .locator('.check-main'),
  ).toHaveAttribute('aria-pressed', 'false')
})

test('shows the row under the bag Alex puts it in, and moves it when he changes his mind', async ({
  page,
}) => {
  await page.goto(`/trips/${trip.id}/bags`)

  // Take a row out of the personal bag and put it in the hold.
  await openBag(page, /^Personal bag/)
  const moving = await firstBagRow(page, /^Personal bag/)

  await bagSection(page, /^Personal bag/)
    .locator('.swipe-row', { hasText: moving })
    .first()
    .getByRole('button', { name: /^Options for/ })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('radio', { name: 'Checked bag', exact: true }).click()
  await page.getByRole('button', { name: 'Done' }).click()

  await openBag(page, /^Checked bag/)
  await expect(
    bagSection(page, /^Checked bag/).locator('.swipe-row', { hasText: moving }),
  ).toHaveCount(1)

  // It left the bag it came from — one row, one place.
  await openBag(page, /^Personal bag/)
  await expect(
    bagSection(page, /^Personal bag/).locator('.swipe-row', { hasText: moving }),
  ).toHaveCount(0)
})

/**
 * A trip whose only bag is the hold: the one case where a passport has nowhere
 * safe to go, and the case a bag-by-bag view must not hide.
 *
 * Its own trip, configured BEFORE anything opens it. The first version reused
 * the shared `beforeEach` trip, which the browser had already loaded — so the
 * screen's own `GET /outfits` was in flight against the same trip the `PUT` was
 * about to regenerate, and WebKit CI answered 500 while a desk machine never
 * lost the race. Configure, then navigate, is the order `bag-safety.spec.ts`
 * already uses for the same reason.
 */
test('says the same thing about a safety conflict that the packing list says', async ({ page }) => {
  const held = await createTrip(page, { owner: 'ByBagHold' })

  await page.evaluate(
    async ([id]) => {
      const current = (await (await fetch(`/api/trips/${id}`)).json()) as {
        name: string
        startDate: string
        endDate: string
      }
      const response = await fetch(`/api/trips/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: current.name,
          startDate: current.startDate,
          endDate: current.endDate,
          destinations: [{ name: 'Cape Town', country: 'South Africa' }],
          activities: ['safari'],
          bags: ['checked'],
          flightHours: 15,
        }),
      })
      if (!response.ok) throw new Error(`configure: ${response.status} ${await response.text()}`)
    },
    [held.id],
  )

  try {
    await page.goto(`/trips/${held.id}`)
    await expect(page.locator('.banner-alert')).toContainText('should not go in a checked bag')

    await page.goto(`/trips/${held.id}/bags`)
    await expect(page.locator('.banner-alert')).toContainText('should not go in a checked bag')
  } finally {
    await deleteTrip(page, held.id)
  }
})
