import { expect, test } from '@playwright/test'
import { createTrip, deleteTrip, ownedName, signIn } from './fixtures'

/**
 * "Unique item for this trip", everywhere it is said (D5, doc 09 §4.3).
 *
 * The rename is not a wording preference. `Something for this trip` said
 * nothing about the one thing that distinguishes this row from everything else
 * on the list: it belongs to this trip alone and never enters the wardrobe —
 * a corkscrew for one rental, a costume for one evening. That is the entire
 * difference between it and the Add in My Stuff, and the old copy hid it.
 *
 * A test rather than a grep because §4.3 asks for it "consistently in forms,
 * sheets, buttons, labels, helper text and accessibility labels", and a control
 * whose visible label and accessible name disagree is exactly the kind of
 * half-rename a grep of the source would call finished.
 */

test.describe('a unique item for one trip', () => {
  test('says the same thing on the button, the field and to a screen reader', async ({
    page,
  }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'Unique' })

    try {
      await page.goto(`/trips/${trip.id}`)

      // The button that opens it.
      const open = page.getByRole('button', { name: 'Add a unique item' })
      await expect(open).toBeVisible()
      // And the old wording is gone rather than merely joined.
      await expect(page.getByRole('button', { name: /Add something to this trip/i })).toHaveCount(0)

      await open.click()

      /*
       * The accessible name AND the placeholder, which are two different things
       * and only one of them survives typing. A placeholder alone leaves a
       * screen reader with an unlabelled field the moment Alex starts.
       */
      const field = page.getByRole('textbox', { name: 'Unique item for this trip' })
      await expect(field).toBeVisible()
      await expect(field).toHaveAttribute('placeholder', 'Unique item for this trip')

      // The helper text says what "unique" costs and what it does not touch.
      await expect(page.getByText('Stays with this trip. My Stuff is not changed.')).toBeVisible()

      // And it does what it says: the row appears on the list.
      const name = ownedName('Corkscrew')
      await field.fill(name)
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await expect(page.getByText(name, { exact: false }).first()).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('a trip-only row explains itself in the same words', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'UniqueWhy' })

    try {
      await page.goto(`/trips/${trip.id}`)
      await page.getByRole('button', { name: 'Add a unique item' }).click()

      const name = ownedName('Costume')
      await page.getByRole('textbox', { name: 'Unique item for this trip' }).fill(name)
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await expect(page.getByText(name, { exact: false }).first()).toBeVisible()

      /*
       * Every generated row says why it is there (C1). One added by hand says
       * so too, in Alex's own register — "You added this for this trip" — which
       * is the same distinction the field's label makes.
       *
       * In the row's own sheet, not on the row. The secondary line is for the
       * facts that change what to do — how many, which bag, the arithmetic —
       * and a hand-added row has none of them; "you added this" on the list
       * would be a line of text under every row Alex typed, telling him
       * something he did thirty seconds ago.
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
