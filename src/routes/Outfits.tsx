import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ColorDots } from '@/components/ColorDots'
import { Screen } from '@/components/Screen'
import { SwapSheet, type SwapTarget } from '@/components/SwapSheet'
import { useSlotChoice } from '@/lib/useSlotChoice'
import {
  fetchOutfits,
  fetchTrip,
  fetchWeather,
  forgetOutfitPairings,
  generateOutfits,
  setOutfitStatus,
  type OutfitGroup,
} from '@/lib/trips'
import { describeOutfits } from '@/lib/outfitReview'
import { explainOutfit, joinNames } from '@shared/outfits'
import { changeSummary, replanNotice, type PlanChange } from '@shared/replan'
import { type WeatherDay } from '@shared/weather'
import { type Trip } from '@shared/trips'
import './Outfits.css'

/**
 * The outfit plan for one trip.
 *
 * Grouped by occasion rather than by calendar day, per product doc 04 §2.
 * Approving a group is what puts its clothing on the packing checklist — there
 * is no separate "add to list" action, because two ways to do it is how the two
 * plans drift apart.
 */
export default function Outfits() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const [trip, setTrip] = useState<Trip | null>(null)
  const [groups, setGroups] = useState<OutfitGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** P1A: applies the choice at once and persists behind it. */
  const chooseSlot = useSlotChoice(id, setGroups, setError)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [swapping, setSwapping] = useState<SwapTarget | null>(null)
  /**
   * Which card has its `Why?` open. One at a time, by id.
   *
   * A set would allow several, and several open explanations is the persistent
   * explanation block this pass exists to remove — reached one tap at a time
   * instead of all at once.
   */
  const [explained, setExplained] = useState<string | null>(null)
  /**
   * What is different about the trip since the plan was made (§31).
   *
   * Server-computed against a snapshot of the planner's own inputs, never
   * inferred here. It decides what the control at the bottom of the screen
   * offers to do, which is why it has to be known BEFORE it is pressed.
   */
  const [changes, setChanges] = useState<PlanChange[]>([])

  /*
   * The outfit whose approval just taught Pack Smart a lasting pairing.
   *
   * Approving affects one trip by default; a saved-outfit relationship outlives
   * it, so it cannot be created silently (CLAUDE.md, doc 04 §5). Undo rather
   * than a confirmation dialog is the house style — doc 02 §2.
   */
  const [remembered, setRemembered] = useState<{ groupId: string; name: string } | null>(null)
  /*
   * The trip's stored forecast. Read, never fetched — going to the network here
   * would put a weather call on a screen Alex opens repeatedly and break it
   * offline, and the fetch already happens when outfits are planned, which is the
   * moment the forecast actually changes a decision.
   */
  const [weatherDays, setWeatherDays] = useState<WeatherDay[]>([])

  /**
   * The plan is older than the days it plans for, and the server said so.
   *
   * P1B: saving days answers as soon as they are durable rather than replanning
   * the whole wardrobe first, so this screen is where the replan happens. It is
   * asked for on load rather than passed in through navigation state, because a
   * refresh, a second tab or a connection that dropped halfway would lose a
   * hand-off and leave a trip whose outfits quietly do not match its itinerary.
   */
  const [stale, setStale] = useState(false)
  /** A replan is running now — said out loud, because Alex did not ask for it. */
  const [planning, setPlanning] = useState(false)

  const plan = useCallback(async () => {
    setBusy(true)
    setPlanning(true)
    setNotice(null)
    try {
      const result = await generateOutfits(id)
      setGroups(result.groups)
      setStale(false)
      /*
       * The plan is now the current one, so nothing is outstanding — whatever
       * the changes were, they have been acted on. Leaving them set would keep
       * offering to update outfits that were just updated.
       */
      setChanges([])
      setNotice(replanNotice(result))
    } catch {
      setError('Could not plan outfits just now.')
    } finally {
      setBusy(false)
      setPlanning(false)
    }
  }, [id])

  const load = useCallback(async () => {
    try {
      const [tripResult, outfitResult] = await Promise.all([fetchTrip(id), fetchOutfits(id)])
      setTrip(tripResult)
      setGroups(outfitResult.groups)
      setStale(outfitResult.stale)
      setChanges(outfitResult.changes)
      setError(null)

      /*
       * Separately, and allowed to fail. A trip with no forecast is the normal
       * case, not an error, and it must not stop the outfits rendering.
       */
      try {
        setWeatherDays((await fetchWeather(id)).days)
      } catch {
        setWeatherDays([])
      }
    } catch {
      setError('Could not load this trip’s outfits.')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  /*
   * Replans once per arrival, never in a loop.
   *
   * The ref is the guard: `generateOutfits` clears `stale` on the server, but
   * this must not depend on that to stop — a plan the server still considers
   * behind would otherwise be replanned on every render for ever. One arrival,
   * one replan; if it did not take, the Plan Outfits button is still there.
   */
  const replanRequested = useRef(false)

  useEffect(() => {
    if (!stale || replanRequested.current) return
    replanRequested.current = true
    void plan()
  }, [stale, plan])

  async function toggleApproval(group: OutfitGroup) {
    setBusy(true)
    setNotice(null)
    setRemembered(null)
    try {
      const next = group.status === 'approved' ? 'draft' : 'approved'
      const result = await setOutfitStatus(id, group.id, next)
      setGroups(result.groups)

      if (result.refused) {
        setNotice('Fill the missing pieces before approving this outfit.')
      } else if (next === 'approved' && result.sync.added > 0) {
        setNotice(`${result.sync.added} added to your packing list.`)
      } else if (next === 'draft' && result.sync.removed > 0) {
        setNotice(`${result.sync.removed} removed from your packing list.`)
      }

      // Only when the approval actually wrote a pairing. Un-approving forgets
      // its own, so there is nothing to announce or undo in that direction.
      if (next === 'approved' && result.remembered) {
        setRemembered({ groupId: group.id, name: group.name })
      }
    } catch {
      setError('Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  /** Declines the pairing without giving up the approval (doc 04 §5). */
  async function forgetPairing() {
    if (!remembered) return
    const target = remembered
    setRemembered(null)
    try {
      await forgetOutfitPairings(id, target.groupId)
      setNotice('Forgotten. This combination will not affect future trips.')
    } catch {
      setError('Could not undo that.')
    }
  }

  /*
   * One derivation, shared with the guided review.
   *
   * The card and the walkthrough state the same facts about the same outfit —
   * dates, place, weather, formality, markers — and working them out twice is
   * how the two end up disagreeing about which days an outfit covers, which is
   * worse than either being wrong alone because neither looks wrong.
   */
  const described = useMemo(
    () => describeOutfits(trip, groups ?? [], weatherDays),
    [trip, groups, weatherDays],
  )

  if (!trip && !error) return <Screen title="Outfits" />

  return (
    <Screen title="Outfits" subtitle={trip ? `${trip.emoji} ${trip.name}` : undefined}>
      {error ? <p className="field-error">{error}</p> : null}

      {groups !== null && groups.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">No outfits planned</p>
          <p className="empty-state-body">
            Pack Smart builds outfits from what you own, grouped by what you are doing rather than
            one for each day.
          </p>
          <button type="button" className="button-primary" onClick={() => void plan()} disabled={busy}>
            {busy ? 'Planning…' : 'Plan Outfits'}
          </button>
        </div>
      ) : null}

      {/*
       * Says a replan is happening, because Alex did not ask for this one.
       *
       * P1B moved it here from `PUT /trips/:id/days`, where it held the tap
       * that committed an itinerary. Work he did not start and cannot see is
       * worse than a wait he understands — so it is announced, and everything
       * else on the screen stays usable while it runs.
       */}
      {planning ? (
        <p className="banner banner-quiet" role="status">
          Planning your outfits from the days you named…
        </p>
      ) : null}

      {notice ? (
        <p className="banner banner-quiet" role="status">
          {notice}
        </p>
      ) : null}

      {/*
       * Says what outlived the trip, and offers to take it back.
       *
       * Everything else on this screen affects one trip. This is the single
       * place an ordinary action writes something lasting, so it announces
       * itself — quietly, and with one tap to refuse (doc 04 §5).
       */}
      {remembered ? (
        <p className="outfit-remembered" role="status">
          <span>Remembered that these go together, for future trips.</span>
          <button type="button" className="button-secondary" onClick={() => void forgetPairing()}>
            Undo
          </button>
        </p>
      ) : null}

      {/*
        * The one unresolved planning state that has its own answer (§4, §5).
        *
        * What used to sit beside it — `5 outfits · 0 of 6 needs covered` and a
        * `Review 5` control — is gone. It was the screen telling Alex to do
        * something the cards below already make obvious: every draft carries
        * its own `Approve`, so a counter and a walkthrough button above them
        * were a second, worse copy of a workflow that is already on screen.
        *
        * Removing it leaves LESS interface rather than different interface.
        * There is no progress bar, no `0/5 approved`, no completion chip: the
        * approved cards are tinted and the drafts are not, which is the same
        * information in no space at all.
        *
        * Day assignment stays, because it is genuinely unresolved and genuinely
        * cannot be answered from a card.
        */}
      {trip && trip.activities.length > 0 && trip.days.length === 0 && (groups ?? []).length > 0 ? (
        <div className="outfit-status">
          <div className="outfit-status-row">
            <span className="outfit-status-text">Days aren’t assigned</span>
            {/*
              * Short on screen, whole to a listener (§23). A screen reader
              * announces the control without the row it sits in, and
              * "Assign, button" says nothing about what.
              */}
            <button
              type="button"
              className="outfit-status-action"
              aria-label="Assign days"
              onClick={() => navigate(`/trips/${id}/days`)}
            >
              Assign
            </button>
          </div>
        </div>
      ) : null}

      {/*
        * Which dates each outfit covers, from the days Alex named.
        *
        * `describeOutfits` is the same derivation the guided review uses, so the
        * dates on a card and the dates in the walkthrough cannot disagree — and
        * it uses `assignDays`, which During Trip also uses, so neither can
        * disagree with the outfit shown on a given morning.
        */}
      {described.map(({ group, when, place, conditions, formality, markers }) => {
        /*
         * Garments this outfit is built on that the packing list has been told
         * not to bring (doc 04 §8).
         */
        const setAside = group.slots.filter((slot) => slot.setAside)
        const blocked = group.status === 'approved' && setAside.length > 0
        const approved = group.status === 'approved'
        const why = explainOutfit(group.slots)

        /*
         * One metadata line, in one order (§8).
         *
         * It was four separate lines — context, weather, markers, status — each
         * with its own margin, stacked above four garments. Occurrence, place,
         * conditions and formality are all facts of the same kind, they are
         * read together, and they belong on one line under the name. The
         * markers join it for the same reason: `Travel day` is another fact
         * about the occasion, not a category of its own.
         *
         * `Once` is dropped. `outfitContext` returns it for a group that
         * happens exactly once, which is the overwhelmingly common case — so it
         * appeared on nearly every card and distinguished nothing. A count that
         * matters (`2 dinners`, `3 days`) is not the string `Once` and survives.
         */
        const meta = [
          ...(when && when !== 'Once' ? [when] : []),
          ...(place ? [place] : []),
          ...(conditions ? [conditions] : []),
          ...(formality ? [formality] : []),
          ...markers.map((marker) => marker.label),
        ]

        return (
        <section
          key={group.id}
          className={`outfit-card is-${group.status}${blocked ? ' is-blocked' : ''}${
            group.reviewReason ? ' is-review' : ''
          }`}
        >
          <header className="outfit-head">
            <h2 className="outfit-name">{group.name}</h2>
            <p className="outfit-context">
              {meta.map((part, index) => (
                <span key={`${part}-${index}`}>
                  {index > 0 ? (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="visually-hidden">, </span>
                    </>
                  ) : null}
                  {part}
                </span>
              ))}
            </p>
          </header>

          {/*
            * The trip moved out from under an approved outfit (§34).
            *
            * Not an un-approval, and deliberately worded as a fact about the
            * world rather than a verdict on his choice: the forecast changed,
            * the dinner became formal. Alex decides what to do about it, and
            * the outfit stays approved until he does.
            *
            * Named rather than generic — `Cashmere Sweater is no longer right
            * for the forecast` is something he can act on; `needs review` makes
            * him open the outfit to find out what the app already knows.
            */}
          {group.reviewReason ? (
            <p className="outfit-flag">
              <span className="outfit-flag-label">Review</span>
              <span>{group.reviewReason}</span>
            </p>
          ) : null}

          {blocked ? (
            <p className="outfit-flag is-blocked-flag">
              <span className="outfit-flag-label">Incomplete</span>
              <span>
                You are not bringing the{' '}
                {joinNames(setAside.map((slot) => slot.itemName ?? 'garment'))}
              </span>
            </p>
          ) : null}

          <ul className="slots">
            {group.slots.map((slot) => (
              <li key={slot.id}>
                <button
                  type="button"
                  className={`slot ${slot.itemId ? '' : 'is-empty'}${slot.setAside ? ' is-set-aside' : ''}`}
                  onClick={() =>
                    setSwapping({
                      groupId: group.id,
                      slotId: slot.id,
                      roleLabel: slot.roleLabel,
                      itemId: slot.itemId,
                    })
                  }
                >
                  {/*
                    * The garment first, its slot second (§7).
                    *
                    * The role was a fixed 56px column on the left of every row,
                    * so the thing being scanned for started a third of the way
                    * into the card and `Deconstructed Sneakers` wrapped where
                    * it had no need to. It is the same fact, on the metadata
                    * line where the brand and colour already live: `Shoes ·
                    * New Balance · White` reads as what kind of thing this is,
                    * which is what the column was for, and it costs no width.
                    *
                    * The accessible name is unchanged in content and improved
                    * in order — a screen reader hears the garment before its
                    * category, which is the same reordering the eye gets.
                    */}
                  <span className="slot-body">
                    <span className="slot-item">{slot.itemName ?? slot.unmetReason}</span>
                    <span className="slot-meta">
                      {[
                        slot.roleLabel,
                        ...(slot.itemDetail && !slot.setAside ? [slot.itemDetail] : []),
                        ...(slot.setAside ? ['Not bringing'] : []),
                      ].map((part, index) => (
                        <span
                          key={part}
                          className={part === 'Not bringing' ? 'slot-warning' : undefined}
                        >
                          {index > 0 ? (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span className="visually-hidden">, </span>
                            </>
                          ) : null}
                          {part}
                        </span>
                      ))}
                    </span>
                  </span>
                  {/*
                    * The colour, in the horizontal room the row already had.
                    *
                    * Between the metadata and the chevron rather than after the
                    * colour word, so every dot on the card sits in one vertical
                    * band and the palette reads down the right edge — which is
                    * the thing a photo would have given and text cannot. Costs
                    * no height: the row is 49px with it and 49px without.
                    */}
                  <ColorDots color={slot.itemColor} className="slot-colors" />
                  <span className="slot-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/*
            * One footer, on one optical baseline (§14).
            *
            * It was three things of three different heights sitting under a
            * separator: a text state, a text action, and a tall outlined
            * button whose box protruded past both. The rule of the row is
            * that everything in it is `align-items: center` inside ONE
            * declared height — the separator is the footer's own top border,
            * so nothing can collide with it, and no control brings its own
            * vertical margin.
            *
            * `Approve` is a tinted compact action rather than an outlined
            * rectangle. It is the obvious thing to do on the card and it is
            * not the loudest thing on the screen: five outlined boxes down a
            * page each claimed to be the page's primary action, and the
            * page's primary action is the replan at the bottom.
            */}
          <footer className="outfit-foot">
            <span className={`outfit-state ${approved ? 'is-on' : ''}`}>
              {approved ? 'Approved' : 'Draft'}
            </span>
            <span className="outfit-foot-actions">
              {why ? (
                <button
                  type="button"
                  className="outfit-why-toggle"
                  aria-expanded={explained === group.id}
                  onClick={() => setExplained(explained === group.id ? null : group.id)}
                >
                  Why?
                </button>
              ) : null}
              <button
                type="button"
                className={approved ? 'outfit-undo' : 'outfit-approve'}
                onClick={() => void toggleApproval(group)}
                disabled={busy}
              >
                {approved ? 'Undo' : 'Approve'}
              </button>
            </span>
          </footer>

          {/*
            * The explanation, on demand (§9).
            *
            * Still built only from the criteria that actually separated each
            * garment from its runner-up — `explainOutfit` aggregates the slots'
            * stored `decidedBy` and recomputes nothing, so it cannot credit
            * comfort on a card where comfort said nothing. What changed is that
            * it is no longer permanently on screen: a correct decision does not
            * need explaining every time it is looked at, and doc 03 §12's rule
            * is to explain the surprising parts.
            */}
          {why && explained === group.id ? <p className="outfit-why">{why}</p> : null}
        </section>
        )
      })}

      {/*
        * The one control that changes the plan, and it says what it would do
        * (§26, §31).
        *
        * `Plan again` was a generic regenerate: against unchanged inputs the
        * planner is deterministic, so it either did nothing or shuffled a tie.
        * The server now compares what the trip is against what it was when the
        * plan was made — the planner's own thresholds, so 67°F to 65°F is not a
        * change and 57–67°F to 41–49°F is — and the button says which of the
        * two situations Alex is in before he presses it.
        *
        * The supporting line appears only when there IS something to say, which
        * is what keeps this from being the persistent banner §31 rules out.
        */}
      {groups !== null && groups.length > 0 ? (
        <div className="outfit-replan">
          <button
            type="button"
            className={changes.length > 0 ? 'button-primary' : 'button-secondary'}
            onClick={() => void plan()}
            disabled={busy}
          >
            {busy
              ? 'Updating…'
              : changes.length > 0
                ? 'Update outfits for changes'
                : 'Refresh suggestions'}
          </button>
          {changeSummary(changes) ? (
            <p className="hint outfit-replan-why">{changeSummary(changes)}</p>
          ) : null}
        </div>
      ) : null}

      {/*
        * Navigation, and it looks like navigation (§38, §39).
        *
        * It was a second full-width bordered button directly under the replan,
        * so the screen ended on two controls of equal weight — one of which
        * mutates the plan and one of which leaves the screen. Making them look
        * alike is how somebody going back accidentally replans.
        */}
      <button type="button" className="button-quiet outfit-back" onClick={() => navigate(`/trips/${id}`)}>
        Back to packing list
      </button>

      <SwapSheet
        open={swapping !== null}
        tripId={id}
        target={swapping}
        onClose={() => setSwapping(null)}
        onChoose={(_itemId, option) => chooseSlot(swapping!.groupId, swapping!.slotId, option)}
      />
    </Screen>
  )
}
