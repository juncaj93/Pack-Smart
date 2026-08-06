import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { signIn } from './fixtures'

/**
 * The import review, on the browser the product ships on (G5b).
 *
 * The classification itself is proved against real SQL in
 * `tests/integration/import-review.test.ts`. What only a browser can prove is
 * the part Alex touches: that a second import of the workbook he already has
 * asks him **nothing**, that the rows which do need him are a radio group a
 * screen reader can operate, and that his answers reach the commit.
 *
 * Alex's ruling of 2026-08-05 is the thing under test in the first case: an
 * exact duplicate is skipped, keeps its identity, and never appears in the
 * queue. Why the payloads here are stubbed rather than seeded is explained
 * above `NOTHING_TO_DO`, and it is a real constraint of this suite rather than
 * a convenience.
 */

const WORKBOOK = join(process.cwd(), 'seed-data', 'Master_Packing_Database_Complete.xlsx')

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

/** Picks the real workbook, and waits for the preview it produces. */
async function choose(page: Page): Promise<void> {
  await page.goto('/import')
  await page.setInputFiles('input[type="file"]', WORKBOOK)
  await expect(page.getByRole('heading', { name: 'Here is what Pack Smart found' })).toBeVisible({
    timeout: 30_000,
  })
}

/**
 * A workbook whose every row is already in My Stuff, unchanged.
 *
 * Stubbed, and the reason is worth stating rather than working around. The e2e
 * suite runs against **one long-lived local D1** that every spec — and every
 * branch checked out against it — writes into. Asserting "a re-import of the
 * seed workbook asks nothing" against that database is asserting on whatever
 * happens to be in it; measured once, it answered 76 new and 34 exact, because
 * garments written by a different branch's importer carry different names.
 *
 * So the split is deliberate: **`tests/integration/import-review.test.ts` owns
 * the data guarantee**, on a clean database, where 118 of 118 exact duplicates
 * and an empty queue is a fact rather than a coincidence. This file owns the
 * screen. The real workbook is still the file being read, so the client's own
 * parse and post are exercised exactly as they will be.
 */
const NOTHING_TO_DO = {
  summary: {
    clothingRows: 118, clothingUnique: 118, exactDuplicates: 0, identityDuplicates: 0,
    reviewCards: [], gearItems: 33, triggerRules: 0, rulesNeedingReview: [], coverageWarnings: [],
  },
  existingItems: 118,
  willAppend: true,
  review: {
    counts: { new: 0, exactDuplicates: 118, updateCandidates: 0, likelyDuplicates: 0, conflicts: 0 },
    attention: [],
    retiredRulesKept: ['Gas-X'],
  },
}

