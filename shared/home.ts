import type { Readiness, ReadinessRoute } from './readiness'
import { ACTIVITY_LABELS, type Trip } from './trips'
import { describeTodayWeather, type TodayWeather } from './today'
import { weatherHeadline, type WeatherDay, type WeatherFreshness } from './weather'

/**
 * What Home says above the trip card, as one derived value.
 *
 * ## Why there is a model at all
 *
 * Home has to answer a different question in each half of a trip's life — "what
 * should I get ready" before it starts, "what is today" once it has — and the
 * cheap way to do that is a screen full of conditionals. That is how the screen
 * got here: four independent `? :` chains, each with its own idea of when a fact
 * was worth showing, and no single place that could be asked "is this hero too
 * tall". So the judgement lives here and the screen renders what it is given.
 *
 * ## Three properties, all load-bearing
 *
 *   1. **Derived, never stored.** Everything below is computed from the trip,
 *      the readiness model, the day's briefing and the outfit groups — all of
 *      which are already authoritative somewhere else. Nothing here is a second
 *      copy of a fact, and nothing is persisted, for the reason `readiness.ts`
 *      gives at length: a stored summary needs something to keep it fresh, and
 *      the thing that keeps it fresh is what goes wrong.
 *   2. **Pure.** No fetching and no clock. `localDate`, `now` and `hour` are
 *      passed in, so a test can put Home in any moment of any trip without
 *      waiting for one.
 *   3. **It may return nothing.** Every field below is nullable and most of them
 *      are usually null. A hero that always has a weather line, always has a
 *      next action and always has an insight is a dashboard; the empty answer is
 *      the common one and it is the one that keeps Home calm.
 *
 * ## What it deliberately does not carry
 *
 * The trip's name, its dates, its countdown and its packing progress. All four
 * are on the trip card directly underneath, and each fact gets exactly one home
 * — a hero that repeated the countdown would be the same sentence twice in one
 * viewport, which is the thing this pass was asked to remove rather than add.
 */

/**
 * Where the trip is, as far as Home is concerned.
 *
 * Coarser than `ReadinessStage` on purpose. Readiness distinguishes nine rungs
 * because it drives one button; this decides which SHAPE the hero takes, and
 * there are four of those.
 */
export type HeroMode = 'no_trip' | 'upcoming' | 'on_trip' | 'post_trip'

/** One garment in a compact outfit summary. */
export interface HeroGarment {
  itemId: string
  name: string
  /** As stored, for `ColorDots`. Null on the many rows that have no colour. */
  color: string | null
}

/**
 * One of today's outfits, in the fewest words that still identify it.
 *
 * `title` is the outfit group's own name — which for a planned trip is the
 * activity it was planned for, so this doubles as the day's agenda rather than
 * repeating it underneath. See `agenda` for the leftovers.
 */
export interface HeroOutfit {
  title: string | null
  garments: HeroGarment[]
  /**
   * Said only when there is something true to say and something to do about it.
   *
   * The day can call for an outfit the bag does not hold — `getDayPlans` shows
   * only what is confirmed packed (doc 04 §10), so an unpacked outfit arrives
   * here with no garments at all. A silently empty row would be Home hiding the
   * problem; this names it, and the summary is tappable through to the screen
   * that fixes it.
   */
  note: string | null
}

/** One counted thing worth doing, and where it is done. */
export interface HeroNextThing {
  label: string
  route: ReadinessRoute
}

export interface Hero {
  mode: HeroMode
  /** The traveller's own calendar day, already formatted. */
  dateLabel: string
  /** "Traverse City" — only while the trip is underway and only when known. */
  place: string | null
  /** "64–72°F · rain likely", in the product's existing words. */
  weather: string | null
  /**
   * Whose weather that is, when it is not the day Alex is standing in.
   *
   * Null on a trip in progress, where the weather is simply today's. Set before
   * departure, where the numbers are the DESTINATION's and a line that did not
   * say so would read as the forecast out of the window.
   */
  weatherPlace: string | null
  /** "These are the usual conditions, not a forecast", when that is the case. */
  weatherNote: string | null
  /** One consequence, only when the forecast disagrees with the plan. */
  consequence: string | null
  /** Today's outfits, deduplicated, most two. */
  outfits: HeroOutfit[]
  /** Today's activities that no outfit above already names. */
  agenda: string[]
  /** How many more of them there are than the hero shows. */
  agendaMore: number
  /** Never the trip card's own button — see `nextThingFor`. */
  nextThing: HeroNextThing | null
  /** Rare: what a replan noticed without being asked. */
  insight: string | null
  /** Only in the evening, and only when tomorrow changes tonight. */
  tomorrow: string | null
}

/** Today's outfit, as much of it as the hero needs. */
export interface HeroPlan {
  groupName: string | null
  wear: HeroGarment[]
  /** How many garments this outfit calls for that are not in the bag. */
  missingCount: number
}

