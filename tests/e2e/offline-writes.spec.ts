import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * Packing with no signal, and what happens when it comes back (F2).
 *
 * ## Why the network is cut with `page.route`, and why the worker is removed
 *
 * `offline.spec.ts` cuts the whole context with `setOffline` and has to skip
 * WebKit for it: the driver cannot put that in front of a service worker, so
 * those tests run on Chromium only and CI proves nothing about them on the
 * engine that ships.
 *
 * Aborting the PATCH is a better cut for the write queue — it reproduces the
 * only condition the queue keys on ("the request never reached the server")
 * without touching reads. But `page.route` **does not intercept a page a
 * service worker is controlling in WebKit**, and this file learned that the
 * hard way: the first CI run failed 8 of 9, because every PATCH went straight
 * through to a live server and nothing was ever queued.
 *
 * So the worker is removed before the app loads. That is `AUTONOMY.md` §8's
 * standing rule — *anything faking a response has to remove the worker first,
 * and anything that needs the worker must not have it removed* — and it is
 * honest here specifically because **the queue does not involve the worker at
 * all**: `sw.js` returns immediately for any non-GET, and
 * `service-worker-routing.test.ts` asserts that line at the source along with
 * the absence of any sync handler. The offline READ specs still need the worker
 * and still skip WebKit; these need it gone and therefore do not.
 *
 * And it cannot pass vacuously either way. If an engine failed to intercept,
 * the PATCH would succeed, nothing would be queued, and every assertion about
 * `Saved on this phone` would fail loudly — which is exactly what happened.
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

/**
 * A Pack now row whose NAME is safe to drive the rest of the spec with.
 *
 * Every locator below finds its row by name, and two of them do it by
 * SUBSTRING — `rowNamed` uses `hasText`, and the button uses `new RegExp(name)`.
 * On a real wardrobe that is two separate ways to hit the wrong row: G6 made
 * duplicate display names ordinary (two garments legitimately read `Dressy
 * T-Shirt`), and one name can be contained in another, so `Shirt` matches
 * `Button-Up Shirt` in the DOM while `packedOnServer` matches only the exact
 * row. The spec would then tick one row and assert about a different one.
 *
 * There is no stable id on the rendered row to match on instead, so the fix is
 * to choose a name that cannot be ambiguous: exactly one entry has it, and it
 * is not a substring of any other entry's name. Asserted rather than skipped —
 * a spec that silently stops exercising the offline queue is worse than one
 * that fails.
 */
async function unambiguousRowName(page: Page, tripId: string): Promise<string> {
  const names = await page.evaluate(
    async ([id]) => {
      const response = await fetch(`/api/trips/${id}/checklist`)
      const body = (await response.json()) as {
        entries: Array<{ name: string; excludedAt: number | null }>
      }
      return body.entries.filter((e) => e.excludedAt === null).map((e) => e.name)
    },
    [tripId] as const,
  )

  const unambiguous = (name: string) =>
    names.filter((other) => other === name).length === 1 &&
    !names.some((other) => other !== name && other.includes(name))

  for (const row of await packNowRows(page).all()) {
    await row.scrollIntoViewIfNeeded()
    const name = ((await row.locator('.check-name').first().textContent()) ?? '')
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/\s*·\s*,?\s*Essential\s*$/u, '')
      .trim()
    if (name && unambiguous(name)) return name
  }

  throw new Error(
    `no Pack now row has a name that identifies it unambiguously. The list holds: ${names.join(' | ')}`,
  )
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

/**
 * Hides the service worker from the page before any script runs.
 *
 * `registerServiceWorker()` bails on `'serviceWorker' in navigator`, and
 * `clearPrivateCaches()` already has a no-worker fallback path — so removing it
 * this way exercises real code rather than a special case, and survives the
 * reloads two of these tests do. Unregistering after the fact would not: the
 * next load registers it again.
 */
async function withoutServiceWorker(page: Page) {
  await page.addInitScript(() => {
    /*
     * The registration is refused rather than the container hidden.
     *
     * Hiding it does not work: `'serviceWorker' in navigator` is still true for
     * a getter that returns undefined, so `registerServiceWorker()` walks
     * straight past its own guard and throws on `undefined.register`. Refusing
     * the registration exercises the `.catch()` that is already there, and
     * leaves `controller` null — which is the state that actually matters.
     */
    const container = navigator.serviceWorker
    if (container) container.register = () => Promise.reject(new Error('disabled for this spec'))
  })
  // Belt and braces: even a registration that got through has nothing to fetch.
  await page.route('**/sw.js', (route) => route.abort())
}

