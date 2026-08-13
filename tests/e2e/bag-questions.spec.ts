import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createOwnedItem, createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * A bag question, from being asked to changing the packing list (P3b).
 *
 * The unit tests decide which question is worth asking and the integration
 * tests prove an answer reaches the column. What only a browser can prove is
 * the round trip Alex actually experiences, and it is the claim the whole
 * feature rests on:
 *
 *   he is asked about a bottle → he answers → the row on his trip moves.
 *
 * A version of this feature that asked beautifully-worded questions and changed
 * nothing would pass every other test in the repository. It would also be
 * worthless, and it would look completely normal — the queue would empty and
 * the columns would fill. This is the test that can tell those apart.
 */

let trip: TripFixture
let bottle: { id: string; name: string }

/**
 * The trip is LIVE and it is a flight, and both matter.
 *
 * The gate refuses to ask about liquids on a drive, and refuses to reason about
 * a trip that is over — so a fixture that got either wrong would produce a spec
 * that passes by never asking anything.
 */
test.beforeEach(async ({ page }) => {
  await signIn(page)

  const today = new Date()
  const start = new Date(today.getTime() + 14 * 86_400_000).toISOString().slice(0, 10)
  const end = new Date(today.getTime() + 21 * 86_400_000).toISOString().slice(0, 10)

  bottle = await createOwnedItem(page, 'BagQ', {
    kind: 'gear',
    category: 'Toiletries',
  })

  trip = await createTrip(page, {
    owner: 'BagQ',
    startDate: start,
    endDate: end,
    flightHours: 4,
  })

  /*
   * Onto THIS trip's list, not onto every trip's.
   *
   * The first version created a per-day amount to get the bottle packable, and
   * that was the wrong door: `packing_rule` is not scoped to a trip, so a rule
   * added here changes the quantity on every trip any later spec creates. It
   * cost three assertions in `today.spec.ts` several files away, and a teardown
   * that removes the rule afterwards only narrows the window rather than
   * closing it — every trip created while this file is running still sees it.
   *
   * `from-wardrobe` is the door "One last look" uses. It writes ONE
   * `checklist_entry` with `item_id` set, so the trait join still finds the
   * row, and it leaves nothing behind that another spec can see.
   */
  await page.evaluate(
    async ([tripId, itemId]) => {
      const response = await fetch(`/api/trips/${tripId}/checklist/from-wardrobe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      })
      if (!response.ok) {
        throw new Error(`from-wardrobe: ${response.status} ${await response.text()}`)
      }
    },
    [trip.id, bottle.id] as const,
  )
})

test.afterEach(async ({ page }) => {
  await deleteTrip(page, trip.id)
})

/*
 * Serial, and for the same reason `review-closet.spec.ts` is.
 *
 * The review queue is ONE queue over the whole closet, so two workers opening
 * it at once are looking at each other's cards — and a spec that acts on
 * whatever is at the head would then answer a question another worker was
 * asserting about. Scoping every read to this spec's own bottle is most of the
 * fix; running one at a time is the rest.
 */
test.describe.configure({ mode: 'serial' })

/** The card in the queue that asks about this bottle, wherever it sits. */
async function cardFor(page: Page, itemId: string) {
  return page.evaluate(
    async ([id]) => {
      const response = await fetch('/api/closet-review')
      const body = (await response.json()) as {
        cards: Array<{ item: { id: string }; reason: string; bagQuestions: Array<{ key: string }> }>
      }
      const index = body.cards.findIndex((card) => card.item.id === id)
      return index < 0
        ? null
        : {
            index,
            reason: body.cards[index]!.reason,
            questions: body.cards[index]!.bagQuestions.map((q) => q.key),
          }
    },
    [itemId] as const,
  )
}

/** Walks the review screen to a given card, confirming it arrived. */
async function walkTo(page: Page, index: number, displayName: string): Promise<void> {
  for (let step = 0; step < index; step += 1) {
    await page.getByRole('button', { name: 'Next' }).click()
  }
  await expect(page.locator('.review-name')).toHaveText(displayName)
}

/** Opens Review Closet Items on the card asking about this bottle. */
async function openOnBottle(page: Page): Promise<void> {
  const card = await cardFor(page, bottle.id)
  expect(card, 'the bottle should be in the queue').not.toBeNull()

  // Settings, which is where the entry lives now — it was removed from My
  // Stuff, where it stood above the wardrobe the screen exists to show.
  await page.goto('/settings')
  await page.getByRole('button', { name: /Review closet items/ }).click()
  await expect(page.getByRole('heading', { name: 'Review closet items' })).toBeVisible()
  await walkTo(page, card!.index, bottle.name)
}

/** What Pack Smart currently says about this item's row on the trip. */
async function bagOnTrip(page: Page, tripId: string, itemId: string) {
  return page.evaluate(
    async ([trip, item]) => {
      // The checklist lives behind its own endpoint; `/api/trips/:id` is the
      // trip itself.
      const response = await fetch(`/api/trips/${trip}/checklist`)
      const body = (await response.json()) as {
        entries: Array<{ itemId: string | null; name: string }>
      }
      return body.entries.find((entry) => entry.itemId === item)?.name ?? null
    },
    [tripId, itemId] as const,
  )
}

test.describe('a bag question, asked and answered', () => {
  test('reaches the front of the queue, because its value is proven rather than assumed', async ({
    page,
  }) => {
    const card = await cardFor(page, bottle.id)
    expect(card, 'the bottle should be in the queue').not.toBeNull()
    expect(card!.questions).toContain('liquid')
    expect(card!.reason).toBe('bag_question')

    /*
     * Ahead of every card that is NOT a bag question, rather than at index 0.
     * Another spec's bottle can legitimately share the front of the queue, and
     * asserting an exact position would make this fail for a reason that has
     * nothing to do with the ranking under test.
     */
    const ahead = await page.evaluate(async () => {
      const body = (await (await fetch('/api/closet-review')).json()) as {
        cards: Array<{ reason: string }>
      }
      return body.cards.findIndex((card) => card.reason !== 'bag_question')
    })
    expect(card!.index).toBeLessThan(ahead === -1 ? Number.MAX_SAFE_INTEGER : ahead)
  })

  test('names the trip it is about, and moves the row when it is answered', async ({ page }) => {
    await expect(await bagOnTrip(page, trip.id, bottle.id)).not.toBeNull()

    await openOnBottle(page)

    const liquid = page.locator('.review-bag', { hasText: 'Is this a full-size liquid?' })
    await expect(liquid).toBeVisible()
    /*
     * The card's reason line, not the question's own hint.
     *
     * A `bag_question` card takes its reason FROM its first question, so the
     * block deliberately does not repeat it — the two rendered as the same
     * sentence stacked twice, which read as a bug on a phone. This asserts the
     * sentence is on the card exactly once and says which trip.
     */
    await expect(page.locator('.review-why')).toContainText(trip.name)
    await expect(liquid.locator('.review-block-hint')).toHaveCount(0)

    await page.getByRole('button', { name: /^Yes, full size/ }).click()

    // Gone from the card, without a reload and without waiting for the write.
    await expect(page.getByText('Is this a full-size liquid?')).toBeHidden()

    /*
     * And the answer reached the trip. `checked` is what a full-size liquid
     * gets on a flight with a hold — the recommendation is computed on read, so
     * this is the same rule the trip screen runs, reading the column the tap
     * just wrote.
     */
    await expect
      .poll(async () =>
        page.evaluate(
          async ([id]) => {
            const response = await fetch(`/api/items/${id}`)
            const body = (await response.json()) as { isLiquid: boolean | null; liquidSize: string | null }
            return `${String(body.isLiquid)}:${String(body.liquidSize)}`
          },
          [bottle.id] as const,
        ),
      )
      .toBe('true:full')

    await page.goto(`/trips/${trip.id}`)
    const row = page.locator('.swipe-row', { hasText: bottle.name }).first()
    await row.scrollIntoViewIfNeeded()
    await row.getByRole('button', { name: /^Options for/ }).click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText(/Pack Smart suggests this/i)).toBeVisible()
    await expect(sheet.getByRole('radio', { name: 'Checked bag' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  test('stops asking once it has been answered', async ({ page }) => {
    await openOnBottle(page)
    await page.getByRole('button', { name: /^Not a liquid/ }).click()

    await expect
      .poll(async () => (await cardFor(page, bottle.id))?.questions.includes('liquid') ?? false)
      .toBe(false)
  })

  test('asks nothing about the same bottle when the trip is a drive', async ({ page }) => {
    /*
     * The aviation rule, end to end. Taking the flight off the trip has to be
     * enough — a liquid limit invented for a car journey is worse than one not
     * mentioned for a flight, because the second is merely incomplete and the
     * first is wrong.
     */
    await page.evaluate(
      async ([id]) => {
        // `GET /api/trips/:id` answers with the trip itself, not a wrapper.
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
            flightHours: null,
          }),
        })
        // A silently rejected edit would leave the trip flying and make the
        // assertion below pass for the wrong reason.
        if (!response.ok) throw new Error(`drive: ${response.status} ${await response.text()}`)
      },
      [trip.id] as const,
    )

    await expect
      .poll(async () => (await cardFor(page, bottle.id))?.questions.includes('liquid') ?? false)
      .toBe(false)
  })
})
