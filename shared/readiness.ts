import { dayOfPlan, isDepartureImminent } from './day-of'
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
export type ReadinessRoute =
  | 'trip'
  | 'checklist'
  | 'outfits'
  | 'today'
  | 'setup'
  /** The departure screen — doc 09 §12, and only within a day of leaving. */
  | 'day_of'
  /** The post-trip review — doc 09 §16, and only until it has been done (F1). */
  | 'review'

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

/**
 * One unresolved thing about this trip, in the words the screen will use.
 *
 * Deliberately just a sentence and a route. It is a REPORT — the summary answers
 * "what is left", and `next` answers "what to do now"; giving each issue its own
 * button would be four primary actions and the one obvious action gone.
 */
export interface ReadinessIssue {
  /** "1 bag issue", "2 outfits need attention". Counted, never a percentage. */
  label: string
  route: ReadinessRoute
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
  /**
   * "Am I basically ready?", answered in three or four words.
   *
   * `Ready` when nothing is outstanding, `Almost ready` when something is —
   * never a percentage. A percentage scores Alex against a total he never
   * agreed to; doc 09 §7 makes the same argument for the review queue's
   * position line, and it applies with more force to a trip.
   */
  summary: 'Ready' | 'Almost ready'
  /**
   * What is actually left, most material first. Empty on a ready trip.
   *
   * Every entry is COUNTED from an authoritative result computed elsewhere —
   * `coverageGaps` for what the wardrobe cannot cover, `bagProblems` for bag
   * safety, the outfit rows for what needs attention, `checklistProgress` for
   * what is unpacked. Nothing here re-derives a rule, which is the whole point:
   * when the swim rules change, this inherits the new truth without being
   * touched.
   */
  issues: ReadinessIssue[]
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
    because: 'A long flight is what adds the neck pillow and the compression socks.',
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
  /**
   * The plan is older than the days it plans for (P1B, migration 0024).
   *
   * Saving days no longer replans before it answers, so between naming days and
   * opening Outfits there is a moment where the groups do not exist yet and the
   * work plainly does. Without this, that moment reads as "no outfit work" and
   * the ladder skips a rung Alex has already asked for — which is what
   * happened to a trip created from a past trip's day plan.
   */
  outfitsStale?: boolean
  /** `YYYY-MM-DD`, passed in so this stays pure. */
  today: string
  /**
   * What this trip's wardrobe cannot cover, from `coverageGaps`.
   *
   * Passed in rather than computed, and that is the design rather than a
   * convenience: the swimwear, tank-top and sandals rules live in
   * `shared/essentials.ts` and `shared/outfits.ts`, and a readiness model that
   * restated any of them would be a second authority to keep in step. The trip
   * screen already receives this from the checklist GET.
   *
   * Optional, and absent means "not known yet" rather than "nothing wrong" —
   * which is why it contributes no issue when omitted instead of contributing a
   * reassuring zero.
   */
  coverage?: Array<{ message: string }>
  /**
   * Bag safety and crowding, from `bagProblems`. Same argument as `coverage`.
   */
  bagProblems?: Array<{ kind: string }>
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
 * How far away departure is, in words, and the only place that decides.
 *
 * Three screens each had their own version of this arithmetic and their own
 * wording — Home said "9 days to go", the Trips list said "9 days", and the
 * trip screen said neither. None of them was wrong; they were just three
 * copies, and three copies drift.
 *
 * Two registers rather than two functions: a list chip has room for "9 days"
 * and not for "9 days to go", so the phrasing differs on purpose while the FACT
 * cannot, because both come from one `daysBetween`. `readiness.test.ts` asserts
 * they agree about the same day.
 */
export function departureLabel(
  trip: { startDate: string; endDate: string; status: string },
  today: string,
  style: 'full' | 'short' = 'full',
): string {
  if (trip.status === 'completed' || daysBetween(today, trip.endDate) < 0) {
    return style === 'full' ? 'Trip finished' : 'Finished'
  }

  const days = daysBetween(today, trip.startDate)
  if (days > 1) return style === 'full' ? `${days} days to go` : `${days} days`
  if (days === 1) return style === 'full' ? 'Leaving tomorrow' : 'Tomorrow'
  if (days === 0) return style === 'full' ? 'Leaving today' : 'Today'
  return 'On the trip'
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
  const { trip, entries, outfits, outfitsStale, today } = input

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

  /*
   * What is left, counted from results computed elsewhere.
   *
   * Deliberately built once and spread into every return below, so it cannot
   * disagree with itself between two rungs of the ladder — and so adding a rung
   * later cannot forget it.
   *
   * The order is materiality: something unsafe, then something the wardrobe
   * cannot cover, then work outstanding. Each label counts rather than scores.
   */
  const issues: ReadinessIssue[] = []

  const bagIssues = (input.bagProblems ?? []).filter((problem) => problem.kind === 'no_safe_bag')
  if (bagIssues.length > 0) {
    issues.push({
      label: bagIssues.length === 1 ? '1 bag issue' : `${bagIssues.length} bag issues`,
      route: 'checklist',
    })
  }

  /*
   * Everything `coverageGaps` reports, whatever it happens to be about.
   *
   * Not filtered to swimwear, and not re-derived from it: this inherits the swim
   * companion rules, the passport check and anything added later without being
   * touched. A readiness model that named swimwear here would be a second
   * authority on a rule it does not own.
   */
  const gaps = input.coverage ?? []
  if (gaps.length > 0) {
    issues.push({
      label:
        gaps.length === 1
          ? '1 thing your wardrobe cannot cover'
          : `${gaps.length} things your wardrobe cannot cover`,
      route: 'checklist',
    })
  }

  const unresolvedGroups = outfits.filter((group) => group.status !== 'approved').length
  if (unresolvedGroups > 0) {
    issues.push({
      label:
        unresolvedGroups === 1 ? '1 outfit needs attention' : `${unresolvedGroups} outfits need attention`,
      route: 'outfits',
    })
  } else if (outfitsStale === true && trip.days.length > 0 && outfits.length === 0) {
    issues.push({ label: 'Outfits not planned yet', route: 'outfits' })
  }

  const leftToPack = progress ? progress.total - progress.packed : 0
  if (leftToPack > 0) {
    issues.push({
      label: leftToPack === 1 ? '1 thing left to pack' : `${leftToPack} things left to pack`,
      route: 'checklist',
    })
  }

  /*
   * Nothing about the CLOSET is here, and that is the rule rather than an
   * oversight. An unrated garment, an unanswered review question and an
   * unresolved duplicate are all facts about Alex's wardrobe, not about whether
   * this trip is packed — and a readiness model that waited for them would tell
   * him he is not ready for a trip he has finished packing.
   */
  const base = {
    progress: measured,
    openQuestions: questions,
    essentialsUrgent,
    summary: (issues.length === 0 ? 'Ready' : 'Almost ready') as 'Ready' | 'Almost ready',
    issues,
  }

  /* --- the trip is over ------------------------------------------- */

  if (trip.status === 'completed' || untilReturn < 0) {
    return {
      ...base,
      stage: 'finished',
      headline: departureLabel(trip, today),
      essentialsUrgent: false,
      /*
       * A trip that is over has nothing outstanding, whatever the list still
       * says. "3 things left to pack" on a trip Alex got back from is the model
       * reporting a fact about a row rather than about his life.
       */
      summary: 'Ready' as const,
      issues: [],
      /*
       * The one stage that used to have no recommended action, and F1 is what
       * fills it — once.
       *
       * `reviewedAt` rather than "are there any answers": a review Alex reads
       * with nothing to report is a complete review that leaves nothing behind,
       * and offering it again to the person who has already done it is how a
       * prompt teaches him to ignore it. After that this is genuinely `null`
       * again, because a finished, reviewed trip has nothing left to do.
       */
      next: trip.reviewedAt
        ? null
        : {
            label: 'Review the trip',
            detail: 'A few short questions, so the next list is closer.',
            route: 'review',
          },
    }
  }

  /* --- the trip has started --------------------------------------- */

  if (untilDeparture <= 0) {
    return {
      ...base,
      stage: 'underway',
      headline: departureLabel(trip, today),
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

  const headline = departureLabel(trip, today)

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
   *
   * **Or when a plan is owed** (P1B). Naming days IS asking for outfits, and
   * since the replan moved off that write there is a window where the asking
   * has happened and the groups do not exist yet. Silence there would be the
   * ladder skipping a rung rather than respecting a preference — so a trip with
   * days named and a plan behind them counts as one piece of outstanding work,
   * and the label says plan rather than review, because there is nothing to
   * review yet.
   */
  const owed = outfitsStale === true && trip.days.length > 0 && outfits.length === 0
  if (owed) {
    return {
      ...base,
      stage: 'outfits',
      headline,
      next: {
        label: 'Plan your outfits',
        detail: 'From the days you named. Approving an outfit adds what it needs to the packing list.',
        route: 'outfits',
      },
    }
  }

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
        /*
         * The departure screen once departure is close enough for it to be the
         * right screen, and the packing list before that (D4).
         *
         * The two answer the same sentence differently. A week out, "3 things to
         * grab" is a note about the list; on the morning it is the list, and the
         * checklist's other forty rows are in the way of it.
         */
        route: isDepartureImminent(untilDeparture) ? 'day_of' : 'checklist',
      },
    }
  }

  /*
   * Packed, confirmed — and still something to put ON.
   *
   * `wear` rows are not packed into anything, so nothing above notices them:
   * `isPacked` on a jacket assigned to Wearing it means "yes, I have it on",
   * which on the morning is the last thing left to be true. Saying "Ready to
   * go" while the coat is on its hook is the confident-but-wrong answer again.
   */
  if (isDepartureImminent(untilDeparture)) {
    const departure = dayOfPlan(entries)
    if (departure.remaining > 0) {
      return {
        ...base,
        stage: 'final_check',
        headline,
        next: {
          label: untilDeparture === 0 ? 'Leaving today' : 'Before you go',
          detail: `${departure.remaining} ${departure.remaining === 1 ? 'thing' : 'things'} left before you leave.`,
          route: 'day_of',
        },
      }
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
