import type { DayPlan } from './during-trip'
import { destinationForDate, type TripDestination } from './trips'
import {
  describeAge,
  rainOutlook,
  toFahrenheit,
  type WeatherDay,
  type WeatherFreshness,
} from './weather'

/**
 * The Today briefing (E1).
 *
 * `during-trip.ts` decides WHAT Alex wears; this decides what the screen SAYS
 * about the day. The split is deliberate — the packed-only rule and the
 * continuity rule live over there and are not restated here, and nothing in this
 * file may recommend a garment. It reads the plan that was already resolved and
 * turns it into six answers:
 *
 *   Where am I, what am I doing, what am I wearing, what weather matters,
 *   is anything unresolved, and is there anything I need to carry.
 *
 * Everything is a pure function over already-fetched data, for the same reason
 * `weather.ts` is: the interesting cases (no timezone, no forecast, a garment
 * left at home, four slots unfilled at once) are all states of the data, and a
 * test that has to stand a Worker up to reach them is a test nobody writes.
 */

/* ------------------------------------------------------------------ */
/* which day it is, where                                              */
/* ------------------------------------------------------------------ */

/**
 * Where the shown date came from.
 *
 * Three answers, and the difference between them is the difference between a
 * date that is right and a date that is probably right. `destination` means the
 * trip records a time zone and the day was read in it. `device` means the phone
 * said so. `utc` means neither was available.
 *
 * Kept as data rather than folded into a boolean because the screen labels the
 * fallback and the tests assert on which one happened.
 */
export type DateBasis = 'destination' | 'device' | 'utc'

/**
 * The calendar date in a named zone, or null when the zone is unusable.
 *
 * Null rather than a fallback ON PURPOSE. A bad or unknown zone name means Pack
 * Smart does not know what day it is where Alex is, and the caller has a
 * labelled fallback for exactly that; quietly returning the UTC date here would
 * spend the label and keep the error.
 */
export function dateInZone(at: Date, timeZone: string): string | null {
  try {
    // en-CA formats as YYYY-MM-DD, which is the format everything else stores.
    const text = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at)
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
  } catch {
    return null
  }
}

export interface TodayDateInput {
  /** Now, as an instant. */
  at: Date
  /** The trip's recorded IANA zone, when it has one. */
  timezone: string | null
  /** The phone's own calendar date, when the client sent it. */
  deviceDate?: string | null
}

export interface TodayDate {
  date: string
  basis: DateBasis
  /** The zone the date was read in, or null when it was not read in one. */
  timezone: string | null
}

/**
 * What day it is, said as honestly as the data allows.
 *
 * The order is not a preference, it is a ranking by what each source actually
 * knows. The destination's zone knows what day it is where Alex is standing.
 * His phone knows what day it is where his phone is, which on an overnight
 * flight is a different answer and on a normal morning is the same one. UTC
 * knows neither and is the last resort.
 */
export function resolveTodayDate(input: TodayDateInput): TodayDate {
  if (input.timezone) {
    const local = dateInZone(input.at, input.timezone)
    if (local) return { date: local, basis: 'destination', timezone: input.timezone }
  }

  if (input.deviceDate && /^\d{4}-\d{2}-\d{2}$/.test(input.deviceDate)) {
    return { date: input.deviceDate, basis: 'device', timezone: null }
  }

  return { date: input.at.toISOString().slice(0, 10), basis: 'utc', timezone: null }
}

/**
 * Whether the date shown could be the wrong day, and is worth saying so.
 *
 * Not on every trip. A weekend in Portland read off the phone is the right day
 * by any measure, and a caveat under it would be noise on the screen Alex opens
 * most during a trip. It earns its place when the trip crosses a border and
 * nothing recorded says which zone that border is in — which is precisely when
 * a phone still on home time gets the day wrong.
 */
export function dateNeedsCaveat(
  basis: DateBasis,
  trip: { international: boolean | null },
): boolean {
  if (basis === 'destination') return false
  return basis === 'utc' || trip.international === true
}

/* ------------------------------------------------------------------ */
/* where, and what is happening                                        */
/* ------------------------------------------------------------------ */

