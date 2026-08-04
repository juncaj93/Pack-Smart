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
  weatherForDay,
  type CarryCandidate,
  type CarryGroup,
  type DateBasis,
  type TodayIssue,
  type TodayPlace,
  type TodayWeather,
} from '@shared/today'
import { ACTIVITY_LABELS, destinationForDate, type Trip } from '@shared/trips'
import { weatherCapability } from '@shared/weather-fit'
import { categoryKind, type Item } from '@shared/items'
import { listWeather } from '../repos/weather'

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

/** How the trip's own rain capability is decided, without inventing any. */
interface RainRow {
  id: string
  display_name: string
  notes: string | null
  weather_tags: string | null
}

export interface TodayBriefing {
  place: TodayPlace | null
  activity: { tag: string; label: string } | null
  weather: TodayWeather | null
  issue: TodayIssue
  carry: CarryGroup[]
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
  trip: Pick<Trip, 'timezone'>,
  deviceDate: string | null,
  at: Date,
): { date: string; basis: DateBasis; timezone: string | null } {
  return resolveTodayDate({ at, timezone: trip.timezone, deviceDate })
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
async function rainCapable(db: D1Database, itemIds: string[]): Promise<Set<string>> {
  const capable = new Set<string>()
  if (itemIds.length === 0) return capable

  const placeholders = itemIds.map(() => '?').join(',')
  const result = await db
    .prepare(`SELECT id, display_name, notes, weather_tags FROM item WHERE id IN (${placeholders})`)
    .bind(...itemIds)
    .all<RainRow>()

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

    if (weatherCapability(item, 'rain').yes) capable.add(row.id)
  }

  return capable
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

  const current = currentDateFor(trip, input.deviceDate, input.at)
  const stop = destinationForDate(trip.destinations, date)
  const weatherDays = await listWeather(db, trip.id)
  const weather = weatherForDay(weatherDays, date, stop?.id ?? null)

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
      })),
    }
  })

  const packedEntries = entries.filter(
    (entry) => entry.itemId !== null && entry.excludedAt === null && entry.packedQty > 0,
  )
  const rain = await rainCapable(
    db,
    weather?.rainLikely ? packedEntries.map((entry) => entry.itemId!) : [],
  )

  const candidates: CarryCandidate[] = packedEntries.map((entry) => ({
    itemId: entry.itemId!,
    name: entry.name,
    category: entry.category,
    kind: categoryKind(entry.category),
    keepsRainOff: rain.has(entry.itemId!),
    tripTriggered:
      entry.source === 'trip_triggered' || entry.source === 'dependency_triggered',
  }))

  const activityTag = trip.days.find((day) => day.date === date)?.activityTag ?? null

  return {
    place: placeForDate(trip.destinations, date),
    activity: activityTag
      ? { tag: activityTag, label: ACTIVITY_LABELS[activityTag] ?? activityTag }
      : null,
    weather,
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
    todayDate: current.date,
    dateBasis: current.basis,
    timezone: current.timezone,
    dateCaveat: dateNeedsCaveat(current.basis, trip),
  }
}
