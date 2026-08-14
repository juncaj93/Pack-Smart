import { expect, test } from '@playwright/test'
import { createOwnedItem, createTrip, deleteTrip, signIn } from './fixtures'

/**
 * The one way onto a packing list, and the shape of the rows it produces.
 *
 * ## What this covers, and why it is one file
 *
 * §47 and §48 ask for two sets of guards, and they are the same interaction
 * seen from two ends: Add puts something on the list, and the list has to show
 * it as one clean row. Splitting them would mean two trips, two seeds and two
 * copies of the same setup for assertions that read each other's output.
 *
 * The route regression is the thing worth the most here. §9 allows the old
 * bottom-of-page `Add a unique item` control to be deleted ONLY once every
 * capability it carried is reachable from the new flow — and this repository
 * has already lost a route once by removing a control that looked redundant.
 * So both halves of Add are exercised through the UI, end to end.
 */

test.describe('adding something to a trip', () => {
  test('the top-right action opens My Stuff, and a tap puts it on the list', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'AddFlow' })
    const item = await createOwnedItem(page, 'AddFlow')

    try {
      await page.goto(`/trips/${trip.id}`)
      await expect(page.getByRole('button', { name: 'Add to this trip' })).toBeVisible()

      await page.getByRole('button', { name: 'Add to this trip' }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()

      // A wardrobe browser, not a second implementation of one: the search
      // reaches the item by the name Alex gave it.
      await sheet.getByRole('searchbox').fill(item.name)
      const row = sheet.getByRole('button', { name: new RegExp(item.name) })
      await expect(row).toBeVisible()

      await row.click()

      /*
       * Two facts, and the second is the one that matters. The sheet says
       * `Added` at once — the write is optimistic — and the list behind it
       * really does carry the row, which is what proves the reply was applied
       * rather than the marker being a lie.
       */
      await expect(row).toContainText('Added')
      await page.getByRole('button', { name: 'Done' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.check-name', { hasText: item.name }).first()).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('does not offer to add something that is already on the list', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'AddDup' })
    const item = await createOwnedItem(page, 'AddDup')

    try {
      await page.goto(`/trips/${trip.id}`)
      await page.getByRole('button', { name: 'Add to this trip' }).click()
      const sheet = page.getByRole('dialog')
      await sheet.getByRole('searchbox').fill(item.name)
      await sheet.getByRole('button', { name: new RegExp(item.name) }).click()
      await expect(sheet.getByRole('button', { name: new RegExp(item.name) })).toContainText('Added')

      // Reopened, the same garment reports where it is rather than offering
      // itself again — the duplicate `§47` rules out, said on the row.
      await page.getByRole('button', { name: 'Done' }).click()
      await page.getByRole('button', { name: 'Add to this trip' }).click()
      const reopened = page.getByRole('dialog').getByRole('button', { name: new RegExp(item.name) })
      await expect(reopened).toContainText('On the list')
      await expect(reopened).toBeDisabled()

      // And exactly one row exists, which is the claim behind the disabled state.
      await page.getByRole('button', { name: 'Done' }).click()
      await expect(page.locator('.check-name', { hasText: item.name })).toHaveCount(1)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('remembers what the picker was searched for, and forgets what was added', async ({
    page,
  }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'AddSearch' })
    const item = await createOwnedItem(page, 'AddSearch')

    try {
      await page.goto(`/trips/${trip.id}`)
      await page.getByRole('button', { name: 'Add to this trip' }).click()
      await page.getByRole('dialog').getByRole('searchbox').fill(item.name)
      await expect(
        page.getByRole('dialog').getByRole('button', { name: new RegExp(item.name) }),
      ).toBeVisible()

      await page.getByRole('button', { name: 'Done' }).click()
      await page.getByRole('button', { name: 'Add to this trip' }).click()

      // §41: the search survives, so adding three things out of one search does
      // not mean typing it three times.
      await expect(page.getByRole('dialog').getByRole('searchbox')).toHaveValue(item.name)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  /*
   * The lens the header action displaced (§6).
   *
   * Removing a control that "looks redundant" is how this project lost a route
   * once already, so the bag screen is asserted to still be reachable — from
   * the row of destinations, where Outfits and Today already are.
   */
  test('the bag lens is still reachable, from the row of destinations', async ({ page }) => {
    await signIn(page)
    // The default fixture is an international flight, which is what gives the
    // trip bags to look through — the same setup `pack-by-bag.spec.ts` uses.
    const trip = await createTrip(page, { owner: 'AddBags' })

    try {
      await page.goto(`/trips/${trip.id}`)
      await expect(page.locator('.checklist').first()).toBeVisible()

      await page.getByRole('button', { name: 'Bags', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Pack by bag', level: 1 })).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})

test.describe('a packing row is one line', () => {
  /*
   * §48, measured rather than looked at, on a list this test BUILDS.
   *
   * The row shape depends on a garment that has both a brand and a colour, and
   * the only way to be certain one is on the list is to put it there — reading
   * `trips[0]` or leaning on whatever the workbook happens to hold is the
   * interference class `fixtures.ts` exists to end. So the trip carries three
   * rows the test made: a plain one, an ordinary brand, and a brand long enough
   * to force the truncation §15 asks for.
   */
  test('carries brand and colour beside the name without a second line', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'OneLine' })

    const plain = await createOwnedItem(page, 'OneLinePlain')
    const branded = await createOwnedItem(page, 'OneLineBrand', {
      kind: 'clothing',
      category: 'Tops & Outerwear',
      subcategory: 't-shirt',
      brand: 'Vuori',
      color: 'Dark Green',
    })
    const longBrand = await createOwnedItem(page, 'OneLineLong', {
      kind: 'clothing',
      category: 'Tops & Outerwear',
      subcategory: 't-shirt',
      brand: 'Abercrombie & Fitch',
      color: 'Navy',
    })

    try {
      await page.goto(`/trips/${trip.id}`)

      for (const item of [plain, branded, longBrand]) {
        await page.getByRole('button', { name: 'Add to this trip' }).click()
        const sheet = page.getByRole('dialog')
        await sheet.getByRole('searchbox').fill(item.name)
        await sheet.getByRole('button', { name: new RegExp(item.name) }).click()
        await expect(sheet.getByRole('button', { name: new RegExp(item.name) })).toContainText(
          'Added',
        )
        await page.getByRole('button', { name: 'Done' }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }

      const rowOf = (name: string) =>
        page.locator('.check-main').filter({ has: page.locator('.check-name', { hasText: name }) })

      await expect(rowOf(branded.name)).toHaveCount(1)

      const shape = await page.evaluate(
        ([plainName, brandName, longName]) => {
          const find = (needle: string) =>
            Array.from(document.querySelectorAll('.check-main')).find((main) =>
              (main.querySelector('.check-name')?.textContent ?? '').includes(needle),
            )
          const read = (main: Element | undefined) =>
            main
              ? {
                  height: main.getBoundingClientRect().height,
                  brand: (main.querySelector('.check-side-text')?.textContent ?? '').trim(),
                  brandWidth:
                    main.querySelector('.check-side-text')?.getBoundingClientRect().width ?? 0,
                  brandScroll: (main.querySelector('.check-side-text') as HTMLElement | null)
                    ?.scrollWidth ?? 0,
                  rowWidth: main.getBoundingClientRect().width,
                  sideWidth: main.querySelector('.check-side')?.getBoundingClientRect().width ?? 0,
                  nameWidth: main.querySelector('.check-name-text')?.getBoundingClientRect().width ?? 0,
                  dots: main.querySelectorAll('.color-dot').length,
                }
              : null

          return {
            plain: read(find(plainName!)),
            branded: read(find(brandName!)),
            long: read(find(longName!)),
          }
        },
        [plain.name, branded.name, longBrand.name],
      )

      expect(shape.plain, 'the plain row is missing').not.toBeNull()
      expect(shape.branded, 'the branded row is missing').not.toBeNull()
      expect(shape.long, 'the long-brand row is missing').not.toBeNull()

      // The brand is on the row, on the right, as text.
      expect(shape.branded!.brand).toBe('Vuori')
      // And the colour is a swatch beside it rather than a word (§13).
      expect(shape.branded!.dots, 'no colour swatch on a garment row').toBeGreaterThan(0)

      /*
       * The claim itself: a row carrying a brand and a colour is exactly as
       * tall as one carrying neither. A second line would be ~20px, which no
       * tolerance this tight can absorb.
       */
      expect(
        Math.abs(shape.branded!.height - shape.plain!.height),
        'a garment row is taller than a plain one',
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(shape.long!.height - shape.plain!.height),
        'a long brand grew the row',
      ).toBeLessThanOrEqual(1)

      /*
       * §15's priority, as two measurements.
       *
       * First: a long brand really does give way — its box is narrower than its
       * own content, so `Abercrombie & Fitch` is ellipsised rather than pushing
       * anything off the row.
       *
       * Second, and the one that makes the first meaningful: the metadata zone
       * is CAPPED, so however long the brand is it can never take the row from
       * the item name. That is what "keep the item name readable" is in
       * pixels — the name is left with the majority of the row, always, rather
       * than with whatever the brand did not want.
       */
      expect(
        shape.long!.brandScroll,
        'the long brand was not truncated',
      ).toBeGreaterThan(shape.long!.brandWidth)
      expect(
        shape.long!.sideWidth / shape.long!.rowWidth,
        'the metadata took more than a third of the row from the name',
      ).toBeLessThanOrEqual(0.32)
      expect(
        shape.long!.nameWidth,
        'the longest brand in the wardrobe left the item name with less room than itself',
      ).toBeGreaterThan(shape.long!.sideWidth)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('tells a listener the colour the dot is standing in for', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'OneLineA11y' })
    const item = await createOwnedItem(page, 'OneLineA11y', {
      kind: 'clothing',
      category: 'Tops & Outerwear',
      subcategory: 't-shirt',
      brand: 'Vuori',
      color: 'Dark Green',
    })

    try {
      await page.goto(`/trips/${trip.id}`)
      await page.getByRole('button', { name: 'Add to this trip' }).click()
      const sheet = page.getByRole('dialog')
      await sheet.getByRole('searchbox').fill(item.name)
      await sheet.getByRole('button', { name: new RegExp(item.name) }).click()
      await expect(sheet.getByRole('button', { name: new RegExp(item.name) })).toContainText('Added')
      await page.getByRole('button', { name: 'Done' }).click()

      /*
       * §14: removing the visible colour word may not take the fact away from
       * the person who cannot see the dot. The swatch is `aria-hidden`, so the
       * colour has to be in the row's accessible DESCRIPTION — and it is read
       * back through `aria-describedby` rather than out of the DOM, because a
       * visually-hidden span nothing references is on the page and silent.
       */
      const row = page
        .locator('.check-main')
        .filter({ has: page.locator('.check-name', { hasText: item.name }) })
        .first()

      const description = await row.evaluate((node) => {
        const ids = (node.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
        return ids
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      })

      expect(description).toContain('Dark Green')
      expect(description).toContain('Vuori')

      // And the name itself is still just the item — the fix that stopped
      // VoiceOver reading prose before the role on every row.
      await expect(row).toHaveAccessibleName(new RegExp(`^${item.name}`))
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})
