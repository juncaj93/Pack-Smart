import { ACTIVITY_LABELS, isValidDate, tripDateRange } from './trips'

/**
 * Reading an itinerary.
 *
 * One interpreter, three ways in. Pasted text, a fetched page and an extracted
 * PDF all arrive here as plain text (product doc 02 §5 Step 3) — there is one
 * set of detection rules, not three, so a phrase that works in a pasted email
 * works identically in a PDF.
 *
 * Everything here PROPOSES. Nothing it returns is applied until Alex accepts it,
 * which is doc 01 §4 "Infer, then confirm" and doc 03 §3's certainty split. That
 * is not ceremony: an itinerary is somebody else's document, full of booking
 * dates, terms and conditions, and marketing, and a parser confident enough to
 * write straight to the trip would pack for the wrong week sooner or later.
 *
 * Every proposal carries the line it came from. A proposal Alex cannot trace to
 * his own itinerary is not reviewable, and an unreviewable proposal is a guess
 * wearing a confirmation dialog.
 */

/* ------------------------------------------------------------------ */
/* activities                                                          */
/* ------------------------------------------------------------------ */

/**
 * The phrases from product doc 03 §2, plus the obvious variants.
 *
 * Word-boundary anchored throughout. Without `\b`, "gym" fires on "Gymnasium
 * Street" and "spa" on "Spain" — the kind of match that puts a workout outfit on
 * a city break and is impossible to explain afterwards.
 */
const ACTIVITY_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: 'safari', pattern: /\b(safari|game\s*drive|game\s*reserve|kruger|serengeti|maasai\s*mara|okavango|bush\s*walk)\b/i },
  { tag: 'wedding', pattern: /\b(wedding|ceremony\s+and\s+reception|rehearsal\s*dinner|black\s*tie)\b/i },
  { tag: 'winery', pattern: /\b(winery|wineries|vineyard|wine\s*tasting|cellar\s*door)\b/i },
  { tag: 'nice_dinner', pattern: /\b(nice\s*dinner|fine\s*dining|upscale\s*restaurant|tasting\s*menu|michelin)\b/i },
  { tag: 'beach', pattern: /\b(beach|seaside|shore\s*day|sunbathing)\b/i },
  /*
   * Water Alex actually gets into.
   *
   * `hot tub`, `jacuzzi` and `water park` join the original list because each
   * one means swimwear on its own, with no second phrase needed. `pool` already
   * covers "spa with pool" and "resort pool", which is why bare `spa` is NOT
   * here: a spa is as often a massage as a thermal bath, and the difference
   * decides whether a swimsuit is packed.
   *
   * Deliberately absent, and each for the same reason — they describe a PLACE
   * rather than getting into the water: `resort`, `hotel`, `waterfront`,
   * `ocean view`, `beachfront`. Also `boat` and `yacht`: a boat day is as often
   * a ferry as a swimming stop, and a line that genuinely means swimming ("yacht
   * day with snorkelling") already says so and already matches.
   */
  { tag: 'swimming', pattern: /\b(swim|swimming|pool|snorkel|snorkelling|snorkeling|hot\s*tub|jacuzzi|water\s*park)\b/i },
  { tag: 'hiking', pattern: /\b(hike|hiking|trail|trek|trekking|summit|ramble)\b/i },
  { tag: 'gym', pattern: /\b(gym|workout|training\s*session|fitness\s*centre|fitness\s*center)\b/i },
  { tag: 'business', pattern: /\b(conference|meeting|client\s*visit|offsite|off-site|keynote|seminar)\b/i },
  { tag: 'road_trip', pattern: /\b(road\s*trip|drive\s+to|car\s*hire|rental\s*car|self\s*drive)\b/i },
  { tag: 'sightseeing', pattern: /\b(sightseeing|city\s*tour|museum|walking\s*tour|old\s*town|cathedral|gallery)\b/i },
]

/* ------------------------------------------------------------------ */
/* dates                                                               */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
}

function iso(year: number, month: number, day: number): string | null {
  const text = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isValidDate(text) ? text : null
}

export interface DateReading {
  /** The exact characters this came from, for the evidence line. */
  text: string
  /** Every date this could mean. More than one means genuinely ambiguous. */
  readings: string[]
}

/**
 * Every date-shaped thing on one line, with all its possible meanings.
 *
 * Returns readings rather than a date on purpose. `03/08` is the third of
 * August to most of the world and the eighth of March in the United States, and
 * an itinerary rarely says which it means. Picking one silently would move a
 * safari by five months; the caller resolves it against the trip's own dates
 * and asks when both readings survive.
 */
