import { checklistProgress, type ChecklistEntry } from './checklist'
import { needsFinalCheck } from './rules'
import { tripDays, type Trip } from './trips'

/**
 * One derived answer to "where is this trip up to, and what should I do next".
 *
 * The central gap doc 09 §2 names: every screen worked out its own version of
 * how far along a trip was, so Home could show a progress bar while the trip
 * screen led with outfits and neither agreed about what mattered most. This is
 * the single place that decides, and every surface reads it rather than
 * re-deriving it.
 *
 * Three properties, all of them load-bearing:
 *
 *   1. **Derived, never stored.** A stored readiness label needs something to
 *      keep it fresh, and the thing that keeps it fresh is what goes wrong —
 *      `tripStatusOn` already makes this argument for status and it applies
 *      with more force here, because readiness changes every time a row is
 *      packed. Doc 09 §4 permits persistence only where technically necessary,
 *      and nothing here is.
 *   2. **Exactly one next action.** Not a ranked list the screen picks from —
 *      then the screen is deciding, and two screens will decide differently.
 *      `next` is one action or none.
 *   3. **Pure.** No fetching, no clock. `today` is passed in, so a test can put
 *      a trip in any relationship to the present without waiting for it.
 */

/**
 * Where a trip is, in the order the journey actually happens.
 *
 * Deliberately not four permanent sections on a screen (doc 09 §6 rules that
 * out for necessities and the same reasoning applies here) — this is an
 * internal vocabulary that decides ONE sentence and ONE button.
 */
export type ReadinessStage =
  | 'no_dates'
  | 'nothing_planned'
  | 'questions'
  | 'outfits'
  | 'packing'
  | 'final_check'
  | 'ready'
  | 'underway'
  | 'finished'

/** Where the one recommended action leads. Named, so no screen builds a URL. */
export type ReadinessRoute = 'trip' | 'checklist' | 'outfits' | 'today' | 'setup'

export interface NextAction {
  /** What the button says. Short enough not to wrap at 360px. */
  label: string
  /** One sentence saying why, in Alex's words. Never a field name. */
  detail: string
  route: ReadinessRoute
}

/**
 * A trip fact worth asking about, because a rule cannot be decided without it.
 *
 * `fact` is the engine's own key, so a question and the condition it unblocks
 * cannot drift apart.
 */
export interface OpenQuestion {
  fact: string
  /** The question as Alex would hear it. */
  question: string
  /** What answering it changes — never "improves recommendations". */
  because: string
}

export interface Readiness {
  stage: ReadinessStage
  /** The state of the trip in three or four words. */
  headline: string
  /** The one thing to do next, or null when there is genuinely nothing. */
  next: NextAction | null
  /** Packing progress, or null before there is a list to measure. */
  progress: { packed: number; total: number } | null
  /** Unanswered facts that gate a real rule, most material first. */
  openQuestions: OpenQuestion[]
  /**
   * Whether an essentials warning is worth showing HERE.
   *
   * Doc 09 §4.1: essentials stay protected and visible where they are
   * actionable, and stop shouting on the calm summary screens. The judgement
   * lives with the model rather than in each screen's JSX, so "when is this
   * urgent" is answered once.
   */
  essentialsUrgent: boolean
}

/* ------------------------------------------------------------------ */
/* questions                                                           */
/* ------------------------------------------------------------------ */

/**
 * The facts worth one concise question, and what each one actually changes.
 *
 * Short on purpose, and every entry has to name a REAL consequence: doc 09 §5
 * asks only for questions that materially change recommendations, and a
 * question whose answer changes nothing is a form field wearing a question's
 * clothes.
 *
 * Each `fact` here is the key a seeded `conditional_include` compares against —
 * `tests/unit/worker/readiness.test.ts` asserts that, so this list cannot drift
 * into asking about facts no rule reads.
 */
const QUESTIONS: Array<OpenQuestion & { unanswered: (trip: Trip) => boolean }> = [
  {
    fact: 'international',
    question: 'Are you leaving the country?',
    because: 'Your passport is only packed on trips that need it.',
    unanswered: (trip) => trip.international === null,
  },
  {
    fact: 'flight_hours',
    question: 'How long is the longest flight?',
    because: 'A long flight is what adds the neck pillow and the seat cushion.',
    unanswered: (trip) => trip.flightHours === null,
  },
  {
    fact: 'laundry_available',
    question: 'Will you have laundry?',
    because: 'Laundry changes how much you need to take.',
    unanswered: (trip) => trip.laundryAvailable === null,
  },
]

