import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/**
 * Data every spec owns outright.
 *
 * The suite runs against **one** database — one Worker, one D1, seeded once by
 * `seed.ts`. That is not going to change: a per-file database would mean a
 * Worker per file, and the whole point of these tests is that they exercise the
 * real deployed shape.
 *
 * So isolation here is not "a database each". It is **ownership**: every spec
 * creates the trip it acts on, names it so no other spec can find it by
 * accident, and cleans it up afterwards. Nothing reads `trips[0]`.
 *
 * `trips[0]` is what made this necessary. `/api/trips` returns
 * `ORDER BY start_date DESC`, so it hands back whichever trip some *other* spec
 * happened to create with the latest start date — and three files were then
 * packing rows, unpacking them, and asserting on the reasons of a trip they did
 * not own, while its owner mutated it in parallel. Every symptom in doc 09 §5a
 * follows from that: passes in isolation, fails in a full run, depends on the
 * order the files happen to run in.
 */

export const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/**
 * A name no other spec will match.
 *
 * Three parts, and each earns its place. The **owner** makes a stray match
 * legible in a failure message — "who created `Swipe 4823`?" has an answer. The
 * **counter** separates tests inside one file. The **random suffix** is what
 * makes it safe under parallel workers, where two files can reach the same
 * millisecond; `performance.now()` alone could not promise that, and the old
 * `uniqueName` helpers used exactly that.
 */
