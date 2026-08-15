// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Trip } from '@shared/trips'
import { forgetSessionCache } from '@/lib/sessionCache'
import type * as TripsNamespace from '@/lib/trips'

type TripsModule = typeof TripsNamespace

/**
 * Home, mounted over the four responses it is built from.
 *
 * ## Why this is a component test rather than an end-to-end one
 *
 * The states worth asserting are states of a PARTICULAR trip — a two-event day
 * with two outfits, a day whose forecast argues with the plan, a trip with an
 * approved outfit a replan has flagged — and Home features whichever live trip
 * starts soonest across one shared database. An end-to-end test cannot make its
 * own trip the featured one without deleting everybody else's, which is the
 * fixture design working as intended (`AUTONOMY.md` §6).
 *
 * So the states live here, where the responses can be stated exactly, and
 * `home.spec.ts` asserts the things that are true of the featured trip whichever
 * one it is: that the actions are inside the card, that the `•••` opens the
 * trip's infrequent actions, and that nothing is said twice.
 */

let trips: Trip[] = []
let today: unknown = null
let weather: unknown = null
let groups: unknown[] = []
let homeStatus: unknown = null
/** How many times each of the conditional requests was actually made. */
const asked = { today: 0, weather: 0, status: 0 }

vi.mock('@/lib/trips', async (importOriginal) => ({
  ...(await importOriginal<TripsModule>()),
  fetchTrips: async () => ({ trips }),
  fetchChecklist: async () => ({ trip: trips[0], entries: [], coverage: [], conflicts: [] }),
  fetchOutfits: async () => ({ groups, stale: false, changes: [] }),
  fetchToday: async () => {
    asked.today += 1
    if (!today) throw new Error('no briefing')
    return today
  },
  fetchWeather: async () => {
    asked.weather += 1
    if (!weather) throw new Error('no weather')
    return weather
  },
  fetchHomeStatus: async () => {
    asked.status += 1
    if (!homeStatus) throw new Error('no status')
    return homeStatus
  },
}))

const { default: Home } = await import('@/routes/Home')

const day = 86_400_000
const iso = (offset: number) => new Date(Date.now() + offset * day).toISOString().slice(0, 10)

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    name: 'Up North Labor Day',
    emoji: '🌲',
    startDate: iso(22),
    endDate: iso(26),
    status: 'planning',
    destinations: [{ id: 'd1', name: 'Traverse City', country: 'United States' }],
    activities: [],
    days: [],
    facts: [],
    notes: null,
    luggageMode: null,
    bags: null,
    laundryAvailable: null,
    maxDressiness: null,
    flightHours: null,
    international: null,
    timezone: null,
    archivedAt: null,
    reviewedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as Trip
}

const FORECAST = {
  source: 'forecast',
  lowF: 58,
  highF: 64,
  rainLikely: false,
  precipitationProbability: 10,
  tempMinC: 14,
  tempMaxC: 18,
  windKph: 9,
}

/** A briefing for a trip that is underway, on its own local day. */
function briefing(overrides: Record<string, unknown> = {}) {
  return {
    todayDate: iso(0),
    date: iso(0),
    dates: [iso(-2), iso(-1), iso(0), iso(1)],
    place: { name: 'Traverse City', country: 'United States' },
    activity: null,
    weather: FORECAST,
    freshness: 'live',
    weatherFetchedAt: Math.floor(Date.now() / 1000),
    conflicts: [],
    issue: { kind: 'none', headline: '', detail: '', slots: [] },
    carry: [],
    tomorrow: null,
    dateBasis: 'trip',
    timezone: 'America/Detroit',
    dateCaveat: false,
    trip: trips[0],
    plan: { date: iso(0), groupName: null, wear: [], bring: [], missing: [] },
    plans: [],
    wearLog: {},
    actionLabels: {},
    ...overrides,
  }
}

function outfit(name: string, garments: string[]) {
  return {
    date: iso(0),
    groupName: name,
    wear: garments.map((garment) => ({
      itemId: garment,
      name: garment,
      detail: null,
      color: 'Navy',
      role: 'top',
      roleLabel: 'Top',
      reason: null,
    })),
    bring: [],
    missing: [],
  }
}

