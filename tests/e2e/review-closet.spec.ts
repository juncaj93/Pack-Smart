import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { signIn } from './fixtures'

/**
 * Review Closet Items, end to end, in a real browser (H1d).
 *
 * The unit tests decide which question is worth asking and the integration
 * tests prove one tap writes one field. What is left — and what only a browser
 * can answer — is the acceptance list itself: open it, move through it, rate
 * three things, save with immediate response, skip, finish, and come back to
 * find the ratings still there.
 *
 * **The latency case holds the write open on purpose.** `page.route` delays
 * every rating PATCH by a second and a half, which is worse than any real
 * network Alex will meet, and the star must still light up immediately. A test
 * against a fast local Worker would pass whether the screen was optimistic or
 * not — the whole failure mode is invisible until the network is slow, which is
 * exactly when Alex notices it.
 */

/** Long enough that a screen waiting on the write cannot possibly hide it. */
const SLOW_WRITE_MS = 1_500

/** P1A's budget for selected-state feedback. The tap must not pay the network. */
const FEEDBACK_BUDGET_MS = 300

async function openReview(page: Page) {
  await signIn(page)
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: /My Stuff/ })
    .click()
  await expect(page.getByRole('heading', { name: 'My Stuff' })).toBeVisible()

  await page.getByRole('button', { name: /Review closet items/ }).click()
  await expect(page.getByRole('heading', { name: 'Review closet items' })).toBeVisible()
}

/** The garment currently on the card. */
function cardName(page: Page) {
  return page.locator('.review-name')
}

/** What the chosen rating MEANS, which is what the control actually asserts. */
function meaning(page: Page, group: 'Comfort' | 'Versatility') {
  return page.locator('.rating-choice', { hasText: group }).locator('.rating-meaning')
}

function starOf(page: Page, group: 'Comfort' | 'Versatility', label: string) {
  return page.locator('.rating-choice', { hasText: group }).getByRole('radio', { name: label })
}

/**
 * The dressiness contexts the CARD currently shows as chosen.
 *
 * Read from the DOM rather than assumed, because the seeded wardrobe came
 * through the importer and the importer already wrote the single context its
 * guessed dressiness meant. A test that blindly clicks `Casual` on a garment
 * already marked Casual UNTICKS it — which is what the first version of this
 * did, and it asserted the opposite of what it had just done.
 */
async function chosenContexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>('.dressiness-option input'))
      .filter((input) => input.checked)
      .map((input) => input.id.replace('review-dressiness-', '')),
  )
}

/** The first context this garment is NOT already marked with. */
async function unchosenContext(page: Page): Promise<{ label: string; key: string }> {
  const options = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>('.dressiness-option input'))
      .filter((input) => !input.checked)
      .map((input) => ({
        key: input.id.replace('review-dressiness-', ''),
        label:
          document.getElementById(`${input.id}-name`)?.textContent?.trim() ?? '',
      })),
  )
  const first = options[0]
  if (!first) throw new Error('every dressiness context is already chosen')
  return first
}

/**
 * The garment at the head of the queue, straight from the API.
 *
 * By ID, and that matters: the first version of these tests looked the garment
 * up by the name on the card, and the real wardrobe has two things called
 * `Swim Trunks` and several called `Quarter-Zip`. `find(byName)` handed back
 * whichever row came first, so one test asserted against a garment a previous
 * test had rated. A name is what the review queue exists to FIX; it is not a
 * key.
 *
 * The queue is deterministic, so its head is the card on screen — asserted
 * below rather than assumed.
 */
async function headOfQueue(page: Page): Promise<{ id: string; displayName: string }> {
  const head = await page.evaluate(async () => {
    const response = await fetch('/api/closet-review')
    const body = (await response.json()) as {
      cards: Array<{ item: { id: string; displayName: string } }>
    }
    return body.cards[0]?.item ?? null
  })
  if (!head) throw new Error('the review queue is empty')
  return head
}

async function storedById(page: Page, id: string) {
  return page.evaluate(async ([wanted]) => {
    const response = await fetch(`/api/items/${wanted}`)
    return (await response.json()) as {
      id: string
      displayName: string
      comfort: number | null
      versatility: number | null
      dressinessContexts: string[]
    }
  }, [id])
}

