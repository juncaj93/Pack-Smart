/**
 * Trip facts and the date arithmetic everything else depends on.
 *
 * The single most consequential rule in the product lives here:
 *
 *   TRIP DAYS are counted INCLUSIVELY.  NIGHTS are counted EXCLUSIVELY.
 *   31 July -> 11 August is 12 trip days and 11 nights.
 *
 * Contacts and underwear are 2 per trip *day*, so getting this wrong is two
 * pairs of each, every trip. Both counts are computed once, here, and stored as
 * structured facts — never re-derived ad hoc at a call site
 * (technical-docs/02_DATA_MODEL.md §2, product doc 03 §6).
 */

export type Certainty = 'certain' | 'likely' | 'possible'
export type FactSource = 'user' | 'structured' | 'detected' | 'preference' | 'default'
export type TripStatus = 'planning' | 'packing' | 'active' | 'completed'

/**
 * What a trip's status IS, rather than what was last written to it.
 *
 * `setTripStatus` exists and is called from nowhere in the app, so every trip
 * has stayed `planning` since it was created — which meant a trip that ended
 * last month sat under "Past trips" wearing a "Planning" chip. Dead metadata
 * contradicting the section around it.
 *
 * Derived rather than stored, and deliberately: a stored status needs something
 * to move it — a scheduled job, or a write on every read — and both can drift
 * or fail silently. Dates cannot. An explicit status Alex set (`packing`,
 * `active`) still wins while the trip is current, because that is information
 * the dates do not carry.
 */
export function tripStatusOn(trip: { startDate: string; endDate: string; status: TripStatus }, today: string): TripStatus {
  if (trip.endDate < today) return 'completed'
  if (trip.status === 'completed') return 'completed'
  if (trip.startDate <= today) return 'active'
  return trip.status === 'planning' ? 'planning' : trip.status
}

/**
 * A trip's fields carried into a new one.
 *
 * Everything here describes the SHAPE of a trip — where, what, how dressy, how
 * long the flight. Nothing here is a record of a trip that happened: no packed
 * state, no wear history, no outfits, no forecast. Those belong to the trip
 * that is over, and copying them would produce a new trip that claims to be
 * half packed before Alex has touched it.
 */
export interface TripTemplate {
  name: string
  emoji: string
  destinations: TripDestinationInput[]
  activities: string[]
  /** Day offsets from the start, so the plan survives new dates. */
  dayOffsets: Array<{ offset: number; activityTag: string }>
  notes: string | null
  luggageMode: TripInput['luggageMode']
  laundryAvailable: boolean | null
  maxDressiness: number | null
  flightHours: number | null
  international: boolean | null
}

/**
 * Turns a finished trip into the starting point for the next one.
 *
 * Dates become OFFSETS. A safari on the third day of last year's trip should be
 * the third day of this one, whatever the new dates are — copying 2025-08-03
 * verbatim would land it outside the trip entirely, where `setTripDays` would
 * silently drop it.
 */
export function toTemplate(trip: Trip): TripTemplate {
  return {
    name: trip.name,
    emoji: trip.emoji,
    destinations: trip.destinations.map((d) => ({
      name: d.name,
      country: d.country,
      // Stop dates are re-derived from the new trip's start, same as day plans.
      arriveDate: null,
      departDate: null,
    })),
    activities: trip.activities,
    dayOffsets: trip.days
      .filter((d): d is { date: string; activityTag: string } => d.activityTag !== null)
      .map((d) => ({ offset: daysBetween(trip.startDate, d.date), activityTag: d.activityTag })),
    notes: trip.notes,
    luggageMode: (trip.luggageMode as TripInput['luggageMode']) ?? null,
    laundryAvailable: trip.laundryAvailable,
    maxDressiness: trip.maxDressiness,
    flightHours: trip.flightHours,
    international: trip.international,
  }
}

