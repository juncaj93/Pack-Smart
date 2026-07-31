import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, Screen } from '@/components/Screen'
import { TripSheet } from '@/components/TripSheet'
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
 * Turns the readiness model's named destination into a path.
 *
 * The model names WHERE to go and never builds a URL, so routing stays a
 * concern of the screens and a renamed route breaks in one place rather than in
 * whichever screens happened to hardcode it.
 */
function routeFor(tripId: string, route: NonNullable<Readiness['next']>['route']): string {
  switch (route) {
    case 'today':
      return `/trips/${tripId}/today`
    case 'outfits':
      return `/trips/${tripId}/outfits`
    // The checklist and the questions both live on the trip screen today. Named
    // separately all the same: they are different intentions, and the day the
    // trip screen splits, this is the only thing that has to change.
    case 'checklist':
    case 'setup':
    case 'trip':
    default:
      return `/trips/${tripId}`
  }
}

/**
 * Home is the trip you are actually working on.
 *
 * Product doc 02 §3: opening the app during a trip should land on that trip's
 * state rather than a dashboard. The soonest trip that has not finished is the
 * one Alex means, so it is chosen for him instead of presented as a menu.
 */
export default function Home() {
  const navigate = useNavigate()
  const [trip, setTrip] = useState<Trip | null>(null)
  /*
   * One derived answer, not four screens' worth of arithmetic.
   *
   * Home used to work out its own countdown, its own progress, and its own
   * view of whether an essential was worth shouting about — and the trip screen
   * worked out a different one. `@shared/readiness` decides once and every
   * surface reads it (doc 09 §4).
   */
  const [ready, setReady] = useState<Readiness | null>(null)
  /*
   * Everything else Alex has planned or taken.
   *
   * Doc 02 §4 asks Home for the featured trip AND "upcoming trips, New Trip,
   * recent trips" beneath it. All three had collapsed into one text link reading
   * "All trips · 4 more", which is why the screen answered its question in the
   * top third and left the rest of the viewport empty — the space was not calm,
   * it was three missing sections.
   */
  const [others, setOthers] = useState<Trip[]>([])
  const [recent, setRecent] = useState<Trip[]>([])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [loading, setLoading] = useState(true)

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
        setRecent(
          active
            .filter((t) => t.status === 'completed' || daysUntil(t.endDate) < 0)
            .sort((a, b) => b.startDate.localeCompare(a.startDate))
            .slice(0, 2),
        )

        if (next) {
          /*
           * The outfits come too, because readiness cannot answer "review two
           * outfits" without them — and asking Home to guess would put a
           * different answer here from the one the trip screen gives.
           */
          const [{ entries: rows }, { groups }] = await Promise.all([
            fetchChecklist(next.id),
            fetchOutfits(next.id).catch(() => ({ groups: [] })),
          ])
          if (!cancelled) {
            setReady(
              readiness({ trip: next, entries: rows, outfits: groups, today: todayISO() }),
            )
          }
        }
      } catch {
        /* Home stays quiet on failure; Trips reports it properly. */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <Screen title="Pack Smart" />

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
    <Screen title="Pack Smart">
      <button type="button" className="home-card" onClick={() => navigate(destination)}>
        <span className="home-countdown">{ready?.headline ?? ''}</span>
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
        {underway ? null : progress ? (
          <>
            <span className="progress-track home-track">
              <span className="progress-fill" style={{ width: `${percent}%` }} />
            </span>
            <span className="home-progress">{progressLabel(progress)}</span>
          </>
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
      <button
        type="button"
        className="button-primary home-primary"
        onClick={() => navigate(routeFor(trip.id, ready?.next?.route ?? 'trip'))}
      >
        {ready?.next?.label ?? 'Packing list'}
      </button>

      {/*
        * Why, under the what.
        *
        * A button reading "Review 2 outfits" is only obvious if Alex knows what
        * approving one does. One quiet sentence, and never an exhortation —
        * doc 09 §9 keeps the language neutral until urgency is real.
        */}
      {ready?.next ? <p className="home-why">{ready.next.detail}</p> : null}

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
      <button type="button" className="button-secondary" onClick={() => navigate(alternate.path)}>
        {alternate.label}
      </button>


      {/* Doc 02 §4, in its order: upcoming trips, New Trip, recent trips. */}
      {others.length > 0 ? (
        <section className="home-section">
          <h2 className="section-heading">Also coming up</h2>
          <ul className="trip-list">
            {others.map((other) => (
              <li key={other.id} className="trip-item">
                <TripRow trip={other} onOpen={(t) => navigate(`/trips/${t.id}`)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        * The sheet lives here as well as on Trips.
        *
        * Sending Alex to another screen to find the button that opens it would
        * make "New Trip" a signpost rather than an action, and it is the same
        * self-contained component either way — there is no second implementation
        * to keep in step.
        */}
      <button type="button" className="button-secondary" onClick={() => setSheetOpen(true)}>
        Plan a Trip
      </button>

      {recent.length > 0 ? (
        <section className="home-section">
          <h2 className="section-heading">Recent trips</h2>
          <ul className="trip-list">
            {recent.map((old) => (
              <li key={old.id} className="trip-item">
                <TripRow trip={old} onOpen={(t) => navigate(`/trips/${t.id}`)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <button
        type="button"
        className="button-quiet home-all-trips"
        onClick={() => navigate('/trips')}
      >
        All trips
      </button>

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
