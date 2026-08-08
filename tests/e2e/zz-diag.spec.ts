import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { signIn } from './fixtures'

/** TEMPORARY DIAGNOSTIC — not for merge. Named zz- so it runs last. */

const WORKBOOK = join(process.cwd(), 'seed-data', 'Master_Packing_Database_Complete.xlsx')

const ATTENTION = {
  summary: {
    clothingRows: 118, clothingUnique: 118, exactDuplicates: 0, identityDuplicates: 0,
    reviewCards: [], gearItems: 33, triggerRules: 0, rulesNeedingReview: [], coverageWarnings: [],
  },
  existingItems: 118,
  willAppend: true,
  review: {
    counts: { new: 0, exactDuplicates: 116, updateCandidates: 1, likelyDuplicates: 0, conflicts: 1 },
    attention: [
      {
        key: 'clothing#4', sheet: 'clothing', name: 'Uniqlo Grey Tee',
        decision: 'update_candidate', matchedItemId: 'existing-1', matchedName: 'Uniqlo Grey Tee',
        why: 'Already in your wardrobe, but the spreadsheet now says something different about one thing.',
        differences: [{ field: 'notes', label: 'Notes', existing: 'Work staple', incoming: 'Work staple; getting thin' }],
        candidates: [], defaultChoice: 'keep_existing',
      },
    ],
    retiredRulesKept: [],
  },
}

test('DIAG: did the dry-run stub intercept on this engine', async ({ page }) => {
  const netRequests: string[] = []
  let stubHits = 0
  let fulfilledOk = true

  page.on('request', (r) => {
    if (r.url().includes('/api/import/dry-run')) netRequests.push(`${r.method()} ${r.url()}`)
  })

  await signIn(page)

  await page.route('**/api/import/dry-run', async (route) => {
    stubHits += 1
    try {
      await route.fulfill({ status: 200, body: JSON.stringify(ATTENTION) })
    } catch {
      fulfilledOk = false
    }
  })

  await page.goto('/import')
  await page.setInputFiles('input[type="file"]', WORKBOOK)
  await expect(page.getByRole('heading', { name: 'Here is what Pack Smart found' })).toBeVisible({
    timeout: 30_000,
  })

  const seen = await page.evaluate(() => ({
    decideCards: document.querySelectorAll('.import-decide').length,
    radiogroups: document.querySelectorAll('[role="radiogroup"]').length,
    text: document.body.innerText.slice(0, 700),
  }))

  throw new Error('DIAGRESULT ' + JSON.stringify({ stubHits, fulfilledOk, netRequests, seen }))
})