export function readDates(line: string, referenceYear: number): DateReading[] {
  const found: DateReading[] = []

  // 2026-08-03
  for (const match of line.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const date = iso(Number(match[1]), Number(match[2]), Number(match[3]))
    if (date) found.push({ text: match[0], readings: [date] })
  }

  // 03/08/2026, 3-8-26, 03.08 — both conventions kept.
  for (const match of line.matchAll(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/g)) {
    const a = Number(match[1])
    const b = Number(match[2])
    const rawYear = match[3]
    const year = rawYear
      ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear)
      : referenceYear

    const readings = new Set<string>()
    const dayFirst = iso(year, b, a) // 03/08 -> 3 August
    const monthFirst = iso(year, a, b) // 03/08 -> 8 March
    if (dayFirst) readings.add(dayFirst)
    if (monthFirst) readings.add(monthFirst)
    if (readings.size > 0) found.push({ text: match[0], readings: [...readings] })
  }

  // 3 August 2026 / 3 Aug
  for (const match of line.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?\b/g)) {
    const month = MONTHS[match[2]!.toLowerCase()]
    if (!month) continue
    const date = iso(match[3] ? Number(match[3]) : referenceYear, month, Number(match[1]))
    if (date) found.push({ text: match[0], readings: [date] })
  }

  // August 3, 2026 / Aug 3
  for (const match of line.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/g)) {
    const month = MONTHS[match[1]!.toLowerCase()]
    if (!month) continue
    const date = iso(match[3] ? Number(match[3]) : referenceYear, month, Number(match[2]))
    if (date) found.push({ text: match[0], readings: [date] })
  }

  return found
}

/** "Day 3" counted from the trip's start, or null when there is no start yet. */
function readDayNumber(line: string, startDate: string | null): string | null {
  const match = /\bday\s+(\d{1,2})\b/i.exec(line)
  if (!match || !startDate) return null

  const offset = Number(match[1]) - 1
  if (offset < 0 || offset > 364) return null

  const [y, m, d] = startDate.split('-').map(Number) as [number, number, number]
  const cursor = new Date(Date.UTC(y, m - 1, d))
  cursor.setUTCDate(cursor.getUTCDate() + offset)
  return cursor.toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ */
/* destinations                                                        */
/* ------------------------------------------------------------------ */

/**
 * Destinations, from explicit labels only.
 *
 * Deliberately NOT extracted from prose. Recognising place names in free text
 * needs a gazetteer this app does not have and will not carry, and a guess here
 * is worse than silence: the destination decides the weather, and a wrong one
 * produces a confident forecast for the wrong continent. A line that announces
 * itself as a destination is evidence; a capitalised word is not.
 */
const DESTINATION_LABELS =
  /^\s*(?:destination|location|city|hotel|staying\s+at|arrive(?:\s+in)?|flying\s+to|fly\s+to)\s*[:\-–]\s*(.+)$/i

function readDestination(line: string): string | null {
  const match = DESTINATION_LABELS.exec(line)
  if (!match) return null
  const value = match[1]!.trim().replace(/[.,;]+$/, '')
  // Long enough to be a place, short enough not to be a sentence about one.
  return value.length >= 2 && value.length <= 60 ? value : null
}

/* ------------------------------------------------------------------ */
/* the proposal                                                        */
/* ------------------------------------------------------------------ */

export interface ProposedDay {
  date: string
  activityTag: string
  activityLabel: string
  /** The line this came from, so Alex can check it against his own itinerary. */
  evidence: string
}

export interface ProposedActivity {
  tag: string
  label: string
  evidence: string
  /** How many dated days carry it. Zero means detected but never dated. */
  dayCount: number
}

export interface AmbiguousDate {
  text: string
  readings: string[]
  evidence: string
}

export interface ItineraryProposal {
  startDate: string | null
  endDate: string | null
  destinations: string[]
  activities: ProposedActivity[]
  days: ProposedDay[]
  ambiguousDates: AmbiguousDate[]
  /** True when there was no usable text at all — an image PDF, a login page. */
  empty: boolean
}

export interface ParseOptions {
  /** The trip's dates, when it already has them. Bounds and disambiguates. */
  startDate?: string | null
  endDate?: string | null
  /** For year-less dates. Defaults to the trip's year, then to this one. */
  referenceYear?: number
}

/** Trims and drops the blank and decorative lines a PDF extraction leaves behind. */
function usefulLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 1)
}