/**
 * What this trip has not said yet, in the order worth asking.
 *
 * Order is the declaration order above rather than anything computed: doc 09 §5
 * wants one concise question at a time, and "which one first" is a judgement
 * about what changes the most, not a sort key.
 */
export function openQuestions(trip: Trip): OpenQuestion[] {
  return QUESTIONS.filter((q) => q.unanswered(trip)).map(({ fact, question, because }) => ({
    fact,
    question,
    because,
  }))
}

/* ------------------------------------------------------------------ */
/* readiness                                                           */
/* ------------------------------------------------------------------ */

export interface ReadinessInput {
  trip: Trip
  /** Every checklist row for the trip, including excluded ones. */
  entries: ChecklistEntry[]
  /** Outfit groups, by status. Empty when outfits have not been planned. */
  outfits: Array<{ status: 'draft' | 'approved' | 'incomplete' }>
  /** `YYYY-MM-DD`, passed in so this stays pure. */
  today: string
}

/**
 * Today, as the engine spells dates.
 *
 * Here rather than in a screen, because two screens computing "today" for
 * themselves is the same duplication this module exists to end — and a
 * disagreement about the date is a disagreement about the whole readiness
 * answer.
 */
export function todayISO(now: Date = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
}

/** Whole days from today to a date. Negative once it has passed. */
export function daysBetween(today: string, date: string): number {
  const from = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)))
  const to = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  return Math.round((to - from) / 86_400_000)
}

/**
 * How close departure has to be before an unpacked essential is urgent.
 *
 * Three days, and the number is the whole of doc 09 §4.1's "escalate only when
 * timely and actionable". A fortnight out, an unpacked passport is not a
 * problem — it is a trip that has not been packed yet, and saying so in red
 * every time Alex opens the app is how he learns to ignore the one that matters
 * on the morning of the flight.
 */
const URGENT_WITHIN_DAYS = 3

