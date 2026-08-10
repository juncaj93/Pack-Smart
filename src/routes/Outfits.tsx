import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
  slotSecondary,
  type OutfitGroup,
} from '@/lib/trips'
import { describeOutfits } from '@/lib/outfitReview'
import {
  coverageSentence,
  explainOutfit,
  joinNames,
  outfitCoverage,
  reviewProgress,
} from '@shared/outfits'
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
      if (!result.regenerated) {
        setNotice('Your approved outfits were left as they are.')
      } else if (result.keptApproved > 0) {
        setNotice(
          `${result.replannedCount} planned again · ${result.keptApproved} left as you approved ${
            result.keptApproved === 1 ? 'it' : 'them'
          }.`,
        )
      }
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
  const coverage = useMemo(() => outfitCoverage(groups ?? []), [groups])

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
       * Names the assumption instead of hiding it.
       *
       * With no days stated the planner gives each activity one outfit, which is
       * right only if each happens once. Guessing a spread would be inventing a
       * fact Alex never gave, so it says what it assumed and offers the screen
       * that would settle it.
       */}
      {trip && trip.activities.length > 0 && trip.days.length === 0 && (groups ?? []).length > 0 ? (
        <p className="banner banner-quiet">
          <span className="banner-text">
            One outfit per activity, because you have not said which days are which.
          </span>
          <button
            type="button"
            className="button-secondary button-compact"
            onClick={() => navigate(`/trips/${id}/days`)}
          >
            Say which days
          </button>
        </p>
      ) : null}

      {/*
        * The closing summary, at the top of the list as well (doc 09 §7).
        *
        * Two units in one sentence on purpose — days covered and outfits
        * approved — because either alone reads as more progress than it is. It
        * sits above the cards so the answer to "am I done" arrives before the
        * work rather than after scrolling past it.
        */}
      {(groups ?? []).length > 0 ? (
        <section className="outfit-coverage">
          <p className="outfit-coverage-line">{coverageSentence(coverage)}</p>
          <p className="outfit-coverage-progress">{reviewProgress(coverage)}</p>
          {coverage.unresolved > 0 ? (
            <button
              type="button"
              className="button-primary"
              onClick={() => navigate(`/trips/${id}/outfits/review`)}
            >
              {coverage.unresolved === 1
                ? 'Review the last outfit'
                : `Review ${coverage.unresolved} outfits`}
            </button>
          ) : null}
        </section>
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
        const context = [when, ...(place ? [place] : []), ...(formality ? [formality] : [])]
        /*
         * Garments this outfit is built on that the packing list has been told
         * not to bring (doc 04 §8).
         *
         * The card says so until it is resolved — replaced, or the removal
         * undone. An approved outfit quietly standing on a garment that is not
         * in the bag is precisely the pair of conflicting plans §8 forbids.
         */
        const setAside = group.slots.filter((slot) => slot.setAside)
        const blocked = group.status === 'approved' && setAside.length > 0

        return (
        <section key={group.id} className={`outfit-card is-${group.status}${blocked ? ' is-blocked' : ''}`}>
          <header className="outfit-head">
            <div>
              <h2 className="outfit-name">{group.name}</h2>
              {/*
                * What it was planned for: when, where, and how dressy (doc 04 §9).
                *
                * No activity label here — the card's own name IS the occasion
                * ("Nice dinners", "Safari"), so naming it again read as a stutter.
                */}
              <p className="outfit-context">{context.join(' · ')}</p>
              {conditions ? <p className="outfit-weather">{conditions}</p> : null}
              {/*
                * Marked, not merely grouped (doc 09 §7).
                *
                * The planner has always treated travel days and multi-day
                * outfits differently; until now nothing said so, and a card
                * named "Travel days" was doing the marking by implication.
                */}
              {markers.length > 0 ? (
                <p className="outfit-markers">
                  {markers.map((marker, index) => (
                    <span key={marker.label}>
                      {index > 0 ? (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span className="visually-hidden">, </span>
                        </>
                      ) : null}
                      {marker.label}
                    </span>
                  ))}
                </p>
              ) : null}
              {/*
                * The status line, and only what the markers above do NOT say.
                *
                * `Missing something` used to appear here as well as in the
                * markers — twice on every incomplete card, the second copy with
                * an orphan leading middot because the approved branch beside it
                * was empty. The markers own that fact now; this line owns the
                * two the markers cannot know, because both are derived from the
                * checklist rather than from the outfit.
                */}
              <p className="outfit-count">
                {group.status === 'approved' && !blocked ? 'On your packing list' : ''}
                {blocked
                  ? `Incomplete — you are not bringing the ${joinNames(
                      setAside.map((slot) => slot.itemName ?? 'garment'),
                    )}`
                  : ''}
              </p>
            </div>
          </header>

          {/*
            * Why Pack Smart chose this one, in one sentence.
            *
            * Built only from the criteria that actually separated each garment
            * from its runner-up — `explainOutfit` aggregates the slots' stored
            * `decidedBy` and recomputes nothing. So it cannot credit comfort on
            * a card where comfort said nothing, and it hands the outfit back to
            * Alex when a slot is his: "You chose this one."
            *
            * Null on a card where nothing was recorded — an outfit from before
            * reasons were stored, or one where every slot was forced. Silence is
            * the honest answer there; an invented reason is not.
            */}
          {explainOutfit(group.slots) ? (
            <p className="outfit-why">{explainOutfit(group.slots)}</p>
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
                  <span className="slot-role">{slot.roleLabel}</span>
                  <span className="slot-body">
                    <span className="slot-item">{slot.itemName ?? slot.unmetReason}</span>
                    {slot.setAside ? (
                      <span className="slot-set-aside">
                        Not bringing this. Choose something else, or put it back on the list.
                      </span>
                    ) : slot.itemName && slotSecondary(slot) ? (
                      /* Which garment, then how often, then why (G6). The name
                       * no longer repeats the brand and the colour, and Alex
                       * owns seven quarter-zips. */
                      <span className="slot-reason">{slotSecondary(slot)}</span>
                    ) : null}
                  </span>
                  <span className="slot-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className={group.status === 'approved' ? 'button-quiet' : 'button-primary'}
            onClick={() => void toggleApproval(group)}
            disabled={busy}
          >
            {group.status === 'approved' ? 'Undo approval' : 'Approve outfit'}
          </button>
        </section>
        )
      })}

      {groups !== null && groups.length > 0 ? (
        <>
          <button type="button" className="button-secondary" onClick={() => void plan()} disabled={busy}>
            Plan again
          </button>
          <p className="hint">
            Planning again leaves approved outfits alone. Anything still a draft is redone.
          </p>
        </>
      ) : null}

      <button type="button" className="button-secondary" onClick={() => navigate(`/trips/${id}`)}>
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
