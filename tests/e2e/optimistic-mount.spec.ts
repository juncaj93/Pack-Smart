import { expect, test } from '@playwright/test'
import { createTrip, deleteTrip, ownedName, PASSPHRASE, signIn } from './fixtures'

/**
 * The optimistic mount, against the real built Worker (P1b).
 *
 * A device that has unlocked before renders the shell without waiting for
 * `/api/auth/session`. That is a rendering decision, and these tests are the
 * end-to-end statement that it is *only* a rendering decision: a browser
 * carrying the flag and no valid cookie must get an empty frame and the Unlock
 * screen, never a trip name.
 *
 * `tests/e2e/production-bundle.spec.ts` already proves the server refuses an
 * unauthenticated `/api/trips`. This proves the client cannot talk itself past
 * that refusal, and that signing out really does end it.
 */

const UNLOCKED_KEY = 'pack-smart:unlocked-before'

test.describe('the flag renders the frame and grants nothing', () => {
  test('a device with the flag and no session shows Unlock, never a trip', async ({
    browser,
  }) => {
    /*
     * The trip has to exist on the server for its absence from the screen to
     * mean anything. Created in a signed-in context, read for from a context
     * that has the flag and no cookie.
     */
    const owner = await browser.newContext()
    const ownerPage = await owner.newPage()
    await signIn(ownerPage)
    const trip = await createTrip(ownerPage, { owner: 'Optimistic' })

    const guest = await browser.newContext()
    await guest.addInitScript(
      ([key]) => window.localStorage.setItem(key as string, '1'),
      [UNLOCKED_KEY],
    )
    const guestPage = await guest.newPage()

    try {
      await guestPage.goto('/trips')

      // The 401 from the screen's own request is what ends the optimism.
      await expect(guestPage.getByLabel('Passphrase')).toBeVisible()
      await expect(guestPage.getByText(trip.name, { exact: false })).toHaveCount(0)

      // And the optimism is not repeated on the next launch.
      expect(await guestPage.evaluate((key) => window.localStorage.getItem(key), UNLOCKED_KEY)).toBeNull()

      // Going back must not resurrect a shell that was never authorised.
      await guestPage.goBack().catch(() => {})
      await expect(guestPage.getByText(trip.name, { exact: false })).toHaveCount(0)
    } finally {
      await guest.close()
      await deleteTrip(ownerPage, trip.id)
      await owner.close()
    }
  })

  /*
   * The session ending, without a button that ends it.
   *
   * `Sign out` has been removed from Settings — a private single-user app has
   * nobody to sign out from, and the control's real effect was to delete the
   * offline copy of a trip. The optimistic launch path still has to refuse a
   * device whose session is gone, which is what this asserts: the cookie is
   * cleared, which is what a logout, an expiry and a revocation all look like.
   */
  test('a session that ends stops it, and a reload lands on Unlock', async ({ page, context }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'SignOut' })

    try {
      await page.goto('/trips')
      await expect(page.getByText(trip.name, { exact: false }).first()).toBeVisible()

      await context.clearCookies()
      await page.reload()
      await expect(page.getByLabel('Passphrase')).toBeVisible()

      expect(await page.evaluate((key) => window.localStorage.getItem(key), UNLOCKED_KEY)).toBeNull()

      // A reload is the launch that would have taken the optimistic path.
      await page.reload()
      await expect(page.getByLabel('Passphrase')).toBeVisible()
      await expect(page.getByText(trip.name, { exact: false })).toHaveCount(0)

      // Back does not walk into the signed-in shell either.
      await page.goBack().catch(() => {})
      await expect(page.getByText(trip.name, { exact: false })).toHaveCount(0)
    } finally {
      // Signed out, so the cleanup needs its own session.
      await signIn(page)
      await deleteTrip(page, trip.id)
    }
  })

  test('unlocking sets the flag, so the next launch is the fast one', async ({ page }) => {
    // A name nothing else will match, purely so the helper's counter advances
    // the same way it does everywhere else in the suite.
    ownedName('Flag')

    await page.goto('/')
    expect(await page.evaluate((key) => window.localStorage.getItem(key), UNLOCKED_KEY)).toBeNull()

    await page.getByLabel('Passphrase').fill(PASSPHRASE)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()

    expect(await page.evaluate((key) => window.localStorage.getItem(key), UNLOCKED_KEY)).toBe('1')
  })
})
