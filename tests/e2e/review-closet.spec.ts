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

/** Already signed in by the baseline hook below — this only navigates. */
async function openReview(page: Page) {
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: /My Stuff/ })
    .click()
  await expect(page.getByRole('heading', { name: 'My Stuff' })).toBeVisible()

  await page.getByRole('button', { name: /Review closet items/ }).click()
  await expect(page.getByRole('heading', { name: 'Review closet items' })).toBeVisible()
}

/** What one card asks for, as the API reports it. */
interface QueuedCard {
  index: number
  item: { id: string; displayName: string }
  asks: string[]
}

/**
 * The first card that asks a given question, and how far along it sits.
 *
 * The tests used to act on whatever was at the HEAD of the queue, which is only
 * the right card by luck: an earlier test in this serial file answers the head,
 * and a retry re-runs against a queue the first attempt already changed. That is
 * how "every dressiness context is already chosen" appeared on a retry — the
 * head card simply had no dressiness question left, and the helper could not
 * tell that from a garment marked with all five.
 *
 * Asking the API which card to walk to makes the test independent of what came
 * before it, which is the property a serial file most needs.
 */
async function findCard(page: Page, wanted: string[]): Promise<QueuedCard> {
  const found = await page.evaluate(async ([asks]) => {
    const response = await fetch('/api/closet-review')
    const body = (await response.json()) as {
      cards: Array<{ item: { id: string; displayName: string }; asks: string[] }>
    }
    const index = body.cards.findIndex((card) =>
      (asks as string[]).every((ask) => card.asks.includes(ask)),
    )
    return index < 0 ? null : { index, item: body.cards[index]!.item, asks: body.cards[index]!.asks }
  }, [wanted] as const)

  if (!found) throw new Error(`no card in the queue asks for ${wanted.join(' + ')}`)
  if (found.index > 30) {
    throw new Error(`the first card asking for ${wanted.join(' + ')} is ${found.index} away`)
  }
  return found
}

