import { isPacked } from '@shared/rules'
import type { ChecklistEntry } from '@shared/checklist'
import type { DayPlan } from '@shared/during-trip'
import {
  carryGroups,
  dateNeedsCaveat,
  isTravelDay,
  placeForDate,
  resolveTodayDate,
  todayIssue,
  weatherDaysFor,
  weatherForDay,
  type CarryCandidate,
  type CarryGroup,
  type DateBasis,
  type TodayIssue,
  type TodayPlace,
  type TodayWeather,
} from '@shared/today'
import { ACTIVITY_LABELS, destinationForDate, tripDateRange, type Trip } from '@shared/trips'
import { weatherCapability } from '@shared/weather-fit'
import { categoryKind, type Item } from '@shared/items'
import { slotFor, SLOT_LABELS } from '@shared/outfits'
import { listWeather, weatherFetchedAt } from '../repos/weather'
import { dismissedFor } from '../repos/during-trip'
import { freshnessOf, type WeatherFreshness } from '@shared/weather'
import {
  weatherConflicts,
  type PackedOption,
  type WeatherConflict,
  type WornGarment,
} from '@shared/weather-conflict'

/**
 * Everything the Today screen needs, in ONE response.
 *
 * That is a constraint rather than a convenience. `tests/e2e/performance.spec.ts`
 * holds every screen but Home to a single serial round trip, and Today is the
 * screen Alex opens standing in a hotel room on someone else's wifi — a second
 * rung to fetch the weather, or a third to find out whether a garment is on the
 * packing list, is exactly the shape P1 spent three slices removing.
 *
 * So the assembly happens here, over data the request already had to read, and
 * the screen renders what it is given.
 */

/**
 * What a garment is recorded as, for the two questions Today asks of it.
 *
 * One query for both — E1 needed rain capability for the carry list, E2 needs
 * warmth and wind for the conflicts, and they are the same rows on the same
 * screen's critical path. `weatherCapability` decides the capability half, which
 * is what keeps "recorded by Alex, never inferred from a name" true here as
 * well as in the planner.
 */
interface GarmentRow {
  id: string
  display_name: string
  notes: string | null
  weather_tags: string | null
  warmth: number | null
  subcategory: string | null
}

export interface GarmentFacts {
  warmth: number | null
  keepsRainOff: boolean
  keepsWindOff: boolean
  /** Which outfit slot this could fill, decided the same way the planner does. */
  role: string | null
  roleLabel: string | null
}

export interface TodayBriefing {
  place: TodayPlace | null
  activity: { tag: string; label: string } | null
  weather: TodayWeather | null
  /** Live, stale, seasonal or unavailable — never the same line for all four. */
  freshness: WeatherFreshness
  /** When the stored forecast was last fetched, so the screen can say how old. */
  weatherFetchedAt: number | null
  /** Where today's weather disagrees with today's outfit. Never acts on it. */
  conflicts: WeatherConflict[]
  issue: TodayIssue
  carry: CarryGroup[]
  /**
   * Tomorrow, when this trip has one — the date and whatever is forecast for it.
   *
   * Assembled here rather than fetched by anybody, because `listWeather` has
   * already returned every day this trip holds: reading one more row out of an
   * array in memory is free, and a second request for "what is tomorrow like"
   * would be the per-subcomponent waterfall this briefing exists to avoid.
   *
   * Null on the last day of the trip, which is the honest answer — there is no
   * tomorrow to prepare for.
   */
  tomorrow: { date: string; weather: TodayWeather | null } | null
  /** The real current day for this trip, however it was decided. */
  todayDate: string
  dateBasis: DateBasis
  timezone: string | null
  /** True when the date shown could be the wrong day and the screen should say so. */
  dateCaveat: boolean
}

/**
 * The current calendar day for a trip.
 *
 * Exported because the route needs it before it knows anything else — it decides
 * which day to show when Alex has not asked for one — and because "what day is
 * it in Cape Town" is the kind of question that must have exactly one answer in
 * the codebase.
 */
export function currentDateFor(
  trip: Pick<Trip, 'timezone' | 'destinations' | 'startDate' | 'endDate'>,
  deviceDate: string | null,
  at: Date,
): { date: string; basis: DateBasis; timezone: string | null } {
  return resolveTodayDate({ at, timezone: zoneFor(trip, deviceDate, at), deviceDate })
}

