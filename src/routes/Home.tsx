import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomSheet } from '@/components/BottomSheet'
import { ColorDots } from '@/components/ColorDots'
import { EmptyState, Screen } from '@/components/Screen'
import { TripSheet } from '@/components/TripSheet'
import { routeFor } from '@/lib/readinessRoute'
import { recall, remember } from '@/lib/sessionCache'
import {
  fetchChecklist,
  fetchOutfits,
  fetchToday,
  fetchTrips,
  fetchWeather,
  type TodayResponse,
  type TripWeather,
} from '@/lib/trips'
import { formatDateRange, TripRow } from '@/routes/Trips'
import { progressLabel } from '@shared/checklist'
import { homeHero, type Hero } from '@shared/home'
import { daysBetween, readiness, todayISO, type Readiness } from '@shared/readiness'
import { tripDays, type Trip } from '@shared/trips'
import './Home.css'

/**
 * Home is the trip you are actually working on, and what today is.
 *
 * Product doc 02 §3: opening the app during a trip should land on that trip's
 * state rather than a dashboard. The soonest trip that has not finished is the
 * one Alex means, so it is chosen for him instead of presented as a menu.
 *
 * Two things on the screen, and only two:
 *
 *   - **One adaptive hero** — what today is, and what is happening in it. It
 *     changes shape between a trip that has not started and one that is
 *     underway, because those are different questions; see `@shared/home`.
 *   - **One trip card** — the trip, its progress, and everything Alex does to
 *     it. The two frequent actions are in the card; the infrequent ones are
 *     behind the `•••`.
 *
 * Anything that would be a third block has to justify itself against the fact
 * that a stack of unrelated cards is exactly what this screen is not.
 */
/**
 * Everything Home shows, as one value it can be handed back later.
 *
 * `ready` and `hero` are separate from the rest because they arrive a whole
 * round trip later — see the two-stage note on `load` below.
 */
interface HomeSnapshot {
  trip: Trip | null
  others: Trip[]
  recent: Trip[]
  /** How many trips exist that Home is not showing. Decides `All trips` (§2). */
  more: number
  ready: Readiness | null
  hero: Hero | null
}

const SNAPSHOT_KEY = 'home'

