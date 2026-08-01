import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ownedName } from './fixtures'

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

  /*
   * Enabled before clicked.
   *
   * Every decision disables its button for the round trip, and the previous
   * `answer` returns as soon as the outfit CHANGES — which can be a moment
   * before the request that changed it has settled. Clicking a disabled button
   * is a no-op that looks exactly like a click, so the next wait then times out
   * against a screen that never had the chance to move. Seen on CI, where one
   * worker and a shared database make every round trip slower.
   */
  const button = page.getByRole('button', { name: action })
  await expect(button).toBeEnabled()
  await button.click()

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
    await tripWithOutfits(page, ownedName('E2E Review'))
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
    await expect(facts.getByText('Weather', { exact: true })).toBeVisible()
    await expect(facts.getByText('How dressy', { exact: true })).toBeVisible()

    /*
     * The activity is STATED, not necessarily as a row called "What for".
     *
     * The first version of this assertion demanded that row and was wrong: for
     * a group whose activity label is its own name — `nice_dinner` labels as
     * "Nice dinners", and so does the group — the row read "Nice dinners …
     * What for, Nice dinners", which is a stutter rather than a fact. §7 asks
     * for the activity to be shown; the heading shows it. So the guarantee is
     * that it is on the panel, and the row appears only when it adds something.
     */
    const activity = (await page.locator('.review-name').textContent())?.trim() ?? ''
    expect(activity.length).toBeGreaterThan(0)
    const panel = await page.locator('.review-panel').innerText()
    expect(panel).toContain(activity)

    // The garments themselves, and the progress line.
    await expect(page.locator('.review-slot').first()).toBeVisible()
    await expect(page.locator('.review-progress')).toHaveText(/\d+ of \d+ outfits reviewed/)
  })

  test('offers exactly three decisions, and no more', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Three'))
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
    await tripWithOutfits(page, ownedName('E2E Advance'))
    await enterReview(page)

    // A different outfit, without Alex asking for one.
    const first = await answer(page, 'Approve outfit')
    await expect(page.locator('.review-name')).not.toHaveText(first)
    await expect(page.locator('.review-progress')).toHaveText(/1 of \d+ outfits reviewed/)
  })

  test('lets an outfit be left for later without pretending it is settled', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Later'))
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
    await tripWithOutfits(page, ownedName('E2E Escape'))
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
    await tripWithOutfits(page, ownedName('E2E Summary'))
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

    /*
     * The rows agree with the breakdown above them, rather than the first one
     * being a particular thing.
     *
     * The first version asserted `.first()` said "Left for later" and failed on
     * CI, correctly: the seeded wardrobe leaves one group INCOMPLETE, and the
     * summary was labelling a deferred-and-incomplete outfit "Missing
     * something" while the breakdown counted it under "left for later". One
     * outfit, two labels, no way to tell they were the same one. The product
     * side of that is fixed; this asserts the invariant rather than an
     * incidental ordering.
     */
    const states = await page.locator('.review-outstanding-state').allInnerTexts()
    expect(states.length).toBeGreaterThan(0)
    for (const state of states) {
      expect(['Left for later', 'Missing something', 'Not reviewed']).toContain(state.trim())
    }

    const deferredRows = states.filter((s) => s.trim() === 'Left for later').length
    const counted = Number(/(\d+) left for later/.exec(breakdown ?? '')?.[1] ?? 0)
    expect(deferredRows, `rows and breakdown disagree: ${breakdown}`).toBe(counted)

    const resume = page.getByRole('button', { name: /^Review / })
    await resume.click()
    await expect(page.locator('.review-panel')).toBeVisible()
  })

  /*
   * The accessibility gate rejected the first version of this screen on six
   * counts. These are the four that automation can hold: the rest — whether
   * VoiceOver actually speaks the announcement, and whether the new border
   * reads as "tappable" — belong to the phone session.
   */
  test.describe('what a screen reader is told', () => {
    test('moves focus first and announces second, which is the whole fix', async ({ page }) => {
      await tripWithOutfits(page, ownedName('E2E Order'))
      await enterReview(page)

      /*
       * Both regions exist before anything happens, and the polite one is
       * empty.
       *
       * A live region inserted into the DOM already containing its text is not
       * reliably announced in Safari — it has to exist first and then change.
       * Asserted here rather than in a test of its own because that test built
       * a whole extra trip to check the same two facts this one already
       * depends on, and every extra trip is more contention on the one shared
       * end-to-end database (see doc 09 §5a).
       */
      await expect(page.locator('[role="alert"]')).toHaveCount(1)
      await expect(page.locator('[role="status"]')).toHaveCount(1)
      expect((await page.locator('[role="status"]').innerText()).trim()).toBe('')

      /*
       * The invariant nothing else tested, and the entirety of two findings: a
       * focus change is a top-priority interruption in VoiceOver and cuts off a
       * live-region announcement that started microseconds earlier. So the
       * announcement has to land AFTER the focus move, on every path.
       *
       * Sampled AT the moment focus lands, not reconstructed from two event
       * streams. The first version of this test used a `MutationObserver` and
       * could not fail: observer callbacks are delivered as microtasks, and
       * React flushes passive effects synchronously for a click, so the
       * heading's focus was always logged before the observer ran — whether or
       * not the DOM had already been mutated. Reading the region's text inside
       * the focus handler asks the question directly.
       */
      await page.evaluate(() => {
        const seen: string[] = []
        ;(window as unknown as { __atFocus: string[] }).__atFocus = seen

        document.addEventListener(
          'focusin',
          (event) => {
            const target = event.target as HTMLElement
            if (!target.classList?.contains('review-name')) return
            seen.push((document.querySelector('[role="status"]')?.textContent ?? '').trim())
          },
          true,
        )
      })

      await page.getByRole('button', { name: 'Approve outfit' }).click()

      // The announcement does arrive — otherwise "empty at focus" is trivial.
      await expect(page.locator('[role="status"]')).not.toBeEmpty()

      const atFocus = await page.evaluate(
        () => (window as unknown as { __atFocus: string[] }).__atFocus,
      )
      expect(atFocus.length, 'the heading never took focus').toBeGreaterThan(0)
      expect(
        atFocus,
        `the region already held text when focus landed: ${JSON.stringify(atFocus)}`,
      ).toEqual(atFocus.map(() => ''))
    })

    test('gives focus back after an action that does not move on', async ({ page }) => {
      await tripWithOutfits(page, ownedName('E2E Focus'))
      await enterReview(page)

      await answer(page, 'Approve outfit')
      await page.getByRole('button', { name: 'Previous outfit' }).click()

      /*
       * `Undo approval` does not advance, so nothing rescues focus by accident.
       * Disabling the button under the finger drops `activeElement` to `body`,
       * and a keyboard user was left at the top of the document while the
       * buttons beneath silently changed meaning.
       */
      const undo = page.getByRole('button', { name: 'Undo approval' })
      await undo.focus()
      await undo.click()

      /*
       * The identity, not merely "something has focus". `not.toBe('BODY')`
       * passes for any element at all — including a heading at the top of the
       * page, which is not giving focus BACK.
       */
      await expect(page.getByRole('button', { name: 'Approve outfit' })).toBeVisible()
      await expect
        .poll(async () => page.evaluate(() => document.activeElement?.textContent ?? ''))
        .toBe('Approve outfit')
    })

    test('says the garment rows became controls, and puts you on one', async ({ page }) => {
      await tripWithOutfits(page, ownedName('E2E Edit'))
      await enterReview(page)

      const toggle = page.getByRole('button', { name: 'Change something' })
      await toggle.click()
      const expanded = page.getByRole('button', { name: 'Done changing' })

      /*
       * Deliberately NOT `aria-expanded`. Nothing is shown or hidden — the rows
       * are fully readable in both modes and change from text into buttons, so
       * announcing "collapsed" about a list the user can already read in full
       * would be a false programmatic state. An earlier version of this test
       * asserted the attribute and locked the inaccuracy in.
       */
      await expect(expanded).not.toHaveAttribute('aria-expanded', /./)

      /*
       * Every rewritten row is ABOVE the toggle in DOM order, so a listener who
       * had already read past them gets no signal from the toggle alone.
       * Landing on the first one IS the announcement.
       */
      await expect
        .poll(async () =>
          page.evaluate(() => document.activeElement?.closest('.review-slot')?.className ?? ''),
        )
        .toContain('is-editable')

      // And back to the toggle on the way out, rather than to the top of the page.
      await expanded.click()
      await expect
        .poll(async () => page.evaluate(() => document.activeElement?.textContent ?? ''))
        .toBe('Change something')
    })

    test('never says the same thing twice on one outfit', async ({ page }) => {
      await tripWithOutfits(page, ownedName('E2E Echo'))
      await enterReview(page)

      // The region was named by the very heading focus lands on, so VoiceOver
      // said the outfit's name twice on every advance.
      await expect(page.locator('.review-panel')).not.toHaveAttribute('aria-labelledby', /./)

      /*
       * On the NICE DINNERS panel specifically, and that is the point.
       *
       * The walkthrough opens on "Travel days", whose activity tag is null — so
       * the row is suppressed by a condition that existed before this fix, and
       * asserting here proved nothing about the fix. The guard that matters is
       * `item.activity !== group.name`: `ACTIVITY_LABELS.nice_dinner` is
       * "Nice dinners" and so is the group's name.
       */
      for (let i = 0; i < 8; i += 1) {
        if (((await page.locator('.review-name').textContent()) ?? '').trim() === 'Nice dinners') {
          break
        }
        if ((await page.locator('.review-panel').count()) === 0) break
        await answer(page, 'Decide later')
      }
      await expect(page.locator('.review-name')).toHaveText('Nice dinners')

      // Scoped to the values, not to a line split of the whole panel.
      const values = await page.locator('.review-facts dd').allInnerTexts()
      expect(values.map((v) => v.trim())).not.toContain('Nice dinners')
    })
  })

  test('marks travel days and multi-day outfits rather than only grouping them', async ({
    page,
  }) => {
    await tripWithOutfits(page, ownedName('E2E Marks'))

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
    await tripWithOutfits(page, ownedName('E2E Sync'))
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
