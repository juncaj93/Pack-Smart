import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * Packing with no signal, and what happens when it comes back (F2).
 *
 * ## Why the network is cut with `page.route`, not `context.setOffline`
 *
 * `offline.spec.ts` cuts the whole context, and has to skip WebKit for it: the
 * driver cannot put `setOffline` in front of a service worker, so the tests
 * that need it run on Chromium only and CI proves nothing about them.
 *
 * The write queue does not need the service worker at all — `sw.js` returns
 * immediately for any non-GET, so a PATCH is an ordinary page request. Aborting
 * exactly that request reproduces the only condition the queue keys on ("it
 * never reached the server") and does it on **every engine, including the one
 * that ships**.
 *
 * And it cannot pass vacuously. If an engine failed to intercept, the PATCH
 * would succeed, nothing would be queued, and every assertion below about
 * `Saved on this phone` would fail loudly rather than quietly proving nothing.
 */

let trip: TripFixture

/** Every checklist write, and nothing else. */
const CHECKLIST_WRITE = '**/api/trips/*/checklist/*'

async function cutTheWritePath(page: Page) {
  await page.route(CHECKLIST_WRITE, async (route) => {
    if (route.request().method() === 'PATCH') return route.abort('internetdisconnected')
    return route.fallback()
  })
}

async function restoreTheWritePath(page: Page) {
  await page.unroute(CHECKLIST_WRITE)
}

/** The first row of Pack now, followed by NAME rather than by position. */
function packNowRows(page: Page) {
  return page.locator('.checklist-section', { hasText: 'Pack now' }).first().locator('.swipe-row')
}

async function firstRowName(page: Page): Promise<string> {
  const row = packNowRows(page).first()
  await row.scrollIntoViewIfNeeded()
  return ((await row.locator('.check-name').first().textContent()) ?? '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s*·\s*,?\s*Essential\s*$/u, '')
    .trim()
}

function rowNamed(page: Page, name: string) {
  return page.locator('.swipe-row').filter({ hasText: name }).first()
}

/** What the server believes, read straight from the API rather than the screen. */
async function packedOnServer(page: Page, tripId: string, name: string): Promise<number> {
  return page.evaluate(
    async ([id, itemName]) => {
      const response = await fetch(`/api/trips/${id}/checklist`)
      const body = (await response.json()) as {
        entries: Array<{ name: string; packedQty: number }>
      }
      return body.entries.find((entry) => entry.name === itemName)?.packedQty ?? -1
    },
    [tripId, name],
  )
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
  trip = await createTrip(page, { owner: 'OfflineWrites' })
  await page.goto(`/trips/${trip.id}`)
  await expect(packNowRows(page).first()).toBeVisible()
})

test.afterEach(async ({ page }) => {
  await restoreTheWritePath(page).catch(() => {})
  await page.evaluate(() => window.localStorage.removeItem('pack-smart:pending-writes'))
  await deleteTrip(page, trip.id)
})

test.describe('packing with no signal', () => {
  test('the tick stays, and the row says where it has been saved', async ({ page }) => {
    const name = await firstRowName(page)
    await cutTheWritePath(page)

    await rowNamed(page, name).getByRole('button', { name: new RegExp(name) }).first().click()

    const row = rowNamed(page, name)
    // It does not spring back — which is the whole defect F2 exists to fix.
    await expect(row.locator('.check-box.is-on')).toBeVisible()
    await expect(row.getByText('Saved on this phone')).toBeVisible()
    // And it is not reported as an error, because nothing has gone wrong.
    await expect(page.getByText('That did not save. Try again.')).toHaveCount(0)

    expect(await packedOnServer(page, trip.id, name)).toBe(0)
  })

  test('unpacking works the same way', async ({ page }) => {
    const name = await firstRowName(page)
    const tap = () =>
      rowNamed(page, name).getByRole('button', { name: new RegExp(name) }).first().click()

    // Packed for real, with a connection.
    await tap()
    await expect.poll(() => packedOnServer(page, trip.id, name)).toBeGreaterThan(0)

    await cutTheWritePath(page)
    await tap()

    await expect(rowNamed(page, name).getByText('Saved on this phone')).toBeVisible()
    await expect(rowNamed(page, name).locator('.check-box.is-on')).toHaveCount(0)
  })

  test('several taps on one row are one change, not a stack of them', async ({ page }) => {
    const name = await firstRowName(page)
    await cutTheWritePath(page)
    const button = rowNamed(page, name).getByRole('button', { name: new RegExp(name) }).first()

    for (let tap = 0; tap < 5; tap += 1) {
      await button.click()
      await expect(rowNamed(page, name).getByText('Saved on this phone')).toBeVisible()
    }

    const queued = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('pack-smart:pending-writes') ?? '[]'),
    )
    // Desired state, not a log: five taps, one record, holding the last one.
    expect(queued).toHaveLength(1)
  })

  test('survives the app being closed and reopened with still no signal', async ({ page }) => {
    const name = await firstRowName(page)
    await cutTheWritePath(page)
    await rowNamed(page, name).getByRole('button', { name: new RegExp(name) }).first().click()
    await expect(rowNamed(page, name).getByText('Saved on this phone')).toBeVisible()

    // A relaunch. The checklist that comes back is the one the SERVER has, with
    // nothing packed on it — the queue is what puts the tick back.
    await page.reload()
    await expect(packNowRows(page).first()).toBeVisible()

    const row = rowNamed(page, name)
    await expect(row.locator('.check-box.is-on')).toBeVisible()
    await expect(row.getByText('Saved on this phone')).toBeVisible()
  })
})

