import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, Screen } from '@/components/Screen'
import { TripSheet } from '@/components/TripSheet'
import { routeFor } from '@/lib/readinessRoute'
import { recall, remember } from '@/lib/sessionCache'
import { fetchChecklist, fetchOutfits, fetchTrips } from '@/lib/trips'
import { formatDateRange, TripRow } from '@/routes/Trips'
import { progressLabel } from '@shared/checklist'
import { readiness, todayISO, type Readiness } from '@shared/readiness'
import { tripDays, type Trip } from '@shared/trips'
import './Home.css'

/** Whole days until departure. Negative once the date has passed. */
function daysUntil(date: string): number {
  const today = new Date()
  const target = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  )
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((target - now) / 86_400_000)
}

/**
 * Home is the trip you are actually working on.
 *
 * Product doc 02 §3: opening the app during a trip should land on that trip's
 * state rather than a dashboard. The soonest trip that has not finished is the
 * one Alex means, so it is chosen for him instead of presented as a menu.
 */
/**
 * Everything Home shows, as one value it can be handed back later.
 *
 * `ready` is separate from the rest because it arrives a whole round trip
 * later — see the two-stage note on `load` below.
 */
interface HomeSnapshot {
  trip: Trip | null
  others: Trip[]
  recent: Trip[]
  /** How many trips exist that Home is not showing. Decides `All trips` (§2). */
  more: number
  ready: Readiness | null
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
   * Everything else Alex has planned or taken.
   *
   * Doc 02 §4 asks Home for the featured trip AND "upcoming trips, New Trip,
   * recent trips" beneath it. All three had collapsed into one text link reading
   * "All trips · 4 more", which is why the screen answered its question in the
   * top third and left the rest of the viewport empty — the space was not calm,
   * it was three missing sections.
   */
  const [others, setOthers] = useState<Trip[]>(cached?.others ?? [])
  const [recent, setRecent] = useState<Trip[]>(cached?.recent ?? [])
  /*
   * The trips Home has no room for, counted rather than assumed (§2).
   *
   * `All trips` used to render whenever Home was populated — so on a database
   * holding exactly one trip it was a door onto the screen Alex was already
   * looking at, with the same single row on it. A control that leads nowhere
   * new is an orphan heading wearing a button's clothes.
   *
   * Counted against every trip, archived included: those live on the Trips
   * screen behind `Show archived`, so a database with one live trip and two
   * archived ones genuinely does have more to go and see.
   */
  const [more, setMore] = useState(cached?.more ?? 0)
  const [sheetOpen, setSheetOpen] = useState(false)
  /*
   * TWO stages, because they are two round trips apart.
   *
   * `trips` is which trip Alex is on and what it is called. `ready` is the
   * countdown, the progress and the recommended action, and it cannot even be
   * ASKED for until `trips` has answered — the checklist and outfits are
   * fetched by trip id. Holding the whole screen back for the second one, which
   * is what a single `loading` flag did, meant Home showed an empty frame for
   * two round trips when it could have shown the trip after one.
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

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { trips } = await fetchTrips()
        /*
         * Archived first, before anything else is decided.
         *
         * A trip Alex has put away must not come back as the FEATURED one just
         * because its dates have not passed — that would make archiving look
         * broken on the screen he opens most.
         */
        const active = trips.filter((t) => !t.archivedAt)
        const live = active
          .filter((t) => t.status !== 'completed' && daysUntil(t.endDate) >= 0)
          .sort((a, b) => a.startDate.localeCompare(b.startDate))
        const next = live[0] ?? null

        if (cancelled) return
        setTrip(next)
        // The trip is on screen now, one round trip in. Everything below is
        // the second one.
        setTripsState('ready')
        /*
         * Three, not all of them.
         *
         * Home is the trip Alex is working on (doc 02 §3); the section beneath it
         * is context, and context that scrolls is a second Trips screen. `All
         * trips` below carries the rest, which is what it is for.
         *
         * Uncapped was also a real hazard rather than a tidiness point: a database
         * with a few hundred trips in it rendered a few hundred rows here, and the
         * screen that is supposed to open instantly became the slowest in the app.
         */
        setOthers(live.slice(1, 4))
        /*
         * Most recently finished first. A finished trip is on Home to be reused,
         * and the one Alex just took is the one worth reusing — so this is not the
         * same order as the Trips screen's history, and should not be.
         */
        const nextRecent = active
          .filter((t) => t.status === 'completed' || daysUntil(t.endDate) < 0)
          .sort((a, b) => b.startDate.localeCompare(a.startDate))
          .slice(0, 2)
        setRecent(nextRecent)

        const nextOthers = live.slice(1, 4)
        const shown = (next ? 1 : 0) + nextOthers.length + nextRecent.length
        const nextMore = Math.max(0, trips.length - shown)
        setMore(nextMore)