export interface TodayPlace {
  name: string
  country: string | null
}

/**
 * The place to put under the date.
 *
 * `destinationForDate` already refuses to guess on a multi-stop trip with no
 * dates, and that refusal is inherited rather than softened: no city is better
 * than the wrong city on the screen that tells Alex where he is.
 */
export function placeForDate(
  destinations: TripDestination[],
  date: string,
): TodayPlace | null {
  const stop = destinationForDate(destinations, date)
  return stop ? { name: stop.name, country: stop.country } : null
}

/**
 * Whether this is a day Alex is moving.
 *
 * The first day, the last day, and any day a stop begins or ends. Used for the
 * one carry reminder that is only true on those days — documents are in the
 * personal item on a travel morning and in a hotel safe on a Tuesday.
 */
export function isTravelDay(
  date: string,
  trip: { startDate: string; endDate: string },
  destinations: TripDestination[],
): boolean {
  if (date === trip.startDate || date === trip.endDate) return true
  return destinations.some((stop) => stop.arriveDate === date || stop.departDate === date)
}

/* ------------------------------------------------------------------ */
/* weather                                                             */
/* ------------------------------------------------------------------ */

/**
 * Today's weather, as data rather than as a sentence.
 *
 * A sentence is built from this on the screen. Keeping the numbers and the
 * source separate is what lets the screen label a climate normal differently
 * from a forecast without parsing its own copy — the confusion
 * `01_ARCHITECTURE.md` §6 names by name.
 */
export interface TodayWeather {
  source: WeatherDay['source']
  lowF: number | null
  highF: number | null
  rainLikely: boolean
  precipitationProbability: number | null
  /**
   * The Celsius the engine reasons in, carried alongside the Fahrenheit the
   * screen reads.
   *
   * Both, deliberately. `toFahrenheit` is display-only and `warmthNeededFor`
   * keeps its Celsius thresholds — converting upstream would mean restating
   * every warmth band, which is a packing-intelligence change dressed up as a
   * units change. E2 compares the day against an outfit, so it needs the unit
   * the comparison is defined in.
   */
  tempMinC: number | null
  tempMaxC: number | null
  windKph: number | null
}

/**
 * The stored rows that are about this day, in this place.
 *
 * Exported because freshness has to be measured over the SAME rows the numbers
 * come from. Measuring it over the whole trip said `live` on a day with no row
 * at all — the trip had been fetched recently, just not for that Tuesday — and
 * the screen would then have compared an outfit against a forecast it did not
 * have.
 */
export function weatherDaysFor(
  days: WeatherDay[],
  date: string,
  destinationId: string | null,
): WeatherDay[] {
  return days.filter(
    (day) =>
      day.date === date &&
      (destinationId == null || day.destinationId == null || day.destinationId === destinationId),
  )
}

export function weatherForDay(
  days: WeatherDay[],
  date: string,
  destinationId: string | null,
): TodayWeather | null {
  const relevant = weatherDaysFor(days, date, destinationId)
  if (relevant.length === 0) return null

  const mins = relevant.map((d) => d.tempMinC).filter((t): t is number => t !== null)
  const maxes = relevant.map((d) => d.tempMaxC).filter((t): t is number => t !== null)
  if (mins.length === 0 && maxes.length === 0) return null

  const rain = rainOutlook(relevant)
  const chances = relevant
    .map((d) => d.precipitationProbability)
    .filter((p): p is number => p !== null)

  const winds = relevant.map((d) => d.windKph).filter((w): w is number => w !== null)

  return {
    source: relevant.every((d) => d.source === 'climate_normal') ? 'climate_normal' : 'forecast',
    lowF: mins.length > 0 ? toFahrenheit(Math.min(...mins)) : null,
    highF: maxes.length > 0 ? toFahrenheit(Math.max(...maxes)) : null,
    rainLikely: rain.likely,
    precipitationProbability: chances.length > 0 ? Math.max(...chances) : null,
    tempMinC: mins.length > 0 ? Math.min(...mins) : null,
    tempMaxC: maxes.length > 0 ? Math.max(...maxes) : null,
    windKph: winds.length > 0 ? Math.max(...winds) : null,
  }
}

