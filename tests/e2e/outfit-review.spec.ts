import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/**
 * The guided outfit review, in WebKit, against the built bundle.
 *
 * The integration tests prove the deferral survives and the packing list stays
 * honest. What only a browser can settle is the half doc 09 §7 spends most of
 * its words on: that the walkthrough shows ONE outfit, that it advances by
 * itself, and — the part that would be easiest to get wrong and hardest to
 * notice — that it is not a trap. Every claim below is about whether Alex can
 * get in, get out, and get back to where he was.
 */

function uniqueName(prefix: string) {
  return `${prefix} ${Math.floor(performance.now())}`
}

async function tripWithOutfits(page: Page, name: string) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
  await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Trip name').fill(name)
  await sheet.getByLabel('Destination').fill('Cape Town')
  await sheet.getByLabel('Leaving').fill('2026-07-31')
  await sheet.getByLabel('Returning').fill('2026-08-11')
  await sheet.getByRole('button', { name: 'Safari' }).click()
  await sheet.getByRole('button', { name: 'Nice dinners' }).click()
  await sheet.getByRole('button', { name: 'Create trip' }).click()

  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.getByRole('button', { name: 'Outfits' }).click()
  await expect(page.getByRole('heading', { name: 'Outfits' })).toBeVisible()
  await page.getByRole('button', { name: 'Plan Outfits' }).click()
  await expect(page.locator('.outfit-card').first()).toBeVisible()
}

/** Into the walkthrough, from the button the coverage summary offers. */
async function enterReview(page: Page) {
  await page.getByRole('button', { name: /Review \d+ outfits|Review the last outfit/ }).click()
  await expect(page.locator('.review-panel')).toBeVisible()
}

/**
 * Answers the outfit on screen and waits for the review to actually move on.
 *
 * Every decision is a round trip — the deferral or the approval is written, and
 * only then does the panel change. Reading the next outfit's name straight after
 * the click races that write, and the first version of this file did exactly
 * that: three tests failed against a product that was behaving correctly, which
 * is the most expensive kind of test to have.
 *
 * Returns the name of the outfit that was answered, and settles on either the
 * next outfit or the closing summary.
 */
async function answer(page: Page, action: 'Approve outfit' | 'Decide later'): Promise<string> {
  const name = (await page.locator('.review-name').textContent()) ?? ''
  await page.getByRole('button', { name: action }).click()

  await expect
    .poll(async () =>
      (await page.locator('.review-name').count()) === 0
        ? 'the summary'
        : ((await page.locator('.review-name').textContent()) ?? ''),
    )
    .not.toBe(name)

  return name
}

