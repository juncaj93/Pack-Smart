import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createTrip, deleteTrip, signIn } from './fixtures'

/**
 * The departure screen, end to end (doc 09 §12, D4).
 *
 * `shared/day-of.ts` decides which section a row lands in and
 * `tests/unit/day-of.test.ts` proves that arithmetic. This is about the things
 * only a real browser and a real Worker can answer: that a tick reaches the
 * database and survives a reload, that the two ticks are genuinely different
 * columns, and that the screen empties out.
 *
 * The trip leaves TODAY, because that is the only day this screen is for.
 */

function todayISO(offsetDays = 0): string {
  const now = new Date()
  const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays)
  return new Date(at).toISOString().slice(0, 10)
}

/** Every row the trip's checklist has, read the way the app reads it. */
async function entries(page: Page, tripId: string) {
  return page.evaluate(async ([id]) => {
    const response = await fetch(`/api/trips/${id}/checklist`)
    return (await response.json()) as {
      entries: Array<{
        id: string
        name: string
        requiredQty: number
        packedQty: number
        packingTiming: string
        requiresFinalCheck: boolean
        finalCheckedAt: number | null
        isCritical: boolean
      }>
    }
  }, [tripId])
}

async function patch(page: Page, tripId: string, entryId: string, body: unknown) {
  await page.evaluate(
    async ([id, rowId, payload]) => {
      const response = await fetch(`/api/trips/${id}/checklist/${rowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: payload as string,
      })
      if (!response.ok) throw new Error(`patch: ${response.status}`)
    },
    [tripId, entryId, JSON.stringify(body)],
  )
}

test.describe('the morning you leave', () => {
  test('shows only what is left, and the tick survives a reload', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, {
      owner: 'DayOf',
      startDate: todayISO(),
      endDate: todayISO(3),
    })

    try {
      const { entries: rows } = await entries(page, trip.id)
      expect(rows.length).toBeGreaterThan(2)

      // One thing deliberately still in use, and everything else packed — the
      // state this screen exists for.
      const dayOf = rows[0]!
      await patch(page, trip.id, dayOf.id, { packingTiming: 'day_of' })
      for (const row of rows.slice(1)) {
        await patch(page, trip.id, row.id, { packedQty: row.requiredQty })
      }

      await page.goto(`/trips/${trip.id}/day-of`)

      await expect(page.getByRole('heading', { name: 'Grab these now' })).toBeVisible()
      await expect(page.getByText(dayOf.name, { exact: false }).first()).toBeVisible()

      // And not the whole packing list: something that is packed and needs no
      // check has no business on this screen.
      const packedElsewhere = rows.slice(1).find((row) => !row.requiresFinalCheck)
      if (packedElsewhere) {
        await expect(page.getByText(packedElsewhere.name, { exact: true })).toHaveCount(0)
      }

      await page.getByRole('button', { name: new RegExp(dayOf.name, 'i') }).first().click()

      // The screen empties, and the count says so.
      await expect(page.getByRole('heading', { name: 'Grab these now' })).toHaveCount(0)

      await page.reload()
      await expect(page.getByRole('heading', { name: 'Grab these now' })).toHaveCount(0)

      const after = await entries(page, trip.id)
      const saved = after.entries.find((row) => row.id === dayOf.id)!
      expect(saved.packedQty).toBe(saved.requiredQty)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('confirming a final check writes the confirmation, not the packing', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, {
      owner: 'DayOfCheck',
      startDate: todayISO(),
      endDate: todayISO(3),
      international: true,
    })

    try {
      const { entries: rows } = await entries(page, trip.id)
      const checkable = rows.find((row) => row.requiresFinalCheck)
      expect(checkable, 'the seeded trip has something worth a final look').toBeTruthy()

      // Packed, but never confirmed — which is exactly the state
      // `requires_final_check` exists to distinguish.
      await patch(page, trip.id, checkable!.id, { packedQty: checkable!.requiredQty })

      await page.goto(`/trips/${trip.id}/day-of`)
      await expect(page.getByRole('heading', { name: 'Check it is really in there' })).toBeVisible()

      await page
        .getByRole('button', { name: new RegExp(checkable!.name, 'i') })
        .first()
        .click()

      await expect(
        page.getByRole('heading', { name: 'Check it is really in there' }),
      ).toHaveCount(0)

      const after = await entries(page, trip.id)
      const saved = after.entries.find((row) => row.id === checkable!.id)!
      // Two different columns, and the tick moved the right one.
      expect(saved.finalCheckedAt).not.toBeNull()
      expect(saved.packedQty).toBe(saved.requiredQty)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('names the essentials it is not listing, and counts the rest', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, {
      owner: 'DayOfRest',
      startDate: todayISO(),
      endDate: todayISO(3),
    })

    try {
      const { entries: rows } = await entries(page, trip.id)
      const essential = rows.find((row) => row.isCritical && !row.requiresFinalCheck)

      await page.goto(`/trips/${trip.id}/day-of`)

      // Nothing is packed, so everything ordinary is in the leftover count
      // rather than listed row by row — §12's "not the packing list again".
      await expect(page.getByRole('heading', { name: 'Not packed yet' })).toBeVisible()
      await expect(page.getByText(/still on the packing list/)).toBeVisible()

      if (essential) {
        await expect(page.getByText(new RegExp(`Including.*${essential.name}`, 'i'))).toBeVisible()
      }
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('the trip screen offers it only while it is the right screen', async ({ page }) => {
    await signIn(page)

    const leavingToday = await createTrip(page, {
      owner: 'DayOfNear',
      startDate: todayISO(),
      endDate: todayISO(3),
    })
    const leavingLater = await createTrip(page, {
      owner: 'DayOfFar',
      startDate: todayISO(20),
      endDate: todayISO(24),
    })

    try {
      await page.goto(`/trips/${leavingToday.id}`)
      await expect(page.getByRole('button', { name: /Before you go/ })).toBeVisible()

      await page.goto(`/trips/${leavingLater.id}`)
      await expect(page.getByRole('heading', { name: new RegExp(leavingLater.name) })).toBeVisible()
      // Three weeks out there is nothing to be at the door about.
      await expect(page.getByRole('button', { name: /Before you go/ })).toHaveCount(0)
    } finally {
      await deleteTrip(page, leavingToday.id)
      await deleteTrip(page, leavingLater.id)
    }
  })

  test('does not scroll sideways', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, {
      owner: 'DayOfWidth',
      startDate: todayISO(),
      endDate: todayISO(3),
    })

    try {
      await page.goto(`/trips/${trip.id}/day-of`)
      await expect(page.getByRole('heading', { name: 'Before you go' })).toBeVisible()

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(1)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})
