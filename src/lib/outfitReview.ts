import type { OutfitGroup, OutfitSlot } from '@/lib/trips'
import { assignDays } from '@shared/during-trip'
import {
  formalityLabel,
  outfitContext,
  outfitFit,
  outfitMarkers,
  templateFor,
  type OutfitMarker,
} from '@shared/outfits'
import { ACTIVITY_LABELS, destinationForDate, type Trip } from '@shared/trips'
import { weatherForDates, type WeatherDay } from '@shared/weather'

/**
 * Everything the review has to state about one outfit, worked out once.
 *
 * Doc 09 §7 lists what a reviewable outfit must show — dates, destination,
 * activity, weather, formality, garments, gaps, and why it fits. Two screens
 * need that list now: the overview card and the guided walkthrough. Deriving it
 * twice is how the card and the walkthrough end up disagreeing about which days
 * an outfit covers, which is worse than either being wrong on its own, because
 * neither looks wrong.
 *
 * Nothing here invents. Where a fact was never recorded the field is null and
 * the screen says so plainly — there is no "probably mild" and no time of day
 * guessed from an activity's name.
 */
export interface ReviewedOutfit {
  group: OutfitGroup
  /** The exact dates, when Alex has said which days are which. Empty otherwise. */
  dates: string[]
  /** "8–10 Aug", or "3 days" when no day has been named. Never an ISO date. */
  when: string
  /** The stop those days belong to, or null on a multi-stop trip with no days. */
  place: string | null
  /**
   * The activity in Alex's words, or null for a group that is not an activity.
   *
   * This is also the only time-of-day context the model holds: "Nice dinners"
   * says evening because Alex chose an evening activity, and nothing anywhere
   * records a clock time. Deriving "Morning" from `safari` would be inventing a
   * fact, so the review states the activity and stops there.
   */
  activity: string | null
  /** "55–70°F · rain likely", "Usually 55–70°F", or null when nothing is stored. */
  conditions: string | null
  /** "Dressy to Formal", or null when the group came from no known template. */
  formality: string | null
  markers: OutfitMarker[]
  /** One or two short lines, from recorded facts only. */
  fit: string[]
  /** Required slots with nothing in them. */
  missing: OutfitSlot[]
  /** Garments in the outfit that the packing list has been told not to bring. */
  setAside: OutfitSlot[]
}

/**
 * Describes every group of a trip together.
 *
 * Together rather than one at a time because `assignDays` spreads the whole
 * plan across the calendar at once — asking it per group would let two groups
 * both believe they own the same Tuesday.
 */
export function describeOutfits(
  trip: Trip | null,
  groups: OutfitGroup[],
  weatherDays: WeatherDay[],
): ReviewedOutfit[] {
  const assignments = trip
    ? assignDays(
        trip.startDate,
        trip.endDate,
        groups.map((g) => ({
          id: g.id,
          name: g.name,
          occurrences: g.occurrences,
          activityTag: g.activityTag,
        })),
        trip.days,
      )
    : []

  return groups.map((group) => {
    const dates = assignments.filter((day) => day.outfitGroupId === group.id).map((d) => d.date)

    const stop = trip ? destinationForDate(trip.destinations, dates[0] ?? trip.startDate) : null
    const place = trip
      ? (stop?.name ?? (trip.destinations.length === 1 ? trip.destinations[0]!.name : null))
      : null

    /*
     * The dates are only CLAIMED when Alex named his days.
     *
     * `assignDays` spreads groups over the calendar either way, and that spread
     * is a reasonable order for During Trip to walk — but it is not a statement
     * that the safari is on the Tuesday. The weather still reads from the spread
     * dates, because a forecast for roughly those days is better than none;
     * the CONTEXT line falls back to the occurrence count, so nothing on screen
     * asserts a day Alex never gave.
     */
    const stated = trip && trip.days.length > 0 ? dates : []
    const template = templateFor(group.activityTag, group.name)

    return {
      group,
      dates: stated,
      when: outfitContext({
        activityTag: group.activityTag,
        dates: stated,
        place: null,
        occurrences: group.occurrences,
      })[0]!,
      place,
      activity: group.activityTag ? (ACTIVITY_LABELS[group.activityTag] ?? null) : null,
      conditions: weatherForDates(weatherDays, dates, stop?.id ?? null),
      formality: template ? formalityLabel(template) : null,
      markers: outfitMarkers(group),
      fit: outfitFit(group),
      missing: group.slots.filter((slot) => slot.required && !slot.itemId),
      setAside: group.slots.filter((slot) => slot.setAside),
    }
  })
}