/** Walks to a card and confirms the screen agrees it is the one. */
async function walkTo(page: Page, card: QueuedCard): Promise<void> {
  for (let step = 0; step < card.index; step += 1) {
    await page.getByRole('button', { name: 'Next' }).click()
  }
  await expect(cardName(page)).toHaveText(card.item.displayName)
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

/**
 * The chip Alex actually taps.
 *
 * In the review queue the checkbox is off the layout and the chip around it is
 * the control — so a test that clicks the input is clicking something with no
 * pixels, which Playwright correctly refuses to do. The INPUT is still what
 * `toBeChecked()` reads, because it is still the real control; only the target
 * of the tap moves.
 */
function contextChip(page: Page, label: string) {
  return page.locator('.dressiness-option', {
    has: page.getByRole('checkbox', { name: label, exact: true }),
  })
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
  if (!first) {
    /*
     * Two very different states, told apart. "No control on screen" means the
     * card has no dressiness question; "all five ticked" means it does and they
     * are all chosen. The first version said the second thing for both, and a
     * CI failure that names the wrong cause costs a whole run to correct.
     */
    const rendered = await page.locator('.dressiness-option input').count()
    throw new Error(
      rendered === 0
        ? 'this card has no dressiness question — walk to one that does'
        : 'every dressiness context is already chosen',
    )
  }
  return first
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

/**
 * The wardrobe's rating fields, as this file found them.
 *
 * The e2e suite runs against ONE database and `fixtures.ts` states the rule:
 * every spec owns what it acts on and cleans up afterwards. This spec cannot
 * own its garment — the queue decides which one is on screen — so it does the
 * other half instead and puts the wardrobe back.
 *
 * Not tidiness. Ratings and dressiness contexts are PLANNER INPUTS; contexts
 * decide eligibility outright. Leaving a seeded garment marked differently
 * changes which garments later specs' outfits contain, and that is exactly what
 * happened: three `today.spec.ts` cases failed on CI because the outfits they
 * generate were no longer the outfits they were written against. It looked like
 * flakiness in someone else's file and it was damage from this one.
 *
 * ## Why the WHOLE wardrobe, and not the garments this file touched
 *
 * The first version recorded each garment before rating it and put those back.
 * It was still wrong in the full suite, and the reason is instructive: a test
 * that fails part-way through has already changed something the bookkeeping
 * never got to record, and in a serial file a failure skips the tests that
 * would have restored the rest. Cleanup that depends on the test having reached
 * the right line is cleanup that is absent exactly when it is needed.
 *
 * Diffing the whole wardrobe needs no such reasoning. One fetch, and a PATCH
 * for each row that differs — on a 119-row catalog where almost nothing ever
 * differs, that is one request and no writes in the common case.
 */
interface RatingFields {
  comfort: number | null
  versatility: number | null
  dressinessContexts: string[]
}

let baseline: Map<string, RatingFields> | null = null

async function wardrobeRatings(page: Page): Promise<Map<string, RatingFields>> {
  const rows = await page.evaluate(async () => {
    const response = await fetch('/api/items?archived=true')
    const body = (await response.json()) as {
      items: Array<{
        id: string
        comfort: number | null
        versatility: number | null
        dressinessContexts: string[]
      }>
    }
    return body.items.map((i) => ({
      id: i.id,
      comfort: i.comfort,
      versatility: i.versatility,
      dressinessContexts: i.dressinessContexts,
    }))
  })
  return new Map(rows.map(({ id, ...fields }) => [id, fields]))
}

function same(a: RatingFields, b: RatingFields): boolean {
  return (
    a.comfort === b.comfort &&
    a.versatility === b.versatility &&
    a.dressinessContexts.join(',') === b.dressinessContexts.join(',')
  )
}

/*
 * Signs in for every test, and takes the baseline ONCE.
 *
 * Once, not per test: if a test somehow fails to put something back, a
 * per-test baseline would bake that in and never repair it. Restoring always to
 * the state the FILE found is the only version that converges.
 *
 * Signing in here rather than inside `openReview` is not a tidy-up — the two
 * together signed in twice, and the second `signIn` waited for a passphrase
 * field that a signed-in app does not render.
 */
test.beforeEach(async ({ page }) => {
  await signIn(page)
  if (!baseline) baseline = await wardrobeRatings(page)
})

test.afterEach(async ({ page }) => {
  /*
   * Route handlers and offline go first, and that is not housekeeping. Two
   * tests here deliberately abort or delay `PATCH /api/items/*`, and a handler
   * outlives the test body — so the restore below was itself being aborted by
   * the test that installed it.
   */
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.context().setOffline(false)
  if (!baseline) return

  const now = await wardrobeRatings(page)
  for (const [id, before] of baseline) {
    const after = now.get(id)
    if (!after || same(before, after)) continue
    await page.evaluate(
      async ([itemId, patch]) => {
        await fetch(`/api/items/${itemId as string}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
      },
      [id, before] as const,
    )
  }
})

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

/**
 * Service workers blocked, for this test only.
 *
 * `page.route` never saw a single `PATCH` on WebKit — the counter below came
 * back zero twice, once with the worker registered and once after unregistering
 * it and reloading. Playwright says why: **a request a service worker handles is
 * not intercepted by `page.route`**, and blocking workers for the context is the
 * documented answer rather than unregistering one at a time. Ours returns early
 * for non-GET, but on WebKit the request is still routed through it and that is
 * enough to put it out of reach.
 *
 * Scoped to a describe of one, deliberately. Everything else in this file wants
 * the shipped worker — the offline case especially, whose evidence is only worth
 * having if it is genuinely the real worker answering.
 */
test.describe('Review Closet Items — under a slow write', () => {
  test.use({ serviceWorkers: 'block' })

  test('rates a garment without ever waiting for the database, and it sticks', async ({ page }) => {
    /*
     * Every rating write is held for a second and a half BEFORE the screen is
     * opened, so nothing in this test can have been saved fast.
     */
    await openReview(page)

    const card = await findCard(page, ['comfort', 'versatility', 'contexts'])
    const head = card.item
    await walkTo(page, card)

    let delayed = 0
    await page.route('**/api/items/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      delayed += 1
      await new Promise((resolve) => setTimeout(resolve, SLOW_WRITE_MS))
      return route.fallback()
    })

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
    await contextChip(page, firstContext.label).click()
    const secondContext = await unchosenContext(page)
    await contextChip(page, secondContext.label).click()

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

    /*
     * The interception is worthless if it silently stopped working, and this
     * whole test is a claim about behaviour under a slow write. Asserted, not
     * assumed — the same lesson `screens.spec.ts` records about a stub that
     * photographed the populated screen for weeks.
     */
    expect(delayed).toBeGreaterThanOrEqual(4)

    // And they are still there after a reload, which is what Alex actually does.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Review closet items' })).toBeVisible()
    expect(await storedById(page, head.id)).toMatchObject({ comfort: 4, versatility: 3 })
  })
})

test.describe('Review Closet Items', () => {

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
    await page.getByRole('button', { name: 'Skip', exact: true }).click()
    await expect(page.locator('.review-progress')).toHaveText(`3 of ${total}`)

    /*
     * Not sure WITHDRAWS the question, so the card is removed rather than moved
     * past: the position holds and the total drops by one. That difference is
     * the whole reason both controls exist.
     */
    /*
     * `exact`, because Playwright matches an accessible name as a
     * case-insensitive SUBSTRING by default — and the duplicate block's own
     * control is named "Not sure whether these are the same item", which
     * contains it. Whether both are on screen depends on which card the queue
     * puts here, so without this the test passes or throws a strict-mode
     * violation according to the wardrobe.
     */
    await page
      .getByRole('button', { name: 'Not sure', exact: true })
      .click()
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

    const card = await findCard(page, ['comfort', 'versatility', 'contexts'])
    const head = card.item
    await walkTo(page, card)
    await starOf(page, 'Comfort', '5 of 5 — One of my most comfortable items').click()
    await starOf(page, 'Versatility', '4 of 5 — Highly versatile').click()

    const context = await unchosenContext(page)
    await contextChip(page, context.label).click()
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
    const card = await findCard(page, ['contexts'])
    await walkTo(page, card)

    const context = await unchosenContext(page)
    const box = page.getByRole('checkbox', { name: context.label, exact: true })
    /*
     * The CHIP is what is photographed, not the input.
     *
     * In the review queue the checkbox is taken out of the layout and the chip
     * around it carries the state — so the input has no pixels of its own to
     * compare, and photographing it would compare two empty images and pass
     * forever. The claim is unchanged: ticking has to change what is on screen.
     */
    const chip = contextChip(page, context.label)

    const unticked = await chip.screenshot()
    await chip.click()
    await expect(box).toBeChecked()
    const ticked = await chip.screenshot()

    expect(Buffer.compare(unticked, ticked)).not.toBe(0)
  })

  test('is reachable from Settings as well as from My Stuff', async ({ page }) => {
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
  test('says so, and puts the rating back, when the write fails', async ({ page, context }) => {
    await openReview(page)
    const card = await findCard(page, ['comfort'])
    await walkTo(page, card)

    /*
     * The browser goes offline, rather than a route handler aborting the PATCH.
     *
     * The route version passed on Chromium and failed on WebKit with the alert
     * simply never appearing — a failure that says nothing about WHY, because
     * "the write succeeded" and "the interception never fired" look identical
     * from the assertion's side. `setOffline` is a context-level switch with no
     * interception to go wrong, so what is under test is the app rather than
     * the harness.
     *
     * It is also the honest scenario. The comment above this test says *Alex on
     * a plane*, and this is a plane.
     */
    await context.setOffline(true)

    await starOf(page, 'Comfort', '2 of 5 — Limited comfort').click()
    await expect(page.getByRole('alert')).toHaveText('Could not save that rating.')
    await expect(meaning(page, 'Comfort')).toHaveText('Not rated')

    await context.setOffline(false)
  })
})
