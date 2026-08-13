// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Trip } from '@shared/trips'
import { forgetSessionCache } from '@/lib/sessionCache'
import type * as TripsNamespace from '@/lib/trips'

/** The module's own shape, for `importOriginal`. `import()` types are linted out. */
type TripsModule = typeof TripsNamespace

/**
 * `All trips` appears only when there are trips Home is not showing.
 *
 * It used to render whenever Home was populated, so on a database holding one
 * trip it was a door onto the screen Alex was already looking at, with the same
 * single row on it — an orphan heading wearing a button's clothes (§2 of the
 * polish pass).
 *
 * ## Why this is a component test rather than an end-to-end one
 *
 * The condition is "the database holds nothing else", and the end-to-end suite
 * shares one database across every spec — so by the time any test ran there
 * would be a dozen other trips in it and the premise could never hold. That is
 * not a gap in the fixtures; it is the fixture design working as intended
 * (`AUTONOMY.md` §6). Mounting the screen over a stubbed `fetchTrips` is the
 * only place the empty case can be stated honestly.
 */

const trips: Trip[] = []

vi.mock('@/lib/trips', async (importOriginal) => ({
  ...(await importOriginal<TripsModule>()),
  fetchTrips: async () => ({ trips }),
  // Readiness needs both, and neither decides anything here.
  fetchChecklist: async () => ({ trip: trips[0], entries: [], coverage: [], conflicts: [] }),
  fetchOutfits: async () => ({ groups: [], stale: false }),
}))

const { default: Home } = await import('@/routes/Home')

/** A trip far enough out that Home treats it as upcoming rather than finished. */
function trip(id: string): Trip {
  const day = 86_400_000
  const iso = (offset: number) => new Date(Date.now() + offset * day).toISOString().slice(0, 10)
  return {
    id,
    name: id,
    emoji: '🧳',
    startDate: iso(10),
    endDate: iso(14),
    status: 'planning',
    destinations: [],
    activities: [],
    days: [],
    facts: [],
    notes: null,
    luggageMode: null,
    laundryAvailable: null,
    maxDressiness: null,
    flightHours: null,
    international: null,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Trip
}

function mount() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  trips.length = 0
  // Home paints a snapshot on mount; a leftover one would answer for the case
  // under test rather than the stub above.
  forgetSessionCache()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the way to the rest of the trips', () => {
  it('is not offered when Home is already showing every trip', async () => {
    trips.push(trip('The only trip'))
    mount()

    await screen.findByText('The only trip')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'All trips' })).toBeNull()
    })
  })

  it('is offered as soon as one trip does not fit', async () => {
    /*
     * Five: the featured trip plus the three `Also coming up` shows, plus one
     * more that has nowhere to go. Four would leave nothing over and is the
     * boundary this asserts from the other side.
     */
    for (const id of ['a', 'b', 'c', 'd', 'e']) trips.push(trip(id))
    mount()

    expect(await screen.findByRole('button', { name: 'All trips' })).toBeTruthy()
  })

  it('is not offered at exactly the number Home can show', async () => {
    for (const id of ['a', 'b', 'c', 'd']) trips.push(trip(id))
    mount()

    await screen.findByText('a')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'All trips' })).toBeNull()
    })
  })

  it('counts archived trips, which live behind Show archived rather than nowhere', async () => {
    /*
     * An archived trip is not on Home by design — it must not come back as the
     * featured one just because its dates have not passed. It IS on the Trips
     * screen, behind `Show archived`, so it is a genuine reason to go there.
     */
    trips.push(trip('The only live trip'))
    trips.push({ ...trip('Put away'), archivedAt: 1 } as Trip)
    mount()

    expect(await screen.findByRole('button', { name: 'All trips' })).toBeTruthy()
  })
})