/** The day's briefing, as much of it as the hero needs. */
export interface HeroToday {
  /** The real current day for this trip, however it was decided. */
  todayDate: string
  place: { name: string } | null
  weather: TodayWeather | null
  freshness: WeatherFreshness
  weatherFetchedAt: number | null
  /** Where today's weather disagrees with today's outfit. */
  conflicts: Array<{ headline: string }>
  plans: HeroPlan[]
  /** Tomorrow, when there is a tomorrow on this trip. */
  tomorrow: { date: string; weather: TodayWeather | null } | null
}

/** What is stored about the trip's weather, before it starts. */
export interface HeroTripWeather {
  days: WeatherDay[]
}

export interface HeroInput {
  trip: Trip | null
  readiness: Readiness | null
  /** Present only while the trip is underway. */
  today: HeroToday | null
  /** Present only before departure, and only inside the forecast horizon. */
  tripWeather: HeroTripWeather | null
  /**
   * Every outfit group, for the one thing the hero reads off them: an APPROVED
   * outfit a replan has put a question mark over.
   */
  outfitGroups: Array<{ name: string; status: string; reviewReason: string | null }>
  /** `YYYY-MM-DD`, the device's own day. Used before the trip starts. */
  localDate: string
  /** Epoch seconds, for how old a forecast is. */
  now: number
  /** The device's local hour, 0–23. Decides whether tomorrow is worth a line. */
  hour: number
}

/* ------------------------------------------------------------------ */
/* dates                                                               */
/* ------------------------------------------------------------------ */

/**
 * "Sat 5 Sep" — a date read as a fact rather than parsed as a timestamp.
 *
 * `T00:00:00Z` and `timeZone: 'UTC'` together, exactly as `Today` formats its
 * own day: the string is already the traveller's calendar day by the time it
 * gets here, so anything that re-interpreted it in the device's zone could shift
 * it by one. Which day it IS was decided by `resolveTodayDate`; this only spells
 * it.
 */
export function formatHeroDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/* ------------------------------------------------------------------ */
/* the pieces                                                          */
/* ------------------------------------------------------------------ */

/** How many of today's outfits the hero will show. */
export const HERO_OUTFITS_SHOWN = 2

/** How many leftover agenda labels the hero will name. */
export const HERO_AGENDA_SHOWN = 3

/**
 * How many garments a summary names before it stops.
 *
 * Four is a whole outfit — top, bottom, shoes, and one layer — and a fifth
 * wraps to a second line at 360px, which is where a summary stops being one.
 */
export const HERO_GARMENTS_SHOWN = 4

/**
 * The day's outfits, without the same outfit twice.
 *
 * Two events sharing an outfit is ordinary — a beach afternoon and dinner can
 * both be `Casual days` — and printing the same four garments under two
 * headings would be the hero explaining that nothing changes, at the cost of
 * four lines. Keyed on the GARMENTS rather than on the name, because that is
 * what "the same outfit" means to somebody getting dressed.
 *
 * A genuine change is never hidden: two plans whose garments differ are two
 * summaries, which is exactly the two-event day this exists for.
 */
export function heroOutfits(plans: HeroPlan[]): HeroOutfit[] {
  const seen = new Set<string>()
  const out: HeroOutfit[] = []

  for (const plan of plans) {
    const key = plan.wear.map((g) => g.itemId).sort().join('|')
    // An outfit with nothing packed has an empty key, and two of those are not
    // "the same outfit" — they are two different unpacked outfits.
    if (plan.wear.length > 0 && seen.has(key)) continue
    if (plan.wear.length > 0) seen.add(key)

    if (plan.wear.length === 0 && plan.missingCount === 0 && !plan.groupName) continue

    out.push({
      title: plan.groupName,
      garments: plan.wear.slice(0, HERO_GARMENTS_SHOWN),
      note:
        plan.wear.length > 0
          ? null
          : plan.missingCount > 0
            ? plan.missingCount === 1
              ? 'One thing for this is not packed'
              : `${plan.missingCount} things for this are not packed`
            : 'No outfit assigned yet',
    })

    if (out.length === HERO_OUTFITS_SHOWN) break
  }

  return out
}

/**
 * Today's activities that the outfits above have not already named.
 *
 * The planner names a group after the activity it is for, so on an ordinary
 * planned day the outfit headings ARE the agenda and a second list of the same
 * words would be the redundancy this pass exists to remove. What is left over is
 * worth saying: a day with a beach afternoon and no beach outfit still has a
 * beach afternoon in it.
 *
 * Matched loosely on purpose — the template is `Nice dinners` and the activity
 * is `Nice dinner`, and treating those as two different things would print both.
 */