/**
 * The weather line, and whether it is a forecast at all.
 *
 * `seasonal` is returned beside the text rather than baked into it so the screen
 * can mark it visually as well as in words. A climate normal never reads as a
 * forecast, at any length.
 */
/**
 * The weather line, and everything the screen needs to keep four states apart.
 *
 * E2's first rule: **the same temperature must not look identical across live,
 * seasonal, stale and unavailable.** `01_ARCHITECTURE.md` §6 already forbade a
 * normal reading as a forecast; this extends the same refusal to age, because a
 * forecast fetched four days ago is a different claim from one fetched this
 * morning and `62–78°F` says neither out loud.
 */
export function describeTodayWeather(
  weather: TodayWeather | null,
  freshness: WeatherFreshness = 'live',
  fetchedAt: number | null = null,
  now = 0,
): { text: string; seasonal: boolean; freshness: WeatherFreshness; age: string | null } | null {
  if (!weather) return null

  const low = weather.lowF
  const high = weather.highF
  const range =
    low !== null && high !== null && low !== high
      ? `${low}–${high}°F`
      : `${high ?? low}°F`

  /*
   * `Usually` is the whole safeguard, and it is one word.
   *
   * `62–78°F` reads identically whether it is Tuesday's forecast or an average
   * of five Augusts, and this line has no room for the full sentence
   * `describeWeather` uses. So a normal is prefixed and a forecast is not —
   * the same rule `weatherForDates` follows for the outfit cards.
   */
  const parts = [weather.source === 'climate_normal' ? `Usually ${range}` : range]
  if (weather.rainLikely) parts.push('rain likely')

  return {
    text: parts.join(' · '),
    seasonal: weather.source === 'climate_normal',
    freshness,
    // Only where it can change a reading. A forecast nobody is doubting does not
    // need "checked 20 minutes ago" under it.
    age: freshness === 'stale' ? describeAge(fetchedAt, now) : null,
  }
}

/* ------------------------------------------------------------------ */
/* what is unresolved                                                  */
/* ------------------------------------------------------------------ */

/**
 * One outfit slot today cannot fill from the bag.
 *
 * Carries the checklist row as well as the garment, because the useful answer to
 * "my shirt is not packed" is very often "yes it is, I forgot to tick it" — and
 * without the row id that answer costs a trip back to the packing list.
 */
export interface UnresolvedSlot {
  role: string
  roleLabel: string
  /** The garment the approved outfit named, when it named one. */
  plannedName: string | null
  /** The trip's checklist row for that garment, when it has one. */
  entryId: string | null
  /** True when Alex moved it to Not bringing — a different fix from a missed tick. */
  excluded: boolean
  /** Packed garments that could take the slot today. Often empty; that is a real answer. */
  alternatives: Array<{ itemId: string; name: string; detail: string | null }>
}

export type IssueKind = 'none' | 'nothing_packed' | 'no_outfit' | 'not_packed'

export interface TodayIssue {
  kind: IssueKind
  /** One sentence. Said once, however many slots are affected. */
  headline: string
  /** Why the screen behaves this way, and what has NOT happened to the outfit. */
  detail: string
  slots: UnresolvedSlot[]
}

/**
 * The screen's single explanation of what is wrong, if anything.
 *
 * The defect this replaces was four identical sentences — `No suitable packed
 * top found.`, `…bottoms…`, `…shoes…`, `…layer…` — stacked with nothing to do
 * about any of them. On a real trip some slots unfilled is the ordinary case,
 * not the exceptional one, so the ordinary case gets one explanation and a row
 * per affected slot rather than an apology per affected slot.
 *
 * Nothing here changes the outfit. The approved plan is still the plan; this
 * says which part of it is not in the bag.
 */