/*
 * Serial, and the reason is the feature rather than the harness.
 *
 * The queue is built over the WHOLE wardrobe, so two of these running at once
 * are two tests answering questions about the same garment — the first card is
 * the first card for both of them. Under parallel workers that is a genuine
 * race over shared state, not flakiness to be retried away. CI already runs one
 * worker; this makes a local run agree with it instead of failing in a way CI
 * would never reproduce.
 */
test.describe.configure({ mode: 'serial' })

test.describe('Review Closet Items', () => {
  test('rates a garment without ever waiting for the database, and it sticks', async ({ page }) => {
    /*
     * Every rating write is held for a second and a half BEFORE the screen is
     * opened, so nothing in this test can have been saved fast.
     */
    await page.route('**/api/items/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      await new Promise((resolve) => setTimeout(resolve, SLOW_WRITE_MS))
      return route.fallback()
    })

    await openReview(page)

    const head = await headOfQueue(page)
    // The screen really is showing the head of the queue the API just returned.
    await expect(cardName(page)).toHaveText(head.displayName)

    // The card says why it is being asked about, which is the thing that keeps
    // a review queue from feeling arbitrary.
    await expect(page.locator('.review-why')).not.toBeEmpty()

    const started = Date.now()
    await starOf(page, 'Comfort', '4 of 5 — Very comfortable').click()
    await expect(meaning(page, 'Comfort')).toHaveText('Very comfortable')
    const elapsed = Date.now() - started

    /*
     * The measurement, and the reason it is an assertion rather than a note.
     * The write cannot answer for 1500ms; if this ever exceeds the budget, the
     * interaction has started waiting on persistence again.
     */
    expect(elapsed).toBeLessThan(FEEDBACK_BUDGET_MS)

    // The other two answers, on the same terms.
    await starOf(page, 'Versatility', '3 of 5 — Works in several situations').click()
    await expect(meaning(page, 'Versatility')).toHaveText('Works in several situations')

    /*
     * Two contexts the garment does not already claim, so this ADDS rather than
     * toggling something off — and so the H1c property under test is real: a
     * garment holds several contexts at once and they never collapse to one.
     */
    const firstContext = await unchosenContext(page)
    await page.getByRole('checkbox', { name: firstContext.label, exact: true }).click()
    const secondContext = await unchosenContext(page)
    await page.getByRole('checkbox', { name: secondContext.label, exact: true }).click()

    const onScreen = await chosenContexts(page)
    expect(onScreen).toEqual(expect.arrayContaining([firstContext.key, secondContext.key]))
    expect(onScreen.length).toBeGreaterThanOrEqual(2)

    // Now let every delayed write land, and prove all three actually persisted.
    await expect(async () => {
      const stored = await storedById(page, head.id)
      expect(stored).toMatchObject({ comfort: 4, versatility: 3 })
      // What the database holds is exactly what the card showed.
      expect(stored.dressinessContexts).toEqual(onScreen)
    }).toPass({ timeout: 15_000 })

    // And they are still there after a reload, which is what Alex actually does.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Review closet items' })).toBeVisible()
    expect(await storedById(page, head.id)).toMatchObject({ comfort: 4, versatility: 3 })
  })

  test('moves through the queue, and every exit is one tap away', async ({ page }) => {
    await openReview(page)

    /*
     * Asserted on the POSITION, not on the garment's name.
     *
     * The first version watched the name change, and it failed against the real
     * wardrobe for the right reason: Alex owns two things called `Swim Trunks`,
     * which is precisely what the *nothing tells this one apart* card exists to
     * point out. Two adjacent cards can legitimately carry the same name, so
     * the name is not what "advanced" means. `n of m` is.
     */
    const position = async () => (await page.locator('.review-progress').textContent())!.trim()

    const opening = await position()
    expect(opening).toMatch(/^1 of \d+$/)
    const total = Number(opening.split(' of ')[1])
    expect(total).toBeGreaterThan(3)

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.locator('.review-progress')).toHaveText(`2 of ${total}`)

    // Skip moves on and leaves the question in the queue for another day.
    await page.getByRole('button', { name: 'Skip' }).click()
    await expect(page.locator('.review-progress')).toHaveText(`3 of ${total}`)

    /*
     * Not sure WITHDRAWS the question, so the card is removed rather than moved
     * past: the position holds and the total drops by one. That difference is
     * the whole reason both controls exist.
     */
    await page.getByRole('button', { name: 'Not sure' }).click()
    await expect(page.locator('.review-progress')).toHaveText(`3 of ${total - 1}`)

    await page.getByRole('button', { name: 'Finish for now' }).click()
    await expect(page.getByRole('heading', { name: 'My Stuff' })).toBeVisible()
  })

  /*
   * The acceptance criterion that has no visible control: coming back must not
   * cost progress. A garment answered in one visit is not asked again in the
   * next, and that is true because the row itself changed — there is no cursor
   * to lose.
   */
  test('does not ask again about a garment already answered', async ({ page }) => {
    await openReview(page)

    const head = await headOfQueue(page)
    await expect(cardName(page)).toHaveText(head.displayName)
    await starOf(page, 'Comfort', '5 of 5 — One of my most comfortable items').click()
    await starOf(page, 'Versatility', '4 of 5 — Highly versatile').click()

    const context = await unchosenContext(page)
    await page.getByRole('checkbox', { name: context.label, exact: true }).click()
    const onScreen = await chosenContexts(page)

    await expect(async () => {
      const stored = await storedById(page, head.id)
      expect(stored).toMatchObject({ comfort: 5, versatility: 4 })
      expect(stored.dressinessContexts).toEqual(onScreen)
    }).toPass({ timeout: 10_000 })

    /*
     * Asked against the QUEUE rather than against what happens to be on screen.
     *
     * A garment can still hold a card for something else entirely — a tidier
     * name, a possible duplicate — and asserting it has vanished from the
     * screen would make this test fail for the right feature doing its job. The
     * claim is narrower and exact: it has no RATING left to be asked for.
     */
    const asks = await page.evaluate(async ([wanted]) => {
      const response = await fetch('/api/closet-review')
      const body = (await response.json()) as {
        cards: Array<{ item: { id: string }; asks: string[] }>
      }
      return body.cards.find((c) => c.item.id === wanted)?.asks ?? []
    }, [head.id])

    expect(asks).toEqual([])
  })

  /**
   * Ticking a context has to CHANGE WHAT IS ON SCREEN.
   *
   * That reads like a tautology and it is not, which is why it is a test. The
   * dressiness multi-select shipped with H1c looking identical ticked and
   * unticked: `global.css` styles `input` as a text field, `appearance: none`
   * removed the platform's checked glyph, and `accent-color` had nothing left
   * to colour. Every existing assertion passed, because `toBeChecked()` reads
   * the DOM property and the DOM property was right — the pixels were the only
   * thing wrong, on the one control whose whole job is showing which of five
   * things are chosen.
   *
   * So this compares the rendered box before and after. It is the only
   * assertion in the suite that could have caught it, and it catches any future
   * styling regression rather than only this one.
   */
  test('shows a ticked context as ticked, and not merely in the DOM', async ({ page }) => {
    await openReview(page)

    /*
     * Walk to a card that actually ASKS about dressiness. The tests above this
     * one have answered the head of the queue, and a card with nothing left to
     * ask about formality does not render the control at all — which is the
     * screen behaving correctly, not a reason to assert against nothing.
     */
    for (let step = 0; step < 15; step += 1) {
      const unchecked = await page.locator('.dressiness-option input:not(:checked)').count()
      if (unchecked > 0) break
      await page.getByRole('button', { name: 'Next' }).click()
    }

    const context = await unchosenContext(page)
    const box = page.getByRole('checkbox', { name: context.label, exact: true })

    const unticked = await box.screenshot()
    await box.click()
    await expect(box).toBeChecked()
    const ticked = await box.screenshot()

    expect(Buffer.compare(unticked, ticked)).not.toBe(0)
  })

  test('is reachable from Settings as well as from My Stuff', async ({ page }) => {
    await signIn(page)
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: /Settings/ })
      .click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.getByRole('button', { name: /Review closet items/ }).click()
    await expect(page.getByRole('heading', { name: 'Review closet items' })).toBeVisible()
  })

  /*
   * A failure has to be visible and has to undo only what failed. Alex on a
   * plane must not be told a rating saved when it did not.
   */
  test('says so, and puts the rating back, when the write fails', async ({ page }) => {
    await openReview(page)

    await page.route('**/api/items/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      return route.abort('failed')
    })

    await starOf(page, 'Comfort', '2 of 5 — Limited comfort').click()
    await expect(page.getByRole('alert')).toHaveText('Could not save that rating.')
    await expect(meaning(page, 'Comfort')).toHaveText('Not rated')
  })
})
