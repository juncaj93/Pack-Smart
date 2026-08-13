import { ACTIVITY_LABELS, type Trip } from './trips'
import {
  rainOutlook,
  toFahrenheit,
  warmthBandForDays,
  type WeatherDay,
  type WeatherSource,
} from './weather'

/**
 * What "plan again" is actually planning against, and how to tell when it moved.
 *
 * Replanning used to be a button that ran the planner. The planner is
 * deterministic, so against unchanged inputs it produced the same answer — which
 * made the control either a no-op or, where a tie fell differently, a shuffle.
 * Neither is what Alex is asking for when he presses it a week before departure
 * with a colder forecast on his phone.
 *
 * So the question the control has to answer is not "what would the planner say
 * now" but **"what is different now from when this plan was made"**. That needs
 * two things: a record of the inputs the plan was made from, and a comparison
 * that only fires on differences the planner could actually act on.
 *
 * ## The threshold rule
 *
 * A forecast moving 67°F → 65°F must not create work. A forecast moving
 * 57–67°F → 41–49°F must. The line between them is not a number invented here:
 * it is `warmthBandForDays`, the band the planner uses as a HARD filter on
 * jackets and mid-layers. Two forecasts that produce the same band are the same
 * forecast as far as any packing decision is concerned, however different the
 * numbers look. Comparing the bands rather than the degrees means this module
 * cannot drift from what the planner does, because it is asking the planner's
 * own question.
 *
 * The same applies throughout: rain is compared at `rainOutlook().likely`,
 * which is the threshold the outer-layer filter uses, not at the raw
 * percentage.
 */

/** Bumped when a change here would make an old snapshot compare wrongly. */
export const PLAN_SIGNALS_VERSION = 1

export interface PlanSignals {
  version: number
  /** Sorted, so the same trip never produces two different snapshots. */
  activities: string[]
  /** `date:tag` for the days Alex has actually named. Sorted. */
  dayPlan: string[]
  startDate: string
  endDate: string
  /** Stop ids, in the order they are visited. */
  destinations: string[]
  maxDressiness: number | null
  laundryAvailable: boolean | null
  /**
   * The planner's hard warmth filter, not the temperature.
   *
   * This is the whole of the "do not respond to forecast noise" rule: two
   * forecasts with the same band cannot change which garments are admissible,
   * so they are the same input.
   */
  warmth: [number, number] | null
  /** `rainOutlook().likely` — the threshold the outer-layer filter uses. */
  rain: boolean
  /**
   * The degrees, carried for EXPLANATION only, never for comparison.
   *
   * "about 18°F colder" is worth saying and is what makes the change legible;
   * deciding anything from it would put a second, softer threshold beside the
   * band and the two would eventually disagree.
   */
  tempRangeC: [number, number] | null
  /** Whether the numbers were a forecast or a climate normal, when known. */
  weatherSource: WeatherSource | null
}

/** One thing that is different now, in terms Alex would recognise. */
export interface PlanChange {
  kind:
    | 'weather_colder'
    | 'weather_warmer'
    | 'weather_rain'
    | 'weather_dry'
    | 'weather_first'
    | 'activities'
    | 'days'
    | 'dates'
    | 'formality'
    | 'laundry'
    | 'destinations'
  /** One short sentence. No implementation mechanics, no percentages. */
  detail: string
}

function sortedActivities(trip: Trip): string[] {
  return [...trip.activities].sort()
}

function dayPlanOf(trip: Trip): string[] {
  return trip.days
    .filter((day) => day.activityTag)
    .map((day) => `${day.date}:${day.activityTag}`)
    .sort()
}

/**
 * The inputs a plan was made from, reduced to what can change its answer.
 *
 * Deliberately small. Anything in here that the planner does not read is a
 * source of false alarms, and anything the planner reads that is missing is a
 * change Alex will never be told about — so the contents are exactly the
 * arguments `generateOutfits` passes down, and nothing decorative.
 */
