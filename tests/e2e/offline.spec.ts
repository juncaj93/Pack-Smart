import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ownedName, signIn } from './fixtures'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/**
 * Waits until the shell is genuinely cached, not merely until a worker exists.
 *
 * `controller` being set says a worker is in charge; it says nothing about
 * whether precaching has finished. Cutting the network in that window fails the
 * navigation outright, which looks like a broken feature but is really the test
 * jumping the gun.
 */
async function serviceWorkerReady(page: Page) {
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration?.active || !navigator.serviceWorker.controller) return false

      const names = await caches.keys()
      const shell = names.find((name) => name.startsWith('pack-smart-shell'))
      if (!shell) return false

      const cache = await caches.open(shell)
      const keys = await cache.keys()
      const paths = keys.map((request) => new URL(request.url).pathname)

      // index.html plus the hashed script and stylesheet it needs to run.
      return (
        paths.includes('/') &&
        paths.some((path) => path.endsWith('.js')) &&
        paths.some((path) => path.endsWith('.css'))
      )
    },
    undefined,
    { timeout: 30_000 },
  )
}

/**
 * Offline reads of the active trip are non-negotiable for v1
 * (01_ARCHITECTURE.md §5). These run in a real browser with the network cut,
 * because a service worker cannot be meaningfully unit-tested.
 */