/** Places a template's day plan on real dates. Offsets past the end are dropped. */
export function daysFromTemplate(
  template: TripTemplate,
  startDate: string,
  endDate: string,
): TripDay[] {
  const dates = tripDateRange(startDate, endDate)
  return template.dayOffsets
    .filter((d) => d.offset >= 0 && d.offset < dates.length)
    .map((d) => ({ date: dates[d.offset]!, activityTag: d.activityTag }))
}

/** The activity vocabulary the rules and outfit engines share. */
export const ACTIVITIES = [
  { tag: 'safari', label: 'Safari' },
  { tag: 'winery', label: 'Winery' },
  { tag: 'nice_dinner', label: 'Nice dinners' },
  { tag: 'sightseeing', label: 'Sightseeing' },
  { tag: 'swimming', label: 'Swimming' },
  { tag: 'hiking', label: 'Hiking' },
  { tag: 'gym', label: 'Gym' },
  { tag: 'business', label: 'Business' },
  { tag: 'wedding', label: 'Wedding' },
  { tag: 'beach', label: 'Beach' },
  { tag: 'road_trip', label: 'Road trip' },
] as const

export type ActivityTag = (typeof ACTIVITIES)[number]['tag']

export const ACTIVITY_LABELS: Record<string, string> = Object.fromEntries(
  ACTIVITIES.map((a) => [a.tag, a.label]),
)

/* ------------------------------------------------------------------ */
/* dates                                                               */
/* ------------------------------------------------------------------ */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const date = new Date(Date.UTC(y, m - 1, d))
  // Rejects 2026-02-30, which would otherwise roll over into March.
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * Whole days between two dates.
 *
 * Deliberately UTC. Local-time arithmetic drifts by a day across a daylight
 * saving boundary, which would silently change a packing quantity.
 */
export function daysBetween(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number) as [number, number, number]
  const [ey, em, ed] = endDate.split('-').map(Number) as [number, number, number]
  const start = Date.UTC(sy, sm - 1, sd)
  const end = Date.UTC(ey, em - 1, ed)
  return Math.round((end - start) / 86_400_000)
}

/** Inclusive. 31 Jul -> 11 Aug = 12. A single-day trip is 1, never 0. */
export function tripDays(startDate: string, endDate: string): number {
  return daysBetween(startDate, endDate) + 1
}

/** Exclusive. 31 Jul -> 11 Aug = 11. A single-day trip is 0 nights. */
export function tripNights(startDate: string, endDate: string): number {
  return daysBetween(startDate, endDate)
}

