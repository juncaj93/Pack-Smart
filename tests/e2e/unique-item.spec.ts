import { expect, test } from '@playwright/test'
import { createTrip, deleteTrip, ownedName, signIn } from './fixtures'

/**
 * "Unique item for this trip", everywhere it is said (D5, doc 09 §4.3) — and
 * now reached from the one Add flow rather than from the end of the list (§8).
 *
 * The rename is not a wording preference. `Something for this trip` said
 * nothing about the one thing that distinguishes this row from everything else
 * on the list: it belongs to this trip alone and never enters the wardrobe —
 * a corkscrew for one rental, a costume for one evening. That is the entire
 * difference between it and adding something out of My Stuff, and the old copy
 * hid it.
 *
 * A test rather than a grep because §4.3 asks for it "consistently in forms,
 * sheets, buttons, labels, helper text and accessibility labels", and a control
 * whose visible label and accessible name disagree is exactly the kind of
 * half-rename a grep of the source would call finished.
 *
 * The route it now takes is asserted as well, because §9 allows the old
 * bottom-of-page control to be removed ONLY once the capability it carried is
 * reachable elsewhere. This is that proof: the row still gets written, it is
 * still trip-only, and it still explains itself in the same words.
 */

test.describe('a unique item for one trip', () => {
  test('says the same thing on the button, the field and to a screen reader', async ({
    page,
  }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'Unique' })

    try {
      await page.goto(`/trips/${trip.id}`)

      /*
       * The old control is gone from the page, and the new one is in the
       * header. Asserting the absence is half the point: §9 forbids leaving two
       * competing ways to do the same thing, so a pass that added the sheet and
       * left the button below the list would be the failure this checks for.
       */
      await expect(page.getByRole('button', { name: 'Add a unique item' })).toHaveCount(0)

      await page.getByRole('button', { name: 'Add to this trip' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()

      const open = page.getByRole('button', { name: 'Unique item for this trip' })
      await expect(open).toBeVisible()
      await open.click()

      /*
       * The accessible name AND the placeholder, which are two different things
       * and only one of them survives typing. A placeholder alone leaves a
       * screen reader with an unlabelled field the moment Alex starts.
       */
      const field = page.getByRole('textbox', { name: 'Unique item for this trip' })
      await expect(field).toBeVisible()
      await expect(field).toHaveAttribute('placeholder', /Wedding invitation/)

      // The helper text says what "unique" costs and what it does not touch.
      await expect(page.getByText('Stays with this trip. My Stuff is not changed.')).toBeVisible()

      // And it does what it says: the row appears on the list, and the sheet
      // closes behind it rather than leaving Alex looking at an empty field.
      const name = ownedName('Corkscrew')
      await field.fill(name)
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByText(name, { exact: false }).first()).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('stays out of My Stuff, which is the whole meaning of the word', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'UniqueTripOnly' })

    try {
      await page.goto(`/trips/${trip.id}`)
      await page.getByRole('button', { name: 'Add to this trip' }).click()
      await page.getByRole('button', { name: 'Unique item for this trip' }).click()

      const name = ownedName('RentalKey')
      await page.getByRole('textbox', { name: 'Unique item for this trip' }).fill(name)
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await expect(page.getByText(name, { exact: false }).first()).toBeVisible()

      /*
       * Asserted against the catalog rather than against the wardrobe screen.
       * "It is not visible in My Stuff" could be true of a row that IS in the
       * catalog and merely filtered; `/api/items` returning nothing for the
       * name is the fact the product promises.
       */
      const inCatalog = await page.evaluate(async (needle) => {
        const response = await fetch(`/api/items?search=${encodeURIComponent(needle)}`)
        const body = (await response.json()) as { items: Array<{ displayName: string }> }
        return body.items.some((item) => item.displayName === needle)
      }, name)

      expect(inCatalog, 'a unique item was silently added to My Stuff').toBe(false)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('a trip-only row explains itself in the same words', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'UniqueWhy' })

    try {
      await page.goto(`/trips/${trip.id}`)
      await page.getByRole('button', { name: 'Add to this trip' }).click()
      await page.getByRole('button', { name: 'Unique item for this trip' }).click()

      const name = ownedName('Costume')
      await page.getByRole('textbox', { name: 'Unique item for this trip' }).fill(name)
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await expect(page.getByText(name, { exact: false }).first()).toBeVisible()

      /*
       * Every generated row says why it is there (C1). One added by hand says
       * so too, in Alex's own register — "You added this for this trip" — which
       * is the same distinction the field's label makes.
       *
       * In the row's own sheet, not on the row. The row's metadata zone is for
       * the facts that change what to do — how many, which bag, which garment —
       * and a hand-added row has none of them; "you added this" on the list
       * would be text beside every row Alex typed, telling him something he did
       * thirty seconds ago.
       */
      await page
        .getByRole('button', { name: new RegExp(`Options for ${name}`, 'i') })
        .first()
        .click()
      await expect(page.getByText('You added this for this trip').first()).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})