function mount() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  trips = []
  today = null
  weather = null
  groups = []
  homeStatus = null
  asked.today = 0
  asked.weather = 0
  asked.status = 0
  // Home paints a snapshot on mount; a leftover one would answer for the case
  // under test rather than the stubs above.
  forgetSessionCache()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Home before the trip', () => {
  it('says what day it is in the status row, and nowhere else', async () => {
    trips = [trip()]
    mount()

    await waitFor(() =>
      expect(document.querySelector('.home-status-date')!.textContent).toMatch(
        /\w{3},? \d{1,2} \w{3}|\w{3},? \w{3} \d{1,2}/,
      ),
    )

    /*
     * The date is the status row's, the countdown is the card's, and neither
     * says the other's line. Two dates on one screen is the specific failure
     * this guards: the row reads the clock in the zone of wherever Alex is
     * standing, and the card used to print the trip's own resolved day beside
     * it — which disagree by one on exactly the flights where it matters.
     */
    const card = document.querySelector('.home-trip')!
    expect(card.textContent).not.toMatch(/\d{1,2}:\d{2}/)
    expect(document.querySelector('.home-status')!.textContent).not.toMatch(/days to go/i)
    expect(document.querySelector('.home-countdown')!.textContent).toMatch(/days to go/i)
  })

  it('names the destination in front of its forecast, so it cannot be misread', async () => {
    trips = [trip()]
    weather = {
      days: [
        { date: iso(22), tempMinC: 14, tempMaxC: 22, precipitationProbability: 10, windKph: 8, source: 'forecast' },
      ],
      status: 'ok',
      fetchedAt: 1,
      freshness: 'live',
      summary: null,
      note: null,
    }
    mount()

    const forecast = await waitFor(() => {
      const el = document.querySelector('.hero-forecast')
      expect(el).not.toBeNull()
      return el!
    })

    expect(forecast.textContent).toContain('Traverse City')
    expect(forecast.textContent).toContain('Forecast')
  })

  it('shows no outfits before the trip starts', async () => {
    trips = [trip()]
    mount()

    await screen.findByText('Up North Labor Day')
    expect(document.querySelector('.hero-outfits')).toBeNull()
  })

  /**
   * The mutation: fetching the day's briefing for a trip that has not started.
   *
   * `Today` answers about the trip's FIRST day when the current day falls
   * outside it — so a hero built on that would tell Alex he is in Traverse City
   * three weeks before he leaves.
   */
  it('does not ask for a day briefing before there is a day to brief', async () => {
    trips = [trip()]
    mount()

    await waitFor(() => expect(asked.weather).toBe(1))
    expect(asked.today, 'Home asked Today about a trip that has not started').toBe(0)
  })
})

describe('Home during the trip', () => {
  beforeEach(() => {
    trips = [trip({ startDate: iso(-2), endDate: iso(3) })]
  })

  it('puts where he is and what it is like into the status row', async () => {
    today = briefing()
    homeStatus = {
      place: { name: 'Traverse City', timezone: 'America/Detroit', source: 'trip' },
      weather: FORECAST,
      fetchedAt: Math.floor(Date.now() / 1000),
      freshness: 'live',
    }
    mount()

    expect(await screen.findByText('Traverse City')).toBeVisible()
    expect(document.querySelector('.home-status-weather')!.textContent).toBe('58–64°F')

    /*
     * And the trip card does not say it again. The status row is the authority
     * on where Alex is standing and what it is like there; the card is the
     * authority on the trip. Neither repeats the other (§21).
     */
    expect(document.querySelector('.hero-forecast')).toBeNull()
    /*
     * The day's weather still came WITH the briefing rather than from a second
     * request for the trip's stored forecast, which would be the
     * per-subcomponent waterfall §39 rules out.
     */
    expect(asked.weather, 'Home asked for the weather twice').toBe(0)
  })

  it('shows both of a two-event day’s outfits, with their garments', async () => {
    today = briefing({
      plans: [
        outfit('Sightseeing', ['T-Shirt', 'Everyday Pants', 'Sneakers']),
        outfit('Nice dinners', ['Button-Up', 'Pants', 'Loafers']),
      ],
    })
    mount()

    const outfits = await waitFor(() => {
      const list = document.querySelector('.hero-outfits')
      expect(list).not.toBeNull()
      return list!
    })

    const rows = within(outfits as HTMLElement).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('Sightseeing')
    expect(rows[0]!.textContent).toContain('Everyday Pants')
    expect(rows[1]!.textContent).toContain('Nice dinners')
    expect(rows[1]!.textContent).toContain('Loafers')
  })

  it('draws a colour swatch beside a garment that has a colour', async () => {
    today = briefing({ plans: [outfit('Sightseeing', ['T-Shirt'])] })
    mount()

    await waitFor(() => {
      expect(document.querySelectorAll('.hero-garment .color-dot').length).toBeGreaterThan(0)
    })
  })

  it('repeats the weather conflict rather than inventing advice', async () => {
    today = briefing({
      plans: [outfit('Sightseeing', ['T-Shirt'])],
      conflicts: [
        {
          kind: 'colder',
          headline: 'Colder today than this outfit was planned for',
          detail: 'Your approved outfit has not changed.',
          role: null,
          roleLabel: null,
          itemId: null,
          itemName: null,
          alternatives: [],
        },
      ],
    })
    mount()

    expect(
      await screen.findByText('Colder today than this outfit was planned for'),
    ).toBeVisible()
  })

  it('says nothing about the weather beyond the numbers when nothing is wrong', async () => {
    today = briefing({ plans: [outfit('Sightseeing', ['T-Shirt'])] })
    mount()

    await waitFor(() => expect(document.querySelector('.hero-outfits')).not.toBeNull())
    expect(document.querySelector('.hero-consequence')).toBeNull()
  })

  /**
   * A day with nothing in it renders no block at all.
   *
   * Not an empty `.hero` with a separator above it — that would be a rule drawn
   * across the card with nothing under it, which reads as something that failed
   * to load rather than as a quiet day.
   */
  it('handles a day with no agenda without an empty section', async () => {
    today = briefing({ plans: [] })
    mount()

    await waitFor(() => expect(document.querySelector('.home-trip')).not.toBeNull())
    expect(document.querySelector('.hero')).toBeNull()
    expect(document.querySelector('.hero-outfits')).toBeNull()
    expect(document.querySelector('.hero-agenda')).toBeNull()
  })

  it('names an outfit the bag cannot dress rather than hiding it', async () => {
    today = briefing({
      plans: [
        {
          ...outfit('Nice dinners', []),
          missing: [
            { role: 'top', roleLabel: 'Top', name: 'Button-Up', itemId: 'x', alternatives: [] },
          ],
        },
      ],
    })
    mount()

    expect(await screen.findByText('One thing for this is not packed')).toBeVisible()
  })

  /**
   * The mutation: an insight built from anything but a flagged approved outfit.
   *
   * `review_reason` is written by a replan that compared an approved outfit
   * against the trip as it now stands, and cleared the moment that stops being
   * true. Nothing is generated on this screen.
   */
  it('surfaces a replan’s own words, and only when a replan wrote them', async () => {
    today = briefing({ plans: [outfit('Sightseeing', ['T-Shirt'])] })
    mount()
    await waitFor(() => expect(document.querySelector('.hero-outfits')).not.toBeNull())
    expect(document.querySelector('.hero-insight')).toBeNull()

    forgetSessionCache()
    groups = [
      {
        id: 'g1',
        name: 'Nice dinners',
        status: 'approved',
        reviewReason: 'The fleece is not warm enough for the new forecast.',
        slots: [],
      },
    ]
    mount()

    expect(
      await screen.findByText(/Nice dinners · The fleece is not warm enough/),
    ).toBeVisible()
  })
})