export function todayIssue(input: {
  plan: DayPlan
  slots: UnresolvedSlot[]
  /** Whether anything at all is confirmed packed for this trip. */
  anythingPacked: boolean
}): TodayIssue {
  const { plan, slots, anythingPacked } = input

  if (!anythingPacked) {
    return {
      kind: 'nothing_packed',
      headline: 'Nothing is packed yet',
      detail:
        'Today only suggests clothes you have confirmed are in your bag. Tick things off on your packing list and they will appear here.',
      slots: [],
    }
  }

  /*
   * Nothing to wear and nothing to resolve — which happens two ways.
   *
   * No approved outfit for the day is the obvious one. The second is subtler and
   * was a genuinely blank screen: an approved group whose garments run out
   * before its days do. `garmentForDay` deliberately returns nothing past the
   * end of the timeline rather than repeating the last shirt, so day five of a
   * four-shirt group has no slots at all — no `wear`, no `missing`, and until
   * this branch existed, no words either.
   */
  if (plan.wear.length === 0 && slots.length === 0) {
    return plan.groupName === null
      ? {
          kind: 'no_outfit',
          headline: 'No outfit is approved for today',
          detail:
            'Pack Smart will not put you in clothes you did not choose. Approve an outfit for this day and it will show up here.',
          slots: [],
        }
      : {
          kind: 'no_outfit',
          headline: 'Nothing is planned for today',
          detail: `Your ${plan.groupName} outfit does not stretch to this day. Review your outfits and Pack Smart will plan one for it.`,
          slots: [],
        }
  }

  if (slots.length === 0) {
    return { kind: 'none', headline: '', detail: '', slots: [] }
  }

  /*
   * `Not in your bag:` rather than a sentence, and the reason is grammar.
   *
   * A garment's name carries its own number — `New Balance White Sneakers` is
   * plural, `Linen shirt` is singular — so any sentence with a verb in it reads
   * wrong for half the wardrobe ("Your New Balance White Sneakers IS not in your
   * bag"). The label form is right for both, and it is also the shorter thing to
   * read standing up.
   */
  const named = slots.filter((slot) => slot.plannedName)
  const headline =
    slots.length === 1
      ? slots[0]!.plannedName
        ? `Not in your bag: ${slots[0]!.plannedName}`
        : `Nothing you packed fits today’s ${slots[0]!.roleLabel.toLowerCase()}`
      : named.length === slots.length
        ? `Not in your bag: ${slots.length} things from today’s outfit`
        : `${slots.length} parts of today’s outfit are unresolved`

  return {
    kind: 'not_packed',
    headline,
    detail:
      'Your approved outfit has not changed. Today only suggests clothes you have confirmed are packed.',
    slots,
  }
}

/**
 * The ways out of an unresolved slot, in the order they are likely to be right.
 *
 * Every one of them is something Alex does explicitly. None of them is Pack
 * Smart deciding: `mark_packed` says the garment IS in the bag, `wear_instead`
 * picks a packed garment for today only, `put_back` undoes a Not bringing, and
 * `review_outfit` goes to the screen where the approved plan can actually be
 * changed. An unresolved slot with none of these would be the dead end again, so
 * `open_list` is the floor — there is always somewhere to go.
 */
export type RecoveryAction =
  | 'mark_packed'
  | 'wear_instead'
  | 'put_back'
  | 'review_outfit'
  | 'open_list'

export function recoveryActions(slot: UnresolvedSlot): RecoveryAction[] {
  const actions: RecoveryAction[] = []

  if (slot.excluded && slot.entryId) actions.push('put_back')
  else if (slot.entryId && slot.plannedName) actions.push('mark_packed')

  if (slot.alternatives.length > 0) actions.push('wear_instead')

  actions.push('review_outfit')
  if (actions.length === 1) actions.push('open_list')

  return actions
}

/* ------------------------------------------------------------------ */
/* what to carry                                                       */
/* ------------------------------------------------------------------ */

export type CarryKind = 'documents' | 'medication' | 'rain' | 'gear'

/**
 * One group of carry reminders, and the ONE reason it has.
 *
 * Grouped rather than listed flat, and the reason said once, because the first
 * version of this section printed `Keep it with you rather than in a bag.`
 * underneath four consecutive medications and then offered `Show 20 more`. That
 * is UX-04 again — the packing list learned it, `DayOf` learned it, and a
 * carry list is where it hurts most, because the whole point of the section is
 * that it is short enough to read standing up.
 */