test.describe('offline', () => {
  /**
   * Serving cached data offline cannot be tested in WebKit. Read this before
   * assuming the skip below is laziness.
   *
   * Playwright's WebKit driver does not put `context.setOffline` in front of the
   * service worker. A reload aborts with "WebKit encountered an internal error"
   * before the page is involved, and an in-app navigation reaches the worker in
   * a state where its own `fetch` does not fail the way a real lost connection
   * makes it fail. Either way the cache path is never exercised.
   *
   * Route interception is not a substitute: `page.route` does not intercept
   * service-worker-initiated requests in WebKit, so the worker would reach the
   * live server and the test would pass while proving nothing. A test that
   * cannot fail is worse than no test.
   *
   * So these run in Chromium, where the logic is genuinely exercised, and the
   * guarantee on the engine that actually ships is verified by the Airplane Mode
   * section of 08_MANUAL_IPHONE_CHECKLIST.md. That is exactly the division risk
   * R11 describes: CI cannot run iOS Safari, and passing CI is not completion.
   */
  const needsServiceWorkerOffline = (browserName: string) =>
    browserName === 'webkit'

  test('the trip stays readable with the network cut', async ({ page, context, browserName }) => {
    test.skip(needsServiceWorkerOffline(browserName), 'WebKit cannot simulate offline to a service worker')

    const name = ownedName('E2E Offline')

    await page.goto('/')
    await page.getByLabel('Passphrase').fill(PASSPHRASE)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await serviceWorkerReady(page)

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Trip name').fill(name)
    await sheet.getByLabel('Destination').fill('Cape Town')
    await sheet.getByLabel('Leaving').fill('2026-07-31')
    await sheet.getByLabel('Returning').fill('2026-08-11')
    await sheet.getByRole('button', { name: 'Create trip' }).click()

    await expect(page.getByRole('heading', { name })).toBeVisible()
    const url = page.url()
    await expect(page.locator('.check-main').first()).toBeVisible()
    const itemsWhileOnline = await page.locator('.check-name').count()

    // Cut the network entirely, then reload from scratch.
    await context.setOffline(true)
    await page.reload()

    // The shell loads from the cache, the trip is readable, and the app says so.
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.check-name')).toHaveCount(itemsWhileOnline)
    await expect(page.getByText(/Offline — showing what you last saw/)).toBeVisible()

    expect(page.url()).toBe(url)
    await context.setOffline(false)
  })

  /**
   * The case that matters most: the app is already open, signal drops, and Alex
   * taps back into the trip he was packing. The packing list must still be
   * there, complete, and labelled as a snapshot.
   */
  test('a trip already opened stays readable after signal drops', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(needsServiceWorkerOffline(browserName), 'WebKit cannot simulate offline to a service worker')

    const name = ownedName('E2E Offline Cached')

    await page.goto('/')
    await page.getByLabel('Passphrase').fill(PASSPHRASE)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await serviceWorkerReady(page)

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Trip name').fill(name)
    await sheet.getByLabel('Destination').fill('Cape Town')
    await sheet.getByLabel('Leaving').fill('2026-07-31')
    await sheet.getByLabel('Returning').fill('2026-08-11')
    await sheet.getByRole('button', { name: 'Create trip' }).click()

    await expect(page.getByRole('heading', { name })).toBeVisible()
    await expect(page.locator('.check-main').first()).toBeVisible()
    const itemsWhileOnline = await page.locator('.check-name').count()
    expect(itemsWhileOnline).toBeGreaterThan(0)

    // Back to the list, so both responses are in the cache, then lose signal.
    //
    // `exact`, because the screen grows a `Past trips` heading the moment the
    // local database has an archived trip in it — which it does after any run
    // that archives one. Without it this resolves to two headings and fails in
    // strict mode on a screen that is perfectly fine.
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await expect(page.getByRole('heading', { name: 'Trips', exact: true })).toBeVisible()
    await context.setOffline(true)

    await page.getByRole('button', { name: new RegExp(name) }).click()

    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.check-name')).toHaveCount(itemsWhileOnline)
    await expect(page.getByText(/Offline — showing what you last saw/)).toBeVisible()

    await context.setOffline(false)
  })

  /**
   * Today, offline (E1).
   *
   * The E1 briefing carries the phone's own date so the server can answer "what
   * day is it" without falling back to UTC. That date is a HEADER rather than a
   * query parameter for exactly this test's sake: `sw.js` caches `GET /api/*` by
   * full URL, so `?today=` would have missed yesterday's cache entry on the one
   * day an offline read matters.
   */
  test('Today stays readable with the network cut', async ({ page, context, browserName }) => {
    test.skip(needsServiceWorkerOffline(browserName), 'WebKit cannot simulate offline to a service worker')

    const name = ownedName('E2E Offline Today')
    const today = new Date()
    const iso = (offset: number) =>
      new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10)

    /*
     * `signIn` rather than clicking Unlock, and that is the whole of a bug this
     * test shipped with.
     *
     * Clicking Unlock starts the login POST; it does not finish it.
     * `serviceWorkerReady` then waits on a COMPLETELY DIFFERENT async chain —
     * registration and shell precache — so under parallel load it can be
     * satisfied while the session cookie is still in flight, and the `fetch`
     * below goes out unauthenticated. Measured: **401 on 6 of 8 runs** with the
     * wait removed entirely, and roughly one full-suite run in three with it.
     *
     * `signIn` waits for the primary navigation, which cannot render until the
     * session check has answered. That is the actual state transition; the
     * service worker being ready never was.
     *
     * The other three specs in this file survived by accident: each clicks a
     * nav link next, and Playwright's actionability wait for that link happens
     * to cover the same gap.
     */
    await signIn(page)
    await serviceWorkerReady(page)

    /*
     * Reports the status rather than dying on `undefined.id`.
     *
     * The first version read `body.trip.id` straight off the response, so the
     * race above surfaced as `Cannot read properties of undefined` — which says
     * nothing about why the trip was not created, and cost a full-suite
     * reproduction to find out.
     */
    const tripId = await page.evaluate(
      async ([payload]) => {
        const response = await fetch('/api/trips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload as string,
        })
        if (!response.ok) {
          throw new Error(`createTrip: ${response.status} ${await response.text()}`)
        }
        const body = (await response.json()) as { trip: { id: string } }
        return body.trip.id
      },
      [
        JSON.stringify({
          name,
          startDate: iso(-1),
          endDate: iso(4),
          destinations: [{ name: 'Cape Town', country: 'South Africa' }],
          activities: ['safari'],
          international: true,
        }),
      ],
    )

    try {
      await page.goto(`/trips/${tripId}/today`)
      await expect(page.locator('.day-nav')).toBeVisible()
      const online = await page.locator('.today-context').textContent()

      await context.setOffline(true)
      await page.reload()

      // The same day, the same place, from the cache — not a blank screen and
      // not an invented one.
      await expect(page.locator('.day-nav')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.today-context')).toHaveText(online ?? '')
      await expect(page.getByText(/Offline — showing what you last saw/)).toBeVisible()

      await context.setOffline(false)
    } finally {
      await context.setOffline(false)
      await page.evaluate(
        async ([id]) => {
          await fetch(`/api/trips/${id}`, { method: 'DELETE' })
        },
        [tripId],
      )
    }
  })

  test('a trip never opened offline says so rather than looking empty', async ({ page, context }) => {
    await page.goto('/')
    await page.getByLabel('Passphrase').fill(PASSPHRASE)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await serviceWorkerReady(page)

    // Navigate inside the running app rather than cold-loading a URL: this is
    // the real case — Pack Smart is already open and you tap a trip you have
    // not looked at since losing signal.
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await expect(page.getByRole('heading', { name: 'Trips', exact: true })).toBeVisible()

    await context.setOffline(true)
    await page.goto('/trips/a-trip-that-was-never-loaded', { waitUntil: 'commit' }).catch(() => {})
    await page.evaluate(() => {
      window.history.pushState({}, '', '/trips/a-trip-that-was-never-loaded')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    // An honest failure, not a screen that reads as "this trip has nothing in it".
    await expect(page.getByText(/Could not load that trip|offline/i).first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('button', { name: 'Back to trips' })).toBeVisible()

    await context.setOffline(false)
  })
})