test.describe('when the signal comes back', () => {
  test('the change reaches the server, and the row stops saying it has not', async ({ page }) => {
    const name = await firstRowName(page)
    await cutTheWritePath(page)
    await rowNamed(page, name).getByRole('button', { name: new RegExp(name) }).first().click()
    await expect(rowNamed(page, name).getByText('Saved on this phone')).toBeVisible()

    await restoreTheWritePath(page)
    // What the OS says when airplane mode goes off, which is one of the three
    // triggers. The others are the app's own first successful request and a
    // relaunch.
    await page.evaluate(() => window.dispatchEvent(new Event('online')))

    await expect.poll(() => packedOnServer(page, trip.id, name), { timeout: 15_000 }).toBeGreaterThan(0)
    await expect(rowNamed(page, name).getByText('Saved on this phone')).toHaveCount(0)

    // And it is genuinely on the server, not merely absent from the queue.
    await page.reload()
    await expect(rowNamed(page, name).locator('.check-box.is-on')).toBeVisible()
  })

  test('a relaunch with signal is enough on its own', async ({ page }) => {
    const name = await firstRowName(page)
    await cutTheWritePath(page)
    await rowNamed(page, name).getByRole('button', { name: new RegExp(name) }).first().click()
    await expect(rowNamed(page, name).getByText('Saved on this phone')).toBeVisible()

    await restoreTheWritePath(page)
    await page.reload()

    await expect.poll(() => packedOnServer(page, trip.id, name), { timeout: 15_000 }).toBeGreaterThan(0)
  })
})

test.describe('signing out', () => {
  test('takes the pending writes with it, and never sends them afterwards', async ({ page }) => {
    const name = await firstRowName(page)
    await cutTheWritePath(page)
    await rowNamed(page, name).getByRole('button', { name: new RegExp(name) }).first().click()
    await expect(rowNamed(page, name).getByText('Saved on this phone')).toBeVisible()

    /*
     * The write path stays cut across the navigation, and that is the point.
     *
     * Restoring it first would let the queue drain on the way to Settings — a
     * correct outcome, and the wrong test. What has to be true is that a
     * sign-out reached with a write STILL pending throws it away rather than
     * sending it afterwards.
     */
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByLabel('Passphrase')).toBeVisible()

    const state = await page.evaluate(() => ({
      queue: window.localStorage.getItem('pack-smart:pending-writes'),
      marker: window.localStorage.getItem('pack-smart:session-id'),
      unlocked: window.localStorage.getItem('pack-smart:unlocked-before'),
    }))
    expect(state).toEqual({ queue: null, marker: null, unlocked: null })

    // Back in, with signal, and nothing from before the sign-out is applied.
    await restoreTheWritePath(page)
    await signIn(page)
    await page.goto(`/trips/${trip.id}`)
    await expect(packNowRows(page).first()).toBeVisible()
    expect(await packedOnServer(page, trip.id, name)).toBe(0)
  })

  test('leaves nothing for the Back button to restore', async ({ page }) => {
    await cutTheWritePath(page)
    const name = await firstRowName(page)
    await rowNamed(page, name).getByRole('button', { name: new RegExp(name) }).first().click()

    await page.goto('/settings')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByLabel('Passphrase')).toBeVisible()

    await page.goBack()

    // The passphrase screen, not the packing list rendered from a cache.
    await expect(page.getByLabel('Passphrase')).toBeVisible()
    await expect(page.locator('.check-name')).toHaveCount(0)
  })
})

test.describe('one-handed, and readable', () => {
  test('says it in words a screen reader will read, at iPhone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 })
    const name = await firstRowName(page)
    await cutTheWritePath(page)
    await rowNamed(page, name).getByRole('button', { name: new RegExp(name) }).first().click()

    const row = rowNamed(page, name)
    const marker = row.getByText('Saved on this phone')
    await expect(marker).toBeVisible()

    /*
     * Not `aria-hidden`, and not a colour.
     *
     * The state has to be available to VoiceOver, which a greyed tick is not —
     * and the row's own accessible name is where a reader will meet it.
     */
    expect(await marker.getAttribute('aria-hidden')).toBeNull()

    // And it does not push the row off the side of a 390px screen.
    const box = await row.boundingBox()
    expect(box!.width).toBeLessThanOrEqual(390)
  })
})