export interface CarryGroup {
  kind: CarryKind
  title: string
  /** Why this group is being shown today. Said once, never per item. */
  why: string
  items: Array<{ key: string; label: string }>
}

/**
 * What a packed thing has to be for the carry list to mention it.
 *
 * Only what Alex or the rules recorded: the item's own category and kind, his
 * recorded weather capability, and whether this trip triggered the row.
 * **Nothing is inferred from a brand or a product name** — doc 09 §13's carry
 * section says so explicitly, and `weather-fit.ts` already refuses to call a
 * jacket waterproof because it is a jacket.
 */
export interface CarryCandidate {
  itemId: string
  name: string
  category: string
  kind: 'clothing' | 'gear'
  /** Recorded rain capability, decided by `weatherCapability` upstream. */
  keepsRainOff: boolean
  /** True when this row exists because of this trip rather than by default. */
  tripTriggered: boolean
}

export interface CarryInput {
  packed: CarryCandidate[]
  travelDay: boolean
  weather: TodayWeather | null
}

/**
 * The reminders worth reading today.
 *
 * Four kinds, and each one has to be true *today* for a reason it can state:
 * documents on the days Alex is moving, medication every day because that is
 * what medication is, rain protection when the forecast says so, and the gear
 * this trip specifically triggered.
 *
 * **`is_critical` is deliberately not one of them.** Every essential Alex has
 * ever flagged is on the trip every day of it, so including them turned this
 * into the packing list a second time — twenty rows behind a `Show more`, none
 * of which said anything a Tuesday did not also say. `Before you go` already
 * owns the essentials, on the one morning they are the question.
 */
export function carryGroups(input: CarryInput): CarryGroup[] {
  const groups: CarryGroup[] = []
  const claimed = new Set<string>()

  const collect = (
    kind: CarryKind,
    title: string,
    why: string,
    matches: (candidate: CarryCandidate) => boolean,
  ) => {
    const items = input.packed
      .filter((candidate) => !claimed.has(candidate.itemId) && matches(candidate))
      .map((candidate) => ({ key: candidate.itemId, label: candidate.name }))
    if (items.length === 0) return
    for (const item of items) claimed.add(item.key)
    groups.push({ kind, title, why, items })
  }

  if (input.travelDay) {
    collect(
      'documents',
      'Travelling today',
      'You need these before you can reach your bag.',
      (candidate) => candidate.category === 'Documents',
    )
  }

  collect(
    'medication',
    'Keep with you',
    'Medication travels with you rather than in a bag.',
    (candidate) => candidate.category === 'Medication',
  )

  /*
   * Rain has a second, more useful half.
   *
   * When rain is likely and NOTHING packed is recorded as keeping it off, the
   * group says that instead of disappearing — silence there would be Pack Smart
   * knowing something worth knowing and not mentioning it. `weather-fit.ts` will
   * not call a jacket waterproof because it is a jacket, so this state is
   * common rather than hypothetical.
   */
  if (input.weather?.rainLikely) {
    const before = groups.length
    collect(
      'rain',
      'Rain is likely',
      'Take something that keeps it off.',
      (candidate) => candidate.keepsRainOff,
    )
    if (groups.length === before) {
      groups.push({
        kind: 'rain',
        title: 'Rain is likely',
        why: 'Nothing you packed is recorded as keeping rain off. Tag a garment as waterproof in My Stuff and Pack Smart will name it here.',
        items: [],
      })
    }
  }

  collect(
    'gear',
    'For this trip',
    'This trip is why these are in the bag at all.',
    (candidate) => candidate.kind === 'gear' && candidate.tripTriggered,
  )

  return groups
}

/** How many carry items show before the rest fold away. Progressive disclosure. */
export const CARRY_VISIBLE = 8

/** The total across every group, for deciding whether anything folds at all. */
export function carryItemCount(groups: CarryGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0)
}