export function heroAgenda(labels: string[], outfits: HeroOutfit[]): string[] {
  const named = outfits
    .map((outfit) => outfit.title?.toLowerCase() ?? '')
    .filter((title) => title.length > 0)

  return labels.filter((label) => {
    const lower = label.toLowerCase()
    return !named.some((title) => title.startsWith(lower) || lower.startsWith(title))
  })
}

/**
 * The one counted thing worth naming, and never the one already on the button.
 *
 * `readiness.issues` is the list of things this trip cannot be finished without
 * deciding — already counted, already ordered by materiality, and deliberately
 * NOT the recommended action, which is `readiness.next` and is the trip card's
 * primary button. Naming the same route twice in one viewport is two controls
 * for one job, so anything the button already leads to is dropped here.
 */
export function nextThingFor(readiness: Readiness | null): HeroNextThing | null {
  if (!readiness) return null
  const first = readiness.issues.find((issue) => issue.route !== readiness.next?.route)
  return first ? { label: first.label, route: first.route } : null
}

/**
 * What automation noticed, using the evidence automation actually left behind.
 *
 * `review_reason` is written by a replan that compared an APPROVED outfit
 * against the trip as it now stands and found a specific garment no longer
 * passes — the fleece that is not warm enough for the new forecast. It is
 * cleared the moment the condition goes away, so it cannot outlive what it is
 * about, and it is set rarely because most replans change nothing.
 *
 * Only approved groups. An unapproved one is already counted in
 * `readiness.issues`, and saying it twice in one hero — once as a count and once
 * as a sentence — is the noise this ordering guard exists to prevent.
 *
 * Nothing is generated here. If no replan flagged anything, the hero is silent,
 * which is the answer on almost every day of almost every trip.
 */
export function heroInsight(
  groups: Array<{ name: string; status: string; reviewReason: string | null }>,
): string | null {
  const flagged = groups.find((group) => group.status === 'approved' && group.reviewReason)
  return flagged ? `${flagged.name} · ${flagged.reviewReason}` : null
}

/**
 * When it is late enough for tomorrow to be tonight's business.
 *
 * Five in the afternoon. Earlier than that, tomorrow's forecast is a fact about
 * a day Alex has not finished getting through, and a hero that carried it all
 * day would be the permanent second agenda §12 rules out.
 */
export const TOMORROW_FROM_HOUR = 17

/**
 * One quiet line about tomorrow, when tomorrow changes what to do tonight.
 *
 * Three conditions, all of them required: it is evening, tomorrow is still part
 * of this trip, and tomorrow has something in it — an activity to dress for, or
 * rain. A warm dry day with nothing planned changes nothing about tonight and
 * gets no line.
 */
export function heroTomorrow(input: {
  hour: number
  activity: string | null
  weather: TodayWeather | null
}): string | null {
  if (input.hour < TOMORROW_FROM_HOUR) return null

  const described = describeTodayWeather(input.weather)
  const interesting = input.activity !== null || (input.weather?.rainLikely ?? false)
  if (!interesting) return null

  return ['Tomorrow', input.activity, described?.text].filter(Boolean).join(' · ')
}

/* ------------------------------------------------------------------ */
/* the hero                                                            */
/* ------------------------------------------------------------------ */

/**
 * How many lines the hero is allowed to spend before it stops being a hero.
 *
 * §46's height guard, counted rather than measured: the trip card has to remain
 * visible, or nearly visible, in the first 664px at 390px, and every line here
 * costs roughly 20px.
 *
 * Eight is the fullest a day can legitimately be — where Alex is, the date and
 * the forecast, one weather consequence, and two outfits at two lines each. That
 * is a real briefing rather than a budget overrun, and §46 is explicit that a
 * genuinely richer day may be taller. What the number decides is everything
 * BELOW it: on a day that full, the quiet lines at the bottom of §45's ordering
 * — tomorrow prep, the automation insight, the next thing, the leftover agenda —
 * are dropped in that order rather than pushing the trip card off the screen.
 */
export const HERO_LINE_BUDGET = 8