describe('the trip card is one object', () => {
  beforeEach(() => {
    trips = [trip()]
  })

  /**
   * The mutation: putting `Keep packing` and `Outfits` back outside the card.
   *
   * That is where they were, separated from the trip they act on by the card's
   * own bottom margin, so the screen read as a trip and then a menu.
   */
  it('holds both frequent actions inside its own border', async () => {
    mount()

    const card = await waitFor(() => {
      const el = document.querySelector('.home-trip')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })

    await waitFor(() => expect(card.querySelector('.home-primary')).not.toBeNull())
    expect(card.querySelector('.home-alternate')).not.toBeNull()
    // And the card is the thing with the border, not the buttons' container.
    expect(document.querySelectorAll('.home-actions')).toHaveLength(0)
  })

  it('never points both buttons at the same screen', async () => {
    mount()

    await waitFor(() => expect(document.querySelector('.home-primary')!.textContent).toBeTruthy())
    const primary = document.querySelector('.home-primary')!.textContent
    const alternate = document.querySelector('.home-alternate')!.textContent

    expect(primary).not.toBe(alternate)
  })

  /**
   * The mutation: the overflow menu losing `Edit trip`.
   *
   * It is the reason the menu exists — §16 names it — and it is the one trip
   * action that has no other home on this screen.
   */
  it('keeps Edit trip behind the ••• and opens the trip sheet with it', async () => {
    mount()

    const more = await screen.findByRole('button', { name: 'More for this trip' })
    await userEvent.click(more)

    const menu = await screen.findByRole('dialog')
    expect(within(menu).getByRole('button', { name: 'Edit trip' })).toBeVisible()
    expect(within(menu).getByRole('button', { name: 'Trip setup' })).toBeVisible()

    await userEvent.click(within(menu).getByRole('button', { name: 'Edit trip' }))

    // The edit sheet, and NOT stacked on the menu that opened it.
    await waitFor(() => {
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
    })
    expect(await screen.findByRole('heading', { name: 'Edit trip' })).toBeVisible()
  })
})

describe('Home with no trips at all', () => {
  it('offers a date and one action, and no trip card skeleton', async () => {
    mount()

    expect(await screen.findByText('No trips yet')).toBeVisible()
    // §29: nothing that looks like a trip is rendered for a database with none.
    expect(document.querySelector('.home-trip')).toBeNull()
    expect(document.querySelector('.home-countdown')).toBeNull()
    // The briefing belongs to a trip, so there is none — but the status row
    // still says what day it is, which is what keeps the screen from reading
    // as a dead end.
    expect(document.querySelector('.hero')).toBeNull()
    expect(document.querySelector('.home-status')).not.toBeNull()
  })
})