        if (!next) {
          // Nothing to be ready ABOUT, so the second stage is already over.
          setReady(null)
          setReadyState('settled')
          remember<HomeSnapshot>(SNAPSHOT_KEY, {
            trip: null,
            others: nextOthers,
            recent: nextRecent,
            more: nextMore,
            ready: null,
          })
        }

        if (next) {
          /*
           * The outfits come too, because readiness cannot answer "review two
           * outfits" without them — and asking Home to guess would put a
           * different answer here from the one the trip screen gives.
           */
          const [{ entries: rows }, { groups, stale }] = await Promise.all([
            fetchChecklist(next.id),
            fetchOutfits(next.id).catch(() => ({ groups: [], stale: false })),
          ])
          if (!cancelled) {
            const nextReady = readiness({
              trip: next,
              entries: rows,
              outfits: groups,
              outfitsStale: stale,
              today: todayISO(),
            })
            setReady(nextReady)
            setReadyState('settled')
            remember<HomeSnapshot>(SNAPSHOT_KEY, {
              trip: next,
              others: nextOthers,
              recent: nextRecent,
              more: nextMore,
              ready: nextReady,
            })
          }
        }
      } catch {
        /*
         * Home stays quiet on failure; Trips reports it properly.
         *
         * Both stages settle regardless, so a screen that cannot load does not
         * sit on a skeleton for ever — it falls through to whatever it has,
         * which for a first visit is the empty state. Nothing is remembered:
         * a failed load must not be handed back as a snapshot.
         */
        if (!cancelled) {
          setTripsState('ready')
          setReadyState('settled')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // The first round trip has not answered yet and there is no snapshot to
  // paint. Nothing is known, so nothing is claimed.
  if (tripsState === 'waiting') return <Screen title="Pack Smart" />

  if (!trip) {
    return (
      <Screen title="Pack Smart">
        <EmptyState
          title="No trips yet"
          body="Tell Pack Smart where you are going and when. It builds the packing list from what you already own."
          action={{ label: 'Plan a Trip', onClick: () => navigate('/trips') }}
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
  const alternate =
    primaryRoute === 'outfits'
      ? { label: 'Packing list', path: `/trips/${trip.id}` }
      : primaryRoute === 'today'
        ? { label: 'Packing list', path: `/trips/${trip.id}` }
        : { label: 'Outfits', path: `/trips/${trip.id}/outfits` }

  /*
   * There is no essentials banner on Home, and that is doc 09 §4.1.
   *
   * It used to sit here in red whenever ANY essential was unpacked — on the day
   * a trip is created, that is every one of them, an alarm about a list nobody
   * has started. Reviewing the screen after the readiness model landed showed
   * the sharper problem: with a recommended action that already reads "Pack the
   * essentials", the panel said the same thing a second time, louder, directly
   * above it.
   *
   * No essentials logic is removed. `essentialsUrgent` still decides when they
   * are worth leading with, the recommended action carries them
   * proportionately, and the packing list keeps the full line because that is
   * the screen where naming them is actionable.
   */

  return (
    <Screen
      title="Pack Smart"
      /*
       * Planning a trip moved into the header, and that is the whole of §8's
       * "tertiary" tier.
       *
       * It was a full-width secondary button sitting between "Also coming up"
       * and "Recent trips" — the same visual weight as the action for the trip
       * Alex is actually packing, for something he does a few times a year. In
       * the header it costs no vertical space at all, it is the same control in
       * the same corner Trips already puts it in, and it opens the same sheet.
       */
      action={{
        label: 'Plan a Trip',
        glyph: '+',
        onClick: () => setSheetOpen(true),
      }}
    >
      <button type="button" className="home-card" onClick={() => navigate(destination)}>
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

        {/*
          * Nothing here restates the button below it.
          *
          * While the trip is underway the card used to end with the words "See
          * what to wear today", and the primary action two hundred pixels lower
          * said the same seven words and went to the same screen. Two controls,
          * one destination, identical labels — `VISUAL_ACCEPTANCE.md` §2's
          * competing actions. The card carries the trip; the button carries the
          * action.
          */}
        {/*
          * The progress pair, and the space it will need before it has it.
          *
          * Reserved while readiness is still out, because otherwise the card
          * grew by about a hundred pixels when it landed and pushed "Also
          * coming up" down the screen — a jump on the screen the app opens on,
          * at the moment Alex is looking straight at it.
          *
          * It is reserved for the case that is nearly always true: a trip that
          * has not started yet, which is what Home features while there is any
          * packing left to do. An underway trip has no bar, so the placeholder
          * collapses instead — one shift either way, and this is the direction
          * that is rare.
          */}
        {/*
          * The bar and the count on ONE line, not two stacked rows.
          *
          * They are the same fact — "0 of 25 packed" is what the bar is drawn
          * from — and giving each its own full-width row cost about 30px of the
          * card for no information. Side by side the number reads as the bar's
          * label, which is what it is.
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
      </button>

      {/*
        * Two actions on one line, and which one leads changes with the trip.
        *
        * Before departure the job is packing; once the trip has started it is what
        * to wear (doc 04 §11), so the primary weight moves rather than the
        * buttons. Stacked full-width they took two rows and read as a menu; side
        * by side they read as a choice, which is what they are.
        *
        * "Today's outfit" rather than "See what to wear today": at half the width
        * the longer label wrapped to two lines at 360px, and the short one is the
        * same promise.
        */}
      {/*
        * One recommended action, and it is derived rather than guessed.
        *
        * This used to be two hardcoded buttons whose primary weight flipped on
        * a single test — underway or not — so before departure it always said
        * "Packing list", whether the list existed, whether two outfits were
        * waiting for review, or whether everything was already packed. Doc 09
        * §4 asks for ONE recommended next action from real trip data, and §21
        * for one obvious action on Home.
        *
        * The secondary button is deliberately not a second recommendation: it
        * is the way to the rest of the trip, so the primary can be specific
        * without becoming the only door.
        */}
      {/*
        * Full width, on its own line.
        *
        * These were two half-width buttons, which worked while both labels were
        * two short words. A recommended action is specific — "Build the packing
        * list", "Pack the essentials" — and at 390px every one of those wrapped
        * to two lines inside a half-width button. A primary action that wraps
        * does not read as one action, which is the whole point of having only
        * one.
        */}
      {/*
        * While readiness is still in flight the button is present, sized and
        * INERT — it is not labelled "Packing list" and then relabelled.
        *
        * A primary action that changes what it says under Alex's thumb is worse
        * than one that is briefly unavailable: the old code showed the fallback
        * label immediately, so a tap in the first hundred milliseconds went to
        * the packing list when the recommendation was "Review 2 outfits". The
        * button keeps its place in the layout so nothing below it moves.
        */}
      {/*
        * Three tiers, and they no longer look alike (§8).
        *
        * The recommended action keeps the full width and the fill. The other
        * door beneath it is a compact secondary sized to its own label rather
        * than to the screen — at full width it read as a second recommendation,
        * which is exactly what the readiness model exists to avoid making. And
        * `Plan a Trip` has left this stack entirely for the header.
        */}
      <div className="home-actions">
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

        {/*
          * Why, under the what — when there is a why worth reading.
          *
          * A button reading "Review 2 outfits" is only obvious if Alex knows what
          * approving one does. One quiet sentence, and never an exhortation —
          * doc 09 §9 keeps the language neutral until urgency is real.
          *
          * The model returns null where the label is already the whole answer, and
          * "Keep packing" is the case that matters: it used to be followed by
          * "10 things still to pack.", which is the button restating the number it
          * came from (doc 09 §0q). Nothing renders here then, rather than a line
          * that exists because the slot exists.
          */}
        {ready?.next?.detail ? (
          <p className="home-why">{ready.next.detail}</p>
        ) : readyState === 'waiting' ? (
          // Holds its line for the same reason the two above do.
          <p className="home-why home-pending home-pending-line" aria-hidden="true" />
        ) : null}

        {/*
          * The other door, and never the same one as above.
          *
          * Not a second recommendation — the model makes exactly one — but the
          * primary is specific enough now that it would otherwise be the only way
          * off this screen into the trip. Which door this is depends on where the
          * primary already goes, so the two can never both lead to the same
          * place: two controls with one destination is `VISUAL_ACCEPTANCE.md`
          * §2's competing actions.
          */}
        <button
          type="button"
          className="button-quiet home-alternate"
          onClick={() => navigate(alternate.path)}
        >
          {alternate.label}
        </button>
      </div>

      {/* Doc 02 §4, in its order: upcoming trips, recent trips. Planning a new
          one is the header's `+`, which costs no vertical space here. */}
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

      {/*
        * The sheet still lives here as well as on Trips — sending Alex to
        * another screen to find the button that opens it would make "Plan a
        * Trip" a signpost rather than an action. What changed is only where the
        * button is: the header, beside the title, rather than a full-width
        * secondary wedged between two lists of trips.
        */}

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
        * Only when there is something else to see (§2).
        *
        * The count says so rather than the screen assuming it: with one trip in
        * the database this was a link to a screen showing that same trip, under
        * a heading promising more.
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

      <TripSheet
        open={sheetOpen}
        trip={null}
        template={null}
        onClose={() => setSheetOpen(false)}
        onSaved={(saved) => navigate(`/trips/${saved.id}`)}
      />
    </Screen>
  )
}