export default function Home() {
  const navigate = useNavigate()
  /*
   * What Home knew last time, painted on the first render (P1c).
   *
   * `undefined` means this tab has not been opened yet this session and there
   * is genuinely nothing to show; a snapshot means paint it now and refresh
   * behind it. Either way `load` runs — nothing here skips a request.
   */
  const cached = recall<HomeSnapshot>(SNAPSHOT_KEY)
  const [trip, setTrip] = useState<Trip | null>(cached?.trip ?? null)
  /*
   * One derived answer, not four screens' worth of arithmetic.
   *
   * Home used to work out its own countdown, its own progress, and its own
   * view of whether an essential was worth shouting about — and the trip screen
   * worked out a different one. `@shared/readiness` decides once and every
   * surface reads it (doc 09 §4).
   */
  const [ready, setReady] = useState<Readiness | null>(cached?.ready ?? null)
  /*
   * And one derived answer for the hero, for the same reason.
   *
   * Home could work out "is there an outfit for today, and is the forecast
   * arguing with it" in its own JSX. It would then be a second opinion about
   * facts the Today screen already has an authority for, and the two would
   * drift. `homeHero` decides; this renders.
   */
  const [hero, setHero] = useState<Hero | null>(cached?.hero ?? null)
  /*
   * Everything else Alex has planned or taken.
   *
   * Doc 02 §4 asks Home for the featured trip AND "upcoming trips, New Trip,
   * recent trips" beneath it.
   */
  const [others, setOthers] = useState<Trip[]>(cached?.others ?? [])
  const [recent, setRecent] = useState<Trip[]>(cached?.recent ?? [])
  /*
   * The trips Home has no room for, counted rather than assumed (§2).
   *
   * `All trips` used to render whenever Home was populated — so on a database
   * holding exactly one trip it was a door onto the screen Alex was already
   * looking at, with the same single row on it.
   */
  const [more, setMore] = useState(cached?.more ?? 0)
  /** The trip sheet, in both its jobs: a new trip, or this one being edited. */
  const [sheet, setSheet] = useState<'new' | 'edit' | null>(null)
  /** The `•••`, which is where the infrequent trip actions live (§16). */
  const [moreOpen, setMoreOpen] = useState(false)
  /*
   * TWO stages, because they are two round trips apart.
   *
   * `trips` is which trip Alex is on and what it is called. `ready` and `hero`
   * are the countdown, the progress, the recommended action and the day — and
   * none of them can even be ASKED for until `trips` has answered, because they
   * are fetched by trip id. Holding the whole screen back for the second one,
   * which is what a single `loading` flag did, meant Home showed an empty frame
   * for two round trips when it could have shown the trip after one.
   *
   * `waiting` never reappears once a snapshot has been painted: a screen that
   * has an answer must not flash back to a skeleton while it refreshes.
   */
  const [tripsState, setTripsState] = useState<'waiting' | 'ready'>(
    cached ? 'ready' : 'waiting',
  )
  const [readyState, setReadyState] = useState<'waiting' | 'settled'>(
    cached?.ready ? 'settled' : 'waiting',
  )

  /*
   * One loader, called on mount and again after an edit.
   *
   * Editing the trip from the `•••` changes its name, its dates and — through
   * the replan the save runs — its checklist and its outfits, which is every
   * input the card and the hero are built from. Refetching is how the screen
   * stays true; the alternative, patching the trip into state and leaving the
   * rest, is how a card ends up showing new dates against the old countdown.
   */
  const load = useCallback(async (signal: { cancelled: boolean }) => {
    const cancelled = () => signal.cancelled
    try {
      const { trips } = await fetchTrips()
      const today = todayISO()
      /*
       * Archived first, before anything else is decided.
       *
       * A trip Alex has put away must not come back as the FEATURED one just
       * because its dates have not passed — that would make archiving look
       * broken on the screen he opens most.
       */
      const active = trips.filter((t) => !t.archivedAt)
      const live = active
        .filter((t) => t.status !== 'completed' && daysBetween(today, t.endDate) >= 0)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
      const next = live[0] ?? null

      if (cancelled()) return
      setTrip(next)
      // The trip is on screen now, one round trip in. Everything below is
      // the second one.
      setTripsState('ready')
      /*
       * Three, not all of them. Home is the trip Alex is working on (doc 02
       * §3); the section beneath it is context, and context that scrolls is a
       * second Trips screen.
       */
      setOthers(live.slice(1, 4))
      /*
       * Most recently finished first. A finished trip is on Home to be reused,
       * and the one Alex just took is the one worth reusing.
       */
      const nextRecent = active
        .filter((t) => t.status === 'completed' || daysBetween(today, t.endDate) < 0)
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .slice(0, 2)
      setRecent(nextRecent)

      const nextOthers = live.slice(1, 4)
      const shown = (next ? 1 : 0) + nextOthers.length + nextRecent.length
      const nextMore = Math.max(0, trips.length - shown)
      setMore(nextMore)

      if (!next) {
        // Nothing to be ready ABOUT, so the second stage is already over. The
        // hero still has a date to give, which is the whole of §29's "date
        // hero if useful" on a database with no trips in it.
        const emptyHero = heroNow({
          trip: null,
          ready: null,
          today: null,
          weather: null,
          groups: [],
        })
        setReady(null)
        setHero(emptyHero)
        setReadyState('settled')
        remember<HomeSnapshot>(SNAPSHOT_KEY, {
          trip: null,
          others: nextOthers,
          recent: nextRecent,
          more: nextMore,
          ready: null,
          hero: emptyHero,
        })
      }

      if (next) {
        /*
         * The second rung, and it is one rung wide however much is on it.
         *
         * Four requests at most and never in a chain: the checklist and the
         * outfits feed `readiness`, and the fourth is whichever half of the
         * hero this trip needs — the day's briefing once the trip has started,
         * the stored forecast before it. `tests/e2e/performance.spec.ts` holds
         * Home to a two-deep waterfall and to no duplicate request, which is
         * what stops this growing a request per hero line (§39).
         *
         * The day's briefing is not fetched before departure, because there is
         * no day to brief: `Today` would answer about the first day of the
         * trip, which is not today, and a hero built on that would say Alex is
         * somewhere he is not.
         */
        const underway = daysBetween(today, next.startDate) <= 0
        const [checklist, outfits, briefing, weather] = await Promise.all([
          fetchChecklist(next.id),
          fetchOutfits(next.id).catch(() => ({ groups: [], stale: false, changes: [] })),
          underway ? fetchToday(next.id).catch(() => null) : Promise.resolve(null),
          underway ? Promise.resolve(null) : fetchWeather(next.id).catch(() => null),
        ])

        if (!cancelled()) {
          const nextReady = readiness({
            trip: next,
            entries: checklist.entries,
            outfits: outfits.groups,
            outfitsStale: outfits.stale,
            today,
            /*
             * Handed over rather than re-derived, exactly as the trip screen
             * does it. Home and the trip screen counted different numbers of
             * unresolved things until this line existed, because only one of
             * them was passing the coverage the checklist already returns.
             */
            coverage: checklist.coverage,
          })
          const nextHero = heroNow({
            trip: next,
            ready: nextReady,
            today: briefing,
            weather,
            groups: outfits.groups,
          })
          setReady(nextReady)
          setHero(nextHero)
          setReadyState('settled')
          remember<HomeSnapshot>(SNAPSHOT_KEY, {
            trip: next,
            others: nextOthers,
            recent: nextRecent,
            more: nextMore,
            ready: nextReady,
            hero: nextHero,
          })
        }
      }
    } catch {
      /*
       * Home stays quiet on failure; Trips reports it properly.
       *
       * Both stages settle regardless, so a screen that cannot load does not
       * sit on a skeleton for ever. Nothing is remembered: a failed load must
       * not be handed back as a snapshot.
       */
      if (!cancelled()) {
        setTripsState('ready')
        setReadyState('settled')
      }
    }
  }, [])

  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => {
      signal.cancelled = true
    }
  }, [load])

  // The first round trip has not answered yet and there is no snapshot to
  // paint. Nothing is known, so nothing is claimed.
  if (tripsState === 'waiting') return <Screen title="Pack Smart" />

  if (!trip) {
    return (
      <Screen title="Pack Smart" action={{ label: 'Plan a Trip', onClick: () => setSheet('new') }}>
        {/*
          * The date, and then the sentence that explains the screen (§29).
          *
          * No trip card skeleton, and no empty sections. What is left is a real
          * empty state with one action in it — which is `Plan a Trip`, the same
          * action the toolbar's `+` already carries, so the two agree.
          */}
        {hero ? <HomeHero hero={hero} /> : null}
        <EmptyState
          title="No trips yet"
          body="Tell Pack Smart where you are going and when. It builds the packing list from what you already own."
          action={{ label: 'Plan a Trip', onClick: () => setSheet('new') }}
        />
        <TripSheet
          open={sheet !== null}
          trip={null}
          template={null}
          onClose={() => setSheet(null)}
          onSaved={(saved) => navigate(`/trips/${saved.id}`)}
        />
      </Screen>
    )
  }

  const progress = ready?.progress ?? null
  const percent = progress && progress.total > 0 ? (progress.packed / progress.total) * 100 : 0

  /*
   * Where the card goes, and what the one button does, both come from the same
   * derived state.
   *
   * Once the trip has started the app's job changes from "help me pack" to
   * "what do I wear today" (doc 04 §11) — but Home no longer works that out for
   * itself, because it and the trip screen disagreed about the boundary. The
   * readiness model owns it.
   */
  const underway = ready?.stage === 'underway'
  const destination = underway ? `/trips/${trip.id}/today` : `/trips/${trip.id}`

  const primaryRoute = ready?.next?.route ?? 'trip'
  /*
   * The other door, and never the same one as the recommendation.
   *
   * `Keep packing` and `Outfits` are the pair the trip card is asked for, and in
   * the ordinary case that is exactly what these two say. What keeps them
   * honest is that the LEFT one is derived: on a trip whose outfits are all
   * waiting for review it reads `Review 2 outfits`, which is more useful than
   * `Keep packing` and is why the readiness model exists (doc 09 §4). When it
   * does, this becomes the packing list rather than a second door onto the
   * outfits — two controls with one destination is `VISUAL_ACCEPTANCE.md` §2's
   * competing actions.
   */
  const alternate =
    primaryRoute === 'outfits' || primaryRoute === 'today'
      ? { label: 'Packing list', path: `/trips/${trip.id}` }
      : { label: 'Outfits', path: `/trips/${trip.id}/outfits` }

  return (
    <Screen
      title="Pack Smart"
      /*
       * Planning a trip is the screen's Add, which the bottom toolbar's centre
       * control invokes. It costs no vertical space here at all.
       */
      action={{
        label: 'Plan a Trip',
        onClick: () => setSheet('new'),
      }}
    >
      {hero ? <HomeHero hero={hero} /> : <HeroPlaceholder />}

      {/*
        * ONE object, not a card with two buttons floating underneath it.
        *
        * `Keep packing` and `Outfits` used to sit outside the card, separated
        * from the trip they act on by the card's own bottom margin — so the
        * screen read as a trip, then a menu. They are inside the border now, and
        * the border is the whole of what makes this a trip command centre rather
        * than three things that happen to be adjacent.
        *
        * A `section` with a button inside it rather than one big button: a
        * button cannot contain buttons, and the actions have to be real controls.
        * The trip itself is still one tap on the part of the card that carries
        * the trip.
        */}
      <section className="home-trip" aria-label={trip.name}>
        <div className="home-trip-top">
          <button
            type="button"
            className="home-card"
            onClick={() => navigate(destination)}
          >
            {/*
              * The countdown arrives a round trip after the trip's name does, so
              * this holds its line rather than letting the name jump upwards when
              * it lands. A blank line of the right height, not a spinner — the wait
              * is usually under 100ms and a spinner that flashes is noise (P1c).
              */}
            {ready ? (
              <span className="home-countdown">{ready.headline}</span>
            ) : (
              <span className="home-countdown home-pending" aria-hidden="true" />
            )}
            <span className="home-trip-name">
              <span className="trip-emoji" aria-hidden="true">{trip.emoji}</span>
              {trip.name}
            </span>
            <span className="home-dates">
              {formatDateRange(trip.startDate, trip.endDate)} ·{' '}
              {tripDays(trip.startDate, trip.endDate)} days
            </span>
          </button>

          {/*
            * Common actions visible, uncommon actions tucked away (§16).
            *
            * Top right of the card rather than in the action row: the row is for
            * the two things Alex does on most visits, and a third control beside
            * them would make the pair look like a set of three. Editing a trip
            * happens once or twice in its life.
            */}
          <button
            type="button"
            className="home-trip-more"
            aria-label="More for this trip"
            aria-haspopup="dialog"
            onClick={() => setMoreOpen(true)}
          >
            <span aria-hidden="true">•••</span>
          </button>
        </div>

        {/*
          * The progress pair, and the space it will need before it has it.
          *
          * Reserved while readiness is still out, because otherwise the card
          * grew by about a hundred pixels when it landed and pushed everything
          * below it down the screen — a jump on the screen the app opens on.
          *
          * An underway trip has no bar: during a trip the packing is done and
          * the hero above is about the day, so a bar here would be a fact about
          * last week competing with today.
          */}
        {readyState === 'waiting' ? (
          <span className="home-progress-row" aria-hidden="true">
            <span className="progress-track home-track home-pending" />
            <span className="home-progress home-pending home-pending-line" />
          </span>
        ) : underway ? null : progress ? (
          <span className="home-progress-row">
            <span className="progress-track home-track">
              <span className="progress-fill" style={{ width: `${percent}%` }} />
            </span>
            <span className="home-progress">{progressLabel(progress)}</span>
          </span>
        ) : null}

        {/*
          * The two frequent actions, side by side, inside the card (§15).
          *
          * The left one is derived rather than fixed — see `alternate` above for
          * why that matters and how the two are kept from meaning the same
          * thing. While readiness is still in flight the button is present,
          * sized and INERT: a primary action that changes what it says under
          * Alex's thumb is worse than one that is briefly unavailable.
          */}
        <div className="home-trip-actions">
          {ready?.next || readyState === 'settled' ? (
            <button
              type="button"
              className="button-primary home-primary"
              onClick={() => navigate(routeFor(trip.id, ready?.next?.route ?? 'trip'))}
            >
              {ready?.next?.label ?? 'Packing list'}
            </button>
          ) : (
            <button
              type="button"
              className="button-primary home-primary home-pending"
              disabled
              aria-busy="true"
              aria-label="Working out what to do next"
            />
          )}

          <button
            type="button"
            className="button-secondary home-alternate"
            onClick={() => navigate(alternate.path)}
          >
            {alternate.label}
          </button>
        </div>

        {/*
          * Why, under the what — and never while the hero is already saying it.
          *
          * A button reading `Review 2 outfits` is only obvious if Alex knows
          * what approving one does, so the model returns one quiet sentence
          * where the label is not the whole answer. During a trip it does not:
          * the recommendation is `Today's outfit`, its detail is "what to wear
          * and what to carry today", and the hero directly above has just listed
          * the clothes. Saying it again would be §21's repeated copy.
          */}
        {ready?.next?.detail && !underway ? (
          <p className="home-why">{ready.next.detail}</p>
        ) : null}
      </section>

      {/* Doc 02 §4, in its order: upcoming trips, recent trips. Planning a new
          one is the toolbar's `+`, which costs no vertical space here. */}
      {others.length > 0 ? (
        <section className="home-section">
          <h2 className="section-heading">Also coming up</h2>
          <ul className="trip-list row-list">
            {others.map((other) => (
              <li key={other.id} className="trip-item">
                <TripRow trip={other} onOpen={(t) => navigate(`/trips/${t.id}`)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className="home-section">
          <h2 className="section-heading">Recent trips</h2>
          <ul className="trip-list row-list">
            {recent.map((old) => (
              <li key={old.id} className="trip-item">
                <TripRow trip={old} onOpen={(t) => navigate(`/trips/${t.id}`)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        * Only when there is something else to see (§2). The count says so rather
        * than the screen assuming it.
        */}
      {more > 0 ? (
        <button
          type="button"
          className="button-quiet home-all-trips"
          onClick={() => navigate('/trips')}
        >
          All trips
        </button>
      ) : null}

      {/*
        * The infrequent half of the trip's actions.
        *
        * A bottom sheet rather than a floating menu, because that is the
        * product's one disclosure surface and doc 02 prefers it to a
        * desktop-style popover. Nothing new lives in here: `Edit trip` opens the
        * same sheet the trip screen opens, and `Trip setup` opens the same
        * disclosure — the itinerary, the days, the bags, archiving and deleting
        * are all still on the trip, where they can be seen in context.
        */}
      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title={trip.name}>
        <div className="form">
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setMoreOpen(false)
              setSheet('edit')
            }}
          >
            Edit trip
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => navigate(`/trips/${trip.id}?setup=1`)}
          >
            Trip setup
          </button>
          <p className="hint">
            The itinerary, the days, the bags and archiving all live on the trip itself.
          </p>
        </div>
      </BottomSheet>

      {/*
        * One sheet, two jobs, and never both at once.
        *
        * `trip` decides which — `TripSheet` titles itself `New trip` or `Edit
        * trip` from exactly that — so a single mounted sheet cannot end up
        * stacked on the menu that opened it.
        */}
      <TripSheet
        open={sheet !== null}
        trip={sheet === 'edit' ? trip : null}
        template={null}
        onClose={() => setSheet(null)}
        onSaved={(saved) => {
          setSheet(null)
          /*
           * A new trip is somewhere to GO; an edit is something to redraw.
           *
           * Editing from Home has to leave Alex on Home — he opened a menu on a
           * card, not a door to another screen — so the screen refetches instead
           * of navigating. Everything the card and the hero show can have moved.
           */
          if (saved.id !== trip.id) navigate(`/trips/${saved.id}`)
          else void load({ cancelled: false })
        }}
      />
    </Screen>
  )
}

/**
 * The hero, built from whatever the second round trip brought back.
 *
 * A wrapper rather than a call at each site, so `homeHero`'s inputs — the
 * clock in particular — are assembled in exactly one place. The clock is read
 * HERE and passed in, which is what keeps `@shared/home` pure and testable at
 * five in the afternoon on a Tuesday in March.
 */
function heroNow(input: {
  trip: Trip | null
  ready: Readiness | null
  today: TodayResponse | null
  weather: TripWeather | null
  groups: Array<{ name: string; status: string; reviewReason: string | null }>
}): Hero {
  const now = new Date()

  return homeHero({
    trip: input.trip,
    readiness: input.ready,
    today: input.today
      ? {
          todayDate: input.today.todayDate,
          place: input.today.place,
          weather: input.today.weather,
          freshness: input.today.freshness,
          weatherFetchedAt: input.today.weatherFetchedAt,
          conflicts: input.today.conflicts,
          plans: (input.today.plans ?? [input.today.plan]).map((plan) => ({
            groupName: plan.groupName,
            wear: plan.wear.map((item) => ({
              itemId: item.itemId,
              name: item.name,
              color: item.color ?? null,
            })),
            missingCount: plan.missing.length,
          })),
          tomorrow: input.today.tomorrow ?? null,
        }
      : null,
    tripWeather: input.weather ? { days: input.weather.days } : null,
    outfitGroups: input.groups,
    localDate: todayISO(now),
    now: Math.floor(now.getTime() / 1000),
    hour: now.getHours(),
  })
}

/**
 * The hero's own place in the layout, held before it has anything to say.
 *
 * One line, at the height the date will be. Everything else in the hero is
 * genuinely conditional, so reserving room for it would leave a hole on every
 * trip that has none — but the date is always there, and letting it appear from
 * nothing pushes the trip card down at the moment Alex is looking at it.
 */
function HeroPlaceholder() {
  return (
    <div className="hero" aria-hidden="true">
      <p className="hero-date">
        <span className="hero-day home-pending home-pending-line" />
      </p>
    </div>
  )
}

/**
 * What today is, above the trip.
 *
 * ## Why nothing in here is a control
 *
 * Every line below is a statement, and that is deliberate rather than an
 * omission. Three reasons, in the order they decided it:
 *
 *   1. **The actions are two inches lower.** Everything this block names is
 *      reachable from the trip card immediately beneath — the outfit and the
 *      weather conflict through `Today's outfit`, the outstanding work through
 *      the recommendation. A hero full of buttons pointing at the same two
 *      screens would be the competing actions `VISUAL_ACCEPTANCE.md` §2 rejects.
 *   2. **A control is 44px tall.** Six tappable lines is 264px of hero before
 *      any content, and the trip card would be off the bottom of a 664px
 *      viewport. Statements cost 20px each, which is what lets a real briefing —
 *      a place, a date, a forecast, a consequence and two outfits — sit above
 *      the card rather than instead of it.
 *   3. **Home summarises; the other screens are the product.** Doc 02 §3 is
 *      explicit that Home is not a dashboard, and a dashboard is precisely a
 *      screen that grows its own controls for other screens' jobs.
 */
function HomeHero({ hero }: { hero: Hero }) {
  const empty =
    !hero.place &&
    !hero.weather &&
    !hero.consequence &&
    hero.outfits.length === 0 &&
    hero.agenda.length === 0 &&
    !hero.nextThing &&
    !hero.insight &&
    !hero.tomorrow

  return (
    <div className={`hero ${empty ? 'is-bare' : ''}`}>
      {/*
        * Where, then when — and the where only while Alex is there.
        *
        * `role="status"` because it is the sentence that changes when the trip
        * starts, and the change is the thing worth announcing.
        */}
      {hero.place ? (
        <p className="hero-place" role="status">
          Today in {hero.place}
        </p>
      ) : null}

      <p className="hero-date">
        <span className="hero-day">{hero.dateLabel}</span>
        {/*
          * The forecast on the date's own line while it is about TODAY, and on
          * its own line when it is about somewhere Alex has not gone yet — where
          * it needs the destination's name in front of it or it reads as the sky
          * out of the window.
          */}
        {hero.weather && !hero.weatherPlace ? (
          <span className="hero-weather">{hero.weather}</span>
        ) : null}
      </p>

      {hero.weather && hero.weatherPlace ? (
        <p className="hero-forecast">
          <span className="hero-forecast-place">{hero.weatherPlace}</span>
          <span className="hero-weather">{hero.weather}</span>
        </p>
      ) : null}

      {/* Where the numbers came from, when that could change how they are read. */}
      {hero.weatherNote ? <p className="hero-note">{hero.weatherNote}</p> : null}

      {/*
        * The one consequence, and only when the forecast argues with the plan.
        *
        * `weatherConflicts` decides; this repeats its first sentence. Nothing is
        * generated here, and nothing is acted on — the approved outfit is
        * untouched until Alex answers it on Today (doc 04 §12).
        */}
      {hero.consequence ? <p className="hero-consequence">{hero.consequence}</p> : null}

      {hero.outfits.length > 0 ? (
        <ul className="hero-outfits">
          {hero.outfits.map((outfit, index) => (
            <li className="hero-outfit" key={`${outfit.title ?? 'outfit'}-${index}`}>
              {outfit.title ? <p className="hero-outfit-title">{outfit.title}</p> : null}
              {outfit.garments.length > 0 ? (
                <p className="hero-garments">
                  {outfit.garments.map((garment) => (
                    <span className="hero-garment" key={garment.itemId}>
                      <ColorDots color={garment.color} className="hero-dot" />
                      {garment.name}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="hero-outfit-note">{outfit.note}</p>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        * What else is in the day that no outfit above already names.
        *
        * No times: `trip_event` can hold one and nothing Alex enters supplies
        * one, so printing `10:00 Beach` would be the screen inventing a fact.
        * The order is the order he arranged them in, which is a fact he gave.
        */}
      {hero.agenda.length > 0 ? (
        <p className="hero-agenda">
          Also today · {hero.agenda.join(' · ')}
          {hero.agendaMore > 0 ? ` · +${hero.agendaMore} more` : ''}
        </p>
      ) : null}

      {hero.nextThing ? <p className="hero-next">{hero.nextThing.label}</p> : null}

      {/*
        * What a replan noticed, in its own words. Rare by construction: the
        * sentence exists only while an approved outfit has something wrong with
        * it, and it is cleared the moment that stops being true.
        */}
      {hero.insight ? <p className="hero-insight">{hero.insight}</p> : null}

      {hero.tomorrow ? <p className="hero-tomorrow">{hero.tomorrow}</p> : null}
    </div>
  )
}