/**
 * The zone to read the day in, when there is one.
 *
 * The STOP's zone before the trip's, because a trip that flies Cape Town to
 * Reykjavik is in two and `trip.timezone` can only hold one. Which stop is
 * decided by `destinationForDate`, which already refuses to guess on a
 * multi-stop trip with no dates — so a trip that cannot say where Alex is also
 * cannot say what time it is there, which is the honest pairing.
 *
 * Read against the CURRENT day rather than the day being viewed. Paging forward
 * to look at Friday must not change what "today" means.
 */
function zoneFor(
  trip: Pick<Trip, 'timezone' | 'destinations' | 'startDate' | 'endDate'>,
  deviceDate: string | null,
  at: Date,
): string | null {
  const today = deviceDate ?? at.toISOString().slice(0, 10)
  const stop = destinationForDate(trip.destinations, today)
  return stop?.timezone ?? trip.timezone
}

/**
 * Reads the recorded rain capability of everything packed.
 *
 * One query, and only over the packed ids — the whole wardrobe is 119 rows and
 * this runs on the screen's critical path. `weatherCapability` is the same
 * function the planner uses, so a garment counts as rain protection here for
 * exactly the reasons it counts there: Alex's own tag, or Alex's own words.
 * Never because it is a jacket.
 */
async function garmentFacts(
  db: D1Database,
  itemIds: string[],
): Promise<Map<string, GarmentFacts>> {
  const facts = new Map<string, GarmentFacts>()
  if (itemIds.length === 0) return facts

  const placeholders = itemIds.map(() => '?').join(',')
  const result = await db
    .prepare(
      `SELECT id, display_name, notes, weather_tags, warmth, subcategory
         FROM item WHERE id IN (${placeholders})`,
    )
    .bind(...itemIds)
    .all<GarmentRow>()

  for (const row of result.results ?? []) {
    let tags: string[] = []
    try {
      const parsed: unknown = row.weather_tags ? JSON.parse(row.weather_tags) : []
      if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string')
    } catch {
      /* an unreadable tag list means no recorded capability, not a guess */
    }

    const item = {
      displayName: row.display_name,
      notes: row.notes,
      weatherTags: tags,
    } as Item

    // The same derivation `packedCatalog` uses, so a garment's slot cannot mean
    // one thing to the plan and another to the conflicts.
    const role = slotFor({ subcategory: row.subcategory } as Parameters<typeof slotFor>[0])

    facts.set(row.id, {
      warmth: row.warmth,
      keepsRainOff: weatherCapability(item, 'rain').yes,
      keepsWindOff: weatherCapability(item, 'wind').yes,
      role,
      roleLabel: role ? SLOT_LABELS[role] : null,
    })
  }

  return facts
}

export interface BriefingInput {
  trip: Trip
  date: string
  plan: DayPlan
  entries: ChecklistEntry[]
  deviceDate: string | null
  at: Date
}