/** Every date the trip covers, inclusive of both ends. */
export function tripDateRange(startDate: string, endDate: string): string[] {
  const out: string[] = []
  const [y, m, d] = startDate.split('-').map(Number) as [number, number, number]
  const cursor = new Date(Date.UTC(y, m - 1, d))
  const total = tripDays(startDate, endDate)
  for (let i = 0; i < total; i += 1) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

/** Northern-hemisphere meteorological season, from the start month. */
export function seasonFor(startDate: string): string {
  const month = Number(startDate.slice(5, 7))
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}

/* ------------------------------------------------------------------ */
/* trip shape                                                          */
/* ------------------------------------------------------------------ */

export interface TripDestinationInput {
  name: string
  country?: string | null
  /**
   * When Alex is at this stop. Optional — a single-city trip needs neither, and
   * demanding them would make the common case worse to serve the rare one.
   */
  arriveDate?: string | null
  departDate?: string | null
}

export interface TripDestination {
  id: string
  name: string
  country: string | null
  arriveDate: string | null
  departDate: string | null
  /**
   * The IANA zone Open-Meteo named for this place, or null until a forecast has
   * been fetched for it.
   *
   * On the STOP rather than on the trip, because a trip that flies Cape Town to
   * Reykjavik is in two zones and one column cannot say which. `Today` reads it
   * through `destinationForDate`, which already refuses to guess which stop a
   * date belongs to when it cannot tell.
   */
  timezone?: string | null
}

/**
 * Which place Alex is in on a given date.
 *
 * One rule, stated rather than emergent, because the answer decides which
 * forecast a day's outfit is planned against — and a wrong answer produces a
 * confident forecast for the wrong continent.
 *
 *   1. A stop whose arrive/depart covers the date wins. Earliest in order if
 *      several overlap, so the answer is stable rather than dependent on
 *      iteration order.
 *   2. Otherwise, if the trip has exactly ONE stop, it covers every date —
 *      including days outside its own arrive/depart, because it is the only
 *      place named. This is the common case and it needs no dates typed in.
 *      "I do not know where you are" is not a more honest answer on a trip with
 *      one destination; it would just cost weather on the days Alex flies.
 *   3. Otherwise: NOTHING. A multi-stop trip with no dates does not get a guess
 *      about which city Alex is in on the Tuesday.
 *
 * Rule 3 is the one doing the work. Returning the first stop as a fallback
 * would look tidier and would silently plan a Reykjavik day against Cape Town's
 * weather.
 */
export function destinationForDate(
  destinations: TripDestination[],
  date: string,
): TripDestination | null {
  for (const stop of destinations) {
    const from = stop.arriveDate
    const to = stop.departDate
    if (!from && !to) continue
    if (from && date < from) continue
    if (to && date > to) continue
    return stop
  }

  return destinations.length === 1 ? destinations[0]! : null
}

export interface TripInput {
  name: string
  startDate: string
  endDate: string
  /** Omitted on create means "suggest one"; a value here is Alex's choice. */
  emoji?: string | null
  destinations: TripDestinationInput[]
  activities: string[]
  notes?: string | null
  luggageMode?: 'carry_on' | 'checked' | 'unknown' | null
  laundryAvailable?: boolean | null
  /**
   * The dressiest thing on this trip, 0-4 on the DRESSINESS_LABELS scale.
   * Null means unanswered, which is not the same as "casual" — nothing is capped.
   */
  maxDressiness?: number | null
  flightHours?: number | null
  international?: boolean | null
}

export interface TripFact {
  factKey: string
  value: unknown
  certainty: Certainty
  source: FactSource
  evidenceText?: string | null
  /** One plain sentence explaining where this came from. */
  explanation: string
}

/**
 * What Alex is doing on one specific date.
 *
 * A null tag means "nothing in particular", which is a real answer and not the
 * same as "not said yet" — a date absent from the list entirely is the latter.
 * The distinction matters: the planner counts stated days to decide how many of
 * each outfit to plan, and treating silence as "nothing planned" would quietly
 * cost Alex an outfit.
 */
export interface TripDay {
  date: string
  activityTag: string | null
}

export interface Trip {
  id: string
  name: string
  /** The one icon this trip is recognised by (product doc 02 §9a). */
  emoji: string
  startDate: string
  endDate: string
  status: TripStatus
  notes: string | null
  luggageMode: string | null
  laundryAvailable: boolean | null
  maxDressiness: number | null
  flightHours: number | null
  international: boolean | null
  timezone: string | null
  destinations: TripDestination[]
  activities: string[]
  /** Only the dates Alex has actually spoken for. Empty until he plans days. */
  days: TripDay[]
  facts: TripFact[]
  /**
   * When Alex put this trip away, or null.
   *
   * A state of its own, separate from the upcoming/past split that is derived
   * from the dates: a finished trip is still a record of what he took, and a
   * future one can be shelved without being cancelled. Archiving changes nothing
   * inside the trip.
   */
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

export interface TripValidation {
  ok: boolean
  errors: Record<string, string>
}

/** A year is already generous; beyond that it is a typo, not a trip. */
const MAX_TRIP_DAYS = 365

export function validateTripInput(input: Partial<TripInput>): TripValidation {
  const errors: Record<string, string> = {}

  if (!(input.name ?? '').trim()) errors.name = 'Give the trip a name.'

  const start = input.startDate ?? ''
  const end = input.endDate ?? ''

  if (!isValidDate(start)) errors.startDate = 'Pick a start date.'
  if (!isValidDate(end)) errors.endDate = 'Pick a return date.'

  if (isValidDate(start) && isValidDate(end)) {
    if (daysBetween(start, end) < 0) {
      errors.endDate = 'The return date is before the start date.'
    } else if (tripDays(start, end) > MAX_TRIP_DAYS) {
      errors.endDate = 'That is longer than a year — check the dates.'
    }
  }

  if (!input.destinations?.some((d) => d.name.trim())) {
    errors.destinations = 'Add at least one destination.'
  }

  if (input.flightHours != null && (input.flightHours < 0 || input.flightHours > 48)) {
    errors.flightHours = 'Flight hours should be between 0 and 48.'
  }

  return { ok: Object.keys(errors).length === 0, errors }
}

/* ------------------------------------------------------------------ */
/* fact derivation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Turns what Alex entered into the structured facts the rules engine reads.
 *
 * Everything here is `structured` and `certain` — derived from dates, chosen
 * activities and explicit answers, never from guessing at prose. That is the
 * no-false-intelligence invariant: critical items may only ever be triggered by
 * facts of this kind (03_INTELLIGENCE_DESIGN.md §12).
 *
 * Anything genuinely unknown is simply absent. There is no default that quietly
 * pretends to be an answer.
 */
export function deriveTripFacts(input: TripInput): TripFact[] {
  const facts: TripFact[] = []
  const days = tripDays(input.startDate, input.endDate)
  const nights = tripNights(input.startDate, input.endDate)

  facts.push({
    factKey: 'trip_days',
    value: days,
    certainty: 'certain',
    source: 'structured',
    explanation: `${input.startDate} to ${input.endDate} counted inclusively is ${days} ${days === 1 ? 'day' : 'days'}.`,
  })

  facts.push({
    factKey: 'nights',
    value: nights,
    certainty: 'certain',
    source: 'structured',
    explanation: `${nights} ${nights === 1 ? 'night' : 'nights'} away.`,
  })

  facts.push({
    factKey: 'season',
    value: seasonFor(input.startDate),
    certainty: 'certain',
    source: 'structured',
    explanation: `Starting in ${input.startDate.slice(0, 7)}.`,
  })

  if (input.activities.length > 0) {
    facts.push({
      factKey: 'activities',
      value: input.activities,
      certainty: 'certain',
      source: 'user',
      explanation: `You chose ${input.activities.map((a) => ACTIVITY_LABELS[a] ?? a).join(', ')}.`,
    })
  }

  // International status comes from the destination country, never from prose.
  // Doc 03 §11 puts structured data above text precisely so a passport is never
  // triggered by a phrase.
  if (input.international != null) {
    facts.push({
      factKey: 'international',
      value: input.international,
      certainty: 'certain',
      source: 'user',
      explanation: input.international
        ? 'You marked this as an international trip.'
        : 'You marked this as a domestic trip.',
    })
  }

  if (input.laundryAvailable != null) {
    facts.push({
      factKey: 'laundry_available',
      value: input.laundryAvailable,
      certainty: 'certain',
      source: 'user',
      explanation: input.laundryAvailable
        ? 'You said laundry will be available.'
        : 'You said laundry will not be available.',
    })
  }

  if (input.luggageMode && input.luggageMode !== 'unknown') {
    facts.push({
      factKey: 'luggage_mode',
      value: input.luggageMode,
      certainty: 'certain',
      source: 'user',
      explanation:
        input.luggageMode === 'carry_on' ? 'Carry-on only.' : 'You are checking a bag.',
    })
  }

  if (input.flightHours != null && input.flightHours > 0) {
    facts.push({
      factKey: 'flight_hours',
      value: input.flightHours,
      certainty: 'certain',
      source: 'user',
      explanation: `About ${input.flightHours} hours in the air.`,
    })
  }

  return facts
}

/** Convenience for the rules engine: facts as a plain lookup. */
export function factsToRecord(facts: TripFact[]): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  // `possible` facts are suggestions only and must never reach the engine
  // (03_INTELLIGENCE_DESIGN.md §4).
  for (const fact of facts) {
    if (fact.certainty !== 'possible') record[fact.factKey] = fact.value
  }
  return record
}