export function homeHero(input: HeroInput): Hero {
  const { trip, readiness, today, localDate } = input

  const base: Hero = {
    mode: 'no_trip',
    dateLabel: formatHeroDate(localDate),
    place: null,
    weather: null,
    weatherPlace: null,
    weatherNote: null,
    consequence: null,
    outfits: [],
    agenda: [],
    agendaMore: 0,
    nextThing: null,
    insight: null,
    tomorrow: null,
  }

  if (!trip) return base

  if (readiness?.stage === 'finished') {
    /*
     * A trip that is over keeps its date and nothing else.
     *
     * The post-trip prompt is `readiness.next` — "Review the trip" — and it is
     * already the trip card's button. Doc 09 §16 owns that flow; this pass was
     * explicitly told not to redesign it, so the hero stays out of its way.
     */
    return { ...base, mode: 'post_trip' }
  }

  /* --- the trip is underway ----------------------------------------- */

  if (today) {
    const described = describeTodayWeather(
      today.weather,
      today.freshness,
      today.weatherFetchedAt,
      input.now,
    )

    const outfits = heroOutfits(today.plans)
    const labels = activityLabelsOn(trip, today.todayDate)
    const leftover = heroAgenda(labels, outfits)

    const hero: Hero = {
      ...base,
      mode: 'on_trip',
      dateLabel: formatHeroDate(today.todayDate),
      place: today.place?.name ?? null,
      weather: described?.text ?? null,
      weatherPlace: null,
      weatherNote: described?.seasonal ? 'Usual weather, not a forecast' : null,
      /*
       * One consequence, and it is the existing one.
       *
       * `weatherConflicts` already decides when today's forecast disagrees with
       * today's outfit, in one sentence, from the same rules the Today screen
       * shows. The hero repeats the first of them and nothing else — a second
       * conflict is a reason to open Today, not a reason for two lines here.
       */
      consequence: today.conflicts[0]?.headline ?? null,
      outfits,
      agenda: leftover.slice(0, HERO_AGENDA_SHOWN),
      agendaMore: Math.max(0, leftover.length - HERO_AGENDA_SHOWN),
      nextThing: nextThingFor(readiness),
      insight: heroInsight(input.outfitGroups),
      tomorrow: heroTomorrow({
        hour: input.hour,
        activity: today.tomorrow
          ? (activityLabelsOn(trip, today.tomorrow.date)[0] ?? null)
          : null,
        weather: today.tomorrow?.weather ?? null,
      }),
    }

    return trim(hero)
  }

  /* --- before departure --------------------------------------------- */

  const headline = input.tripWeather ? weatherHeadline(input.tripWeather.days) : null

  return trim({
    ...base,
    mode: 'upcoming',
    /*
     * The destination's outlook, named as the destination's.
     *
     * Pack Smart has no current-location weather — every forecast it holds was
     * fetched for a trip's stops — so the honest pre-trip line is the one about
     * where Alex is GOING, labelled so it cannot be read as the sky outside.
     * §10's preference for current-location weather is conditional on the
     * product supporting it, and this one does not; inventing a geolocation
     * permission and a second weather path for one line would be exactly the
     * over-engineering §40 rules out.
     *
     * Offered only inside the forecast horizon, which is the caller's decision:
     * a trip four months away has climate normals rather than a forecast, and
     * "typically 54–74°F in Tokyo in April" is not a thing that changes what
     * Alex does today.
     */
    weather: headline?.short ?? null,
    weatherPlace: headline ? (trip.destinations[0]?.name ?? null) : null,
    weatherNote: headline?.note ?? null,
    nextThing: nextThingFor(readiness),
    insight: heroInsight(input.outfitGroups),
  })
}

/** Every activity named for a date, in the order Alex arranged them. */
function activityLabelsOn(trip: Trip, date: string): string[] {
  return trip.days
    .filter((day) => day.date === date && day.activityTag !== null)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((day) => ACTIVITY_LABELS[day.activityTag!] ?? day.activityTag!)
}

/**
 * How many lines a hero would render as.
 *
 * Counted from what is actually drawn rather than from the number of fields
 * set: an outfit is a heading and a row of garments, which is two.
 */
export function heroLines(hero: Hero): number {
  return (
    (hero.place ? 1 : 0) +
    1 + // the date, which is always there
    (hero.weather ? 1 : 0) +
    (hero.consequence ? 1 : 0) +
    hero.outfits.reduce((n, outfit) => n + (outfit.title ? 2 : 1), 0) +
    (hero.agenda.length > 0 ? 1 : 0) +
    (hero.nextThing ? 1 : 0) +
    (hero.insight ? 1 : 0) +
    (hero.tomorrow ? 1 : 0)
  )
}

/**
 * Drops the least important things until the hero fits.
 *
 * In §45's order, from the bottom: tomorrow prep, then the automation insight,
 * then the next thing, then the leftover agenda. Nothing above those is ever
 * dropped — the day, the weather, the consequence and the outfits are what the
 * hero is FOR, and a trip whose day genuinely holds two outfits and a weather
 * conflict is allowed to be taller than one that does not (§46).
 */
function trim(hero: Hero): Hero {
  let out = hero
  const drops: Array<(h: Hero) => Hero> = [
    (h) => ({ ...h, tomorrow: null }),
    (h) => ({ ...h, insight: null }),
    (h) => ({ ...h, nextThing: null }),
    (h) => ({ ...h, agenda: [], agendaMore: 0 }),
  ]

  for (const drop of drops) {
    if (heroLines(out) <= HERO_LINE_BUDGET) return out
    out = drop(out)
  }

  return out
}
