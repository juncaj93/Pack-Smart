import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createOwnedItem, createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * The post-trip review (F1, doc 09 §16).
 *
 * What these assert is the SHAPE, because the shape is the product:
 *
 *   - the summary is shown, never asked — "what did you pack but never use" is
 *     a sentence here and must never appear as a question;
 *   - nothing is required, and Finish works on the first frame;
 *   - a proposal states its effect before the button that applies it;
 *   - accepting one is the only thing that changes a rule.
 *
 * Setup goes through the API for the same reason it does in `today.spec.ts`:
 * clicking a trip into existence and ticking forty rows would make every test
 * here also a test of the trip sheet.
 */

/** A trip that ended a week ago, so it is genuinely finished. */
function pastDates() {
  const today = new Date()
  const iso = (offset: number) =>
    new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
  return { start: iso(-14), end: iso(-7) }
}

async function api<T>(page: Page, path: string, init?: RequestInit): Promise<T> {
  return page.evaluate(
    async ([url, options]) => {
      const response = await fetch(url as string, (options ?? undefined) as RequestInit)
      if (!response.ok) throw new Error(`${url as string}: ${response.status}`)
      return (await response.json()) as unknown
    },
    [path, init ? { ...init, headers: { 'Content-Type': 'application/json' } } : null] as const,
  ) as Promise<T>
}

interface Rule {
  id: string
  itemId: string
  ruleType: string
  quantityValue: number | null
  source: string
  enabled: boolean
}

const listRules = (page: Page) =>
  api<{ rules: Rule[] }>(page, '/api/settings/rules').then((r) => r.rules)

async function finishedTrip(page: Page, owner: string): Promise<TripFixture> {
  const dates = pastDates()
  return createTrip(page, { owner, startDate: dates.start, endDate: dates.end })
}

