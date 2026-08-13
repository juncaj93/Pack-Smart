import { expect, test } from '@playwright/test'
import { createTrip, deleteTrip, liveDates, signIn } from './fixtures'

/**
 * The finishing pass, asserted as geometry rather than as taste.
 *
 * Every check in this file exists because the same class of defect has now cost
 * this codebase four separate rounds: a rule written in a route's stylesheet
 * against a rule of EQUAL specificity in `primitives.css`, where which one wins
 * is decided by the order Vite happens to concatenate the bundle in. Nothing
 * about that is visible in a diff, in a type check, or in a lint run — the CSS
 * is valid, the class is applied, and the property simply never lands.
 *
 * Three of the four were caught by looking at a screenshot, which is not a
 * process. These assert the RESULT — the margin that is actually computed, the
 * label that is actually legible, the edge a marker actually lines up on — on
 * the engine the product ships to.
 *
 * They are deliberately about layout facts a reader would notice, not about
 * exact pixel values: `24px of space above a group heading` is the intent, and
 * `>= 20` is enough to fail the day it silently becomes 0 again.
 */

test.describe('Settings reads as groups', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
  })

  /*
   * The bug this was written for: `.settings-group { margin: 24px 0 6px }` lost
   * to `.section-heading { margin: 0 }`, so four group labels sat hard against
   * the list above them and Settings read as one undivided column of cards.
   * The comment in `Settings.css` had described the 24px for two passes.
   */
  test('a group heading has real space before it and less after', async ({ page }) => {
    const spacing = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.settings-group')).map((el, index) => {
        const style = getComputedStyle(el)
        return {
          index,
          label: (el.textContent ?? '').trim(),
          top: Number.parseFloat(style.marginTop),
          bottom: Number.parseFloat(style.marginBottom),
        }
      }),
    )

    expect(spacing.length, 'Settings has no group headings').toBeGreaterThan(1)

    for (const group of spacing) {
      // The first one sits directly under the navigation on purpose.
      if (group.index > 0) {
        expect(
          group.top,
          `"${group.label}" has ${group.top}px above it — it will read as a caption on the list before it`,
        ).toBeGreaterThanOrEqual(20)
      }
      expect(
        group.bottom,
        `"${group.label}" has as much space under it as over it, so it belongs to neither list`,
      ).toBeLessThan(group.top || 20)
    }
  })

  /*
   * §7. The heading named the group in the same words its only row uses, so the
   * two had to be read against each other to find out they were different
   * things.
   */
  test('the learning group is named for the group, not for its row', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Learning' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /has learned/ })).toHaveCount(0)
    // The row inside it keeps its own, longer wording.
    await expect(page.getByRole('button', { name: /What Pack Smart has noticed/ })).toBeVisible()
  })

  /*
   * §8. A card, holding a track, holding a selected segment with its own
   * surface — three nested frames around a choice between three words.
   */
  test('the appearance control is not wrapped in a card of its own', async ({ page }) => {
    const frame = await page.evaluate(() => {
      const el = document.querySelector('.appearance-choice')
      if (!el) return null
      const style = getComputedStyle(el)
      return {
        border: Number.parseFloat(style.borderTopWidth),
        padding: Number.parseFloat(style.paddingTop),
      }
    })

    expect(frame, 'the appearance control is missing').not.toBeNull()
    expect(frame?.border, 'the appearance block still draws its own outline').toBe(0)
    expect(frame?.padding, 'the appearance block still pads like a card').toBe(0)
  })

  /*
   * §9/§11. `.button-quiet` paints its label in the accent, which in this
   * product means primary action / active tab / selected segment. Sign out is
   * none of the three and was the only coloured word on the screen.
   */
  test('sign out is not painted in the accent', async ({ page }) => {
    const colours = await page.evaluate(() => {
      const button = document.querySelector('.settings-signout')
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-accent)'
      document.body.append(probe)
      const accent = getComputedStyle(probe).color
      probe.remove()
      return button ? { signOut: getComputedStyle(button).color, accent } : null
    })

    expect(colours, 'Sign out is missing').not.toBeNull()
    expect(
      colours?.signOut,
      'Sign out is in the accent, which is reserved for the primary action',
    ).not.toBe(colours?.accent)
  })
})