export function planSignals(trip: Trip, weather: WeatherDay[]): PlanSignals {
  const band = warmthBandForDays(weather)

  let min: number | null = null
  let max: number | null = null
  for (const day of weather) {
    const low = day.tempMinC ?? day.tempMaxC
    const high = day.tempMaxC ?? day.tempMinC
    if (low !== null) min = min === null ? low : Math.min(min, low)
    if (high !== null) max = max === null ? high : Math.max(max, high)
  }

  return {
    version: PLAN_SIGNALS_VERSION,
    activities: sortedActivities(trip),
    dayPlan: dayPlanOf(trip),
    startDate: trip.startDate,
    endDate: trip.endDate,
    destinations: trip.destinations.map((stop) => stop.id),
    maxDressiness: trip.maxDressiness,
    laundryAvailable: trip.laundryAvailable,
    warmth: band,
    rain: rainOutlook(weather).likely,
    tempRangeC: min === null || max === null ? null : [min, max],
    weatherSource: weather[0]?.source ?? null,
  }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function activityWords(tags: string[]): string {
  const labels = tags.map((tag) => ACTIVITY_LABELS[tag] ?? tag)
  if (labels.length === 1) return labels[0]!
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

/**
 * How much colder, in the units Alex reads.
 *
 * Returns null when either snapshot had no numbers — a trip that gains a
 * forecast for the first time is a change worth reporting, but "18°F colder
 * than nothing" is not a sentence.
 */
function degreeShift(
  before: [number, number] | null,
  after: [number, number] | null,
): number | null {
  if (!before || !after) return null
  const beforeMid = (before[0] + before[1]) / 2
  const afterMid = (after[0] + after[1]) / 2
  return toFahrenheit(afterMid) - toFahrenheit(beforeMid)
}

/**
 * What is different now — and nothing else.
 *
 * Empty is the expected answer. Pressing "plan again" against a trip that has
 * not moved should find nothing to say, because nothing has happened, and a
 * control that invents a difference to look busy is exactly the "random
 * novelty" this product does not do.
 *
 * A missing or superseded snapshot returns empty rather than "everything
 * changed". The plans on the database were made before this existed and are not
 * wrong; announcing a change nobody made would be worse than staying quiet, and
 * the next plan writes a snapshot that works from then on.
 */
export function planChanges(before: PlanSignals | null, after: PlanSignals): PlanChange[] {
  if (!before || before.version !== after.version) return []

  const changes: PlanChange[] = []

  /* ---- weather ------------------------------------------------------ */

  if (before.warmth === null && after.warmth !== null) {
    changes.push({
      kind: 'weather_first',
      detail: 'There is a forecast for these dates now.',
    })
  } else if (
    before.warmth !== null &&
    after.warmth !== null &&
    (before.warmth[0] !== after.warmth[0] || before.warmth[1] !== after.warmth[1])
  ) {
    /*
     * Warmer or colder is decided by the BAND, which counts upwards as the
     * weather gets colder (`warmthNeededFor`). Reading the degrees to decide
     * the direction would let the two disagree on a forecast that shifted the
     * band one way and the midpoint the other.
     */
    const colder =
      after.warmth[0] + after.warmth[1] > before.warmth[0] + before.warmth[1]
    const shift = degreeShift(before.tempRangeC, after.tempRangeC)
    const amount = shift === null ? null : Math.abs(shift)

    changes.push({
      kind: colder ? 'weather_colder' : 'weather_warmer',
      detail:
        amount !== null && amount >= 1
          ? `The forecast is about ${amount}°F ${colder ? 'colder' : 'warmer'} than when you planned.`
          : `The forecast turned ${colder ? 'colder' : 'warmer'} since you planned.`,
    })
  }

  if (!before.rain && after.rain) {
    changes.push({ kind: 'weather_rain', detail: 'Rain is likely now.' })
  } else if (before.rain && !after.rain) {
    changes.push({ kind: 'weather_dry', detail: 'Rain is no longer likely.' })
  }

  /* ---- the trip itself ---------------------------------------------- */

  if (!sameList(before.activities, after.activities)) {
    const added = after.activities.filter((tag) => !before.activities.includes(tag))
    const removed = before.activities.filter((tag) => !after.activities.includes(tag))
    changes.push({
      kind: 'activities',
      detail:
        added.length > 0 && removed.length === 0
          ? `You added ${activityWords(added)}.`
          : removed.length > 0 && added.length === 0
            ? `You are no longer doing ${activityWords(removed)}.`
            : 'What you are doing on this trip changed.',
    })
  }

  if (!sameList(before.dayPlan, after.dayPlan)) {
    changes.push({ kind: 'days', detail: 'Which days are which changed.' })
  }

  if (before.startDate !== after.startDate || before.endDate !== after.endDate) {
    changes.push({ kind: 'dates', detail: 'The trip’s dates changed.' })
  }

  if (before.maxDressiness !== after.maxDressiness) {
    changes.push({
      kind: 'formality',
      detail:
        after.maxDressiness !== null &&
        (before.maxDressiness === null || after.maxDressiness > before.maxDressiness)
          ? 'This trip is dressier than you first said.'
          : 'This trip is less dressy than you first said.',
    })
  }

  if (before.laundryAvailable !== after.laundryAvailable) {
    changes.push({
      kind: 'laundry',
      detail: after.laundryAvailable ? 'You will have laundry now.' : 'You will not have laundry.',
    })
  }

  if (!sameList(before.destinations, after.destinations)) {
    changes.push({ kind: 'destinations', detail: 'Where you are going changed.' })
  }

  return changes
}

/**
 * The changes as one compact line, for the control that offers to act on them.
 *
 * One sentence when there is one thing to say, a count when there are several —
 * a stack of four sentences above a button is the persistent banner §31 rules
 * out, and the detail is available on the outfits themselves once the replan
 * has run.
 */
export function changeSummary(changes: PlanChange[]): string | null {
  if (changes.length === 0) return null
  if (changes.length === 1) return changes[0]!.detail
  const weather = changes.filter((c) => c.kind.startsWith('weather_'))
  if (weather.length === changes.length) return 'The forecast changed since you planned.'
  return `${changes.length} things changed since you planned.`
}

/* ------------------------------------------------------------------ */
/* what the replan actually did                                        */
/* ------------------------------------------------------------------ */

export interface ReplanOutcome {
  /** How many draft outfits were planned again. */
  replannedCount: number
  /** How many approvals were honoured untouched. */
  keptApproved: number
  /** Whether anything moved at all. */
  regenerated: boolean
  /** Approved outfits the changes have put a question mark over. */
  flagged: Array<{ id: string; name: string; reason: string }>
  /** What was different about the trip when this ran. */
  changes: PlanChange[]
}

/**
 * One line saying what the replan did, in terms of the trip rather than the run.
 *
 * ## Why it leads with the CAUSE
 *
 * `2 planned again · 1 left as you approved it` is a report about the
 * algorithm. It tells Alex how many rows moved, which is not a thing he wanted
 * to know — he pressed the button because the forecast changed, and the answer
 * he is owed is *what that did to his packing*. So the sentence starts with the
 * reason when there is one, and the counts follow it as detail.
 *
 * ## Why it is one line
 *
 * §32 asks for a meaningful delta and rules out dumping a diff. The outfits are
 * directly below, each carrying its own state and its own flag; a list here
 * would restate them in a second vocabulary, which is how two parts of one
 * screen start disagreeing. This says what happened; the cards say what it
 * happened to.
 *
 * Returns null when nothing meaningful happened. A replan that found nothing to
 * change should leave no trace — announcing "no changes" on every press is the
 * churn this whole slice exists to remove.
 */
export function replanNotice(outcome: ReplanOutcome): string | null {
  const { changes, flagged, replannedCount, regenerated } = outcome

  const cause = changes.length === 1 ? changes[0]!.detail : changeSummary(changes)

  const effects: string[] = []
  if (replannedCount > 0) {
    effects.push(
      `${replannedCount} ${replannedCount === 1 ? 'outfit' : 'outfits'} planned again`,
    )
  }
  if (flagged.length > 0) {
    effects.push(
      `${flagged.length} ${flagged.length === 1 ? 'outfit needs' : 'outfits need'} review`,
    )
  }

  if (cause && effects.length > 0) return `${cause} ${effects.join(' · ')}.`
  if (cause) {
    /*
     * Something about the trip moved and the plan came out the same anyway.
     * Worth saying once — it is the difference between "the app did nothing"
     * and "the app checked, and nothing needed to change", and only one of
     * those is reassuring.
     */
    return `${cause} Nothing needed to change.`
  }
  if (effects.length > 0) return `${effects.join(' · ')}.`
  if (!regenerated) return 'Your approved outfits were left as they are.'
  return null
}