test.describe('the review of a finished trip', () => {
  let trip: TripFixture

  test.beforeEach(async ({ page }) => {
    await signIn(page)
    trip = await finishedTrip(page, 'Review')
  })

  test.afterEach(async ({ page }) => {
    await deleteTrip(page, trip.id)
  })

  /*
   * The entry point. Home features the trip Alex is working on, which is never
   * a finished one, so the trip screen is the only door — and a finished trip
   * whose recommended action led nowhere would be the dead end E1 existed to
   * remove from Today.
   */
  test('a finished trip offers the review, and only until it is done', async ({ page }) => {
    await page.goto(`/trips/${trip.id}`)

    const offer = page.getByRole('button', { name: 'Review the trip' })
    await expect(offer).toBeVisible()
    await offer.click()

    await expect(page.getByRole('heading', { name: 'Trip review' })).toBeVisible()
    await page.getByRole('button', { name: 'Finish' }).click()
    await expect(page.getByText('Review saved.')).toBeVisible()

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Review the trip' })).toHaveCount(0)
  })

  /*
   * The non-negotiable instruction, asserted as an absence.
   *
   * `wear_log` already records what came home unworn, and the summary states
   * it. Asking it again is homework whose answer is on the screen above the
   * question — so the question must not exist.
   */
  test('shows what it observed and never asks what it can already see', async ({ page }) => {
    await page.goto(`/trips/${trip.id}/review`)

    await expect(page.getByRole('heading', { name: 'What Pack Smart saw' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Anything to add?' })).toBeVisible()

    for (const question of [
      /never use/i,
      /never wore/i,
      /did you wear/i,
      /which items did you pack/i,
    ]) {
      await expect(page.getByRole('button', { name: question })).toHaveCount(0)
    }
  })

  test('finishes without answering anything', async ({ page }) => {
    await page.goto(`/trips/${trip.id}/review`)

    // Available on the first frame. A Finish that appears only once every
    // question is answered is a block wearing a friendlier word.
    await page.getByRole('button', { name: 'Finish' }).click()
    await expect(page.getByText('Review saved.')).toBeVisible()
    // And it is not a dead end: there is still a way back to the trip.
    await expect(page.getByRole('button', { name: 'Back to the trip' })).toBeVisible()
  })

  test('every question is a named control that opens a sheet', async ({ page }) => {
    await page.goto(`/trips/${trip.id}/review`)

    const questions = page.locator('.trip-review-question')
    await expect(questions).toHaveCount(5)

    await page.getByRole('button', { name: 'Was something missing from Today or Before you go?' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What was missing?' })).toBeVisible()
  })

  test('records a note, and does not claim to have learned from it', async ({ page }) => {
    await page.goto(`/trips/${trip.id}/review`)

    await page.getByRole('button', { name: 'Was something missing from Today or Before you go?' }).click()
    await page.getByRole('textbox').fill('No reminder to charge the camera')
    await page.getByRole('button', { name: 'Save this' }).click()

    await expect(page.getByText('charge the camera')).toBeVisible()
    await expect(page.getByText(/cannot change a screen/i)).toBeVisible()
    // Nothing to accept, so nothing offers to be accepted.
    await expect(page.getByRole('button', { name: 'Do that' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Remove this' })).toBeVisible()
  })
})

/* ------------------------------------------------------------------ */

test.describe('a proposal that changes a rule', () => {
  let trip: TripFixture
  let item: { id: string; name: string }

  /*
   * An item this spec owns outright, because accepting writes a
   * `packing_rule` row and rules are NOT scoped to a trip — a spare on a shared
   * garment changes the quantity on every other spec's list. This is the second
   * interference class doc 09 §5a records.
   */
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    trip = await finishedTrip(page, 'Review rule')
    item = await createOwnedItem(page, 'Review item')
  })

  test.afterEach(async ({ page }) => {
    await deleteTrip(page, trip.id)
    await page
      .evaluate(
        async ([itemId]) => {
          const listed = await fetch('/api/settings/rules')
          if (!listed.ok) return
          const { rules } = (await listed.json()) as {
            rules: Array<{ id: string; itemId: string; canDelete: boolean }>
          }
          for (const rule of rules.filter((r) => r.itemId === itemId)) {
            await fetch(`/api/settings/rules/${rule.id}`, { method: 'DELETE' })
          }
        },
        [item.id],
      )
      .catch(() => {})
  })

  test('states the effect before the button, and only the button changes anything', async ({ page }) => {
    await page.goto(`/trips/${trip.id}/review`)

    await page.getByRole('button', { name: 'Did you forget anything?' }).click()
    await page.getByRole('button', { name: item.name }).click()

    // The sentence, then what accepting does, then the control — in that order.
    await expect(page.getByText(`You forgot ${item.name}.`)).toBeVisible()
    await expect(page.getByText(/every trip/)).toBeVisible()

    // Reading it changed nothing.
    expect((await listRules(page)).filter((r) => r.itemId === item.id)).toHaveLength(0)

    await page.getByRole('button', { name: 'Do that' }).click()
    await expect(page.getByRole('heading', { name: 'Already decided' })).toBeVisible()

    const rules = (await listRules(page)).filter((r) => r.itemId === item.id)
    expect(rules).toHaveLength(1)
    expect(rules[0]?.ruleType).toBe('fixed_per_trip')
    // Learned, not `user` — provenance is what Packing rules shows and what
    // precedence ranks.
    expect(rules[0]?.source).toBe('learned')
  })

  test('declining writes nothing at all', async ({ page }) => {
    await page.goto(`/trips/${trip.id}/review`)

    await page.getByRole('button', { name: 'Did you forget anything?' }).click()
    await page.getByRole('button', { name: item.name }).click()
    await page.getByRole('button', { name: 'No thanks' }).click()

    await expect(page.getByText('Left as it was.')).toBeVisible()
    expect((await listRules(page)).filter((r) => r.itemId === item.id)).toHaveLength(0)
  })

  test('does not offer the same thing twice', async ({ page }) => {
    await page.goto(`/trips/${trip.id}/review`)

    await page.getByRole('button', { name: 'Did you forget anything?' }).click()
    await page.getByRole('button', { name: item.name }).click()
    await expect(page.getByText(`You forgot ${item.name}.`)).toBeVisible()

    await page.getByRole('button', { name: 'Did you forget anything?' }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: item.name })).toHaveCount(0)
  })
})

/* ------------------------------------------------------------------ */

test.describe('the review on a phone', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  let trip: TripFixture

  test.beforeEach(async ({ page }) => {
    await signIn(page)
    trip = await finishedTrip(page, 'Review phone')
  })

  test.afterEach(async ({ page }) => {
    await deleteTrip(page, trip.id)
  })

  /*
   * 390 × 664 is what Safari actually gives a page on an iPhone 14 — not the
   * 844px screen — and the page must never scroll sideways at it.
   */
  test('never scrolls sideways, and every control clears 44px', async ({ page }) => {
    await page.goto(`/trips/${trip.id}/review`)
    await expect(page.getByRole('heading', { name: 'Trip review' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)

    for (const question of await page.locator('.trip-review-question').all()) {
      const box = await question.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }

    const finish = page.getByRole('button', { name: 'Finish' })
    const box = await finish.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })

  /*
   * What VoiceOver reads. Every question is a button with the question as its
   * name — not a div with a tap handler — and the two headings give the screen
   * a structure that can be navigated by heading rather than by swiping through
   * every line.
   */
  test('reads as headings and named buttons', async ({ page }) => {
    await page.goto(`/trips/${trip.id}/review`)

    await expect(page.getByRole('heading', { name: 'What Pack Smart saw' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Did you forget anything?' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Did you run out of anything?' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Was an outfit wrong?' })).toBeVisible()
  })
})

/* ------------------------------------------------------------------ */

test.describe('when things go wrong', () => {
  test('says so rather than showing an empty review', async ({ page }) => {
    await signIn(page)
    await page.route('**/api/trips/*/review', (route) => route.abort())

    await page.goto('/trips/does-not-exist/review')

    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Trip review' })).toBeVisible()
  })

  test('a trip that does not exist does not pretend to have one', async ({ page }) => {
    await signIn(page)
    await page.goto('/trips/does-not-exist/review')

    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Finish' })).toHaveCount(0)
  })
})