export async function buildBriefing(
  db: D1Database,
  input: BriefingInput,
): Promise<TodayBriefing> {
  const { trip, date, plan, entries } = input

  const now = Math.floor(input.at.getTime() / 1000)
  const current = currentDateFor(trip, input.deviceDate, input.at)
  const stop = destinationForDate(trip.destinations, date)

  const [weatherDays, fetchedAt, dismissed] = await Promise.all([
    listWeather(db, trip.id),
    weatherFetchedAt(db, trip.id),
    dismissedFor(db, trip.id, date),
  ])

  const weather = weatherForDay(weatherDays, date, stop?.id ?? null)
  /*
   * Measured over the rows this DAY has, not over the trip's.
   *
   * A trip fetched an hour ago but holding nothing for the Tuesday being shown
   * is `unavailable` for that Tuesday, however fresh the rest is. Measuring it
   * trip-wide reported `live` and let the conflict rules compare an outfit
   * against a forecast that did not exist.
   */
  const freshness = freshnessOf(weatherDaysFor(weatherDays, date, stop?.id ?? null), fetchedAt, now)

  /*
   * The checklist row for a garment, by item id.
   *
   * Including excluded rows, deliberately. "Your linen shirt is on Not bringing"
   * is a different problem from "you have not ticked it", and it has a different
   * fix — offering `Mark packed` for something Alex deliberately left behind
   * would be the app arguing with him.
   */
  const byItem = new Map<string, ChecklistEntry>()
  for (const entry of entries) if (entry.itemId) byItem.set(entry.itemId, entry)

  const slots = plan.missing.map((gap) => {
    const entry = gap.itemId ? byItem.get(gap.itemId) : undefined
    return {
      role: gap.role,
      roleLabel: gap.roleLabel,
      plannedName: entry?.name ?? (gap.itemId ? gap.name : null),
      entryId: entry?.id ?? null,
      excluded: entry?.excludedAt != null,
      alternatives: gap.alternatives.map((option) => ({
        itemId: option.itemId,
        name: option.name,
        // Which one of them (G6). This is a REPLACEMENT chooser, and after the
        // names stopped repeating the brand and the colour two different
        // shirts can read identically here — the one list where that must not
        // happen, because picking the wrong one is the whole action.
        detail: option.detail,
      })),
    }
  })

  const packedEntries = entries.filter(
    (entry) => entry.itemId !== null && entry.excludedAt === null && entry.packedQty > 0,
  )

  /*
   * One query for the facts BOTH halves of this screen need.
   *
   * E1's carry list needs rain capability; E2's conflicts need warmth and wind
   * as well. Fetching them together keeps Today at the query count it already
   * had, and keeps `weatherCapability` the single place that decides what a
   * garment is recorded as handling.
   */
  const facts = await garmentFacts(db, packedEntries.map((entry) => entry.itemId!))
  const factsFor = (itemId: string): GarmentFacts =>
    facts.get(itemId) ?? {
      warmth: null,
      keepsRainOff: false,
      keepsWindOff: false,
      role: null,
      roleLabel: null,
    }

  const candidates: CarryCandidate[] = packedEntries.map((entry) => ({
    itemId: entry.itemId!,
    name: entry.name,
    category: entry.category,
    kind: categoryKind(entry.category),
    keepsRainOff: factsFor(entry.itemId!).keepsRainOff,
    tripTriggered:
      entry.source === 'trip_triggered' || entry.source === 'dependency_triggered',
  }))

  /*
   * The outfit, and everything packed that could change it — as facts rather
   * than as names, so `weatherConflicts` never has to look at a brand.
   */
  const worn: WornGarment[] = plan.wear.map((item) => {
    const fact = factsFor(item.itemId)
    return {
      itemId: item.itemId,
      name: item.name,
      detail: byItem.get(item.itemId)?.detail ?? null,
      // The PLAN's role wins for something already being worn: it is the slot
      // the approved outfit put it in, which is the thing a conflict is about.
      role: item.role,
      roleLabel: item.roleLabel,
      warmth: fact.warmth,
      keepsRainOff: fact.keepsRainOff,
      keepsWindOff: fact.keepsWindOff,
    }
  })

  const wornIds = new Set(worn.map((garment) => garment.itemId))
  const options: PackedOption[] = packedEntries
    .filter((entry) => !wornIds.has(entry.itemId!))
    .map((entry) => {
      const fact = factsFor(entry.itemId!)
      return {
        itemId: entry.itemId!,
        name: entry.name,
        detail: entry.detail,
        role: fact.role ?? '',
        roleLabel: fact.roleLabel ?? '',
        warmth: fact.warmth,
        keepsRainOff: fact.keepsRainOff,
        keepsWindOff: fact.keepsWindOff,
      }
    })
    // Clothing only. A conflict is answered by a garment, and offering the
    // toothpaste as a warmer layer would be worse than offering nothing.
    .filter((option) => option.role !== '')

  const activityTag = trip.days.find((day) => day.date === date)?.activityTag ?? null

  /*
   * The day after the one being shown, and only while it is still this trip.
   *
   * Read against the day on screen rather than against the current day, so
   * paging forward keeps `tomorrow` meaning "the day after this one" — which is
   * what any caller reading it beside a date would assume.
   */
  const dates = tripDateRange(trip.startDate, trip.endDate)
  const nextDate = dates[dates.indexOf(date) + 1] ?? null
  const nextStop = nextDate ? destinationForDate(trip.destinations, nextDate) : null

  return {
    place: placeForDate(trip.destinations, date),
    activity: activityTag
      ? { tag: activityTag, label: ACTIVITY_LABELS[activityTag] ?? activityTag }
      : null,
    weather,
    freshness,
    weatherFetchedAt: fetchedAt,
    conflicts: weatherConflicts({
      weather,
      freshness,
      hadForecast: fetchedAt !== null,
      worn,
      options,
      dismissed,
      fetchedAt,
    }),
    issue: todayIssue({
      plan,
      slots,
      anythingPacked: entries.some((entry) => entry.excludedAt === null && isPacked(entry)),
    }),
    carry: carryGroups({
      packed: candidates,
      travelDay: isTravelDay(date, trip, trip.destinations),
      weather,
    }),
    tomorrow: nextDate
      ? { date: nextDate, weather: weatherForDay(weatherDays, nextDate, nextStop?.id ?? null) }
      : null,
    todayDate: current.date,
    dateBasis: current.basis,
    timezone: current.timezone,
    dateCaveat: dateNeedsCaveat(current.basis, trip),
  }
}
