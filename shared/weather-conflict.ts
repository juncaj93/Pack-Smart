import type { TodayWeather } from './today'
import { WIND_THRESHOLD_KPH } from './weather-fit'
import { warmthNeededFor, type WeatherFreshness } from './weather'

/**
 * When today's weather disagrees with today's approved outfit (E2).
 *
 * The rule this whole file exists to obey is the same one E1 was built on and
 * doc 04 §12 states outright: **an approved outfit is never silently changed.**
 * Nothing here rewrites anything. It produces a sentence, the slot it is about,
 * and the packed garments that could answer it — and then stops, because the
 * next move is Alex's.
 *
 * The second rule is that it has to be worth reading. A forecast that moved two
 * degrees changes no clothing decision, and an alert for it teaches Alex to
 * ignore the ones that matter. So every threshold below is a **band boundary**
 * from `warmthNeededFor` rather than a temperature: a conflict exists when the
 * day has crossed into needing a different KIND of garment, not when a number
 * moved.
 *
 * And the third: capability is only ever what Alex recorded. `weather-fit.ts`
 * refuses to call a jacket waterproof because it is a jacket, and this file
 * inherits that refusal rather than working around it — the garment facts
 * arrive already decided.
 */

export type ConflictKind = 'rain' | 'colder' | 'hotter' | 'wind' | 'forecast_lost'

/** One garment in today's outfit, with only the facts a conflict can turn on. */
export interface WornGarment {
  itemId: string
  name: string
  role: string
  roleLabel: string
  /** 0–3 on the WARMTH_LABELS scale, or null when Alex never recorded it. */
  warmth: number | null
  keepsRainOff: boolean
  keepsWindOff: boolean
}

/**
 * A packed garment that could take a slot.
 *
 * The same facts as a worn one, because the comparison is symmetric: deciding
 * whether the jacket in the bag is warmer than the one on the plan needs both
 * described the same way.
 */
export type PackedOption = WornGarment

export interface WeatherConflict {
  kind: ConflictKind
  /** One sentence. What is wrong, in plain words. */
  headline: string
  /** What Pack Smart is and is not doing about it. */
  detail: string
  /** The slot this is about, when it is about one. */
  role: string | null
  roleLabel: string | null
  /** The garment being questioned — never removed, only questioned. */
  itemId: string | null
  itemName: string | null
  /** Packed garments that would answer it. Empty is a real answer. */
  alternatives: Array<{ itemId: string; name: string }>
}

export interface ConflictInput {
  weather: TodayWeather | null
  freshness: WeatherFreshness
  /**
   * True when this trip has fetched a real forecast at some point.
   *
   * The difference between "Pack Smart never knew" and "Pack Smart knew and has
   * lost it", which are different things to tell someone standing in a hotel
   * room. Read from whether anything was ever stored, not from a history table.
   */
  hadForecast: boolean
  worn: WornGarment[]
  /** Everything packed that could stand in, by role. */
  options: PackedOption[]
  /**
   * Conflict kinds Alex has already answered, and the forecast he answered
   * against. A newer forecast re-raises them; the same one does not.
   */
  dismissed: Record<string, number>
  /** The forecast currently on screen, so a dismissal can be scoped to it. */
  fetchedAt: number | null
}

/** Which slot a conflict is about, given what is being worn. */
function slotFor(worn: WornGarment[], roles: string[]): WornGarment | null {
  for (const role of roles) {
    const match = worn.find((garment) => garment.role === role)
    if (match) return match
  }
  return null
}

function optionsFor(
  options: PackedOption[],
  role: string | null,
  matches: (option: PackedOption) => boolean,
  worn: WornGarment[],
): Array<{ itemId: string; name: string }> {
  return options
    .filter((option) => (role === null || option.role === role) && matches(option))
    .filter((option) => !worn.some((garment) => garment.itemId === option.itemId))
    .map((option) => ({ itemId: option.itemId, name: option.name }))
}

/** The warmest thing being worn, ignoring garments with no recorded warmth. */
function warmthWorn(worn: WornGarment[]): { max: number | null; min: number | null } {
  const values = worn.map((g) => g.warmth).filter((w): w is number => w !== null)
  if (values.length === 0) return { max: null, min: null }
  return { max: Math.max(...values), min: Math.min(...values) }
}

/**
 * The layers a conflict can sensibly be about, warmest first.
 *
 * A cold morning is answered by a jacket, then a mid-layer, then a top — in that
 * order, because that is the order Alex would reach for them. Bottoms and shoes
 * are deliberately absent: "it is colder than expected, change your trousers" is
 * not advice anybody acts on.
 */
const LAYER_ROLES = ['outer', 'mid', 'top']