export function readiness(input: ReadinessInput): Readiness {
  const { trip, entries, outfits, today } = input

  const untilDeparture = daysBetween(today, trip.startDate)
  const untilReturn = daysBetween(today, trip.endDate)
  const bringing = entries.filter((e) => e.excludedAt === null)
  const progress = bringing.length > 0 ? checklistProgress(entries) : null
  const questions = openQuestions(trip)

  const measured = progress ? { packed: progress.packed, total: progress.total } : null

  /*
   * Essentials are urgent when they are actionable, not whenever they exist.
   *
   * Close to departure, or already underway, or nearly finished packing — the
   * three moments where "you have not packed your passport" is a fact Alex can
   * do something about right now. Everywhere else the progress line already
   * says the trip is not packed, and a second, louder way of saying it is the
   * alarm fatigue doc 06 §3 rules out.
   */
  const essentialsOutstanding = progress ? progress.criticalOutstanding.length : 0
  const nearlyDone = progress !== null && progress.total > 0 && progress.packed / progress.total >= 0.8
  const essentialsUrgent =
    essentialsOutstanding > 0 && (untilDeparture <= URGENT_WITHIN_DAYS || nearlyDone)

  const base = { progress: measured, openQuestions: questions, essentialsUrgent }

  /* --- the trip is over ------------------------------------------- */

  if (trip.status === 'completed' || untilReturn < 0) {
    return {
      ...base,
      stage: 'finished',
      headline: 'Trip finished',
      essentialsUrgent: false,
      next: null,
    }
  }

  /* --- the trip has started --------------------------------------- */

  if (untilDeparture <= 0) {
    return {
      ...base,
      stage: 'underway',
      headline: untilDeparture === 0 ? 'Leaving today' : 'On the trip',
      next: {
        label: "Today's outfit",
        detail: 'What to wear, and what to carry today.',
        route: 'today',
      },
    }
  }

  /* --- before departure -------------------------------------------- */

  if (!trip.startDate || !trip.endDate) {
    return {
      ...base,
      stage: 'no_dates',
      headline: 'Dates needed',
      next: {
        label: 'Add the dates',
        detail: 'How many days you are away decides how much of everything you need.',
        route: 'setup',
      },
    }
  }

  const headline = untilDeparture === 1 ? 'Leaving tomorrow' : `${untilDeparture} days to go`

  /*
   * Nothing generated yet.
   *
   * First, because every other stage is a judgement about a list that does not
   * exist. Questions come second even though the journey asks them earlier —
   * doc 09 §5 says a question must be deferrable without blocking, and blocking
   * the list on them would make them mandatory in the only way that counts.
   */
  if (bringing.length === 0) {
    return {
      ...base,
      stage: 'nothing_planned',
      headline,
      next: {
        label: 'Build the packing list',
        detail: 'Pack Smart works out what you need from your own things.',
        route: 'trip',
      },
    }
  }

  /*
   * A question that would change the list, asked while there is still time to
   * act on the answer.
   *
   * Ahead of outfits and packing because answering one can ADD to the list, and
   * finding that out after packing is the wasted work the readiness model exists
   * to prevent. Never in the last three days: at that point a question is an
   * interruption, and the list Alex has is the list he is taking.
   */
  if (questions.length > 0 && untilDeparture > URGENT_WITHIN_DAYS) {
    const first = questions[0]!
    return {
      ...base,
      stage: 'questions',
      headline,
      next: {
        label: questions.length === 1 ? 'Answer one question' : `Answer ${questions.length} questions`,
        detail: first.because,
        route: 'setup',
      },
    }
  }

  /*
   * Outfits that are planned but unresolved.
   *
   * Only when some group exists: a trip with no outfits planned at all is not
   * "outfits outstanding", it is a trip Alex may not want outfits for, and
   * inventing that need would be the app deciding his taste for him.
   */
  const unresolvedOutfits = outfits.filter((g) => g.status !== 'approved').length
  if (unresolvedOutfits > 0) {
    return {
      ...base,
      stage: 'outfits',
      headline,
      next: {
        label: unresolvedOutfits === 1 ? 'Review one outfit' : `Review ${unresolvedOutfits} outfits`,
        detail: 'Approving an outfit adds what it needs to the packing list.',
        route: 'outfits',
      },
    }
  }

  const outstanding = progress ? progress.total - progress.packed : 0

  if (outstanding > 0) {
    /*
     * Essentials lead only when they are the actionable thing. Far from
     * departure this is the ordinary "keep packing" case, and the essentials
     * line stays where the packing list can act on it.
     */
    const leadWithEssentials = essentialsUrgent
    return {
      ...base,
      stage: 'packing',
      headline,
      next: {
        label: leadWithEssentials ? 'Pack the essentials' : 'Keep packing',
        detail: leadWithEssentials
          ? `${essentialsOutstanding} ${essentialsOutstanding === 1 ? 'essential is' : 'essentials are'} still to pack.`
          : `${outstanding} ${outstanding === 1 ? 'thing' : 'things'} still to pack.`,
        route: 'checklist',
      },
    }
  }

  /*
   * Everything is packed except the things that cannot be packed early.
   *
   * A separate stage rather than "ready", because a toothbrush that is still in
   * the bathroom is not the same as a bag that is finished — and telling Alex
   * he is ready when he is not is exactly the confident-but-wrong behaviour
   * doc 09 §25 forbids.
   */
  const finalCheckOutstanding = bringing.filter(needsFinalCheck).length
  if (finalCheckOutstanding > 0) {
    return {
      ...base,
      stage: 'final_check',
      headline,
      next: {
        label: 'Final check',
        detail: `${finalCheckOutstanding} ${finalCheckOutstanding === 1 ? 'thing' : 'things'} to grab before you go.`,
        route: 'checklist',
      },
    }
  }

  return {
    ...base,
    stage: 'ready',
    headline: untilDeparture === 1 ? 'Ready — leaving tomorrow' : 'Ready to go',
    next: null,
  }
}

/**
 * How long the trip is, for a screen that wants to say it.
 *
 * Re-exported rather than reimplemented: two definitions of "how many days" is
 * how a 12-day trip becomes an 11-day one on the screen next door.
 */
export { tripDays }