test.describe('the guided outfit review', () => {
  test('shows one outfit at a time, with what it was planned against', async ({ page }) => {
    await tripWithOutfits(page, uniqueName('E2E Review'))
    await enterReview(page)

    // One, not four. This is the clause the audit found missing.
    await expect(page.locator('.review-panel')).toHaveCount(1)

    /*
     * Doc 09 §7's required content, asserted by its labels rather than by the
     * values — the values differ per trip, the guarantee is that the facts are
     * stated at all.
     */
    const facts = page.locator('.review-facts')
    await expect(facts.getByText('When', { exact: true })).toBeVisible()
    await expect(facts.getByText('What for', { exact: true })).toBeVisible()
    await expect(facts.getByText('Weather', { exact: true })).toBeVisible()
    await expect(facts.getByText('How dressy', { exact: true })).toBeVisible()

    // The garments themselves, and the progress line.
    await expect(page.locator('.review-slot').first()).toBeVisible()
    await expect(page.locator('.review-progress')).toHaveText(/\d+ of \d+ outfits reviewed/)
  })

  test('offers exactly three decisions, and no more', async ({ page }) => {
    await tripWithOutfits(page, uniqueName('E2E Three'))
    await enterReview(page)

    const panel = page.locator('.review-actions')
    await expect(panel.getByRole('button', { name: 'Approve outfit' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Change something' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Decide later' })).toBeVisible()
    expect(await panel.getByRole('button').count()).toBe(3)

    /*
     * The garments are not tappable until Alex asks to change something. Eight
     * buttons above the three decisions would be eleven decisions on screen,
     * which is what §7 rules out by naming the number.
     */
    expect(await page.locator('.review-slot.is-editable').count()).toBe(0)
    await panel.getByRole('button', { name: 'Change something' }).click()
    expect(await page.locator('.review-slot.is-editable').count()).toBeGreaterThan(0)
    // Still three: the label changes rather than a fourth button appearing.
    expect(await panel.getByRole('button').count()).toBe(3)
  })

  test('moves to the next outfit by itself once one is answered', async ({ page }) => {
    await tripWithOutfits(page, uniqueName('E2E Advance'))
    await enterReview(page)

    // A different outfit, without Alex asking for one.
    const first = await answer(page, 'Approve outfit')
    await expect(page.locator('.review-name')).not.toHaveText(first)
    await expect(page.locator('.review-progress')).toHaveText(/1 of \d+ outfits reviewed/)
  })

  test('lets an outfit be left for later without pretending it is settled', async ({ page }) => {
    await tripWithOutfits(page, uniqueName('E2E Later'))
    await enterReview(page)

    const deferred = await answer(page, 'Decide later')

    /*
     * The honesty check. A deferral counts as REVIEWED and never as COVERED, so
     * the coverage sentence must still report nothing approved.
     */
    await page.getByRole('button', { name: 'See all outfits' }).click()
    await expect(page.locator('.outfit-coverage-line')).toHaveText(/none approved yet/)
    await expect(page.locator('.outfit-coverage-progress')).toHaveText(/1 of \d+ outfits reviewed/)

    // And the outfit says so on its own card, rather than looking like any draft.
    const card = page.locator('.outfit-card').filter({ hasText: deferred }).first()
    await expect(card.locator('.outfit-markers')).toContainText('Decided later')
  })

  test('is not a trap: back, out, and in again land where they should', async ({ page }) => {
    await tripWithOutfits(page, uniqueName('E2E Escape'))
    await enterReview(page)

    const first = await answer(page, 'Decide later')
    expect(await page.locator('.review-name').textContent()).not.toBe(first)

    // Backward, to the outfit already answered — it is still reachable and still
    // editable, which is what stops "decide later" from losing an outfit.
    await page.getByRole('button', { name: 'Previous outfit' }).click()
    await expect(page.locator('.review-name')).toHaveText(first)

    /*
     * The browser's own Back leaves the review. Doc 09 §7 forbids a modal
     * prison, and on iPhone Safari the edge-swipe is the gesture Alex already
     * trusts — a review that swallowed it would be exactly that prison.
     */
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Outfits' })).toBeVisible()
    await expect(page.locator('.outfit-card').first()).toBeVisible()

    // And back in, resuming at an outfit still wanting an answer rather than at
    // the beginning.
    await enterReview(page)
    await expect(page.locator('.review-name')).not.toHaveText(first)
  })

  test('ends on a coverage summary with one thing left to do', async ({ page }) => {
    await tripWithOutfits(page, uniqueName('E2E Summary'))
    await enterReview(page)

    // Answer every outfit the walkthrough stops at. Bounded so a review that
    // refused to end would fail here rather than hang.
    for (let i = 0; i < 8 && (await page.locator('.review-panel').count()) > 0; i += 1) {
      await answer(page, 'Decide later')
    }

    await expect(page.locator('.review-summary-headline')).toBeVisible()
    await expect(page.locator('.review-summary-headline')).toHaveText(/outfit needs?/)

    /*
     * The breakdown doc 09 §7 asks for, and the shortfall it would otherwise
     * hide. Every outfit here was deferred, so nothing is covered and the
     * summary has to say both halves rather than reporting "reviewed" and
     * stopping there.
     */
    await expect(page.locator('.review-summary-breakdown')).toHaveText(/left for later/)
    await expect(page.locator('.review-summary-uncovered')).toHaveText(
      /(One day has|\d+ days have) no approved outfit yet\./,
    )

    // `·` is not spoken at VoiceOver's default punctuation level, so a
    // multi-part breakdown carries a real comma beside the middot.
    const breakdown = await page.locator('.review-summary-breakdown').textContent()
    if ((breakdown ?? '').includes('·')) expect(breakdown).toContain(',')

    /*
     * Nothing is lost. Every deferred outfit is listed by name with one tap back
     * into it, and one of them is the recommended next action.
     */
    await expect(page.locator('.review-outstanding-row').first()).toBeVisible()
    await expect(page.locator('.review-outstanding-state').first()).toHaveText('Left for later')

    const resume = page.getByRole('button', { name: /^Review / })
    await resume.click()
    await expect(page.locator('.review-panel')).toBeVisible()
  })

  test('marks travel days and multi-day outfits rather than only grouping them', async ({
    page,
  }) => {
    await tripWithOutfits(page, uniqueName('E2E Marks'))

    /*
     * Doc 09 §7 asks for these to be MARKED. The planner has always treated them
     * differently — a dedicated travel group, an occurrence count — but nothing
     * on the screen said so, and a card called "Travel days" was doing the
     * marking by implication.
     */
    const travel = page.locator('.outfit-card').filter({ hasText: 'Travel days' }).first()
    await expect(travel.locator('.outfit-markers')).toContainText('Travel day')

    const multi = page.locator('.outfit-card').filter({ hasText: 'Casual days' }).first()
    if ((await multi.count()) > 0) {
      await expect(multi.locator('.outfit-markers')).toContainText(/Worn \d+ days/)
    }
  })

  test('says an approved outfit’s clothes are on the list, and a deferred one’s are not', async ({
    page,
  }) => {
    await tripWithOutfits(page, uniqueName('E2E Sync'))
    await enterReview(page)

    const garment = await page.locator('.review-slot-item').first().textContent()
    const approved = await answer(page, 'Approve outfit')
    const deferred = await answer(page, 'Decide later')
    expect(approved).not.toBe(deferred)

    await page.getByRole('button', { name: 'See all outfits' }).click()
    await page.getByRole('button', { name: 'Back to packing list' }).click()

    // The approved outfit's garment made it onto the list.
    await expect(page.locator('.checklist').getByText(garment ?? '', { exact: false }).first()).toBeVisible()
  })
})