export function weatherConflicts(input: ConflictInput): WeatherConflict[] {
  const { weather, worn, options } = input
  const out: WeatherConflict[] = []

  const push = (conflict: WeatherConflict) => {
    // Answered against this same forecast, so it is not news any more.
    const answeredAt = input.dismissed[conflict.kind]
    if (answeredAt !== undefined && input.fetchedAt !== null && answeredAt >= input.fetchedAt) return
    out.push(conflict)
  }

  /*
   * The forecast is gone, and it used to be here.
   *
   * Reported before anything else and instead of everything else: with no
   * forecast there is nothing to compare an outfit against, and inventing a
   * comparison out of a climate normal is exactly the confusion §6 forbids.
   */
  if (input.hadForecast && (input.freshness === 'unavailable' || input.freshness === 'seasonal')) {
    push({
      kind: 'forecast_lost',
      headline: 'No live forecast for today',
      detail:
        input.freshness === 'seasonal'
          ? 'What is shown is the usual weather for this time of year, not a forecast. Your outfit has not been changed.'
          : 'Pack Smart could not reach the weather service. Your outfit has not been changed.',
      role: null,
      roleLabel: null,
      itemId: null,
      itemName: null,
      alternatives: [],
    })
    return out
  }

  if (!weather || input.freshness === 'seasonal') return out

  /* ---------------------------------------------------------------- */
  /* rain                                                              */
  /* ---------------------------------------------------------------- */

  if (weather.rainLikely && !worn.some((garment) => garment.keepsRainOff)) {
    const slot = slotFor(worn, LAYER_ROLES)
    const alternatives = optionsFor(options, null, (option) => option.keepsRainOff, worn)

    push({
      kind: 'rain',
      headline: 'Rain is likely and nothing in today’s outfit keeps it off',
      detail:
        alternatives.length > 0
          ? 'Your approved outfit has not changed. Swap one in for today only, or keep what you have.'
          : 'Nothing you packed is recorded as keeping rain off. Your approved outfit has not changed.',
      role: slot?.role ?? null,
      roleLabel: slot?.roleLabel ?? null,
      itemId: slot?.itemId ?? null,
      itemName: slot?.name ?? null,
      alternatives,
    })
  }

  /* ---------------------------------------------------------------- */
  /* temperature                                                       */
  /* ---------------------------------------------------------------- */

  const { max: warmestWorn, min: lightestWorn } = warmthWorn(worn)

  /*
   * Colder than the outfit covers.
   *
   * Measured at the coldest part of the day and against the WARMEST thing being
   * worn, because that garment is the outfit's answer to cold. A full band's gap
   * is the threshold, and a band is roughly eight degrees — so a forecast that
   * shifts by two says nothing, which is the point.
   */
  if (weather.tempMinC !== null && warmestWorn !== null) {
    const needed = warmthNeededFor(weather.tempMinC)
    if (needed > warmestWorn) {
      const slot = slotFor(worn, LAYER_ROLES)
      const alternatives = optionsFor(
        options,
        null,
        (option) => option.warmth !== null && option.warmth >= needed,
        worn,
      )

      push({
        kind: 'colder',
        headline: `Colder today than this outfit was planned for`,
        detail:
          alternatives.length > 0
            ? 'Your approved outfit has not changed. Add a warmer layer for today only, or keep what you have.'
            : 'Nothing warmer is in your bag. Your approved outfit has not changed.',
        role: slot?.role ?? null,
        roleLabel: slot?.roleLabel ?? null,
        itemId: slot?.itemId ?? null,
        itemName: slot?.name ?? null,
        alternatives,
      })
    }
  }

  /*
   * Hotter than the outfit covers.
   *
   * Against the LIGHTEST thing being worn: an outfit is too warm only when even
   * its lightest garment is heavier than the day needs. Measured at the warmest
   * part of the day, and only raised when something lighter is actually packed —
   * "you will be too hot and there is nothing to do about it" is a sentence with
   * no next action, which is the E1 defect wearing a weather hat.
   */
  if (weather.tempMaxC !== null && lightestWorn !== null) {
    const needed = warmthNeededFor(weather.tempMaxC)
    if (needed < lightestWorn) {
      const slot = slotFor(worn, LAYER_ROLES)
      const alternatives = optionsFor(
        options,
        slot?.role ?? null,
        (option) => option.warmth !== null && option.warmth <= needed,
        worn,
      )

      if (alternatives.length > 0) {
        push({
          kind: 'hotter',
          headline: 'Warmer today than this outfit was planned for',
          detail:
            'Your approved outfit has not changed. Swap something lighter in for today only, or keep what you have.',
          role: slot?.role ?? null,
          roleLabel: slot?.roleLabel ?? null,
          itemId: slot?.itemId ?? null,
          itemName: slot?.name ?? null,
          alternatives,
        })
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* wind                                                              */
  /* ---------------------------------------------------------------- */

  /*
   * Wind is a PREFERENCE, not a requirement — `weather-fit.ts` says so and this
   * inherits it. So it is raised only when something packed would genuinely
   * answer it. Being slightly cold in a breeze is not a problem worth a banner
   * Alex can do nothing about.
   */
  if (weather.windKph !== null && weather.windKph >= WIND_THRESHOLD_KPH) {
    if (!worn.some((garment) => garment.keepsWindOff)) {
      const alternatives = optionsFor(options, null, (option) => option.keepsWindOff, worn)
      if (alternatives.length > 0) {
        const slot = slotFor(worn, LAYER_ROLES)
        push({
          kind: 'wind',
          headline: 'Windy today, and nothing in this outfit is recorded for it',
          detail:
            'Your approved outfit has not changed. Swap one in for today only, or keep what you have.',
          role: slot?.role ?? null,
          roleLabel: slot?.roleLabel ?? null,
          itemId: slot?.itemId ?? null,
          itemName: slot?.name ?? null,
          alternatives,
        })
      }
    }
  }

  return out
}