test.describe('Home offers one recommendation and one other door', () => {
  /*
   * §2. This control has been all three button tiers. Full-width secondary
   * competed with the recommendation; bare accent text read as a stray link
   * with air on every side. What it must be is visibly a button and visibly
   * narrower than the primary above it.
   */
  test('the alternate action is a bordered control, narrower than the primary', async ({
    page,
  }) => {
    await signIn(page)

    const trip = await createTrip(page, { owner: 'Finishing', ...liveDates(3) })
    try {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const shape = await page.evaluate(() => {
        const alternate = document.querySelector('.home-alternate')
        const primary = document.querySelector('.home-primary')
        if (!alternate || !primary) return null
        const style = getComputedStyle(alternate)
        return {
          width: alternate.getBoundingClientRect().width,
          primaryWidth: primary.getBoundingClientRect().width,
          height: alternate.getBoundingClientRect().height,
          border: Number.parseFloat(style.borderTopWidth),
        }
      })

      expect(shape, 'Home has no alternate action beside its recommendation').not.toBeNull()
      expect(shape?.border, 'the alternate action draws nothing that says it is a button').toBeGreaterThanOrEqual(1)
      expect(
        shape!.width,
        'the alternate action is as wide as the recommendation, so the two read as a pair',
      ).toBeLessThan(shape!.primaryWidth * 0.75)
      expect(shape?.height, 'the alternate action is under the touch minimum').toBeGreaterThanOrEqual(44)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})

test.describe('the packing list scans as items first', () => {
  /*
   * The marker is spoken and not printed, and this replaces the geometry test
   * that used to live here.
   *
   * That test asserted the marker was right-aligned into a column, every marker
   * starting at the same x — a real guarantee about a treatment that has since
   * been superseded. Right-aligning was the third attempt at making a word that
   * appears on a RUN of consecutive rows stop reading as noise, and the run is
   * the actual cause: essentials sort to the top, so a label on every row of
   * that block distinguishes nothing within it.
   *
   * What replaces it is the pair of facts that make removing it safe rather
   * than lossy — nothing is painted, and a listener is told anyway.
   */
  test('says Essential to a screen reader without printing it', async ({ page }) => {
    await signIn(page)

    const trip = await createTrip(page, { owner: 'Finishing', ...liveDates(5) })
    try {
      await page.goto(`/trips/${trip.id}`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('.check-row').first()).toBeVisible()

      const markers = page.locator('.check-critical')
      expect(
        await markers.count(),
        'no row on this trip is an essential, so this proves nothing',
      ).toBeGreaterThan(1)

      /*
       * Clipped to nothing, measured rather than assumed.
       *
       * `toBeVisible()` is NOT the check: a 1px clipped element still has a
       * bounding box, so Playwright can call it visible and this would pass
       * while the word was on screen. The painted size is what the eye gets.
       */
      const painted = await markers.evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect()
          return { area: box.width * box.height, clip: getComputedStyle(node).clip }
        }),
      )
      for (const marker of painted) {
        expect(marker.area, 'the Essential marker is taking space on the row').toBeLessThanOrEqual(1)
        expect(marker.clip, 'the Essential marker is no longer clipped out').toBe('rect(0px, 0px, 0px, 0px)')
      }

      // And a listener still hears it, which is what makes hiding it honest.
      const row = page.locator('.check-main').filter({ hasText: 'Essential' }).first()
      await expect(row).toHaveCount(1)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  /*
   * The count reads down the right-hand edge, which is why it moved there.
   *
   * A quantity is the one fact on the row that is a number against a fixed
   * vocabulary, so it can form a column; `AG · Standard Blue` could not. If the
   * counts do not line up the move bought nothing but a shorter row.
   */
  test('lines the counts up at the end of the row, costing no height', async ({ page }) => {
    await signIn(page)

    const trip = await createTrip(page, { owner: 'Counts', ...liveDates(5) })
    try {
      await page.goto(`/trips/${trip.id}`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('.check-row').first()).toBeVisible()

      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.check-main')).map((main) => {
          const qty = main.querySelector('.check-qty')
          return {
            height: main.getBoundingClientRect().height,
            right: qty ? qty.getBoundingClientRect().right : null,
            mainRight: main.getBoundingClientRect().right,
          }
        }),
      )

      const counted = rows.filter((row) => row.right !== null)
      expect(counted.length, 'no row on this trip carries a count').toBeGreaterThan(1)

      // A column: every count ends at the same x.
      const rights = counted.map((row) => row.right!)
      expect(
        Math.max(...rights) - Math.min(...rights),
        'the counts do not line up',
      ).toBeLessThanOrEqual(1)

      /*
       * And the whole point: a row with a count is no taller than one without.
       * This is the assertion that fails if the count ever goes back under the
       * name.
       */
      const withCount = counted.map((row) => row.height)
      const without = rows.filter((row) => row.right === null).map((row) => row.height)
      expect(without.length, 'every row has a count, so evenness proves nothing').toBeGreaterThan(0)
      expect(
        Math.max(...withCount),
        'a row carrying a count is taller than one without',
      ).toBeLessThanOrEqual(Math.min(...without) + 1)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  /*
   * §4. The filter was `flex: 2` against search's `flex: 3` — forty per cent of
   * the row for a control holding one of five short words. Sizing it to its
   * content is only an improvement while the content still fits: the first
   * attempt at this truncated `Everything` to `Everythi…`.
   */
  test('the filter shows its whole label and search takes the rest of the row', async ({
    page,
  }) => {
    await signIn(page)

    const trip = await createTrip(page, { owner: 'Finishing', ...liveDates(5) })
    try {
      await page.goto(`/trips/${trip.id}`)
      await page.waitForLoadState('networkidle')

      const controls = page.locator('.checklist-controls')
      await expect(controls).toBeVisible()

      const row = await page.evaluate(() => {
        const select = document.querySelector('.checklist-controls select') as HTMLSelectElement
        const search = document.querySelector('.checklist-search') as HTMLElement
        return {
          overflow: select.scrollWidth - select.clientWidth,
          selectWidth: select.getBoundingClientRect().width,
          searchWidth: search.getBoundingClientRect().width,
        }
      })

      expect(row.overflow, 'the filter cannot show its own current value').toBeLessThanOrEqual(1)
      expect(
        row.searchWidth,
        'the filter is as wide as the field Alex actually types in',
      ).toBeGreaterThan(row.selectWidth)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})

/*
 * §1. The selected tab was `--color-surface` with an elevation under it, which
 * on a light page is a white card floating on near-white — read beside the trip
 * card below it, the navigation looked like another content module rather than
 * like chrome.
 *
 * The assertion is about what it is NOT: no shadow, and not the same fill as
 * the cards on the page. What it IS stays a judgement call, and the screenshots
 * are where that is settled.
 */
test('the selected tab reads as chrome rather than as a card', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')

  const nav = await page.evaluate(() => {
    const current = document.querySelector('.primary-nav-item[aria-current="page"]')
    const card = document.querySelector('.settings-list')
    if (!current || !card) return null
    const style = getComputedStyle(current)
    return {
      shadow: style.boxShadow,
      background: style.backgroundColor,
      cardBackground: getComputedStyle(card.parentElement ?? card).backgroundColor,
      weight: style.fontWeight,
    }
  })

  expect(nav, 'no tab is marked as current').not.toBeNull()
  expect(nav?.shadow, 'the selected tab is elevated like a card').toBe('none')
  expect(nav?.background, 'the selected tab uses the same surface as the cards below it').not.toBe(
    nav?.cardBackground,
  )
  /*
   * Selection is stated in more than one channel. `aria-current` is the
   * semantic answer; the weight is what a reader who cannot separate the tint
   * from the page still sees.
   */
  expect(Number(nav?.weight), 'selection is signalled by colour alone').toBeGreaterThanOrEqual(600)
})