test.describe('importing a workbook already in My Stuff', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/import/dry-run', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(NOTHING_TO_DO) }),
    )
  })

  test('asks nothing, and says so rather than leaving it to be inferred', async ({ page }) => {
    await choose(page)

    await expect(page.getByRole('heading', { name: 'Compared with what you already have' })).toBeVisible()
    await expect(page.getByText(/already in My Stuff, unchanged/i)).toBeVisible()

    /*
     * Alex's ruling of 2026-08-05, on the screen: 118 exact duplicates and no
     * queue at all. `to decide` is the heading the attention list carries, and
     * its absence is the assertion.
     */
    await expect(page.getByRole('heading', { name: /to decide$/ })).toHaveCount(0)
    await expect(page.getByText(/nothing will be added twice/i)).toBeVisible()
  })

  test('says which retired rules will stay retired', async ({ page }) => {
    await choose(page)

    await expect(page.getByRole('heading', { name: 'Rules that will stay retired' })).toBeVisible()
    await expect(page.getByText(/Gas-X/)).toBeVisible()
  })

  test('still has one obvious primary action, and does not scroll sideways', async ({ page }) => {
    await choose(page)

    await expect(page.getByRole('button', { name: 'Add these to My Stuff' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})

/**
 * The rows that DO need Alex.
 *
 * Stubbed at `/api/import/dry-run` rather than manufactured in the database:
 * the classification is already proved against real SQL, and what this file is
 * for is the screen. The real workbook is still the file being read, so the
 * client's own parse and post are exercised exactly as they will be.
 */
const ATTENTION = {
  summary: {
    clothingRows: 2, clothingUnique: 2, exactDuplicates: 0, identityDuplicates: 0,
    reviewCards: [], gearItems: 0, triggerRules: 0, rulesNeedingReview: [], coverageWarnings: [],
  },
  existingItems: 118,
  willAppend: true,
  review: {
    counts: { new: 0, exactDuplicates: 116, updateCandidates: 1, likelyDuplicates: 0, conflicts: 1 },
    attention: [
      {
        key: 'clothing#4',
        sheet: 'clothing',
        name: 'Uniqlo Grey Tee',
        decision: 'update_candidate',
        matchedItemId: 'existing-1',
        matchedName: 'Uniqlo Grey Tee',
        why: 'Already in your wardrobe, but the spreadsheet now says something different about one thing.',
        differences: [
          { field: 'notes', label: 'Notes', existing: 'Work staple', incoming: 'Work staple; getting thin' },
        ],
        candidates: [],
        defaultChoice: 'keep_existing',
      },
      {
        key: 'clothing#9',
        sheet: 'clothing',
        name: 'Uniqlo Black Tee',
        decision: 'conflict',
        matchedItemId: null,
        matchedName: null,
        why: 'You already have 2 things called “Uniqlo Black Tee”, and this matches none of them exactly.',
        differences: [],
        candidates: [
          { id: 'a', name: 'Uniqlo Black Tee' },
          { id: 'b', name: 'Uniqlo Black Tee' },
        ],
        defaultChoice: 'import_separately',
      },
    ],
    retiredRulesKept: [],
  },
}

test.describe('the rows that need a decision', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/import/dry-run', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(ATTENTION) }),
    )
  })

  test('are the only ones listed, and each says what kind of question it is', async ({ page }) => {
    await choose(page)

    await expect(page.getByRole('heading', { name: '2 to decide' })).toBeVisible()
    await expect(page.getByText('The spreadsheet has changed')).toBeVisible()
    await expect(page.getByText('More than one match')).toBeVisible()

    // The 116 that need nothing are a count, not 116 cards.
    await expect(page.locator('.import-decide')).toHaveCount(2)
  })

  test('compare the two sides in words a screen reader can tell apart', async ({ page }) => {
    await choose(page)

    const card = page.locator('.import-decide').first()
    await expect(card.getByText('Notes')).toBeVisible()

    /*
     * `→` is not spoken, so each side carries its own hidden label — the same
     * reading the checklist row's middot gets in `Trip.tsx`.
     */
    await expect(card.getByText('You have:')).toBeAttached()
    await expect(card.getByText('Spreadsheet says:')).toBeAttached()
    await expect(card.getByText('Work staple; getting thin')).toBeVisible()
  })

  test('are a named radio group, with exactly one answer chosen', async ({ page }) => {
    await choose(page)

    const group = page.getByRole('radiogroup', { name: 'What to do with Uniqlo Grey Tee' })
    await expect(group).toBeVisible()

    // Nothing is overwritten unless Alex says so.
    await expect(group.getByRole('radio', { name: 'Keep what I have' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // Every answer is a real target for a thumb (doc 02: 44px minimum).
    for (const radio of await group.getByRole('radio').all()) {
      const box = await radio.boundingBox()
      expect(box!.height, (await radio.textContent()) ?? '').toBeGreaterThanOrEqual(44)
    }
  })

  /*
   * A conflict has no single match, so `Keep what I have` and `Update it` name
   * an item that does not exist. Both were offered at first, and the screenshot
   * is what caught it: the server has no matched row to act on, so either would
   * have quietly imported the garment separately while the screen said
   * otherwise. Two answers, both of which mean what they say.
   */
  test('offer only the two answers that mean anything on a conflict', async ({ page }) => {
    await choose(page)

    const conflict = page.getByRole('radiogroup', { name: 'What to do with Uniqlo Black Tee' })
    await expect(conflict.getByRole('radio')).toHaveCount(2)
    await expect(conflict.getByRole('radio', { name: 'Update it' })).toHaveCount(0)
    await expect(conflict.getByRole('radio', { name: 'Keep what I have' })).toHaveCount(0)
    await expect(conflict.getByRole('radio', { name: 'Add as separate' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  test('never claim you own both when there are three of them', async ({ page }) => {
    await choose(page)

    // The update candidate has one other; the conflict has two.
    await expect(page.getByText('You own both.')).toHaveCount(0)
    await expect(page.getByText(/beside the ones you have/i)).toBeVisible()
  })

  test('send the answers with the commit', async ({ page }) => {
    await choose(page)

    const group = page.getByRole('radiogroup', { name: 'What to do with Uniqlo Grey Tee' })
    await group.getByRole('radio', { name: 'Update it' }).click()
    await expect(group.getByRole('radio', { name: 'Update it' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    let sent: Record<string, string> | undefined
    await page.route('**/api/import/commit', async (route) => {
      const body = route.request().postDataJSON() as { choices?: Record<string, string> }
      sent = body.choices
      await route.fulfill({ status: 200, body: JSON.stringify({ created: 0 }) })
    })

    await page.getByRole('button', { name: 'Add these to My Stuff' }).click()
    await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible()

    expect(sent).toEqual({ 'clothing#4': 'update_existing' })
  })

  test('do not push the screen sideways, however long the note', async ({ page }) => {
    await choose(page)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
