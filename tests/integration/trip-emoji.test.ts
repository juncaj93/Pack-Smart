import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { createTrip, getTrip, updateTrip } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * The trip's icon, against real SQL.
 *
 * The behaviour worth proving is not which emoji a safari gets — that is a unit
 * test — but that the value STICKS. An icon Alex recognises a trip by must
 * survive an edit that has nothing to do with it (02_DATA_MODEL.md §3).
 */

const NOW = 1_780_000_000

function tripInput(partial: Partial<TripInput> = {}): TripInput {
  return {
    name: 'South Africa',
    startDate: '2026-08-01',
    endDate: '2026-08-08',
    destinations: [{ name: 'Cape Town', country: 'South Africa' }],
    activities: ['safari'],
    ...partial,
  }
}

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

describe('the trip icon', () => {
  it('is suggested from the activities when none was chosen', async () => {
    const trip = await createTrip(db.binding, tripInput(), NOW)
    expect(trip.emoji).toBe('🦁')
  })

  it('takes the chosen one over the suggestion', async () => {
    const trip = await createTrip(db.binding, tripInput({ emoji: '🍷' }), NOW)
    expect(trip.emoji).toBe('🍷')
  })

  it('ignores something that is not an emoji rather than storing it', async () => {
    const trip = await createTrip(db.binding, tripInput({ emoji: 'safari' }), NOW)
    expect(trip.emoji).toBe('🦁')
  })

  /*
   * The point of storing it. Re-suggesting on every edit would change the icon
   * under Alex the moment he touched the dates or added an activity.
   */
  it('survives an edit that changes the activities', async () => {
    const created = await createTrip(db.binding, tripInput({ emoji: '🚢' }), NOW)

    const edited = await updateTrip(
      db.binding,
      created.id,
      tripInput({ emoji: '🚢', activities: ['wedding', 'safari'], endDate: '2026-08-12' }),
      NOW + 60,
    )

    expect(edited?.emoji).toBe('🚢')
    expect((await getTrip(db.binding, created.id))?.emoji).toBe('🚢')
  })

  it('keeps what the trip already had when an edit sends nothing', async () => {
    const created = await createTrip(db.binding, tripInput({ emoji: '🚢' }), NOW)
    const edited = await updateTrip(db.binding, created.id, tripInput({ emoji: null }), NOW + 60)

    expect(edited?.emoji).toBe('🚢')
  })

  it('gives an existing trip the neutral icon rather than none', async () => {
    // What migration 0007 does to the trips already in production.
    const created = await createTrip(db.binding, tripInput(), NOW)
    db.raw.prepare("UPDATE trip SET emoji = '' WHERE id = ?").run(created.id)

    expect((await getTrip(db.binding, created.id))?.emoji).toBe('✈️')
  })
})
