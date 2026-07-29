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
  destinations: Array<{ id: string; name: string; country: string | null }>
  activities: string[]
  /** Only the dates Alex has actually spoken for. Empty until he plans days. */
  days: TripDay[]
  facts: TripFact[]
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