/**
 * Reads an itinerary into a proposal.
 *
 * Never throws and never returns half a reading. Text it cannot make sense of
 * produces an empty proposal, which the screen reports as "nothing found" — a
 * far better outcome than a plausible-looking trip assembled from a terms and
 * conditions page.
 */
export function parseItinerary(text: string, options: ParseOptions = {}): ItineraryProposal {
  const lines = usefulLines(text)

  const empty: ItineraryProposal = {
    startDate: null, endDate: null, destinations: [],
    activities: [], days: [], ambiguousDates: [], empty: true,
  }

  if (lines.length === 0) return empty

  const tripStart = options.startDate && isValidDate(options.startDate) ? options.startDate : null
  const tripEnd = options.endDate && isValidDate(options.endDate) ? options.endDate : null
  const referenceYear =
    options.referenceYear ?? (tripStart ? Number(tripStart.slice(0, 4)) : new Date().getUTCFullYear())

  const withinTrip = tripStart && tripEnd ? new Set(tripDateRange(tripStart, tripEnd)) : null

  /*
   * Pass one: every date on every line.
   *
   * The trip's own range comes out of this when Alex has not given one, so the
   * second pass can reject a booking date or a "book by" deadline that falls
   * outside the travel window.
   */
  const perLine = lines.map((line) => ({ line, dates: readDates(line, referenceYear) }))

  const certainDates = perLine
    .flatMap((entry) => entry.dates)
    .filter((d) => d.readings.length === 1)
    .map((d) => d.readings[0]!)
    .sort()

  const inferredStart = tripStart ?? certainDates[0] ?? null
  const inferredEnd = tripEnd ?? certainDates[certainDates.length - 1] ?? null

  const bounds =
    withinTrip ??
    (inferredStart && inferredEnd ? new Set(tripDateRange(inferredStart, inferredEnd)) : null)

  /* Pass two: what happens, and when. */
  const destinations: string[] = []
  const days: ProposedDay[] = []
  const activityEvidence = new Map<string, string>()
  const ambiguous: AmbiguousDate[] = []
  const seenDay = new Set<string>()

  for (const { line, dates } of perLine) {
    const destination = readDestination(line)
    if (destination && !destinations.includes(destination)) destinations.push(destination)

    const tags = ACTIVITY_PATTERNS.filter((entry) => entry.pattern.test(line)).map((e) => e.tag)
    for (const tag of tags) {
      if (!activityEvidence.has(tag)) activityEvidence.set(tag, line)
    }
    if (tags.length === 0) continue

    // Which date does this line belong to?
    const resolved: string[] = []
    for (const reading of dates) {
      const inRange = bounds ? reading.readings.filter((d) => bounds.has(d)) : reading.readings

      if (inRange.length === 1) {
        resolved.push(inRange[0]!)
      } else if (inRange.length > 1) {
        // Both readings are plausible travel dates. Ask; do not pick.
        ambiguous.push({ text: reading.text, readings: inRange, evidence: line })
      }
      // inRange.length === 0: a date outside the trip. A confirmation email is
      // full of them — booking dates, cancellation deadlines. Dropped silently.
    }

    const dayNumber = readDayNumber(line, inferredStart)
    if (resolved.length === 0 && dayNumber) resolved.push(dayNumber)

    for (const date of resolved) {
      for (const tag of tags) {
        const key = `${date}|${tag}`
        if (seenDay.has(key)) continue
        seenDay.add(key)
        days.push({ date, activityTag: tag, activityLabel: ACTIVITY_LABELS[tag] ?? tag, evidence: line })
      }
    }
  }

  const activities: ProposedActivity[] = [...activityEvidence.entries()].map(([tag, evidence]) => ({
    tag,
    label: ACTIVITY_LABELS[tag] ?? tag,
    evidence,
    dayCount: days.filter((d) => d.activityTag === tag).length,
  }))

  const nothingFound =
    activities.length === 0 && destinations.length === 0 && certainDates.length === 0

  if (nothingFound) return empty

  return {
    startDate: inferredStart,
    endDate: inferredEnd,
    destinations,
    activities,
    days: days.sort((a, b) => a.date.localeCompare(b.date)),
    ambiguousDates: ambiguous,
    empty: false,
  }
}
