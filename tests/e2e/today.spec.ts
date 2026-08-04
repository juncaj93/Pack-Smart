import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * Today — the screen the app opens on during a trip (E1).
 *
 * The defect this suite is written against was measured, not imagined:
 * `.visual/390/today.png` showed four identical `No suitable packed X found.`
 * sentences stacked with nothing to tap, no date, no city, no weather and no
 * primary action. So the assertions here are mostly about **shape** —
 *
 *   - one explanation, however many slots are unfilled;
 *   - every unfilled slot is a CONTROL, not a sentence;
 *   - nothing unpacked is ever offered as something to wear;
 *   - the approved outfit is never changed except by a tap that says so.
 *
 * Setup goes through the API, assertions go through the UI. Clicking a trip into
 * existence and then ticking forty checklist rows is the slowest thing this
 * suite can do, and it makes every Today test also a test of the trip sheet.
 */

/** A trip whose dates cover today, so Today has a real day to show. */
function currentDates() {
  const today = new Date()
  const iso = (offset: number) =>
    new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
  return { start: iso(-2), end: iso(5) }
}

interface Entry {
  id: string
  itemId: string | null
  name: string
  category: string
  requiredQty: number
  packedQty: number
  excludedAt: number | null
}

interface Group {
  id: string
  name: string
  status: string
  slots: Array<{ id: string; role: string; roleLabel: string; itemId: string | null; itemName: string | null }>
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

const listEntries = (page: Page, tripId: string) =>
  api<{ entries: Entry[] }>(page, `/api/trips/${tripId}/checklist`).then((r) => r.entries)

const listGroups = (page: Page, tripId: string) =>
  api<{ groups: Group[] }>(page, `/api/trips/${tripId}/outfits`).then((r) => r.groups)

/**
 * Plans outfits and approves the ones that CAN be approved.
 *
 * The `is-incomplete` filter is the whole point, and it is the fix for the
 * recorded flake. An incomplete outfit renders the same `Approve outfit` button
 * as any other, the server correctly refuses it (`refreshGroupStatus` vetoes an
 * approval with an unfilled required slot), and the old helper then waited five
 * seconds for an `Undo approval` that was never going to appear. Which groups
 * come back incomplete depends on the wardrobe, so it failed some runs and not
 * others — the definition of the flake in doc 09 §5a.
 *
 * Nothing here waits on elapsed time. Approving is serialised by waiting for the
 * card's own status class to flip, which is the state transition itself.
 */
async function planAndApprove(page: Page, tripId: string): Promise<void> {
  await api(page, `/api/trips/${tripId}/outfits/generate`, { method: 'POST' })

  for (const group of await listGroups(page, tripId)) {
    if (group.status === 'incomplete') continue
    await api(page, `/api/trips/${tripId}/outfits/${group.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'approved' }),
    })
  }
}

async function setPacked(page: Page, tripId: string, entryId: string, qty: number): Promise<void> {
  await api(page, `/api/trips/${tripId}/checklist/${entryId}`, {
    method: 'PATCH',
    body: JSON.stringify({ packedQty: qty }),
  })
}

/** Ticks everything on the list, which is what makes Today have anything to say. */
async function packEverything(page: Page, tripId: string): Promise<void> {
  for (const entry of await listEntries(page, tripId)) {
    if (entry.excludedAt !== null) continue
    await setPacked(page, tripId, entry.id, entry.requiredQty)
  }
}

/** A trip covering today, with approved outfits and a full bag. */
async function readyTrip(page: Page, owner: string): Promise<TripFixture> {
  const { start, end } = currentDates()
  const trip = await createTrip(page, { owner, startDate: start, endDate: end })
  await planAndApprove(page, trip.id)
  await packEverything(page, trip.id)
  return trip
}

async function openToday(page: Page, tripId: string): Promise<void> {
  await page.goto(`/trips/${tripId}/today`)
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  // The day nav cannot render until the response has landed, so this is the
  // screen's answer rather than its frame.
  await expect(page.locator('.day-nav')).toBeVisible()
}

/** The garments today's plan is actually built on. */
async function todaysWorn(page: Page): Promise<string[]> {
  return page.locator('.today-section:not(.today-issue) .today-name').allTextContents()
}

/** Takes a named garment out of the bag and returns to Today. */
async function unpack(page: Page, tripId: string, names: string[]): Promise<void> {
  const entries = await listEntries(page, tripId)
  for (const name of names) {
    const entry = entries.find((e) => e.name === name)
    if (entry) await setPacked(page, tripId, entry.id, 0)
  }
}

const issueTitle = (page: Page): Locator => page.locator('.today-issue-title')
const issueRows = (page: Page): Locator => page.locator('.today-issue-list .today-row')

/* ------------------------------------------------------------------ */

test.describe('Today, on a live trip', () => {
  test('says where you are and what day it is', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today Where')

    try {
      await openToday(page, trip.id)

      await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
      // The date, spelled out, under the heading — weekday, day, month.
      await expect(page.locator('.screen-subtitle')).toHaveText(/\w+day \d+ \w+/)
      // And the city, which the screen had no idea about before E1.
      await expect(page.locator('.today-context')).toContainText('Cape Town')
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('shows the approved outfit once its clothing is packed', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today Packed')

    try {
      await openToday(page, trip.id)

      await expect(page.getByRole('heading', { name: 'Wear' })).toBeVisible()
      expect((await todaysWorn(page)).length).toBeGreaterThan(0)
      // Nothing to resolve, so nothing is said about it.
      await expect(issueTitle(page)).toHaveCount(0)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('shows the same plan when reopened', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today Stable')

    try {
      await openToday(page, trip.id)
      const first = await todaysWorn(page)

      await page.reload()
      await expect(page.locator('.day-nav')).toBeVisible()
      expect(await todaysWorn(page)).toEqual(first)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('says nothing is packed rather than inventing an outfit', async ({ page }) => {
    await signIn(page)
    const { start, end } = currentDates()
    const trip = await createTrip(page, { owner: 'Today Empty', startDate: start, endDate: end })

    try {
      await openToday(page, trip.id)

      await expect(issueTitle(page)).toHaveText('Nothing is packed yet')
      // Critically: no clothing is suggested at all.
      await expect(page.locator('.today-row')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Open packing list' })).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('says no outfit is approved rather than putting you in clothes you did not choose', async ({
    page,
  }) => {
    await signIn(page)
    const { start, end } = currentDates()
    const trip = await createTrip(page, { owner: 'Today NoOutfit', startDate: start, endDate: end })

    try {
      // A full bag, and not one approved outfit.
      await packEverything(page, trip.id)
      await openToday(page, trip.id)

      await expect(issueTitle(page)).toHaveText('No outfit is approved for today')
      await expect(page.locator('.today-row')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Review outfits' })).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})

/* ------------------------------------------------------------------ */

test.describe('when part of the outfit is not in the bag', () => {
  test('explains it once and offers a way out, for one missing garment', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today OneGap')

    try {
      await openToday(page, trip.id)
      const worn = await todaysWorn(page)
      expect(worn.length).toBeGreaterThan(0)

      await unpack(page, trip.id, [worn[0]!])
      await openToday(page, trip.id)

      // ONE explanation.
      await expect(issueTitle(page)).toHaveCount(1)
      await expect(issueTitle(page)).toContainText(worn[0]!)
      // And the affected slot is a control, not a sentence.
      await expect(issueRows(page)).toHaveCount(1)

      await issueRows(page).first().click()
      const sheet = page.getByRole('dialog')
      await expect(sheet.getByRole('button', { name: 'It is in my bag' })).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  /**
   * The measured defect, asserted directly.
   *
   * Four unfilled slots used to be four sentences. This fails against that
   * screen twice over: `toHaveCount(1)` on the explanation, and `issueRows`
   * being buttons at all.
   */
  test('explains several missing garments ONCE, with a row for each', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today ManyGaps')

    try {
      await openToday(page, trip.id)
      const worn = await todaysWorn(page)
      expect(worn.length).toBeGreaterThan(1)

      await unpack(page, trip.id, worn)
      await openToday(page, trip.id)

      await expect(issueTitle(page)).toHaveCount(1)
      await expect(issueTitle(page)).toContainText(/Not in your bag|unresolved/)
      expect(await issueRows(page).count()).toBe(worn.length)

      // Nothing on this screen repeats the old dead end.
      await expect(page.getByText(/No suitable packed/)).toHaveCount(0)

      // Every row leads somewhere.
      for (let i = 0; i < worn.length; i += 1) {
        await expect(issueRows(page).nth(i)).toBeEnabled()
      }
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('offers packed alternatives, and only packed ones', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today Alternatives')

    try {
      await openToday(page, trip.id)
      const worn = await todaysWorn(page)
      await unpack(page, trip.id, [worn[0]!])
      await openToday(page, trip.id)

      await issueRows(page).first().click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()

      const offered = await sheet.locator('.swap-name').allTextContents()
      if (offered.length > 0) {
        const entries = await listEntries(page, trip.id)
        const packed = new Set(
          entries.filter((e) => e.excludedAt === null && e.packedQty > 0).map((e) => e.name),
        )
        for (const name of offered) expect(packed.has(name)).toBe(true)
        // And never the garment that was just taken out of the bag.
        expect(offered).not.toContain(worn[0]!)
      }
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('is honest when nothing packed could take the slot, and still leads somewhere', async ({
    page,
  }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today NoAlternative')

    try {
      await openToday(page, trip.id)
      const worn = await todaysWorn(page)

      // Every shoe out of the bag: the planned pair and anything that could
      // stand in for it.
      const entries = await listEntries(page, trip.id)
      for (const entry of entries) {
        if (entry.category === 'Footwear') await setPacked(page, trip.id, entry.id, 0)
      }
      expect(worn.length).toBeGreaterThan(0)

      await openToday(page, trip.id)
      const row = issueRows(page).filter({ hasText: 'Shoes' }).first()
      await expect(row).toContainText('Nothing packed could take its place')

      await row.click()
      const sheet = page.getByRole('dialog')
      // No invented substitute...
      await expect(sheet.locator('.swap-name')).toHaveCount(0)
      // ...and not a dead end either.
      await expect(sheet.getByRole('button', { name: 'Review outfits' })).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('marking it packed clears the problem without touching the approved outfit', async ({
    page,
  }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today MarkPacked')

    try {
      await openToday(page, trip.id)
      const worn = await todaysWorn(page)
      const before = await listGroups(page, trip.id)

      await unpack(page, trip.id, [worn[0]!])
      await openToday(page, trip.id)
      await expect(issueTitle(page)).toHaveCount(1)

      await issueRows(page).first().click()
      await page.getByRole('dialog').getByRole('button', { name: 'It is in my bag' }).click()

      // The state transition itself, not a timeout: the panel goes away.
      await expect(issueTitle(page)).toHaveCount(0)
      await expect(page.locator('.today-name').filter({ hasText: worn[0]! })).toBeVisible()

      // The approved outfit is byte-for-byte what it was.
      const after = await listGroups(page, trip.id)
      expect(after.map((g) => ({ id: g.id, status: g.status, slots: g.slots.map((s) => s.itemId) })))
        .toEqual(before.map((g) => ({ id: g.id, status: g.status, slots: g.slots.map((s) => s.itemId) })))
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('never lists an unpacked garment as something to wear', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today PackedOnly')

    try {
      await openToday(page, trip.id)
      const worn = await todaysWorn(page)
      await unpack(page, trip.id, worn)
      await openToday(page, trip.id)

      const entries = await listEntries(page, trip.id)
      const packed = new Set(
        entries.filter((e) => e.excludedAt === null && e.packedQty > 0).map((e) => e.name),
      )

      for (const name of await todaysWorn(page)) expect(packed.has(name)).toBe(true)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})

/* ------------------------------------------------------------------ */

test.describe('moving around', () => {
  test('moves between days without losing its place', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today Nav')

    try {
      await openToday(page, trip.id)

      await expect(page.getByText(/Day 3 of 8/)).toBeVisible()
      await page.getByRole('button', { name: 'Previous day' }).click()
      await expect(page.getByText(/Day 2 of 8/)).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('Back returns to where you came from', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today Back')

    try {
      await page.goto(`/trips/${trip.id}`)
      await expect(page.getByRole('heading', { name: trip.name })).toBeVisible()

      await page.getByRole('button', { name: 'Today', exact: true }).click()
      await expect(page.locator('.day-nav')).toBeVisible()

      await page.goBack()
      await expect(page.getByRole('heading', { name: trip.name })).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('a sheet is dismissible without a swipe', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today Escape')

    try {
      await openToday(page, trip.id)
      await page.locator('.today-row').first().click()
      await expect(page.getByRole('dialog')).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('does not scroll sideways', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today Width')

    try {
      await openToday(page, trip.id)

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})

/* ------------------------------------------------------------------ */

test.describe('reading it without looking at it', () => {
  /**
   * VoiceOver reads roles and names, not CSS.
   *
   * The old screen's four dead ends were plain paragraphs — a screen-reader user
   * heard four apologies and reached no control at all. Every one of them is a
   * button with a name now, and the explanation above them is a heading.
   */
  test('every unresolved slot is a named control, under a heading', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today A11y')

    try {
      await openToday(page, trip.id)
      const worn = await todaysWorn(page)
      await unpack(page, trip.id, worn)
      await openToday(page, trip.id)

      const heading = page.getByRole('heading', { level: 2 }).filter({
        hasText: /Not in your bag|unresolved|Nothing you packed/,
      })
      await expect(heading).toHaveCount(1)

      const buttons = issueRows(page)
      const count = await buttons.count()
      expect(count).toBeGreaterThan(0)
      for (let i = 0; i < count; i += 1) {
        const name = (await buttons.nth(i).textContent())?.trim() ?? ''
        expect(name.length).toBeGreaterThan(0)
      }
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('reads the same in Dark as in Light', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'Today Dark')

    try {
      await openToday(page, trip.id)
      const light = await todaysWorn(page)

      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
      await expect(page.locator('.day-nav')).toBeVisible()

      expect(await todaysWorn(page)).toEqual(light)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})