/**
 * Proves the worker really is gone before anything is asserted about a queue.
 *
 * `AUTONOMY.md` §8: a state simulated by removing something has to assert the
 * removal took effect. Without this, a worker that survived would show up as a
 * missing `Saved on this phone` marker — which reads as a broken feature and is
 * not one.
 */
async function expectNoServiceWorker(page: Page) {
  const controller = await page.evaluate(
    () => navigator.serviceWorker?.controller?.scriptURL ?? null,
  )
  expect(controller, 'a service worker is still controlling the page').toBeNull()
}

test.beforeEach(async ({ page }) => {
  await withoutServiceWorker(page)
  await signIn(page)
  trip = await createTrip(page, { owner: 'OfflineWrites' })
  await page.goto(`/trips/${trip.id}`)
  await expect(packNowRows(page).first()).toBeVisible()
  await expectNoServiceWorker(page)
})

test.afterEach(async ({ page }) => {
  await restoreTheWritePath(page).catch(() => {})
  await page.evaluate(() => window.localStorage.removeItem('pack-smart:pending-writes'))
  await deleteTrip(page, trip.id)
})

test.describe('packing with no signal', () => {
  test('the tick stays, and the row says where it has been saved', async ({ page }) => {
    const name = await unambiguousRowName(page, trip.id)
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
    const name = await unambiguousRowName(page, trip.id)
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
    const name = await unambiguousRowName(page, trip.id)
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
    const name = await unambiguousRowName(page, trip.id)
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
    const name = await unambiguousRowName(page, trip.id)
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
    const name = await unambiguousRowName(page, trip.id)
    await cutTheWritePath(page)
    await rowNamed(page, name).getByRole('button', { name: new RegExp(name) }).first().click()
    await expect(rowNamed(page, name).getByText('Saved on this phone')).toBeVisible()

    await restoreTheWritePath(page)
    await page.reload()

    await expect.poll(() => packedOnServer(page, trip.id, name), { timeout: 15_000 }).toBeGreaterThan(0)
  })
})

/**
 * A session that ends takes the pending writes with it.
 *
 * These used to press `Sign out` on Settings. That control is gone — a private
 * single-user app has nobody to sign out from, and the button's real effect was
 * to delete the offline copy of the trip Alex was relying on — so the session is
 * ended the way it now ends in practice: the cookie stops being valid, the next
 * request 401s, and `App`'s `lock()` empties everything.
 *
 * That is a STRONGER test than the button was, not a weaker one. `lock()` was
 * always the thing under the button, and it is the thing that runs on every
 * other path too; the button was one of four callers and is the only one that
 * has gone.
 */
test.describe('a session that ends', () => {
  test('takes the pending writes with it, and never sends them afterwards', async ({
    page,
    context,
  }) => {
    const name = await unambiguousRowName(page, trip.id)
    await cutTheWritePath(page)
    await rowNamed(page, name).getByRole('button', { name: new RegExp(name) }).first().click()
    await expect(rowNamed(page, name).getByText('Saved on this phone')).toBeVisible()

    /*
     * The write path stays cut across the reload, and that is the point.
     *
     * Restoring it first would let the queue drain before the session ends — a
     * correct outcome, and the wrong test. What has to be true is that a session
     * ending with a write STILL pending throws it away rather than sending it
     * afterwards.
     */
    await context.clearCookies()
    await page.reload()
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

  test('leaves nothing for the Back button to restore', async ({ page, context }) => {
    await cutTheWritePath(page)
    const name = await unambiguousRowName(page, trip.id)
    await rowNamed(page, name).getByRole('button', { name: new RegExp(name) }).first().click()

    // Somewhere else first, so `Back` has a signed-in screen to try to return to.
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await context.clearCookies()
    await page.reload()
    await expect(page.getByLabel('Passphrase')).toBeVisible()

    await page.goBack()

    // The passphrase screen, not the packing list rendered from a cache.
    await expect(page.getByLabel('Passphrase')).toBeVisible()
    await expect(page.locator('.check-name')).toHaveCount(0)

    // Signed out, so the teardown needs its own session.
    await restoreTheWritePath(page)
    await signIn(page)
  })
})

test.describe('one-handed, and readable', () => {
  test('says it in words a screen reader will read, at iPhone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 })
    const name = await unambiguousRowName(page, trip.id)
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