let counter = 0
export function ownedName(owner: string): string {
  counter += 1
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${owner} ${counter}-${suffix}`
}

/** The unlock dance, which every spec was copying. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
}

export interface TripFixture {
  id: string
  name: string
}

export interface TripOptions {
  /** Who is creating it — a short spec-file name, for legible failures. */
  owner: string
  startDate?: string
  endDate?: string
  destination?: string
  country?: string
  activities?: string[]
  international?: boolean
  laundryAvailable?: boolean
  flightHours?: number
}

/**
 * Dates relative to now, so a trip is always live.
 *
 * `createTrip`'s defaults are 31 Jul – 11 Aug 2026 and are NOT this: they are
 * the dates half the suite types into the trip sheet, chosen because 12 days
 * inclusive is the arithmetic several tests assert. Fixed dates are correct for
 * a test about a derivation and a time bomb for a test about a live trip —
 * `daysUntil(endDate) >= 0` went false on 12 Aug 2026, and every spec that
 * needed a featured trip on Home started failing for a reason that had nothing
 * to do with what it asserts.
 *
 * `home.spec.ts` worked this out first and kept the helper to itself, which is
 * why `readiness.spec.ts` was still hard-coding a trip into the past. Any spec
 * that needs a trip to be UPCOMING should ask for these dates rather than the
 * defaults.
 *
 * ## Which to use, when
 *
 * The rule that keeps this from happening a fourth time:
 *
 * - **Relative (`liveDates`)** whenever the test's meaning depends on WHEN the
 *   trip is — that it is featured on Home, that departure is imminent, that
 *   readiness is anything other than `finished`, or that the trip screen shows
 *   its live rather than its finished variant.
 * - **Fixed** only where the test is about date ARITHMETIC and the numbers are
 *   the assertion: `trips.spec.ts` asserts 31 Jul – 11 Aug is 12 days
 *   inclusive, and relative dates would make that test prove nothing.
 * - **Fixed is also fine for payload data** a test never reasons about — the
 *   round-trip costs in `action-cost.spec.ts` are the same whatever the dates
 *   are.
 *
 * A new literal calendar date in any other position is a time bomb with a
 * delay fuse, and this repository has now defused four of them.
 */
export function liveDates(startInDays: number, lengthDays = 4) {
  const day = 86_400_000
  const start = new Date(Date.now() + startInDays * day)
  const end = new Date(start.getTime() + lengthDays * day)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { startDate: iso(start), endDate: iso(end) }
}

/**
 * Creates a trip through the real API and returns it.
 *
 * Through the API rather than the trip sheet, deliberately. Clicking through
 * the sheet takes a dozen round trips and is the slowest thing in the suite;
 * more importantly it makes every test that merely *needs* a trip also a test
 * OF the trip sheet, so a change to that sheet breaks twenty unrelated files.
 * The specs that are genuinely about creating a trip still use the sheet.
 *
 * The checklist is generated by the endpoint itself, so the trip comes back
 * ready to act on.
 */
export async function createTrip(page: Page, options: TripOptions): Promise<TripFixture> {
  const name = ownedName(options.owner)

  const trip = await page.evaluate(
    async ([payload]) => {
      const response = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload as string,
      })
      if (!response.ok) {
        throw new Error(`createTrip: ${response.status} ${await response.text()}`)
      }
      const body = (await response.json()) as { trip: { id: string; name: string } }
      return body.trip
    },
    [
      JSON.stringify({
        name,
        startDate: options.startDate ?? '2026-07-31',
        endDate: options.endDate ?? '2026-08-11',
        destinations: [
          { name: options.destination ?? 'Cape Town', country: options.country ?? 'South Africa' },
        ],
        activities: options.activities ?? ['safari', 'nice_dinner'],
        international: options.international ?? true,
        laundryAvailable: options.laundryAvailable ?? false,
        flightHours: options.flightHours ?? 15,
      }),
    ],
  )

  return { id: trip.id, name }
}

/**
 * Gets rid of a trip the spec created.
 *
 * Best effort on purpose: a teardown that throws turns one failed assertion
 * into a failed assertion *and* a confusing second error, and the trip's name
 * is unique so leaving one behind cannot break another spec. What it does buy
 * is a database that does not grow by twenty trips per run, which is its own
 * slow kind of interference.
 */
export async function deleteTrip(page: Page, id: string): Promise<void> {
  await page
    .evaluate(
      async ([tripId]) => {
        await fetch(`/api/trips/${tripId}`, { method: 'DELETE' })
      },
      [id],
    )
    .catch(() => {})
}

/**
 * An item this spec owns, for the tests that mutate GLOBAL catalog state.
 *
 * The amounts and rules screens write `packing_rule` rows, which are not scoped
 * to a trip — a per-day amount on a garment changes the quantity on *every*
 * trip's list, including the ones other specs are asserting on. Doing that to a
 * shared item is the second interference class in doc 09 §5a, and the reason a
 * failed run could poison a local database permanently: the amount picker hides
 * items that already have an amount, so a test that died before its cleanup
 * could never find its item again.
 *
 * A fresh item per test removes both halves. Nothing else asserts on it, and a
 * leftover one is invisible rather than fatal.
 */
export async function createOwnedItem(
  page: Page,
  owner: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; name: string }> {
  const name = ownedName(owner)

  const id = await page.evaluate(
    async ([payload]) => {
      const response = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload as string,
      })
      if (!response.ok) {
        throw new Error(`createOwnedItem: ${response.status} ${await response.text()}`)
      }
      // `POST /api/items` answers with the item itself, not a wrapper.
      const body = (await response.json()) as { id: string }
      return body.id
    },
    [JSON.stringify({ kind: 'gear', displayName: name, category: 'Travel Gear', ...overrides })],
  )

  return { id, name }
}

/**
 * Removes every usual-amount rule belonging to an item, whatever state the test
 * left it in.
 *
 * A teardown rather than a final step in the test body, and that distinction is
 * the whole point. `packing_rule` is not scoped to a trip, so an amount left
 * behind changes the quantity on every future list — and the amount picker
 * hides items that already have one, so a test that died before its cleanup
 * could never find its item again. That was not a flake: it was permanent until
 * `.wrangler/state` was deleted (doc 09 §5a).
 *
 * Runs on the failure path too, which is the only path where it mattered.
 */
export async function clearAmounts(page: Page, itemId: string): Promise<void> {
  await page
    .evaluate(
      async ([id]) => {
        const listed = await fetch('/api/settings/amounts')
        if (!listed.ok) return
        const { amounts } = (await listed.json()) as {
          amounts: Array<{ ruleId: string; itemId: string }>
        }
        for (const amount of amounts.filter((a) => a.itemId === id)) {
          await fetch(`/api/settings/amounts/${amount.ruleId}`, { method: 'DELETE' })
        }
      },
      [itemId],
    )
    .catch(() => {})
}

/* ------------------------------------------------------------------ */
/* approving an outfit, which is where the flakes lived                */
/* ------------------------------------------------------------------ */

/**
 * Approves an outfit card, and fails immediately and legibly if it cannot be.
 *
 * ## Why this exists
 *
 * Seven WebKit tests were flaky for weeks, in four files, all in this shape:
 *
 * ```
 * await card.getByRole('button', { name: 'Approve outfit' }).click()
 * await expect(card.getByRole('button', { name: 'Undo approval' })).toBeVisible()
 * ```
 *
 * An **incomplete** outfit renders exactly the same `Approve outfit` button as
 * a complete one, the server correctly refuses it, and the button never becomes
 * `Undo approval`. So the assertion waited five seconds for a transition that
 * was never going to happen and then reported `element(s) not found` — which
 * reads like a rendering problem and is not one.
 *
 * The root cause of the refusals is fixed in `shared/outfits.ts` (a weather
 * demand the wardrobe cannot meet anywhere no longer vetoes the outfit), and
 * `rain-approval.test.ts` holds that. But **an incomplete outfit is still a
 * legitimate state** — a template-required slot with no candidate is a real
 * hole — so a helper that waits on a button label is still waiting on the wrong
 * thing. This waits on the CARD'S OWN STATUS, which is what the server decides.
 *
 * Raising the timeout was explicitly the wrong answer, and so was a retry: both
 * spend the evidence that finds the next one of these.
 */
export async function approveOutfit(card: Locator, name = 'this outfit'): Promise<void> {
  await card.getByRole('button', { name: 'Approve outfit' }).click()

  /*
   * `is-approved` on the card, not `Undo approval` in it.
   *
   * The class comes straight from the group's status, which is the server's
   * answer to the approval — so this waits on the decision rather than on a
   * label that reads identically in two different states.
   */
  await expect(
    card,
    `Approving ${name} was refused: the outfit is incomplete, so the server declined it. ` +
      'This is a real product state, not a slow render — see rain-approval.test.ts.',
  ).toHaveClass(/is-approved/, { timeout: 5000 })
}

/**
 * The first outfit card that can actually be approved.
 *
 * Specs that merely NEED an approved outfit were picking the card called
 * "Safari" and then requiring it to be approvable — two assertions in one, and
 * only one of them was the subject. Which groups come back complete depends on
 * the wardrobe, the trip's activities and the forecast, so "a card that can be
 * approved" is the honest way to ask for one.
 *
 * Throws rather than returning null: a spec that needs an approved outfit and
 * cannot have one has to say so, not proceed and fail somewhere less obvious.
 */
export async function approvableCard(page: Page): Promise<Locator> {
  const cards = page.locator('.outfit-card:not(.is-incomplete)')
  await expect(
    cards.first(),
    'No outfit on this trip can be approved — every card came back incomplete.',
  ).toBeVisible()
  return cards.first()
}
