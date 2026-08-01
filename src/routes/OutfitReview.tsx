import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Screen } from '@/components/Screen'
import { SwapSheet, type SwapTarget } from '@/components/SwapSheet'
import { describeOutfits, type ReviewedOutfit } from '@/lib/outfitReview'
import { routeFor } from '@/lib/readinessRoute'
import {
  deferOutfit,
  fetchChecklist,
  fetchOutfits,
  fetchTrip,
  fetchWeather,
  setOutfitStatus,
  type OutfitGroup,
} from '@/lib/trips'
import type { ChecklistEntry } from '@shared/checklist'
import {
  coverageBreakdown,
  coverageSentence,
  joinNames,
  needsReviewNow,
  outfitCoverage,
  reviewProgress,
  uncoveredNeeds,
} from '@shared/outfits'
import { readiness, todayISO } from '@shared/readiness'
import type { Trip } from '@shared/trips'
import type { WeatherDay } from '@shared/weather'
import './OutfitReview.css'

/**
 * The guided outfit review (doc 09 §7).
 *
 * A ROUTE, not a stack of sheets. The clause asks for one unresolved outfit at
 * a time and in the same breath forbids a modal prison — and a bottom sheet
 * that owns the whole decision is exactly that on iPhone Safari, where the only
 * reliable way out of a sheet is the control the sheet chooses to offer. As a
 * route, the browser's own Back gesture leaves the review and lands on the full
 * list, which is the escape hatch Alex already knows how to use.
 *
 * The position is held in component state rather than the URL on purpose. Where
 * Alex is up to is not a fact about the outfits — it is derived from them, and
 * every real decision is already stored, so re-entering resumes at the first
 * outfit still wanting an answer whether he left five seconds or five days ago.
 * Putting the index in the path would instead make Back walk one outfit at a
 * time and take four taps to escape a four-outfit trip.
 */
export default function OutfitReview() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const [trip, setTrip] = useState<Trip | null>(null)
  const [groups, setGroups] = useState<OutfitGroup[] | null>(null)
  const [entries, setEntries] = useState<ChecklistEntry[]>([])
  const [weatherDays, setWeatherDays] = useState<WeatherDay[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  /** Which outfit is on screen, by id — an index would slide under a re-plan. */
  const [cursor, setCursor] = useState<string | null>(null)
  /** Whether the garments are being changed rather than read. */
  const [editing, setEditing] = useState(false)
  const [swapping, setSwapping] = useState<SwapTarget | null>(null)
  /** True once every outfit has an answer, or Alex has walked past the last one. */
  const [finished, setFinished] = useState(false)

  /**
   * The heading of whatever is on screen — one outfit, or the closing summary.
   *
   * One ref for both because only one of them is ever mounted. Two refs would
   * mean the summary arrived with focus on a button that had just been removed,
   * which drops VoiceOver back to the top of the document — the review's last
   * screen being the one place it went quiet.
   */
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  /** Suppresses the focus move on first paint — only an ADVANCE should grab it. */
  const advanced = useRef(false)

  const load = useCallback(async () => {
    try {
      const [tripResult, outfitResult, checklist] = await Promise.all([
        fetchTrip(id),
        fetchOutfits(id),
        fetchChecklist(id),
      ])
      setTrip(tripResult)
      setGroups(outfitResult.groups)
      setEntries(checklist.entries)
      setError(null)

      // Allowed to fail: a trip with no forecast is the normal case, not an error.
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

  const reviewed = useMemo(
    () => describeOutfits(trip, groups ?? [], weatherDays),
    [trip, groups, weatherDays],
  )
  const coverage = useMemo(() => outfitCoverage(groups ?? []), [groups])

  /*
   * Where to start, and where to go next.
   *
   * "Still wants an answer" excludes deferred outfits, which is the whole
   * function of a deferral — they stay unresolved and they stay in the summary,
   * they simply stop stopping the walkthrough. Approved ones are excluded
   * because they have been answered.
   */
  const outstanding = useMemo(
    () => reviewed.filter((item) => needsReviewNow(item.group)),
    [reviewed],
  )

  // The opening position, chosen once the outfits are actually in hand.
  useEffect(() => {
    if (groups === null || cursor !== null || finished) return
    const first = outstanding[0]
    if (first) setCursor(first.group.id)
    else setFinished(true)
  }, [groups, cursor, finished, outstanding])

  const current = reviewed.find((item) => item.group.id === cursor) ?? null

  // Announces the new outfit by moving focus to its name. Only on an advance —
  // stealing focus on first paint would fight VoiceOver's own landing place.
  useEffect(() => {
    if (!advanced.current) return
    advanced.current = false
    headingRef.current?.focus()
  }, [cursor, finished])

  /** The next outfit still wanting an answer, skipping the one just answered. */
  function advance(from: string) {
    const next = outstanding.find((item) => item.group.id !== from)
    advanced.current = true
    setEditing(false)
    if (next) setCursor(next.group.id)
    else setFinished(true)
  }

  async function approve(group: OutfitGroup) {
    setBusy(true)
    setNotice(null)
    try {
      const result = await setOutfitStatus(id, group.id, 'approved')
      setGroups(result.groups)

      if (result.refused) {
        // Never advance past an outfit that was not approved. Moving on would
        // read as acceptance of a decision the server declined to make.
        setNotice('Fill the missing pieces before approving this outfit.')
        return
      }

      setNotice(
        result.sync.added > 0
          ? `${result.sync.added} added to your packing list.`
          : 'Approved.',
      )
      advance(group.id)
    } catch {
      setError('Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  async function decideLater(group: OutfitGroup) {
    setBusy(true)
    setNotice(null)
    try {
      const result = await deferOutfit(id, group.id, true)
      setGroups(result.groups)
      setNotice('Left for later. Nothing about it has changed.')
      advance(group.id)
    } catch {
      setError('Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  async function undoApproval(group: OutfitGroup) {
    setBusy(true)
    setNotice(null)
    try {
      const result = await setOutfitStatus(id, group.id, 'draft')
      setGroups(result.groups)
      setNotice(
        result.sync.removed > 0
          ? `${result.sync.removed} removed from your packing list.`
          : 'No longer approved.',
      )
    } catch {
      setError('Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  /** Steps back to the outfit before this one in the plan's own order. */
  function back() {
    const index = reviewed.findIndex((item) => item.group.id === cursor)
    const previous = index > 0 ? reviewed[index - 1] : null
    if (!previous) return
    advanced.current = true
    setEditing(false)
    setFinished(false)
    setCursor(previous.group.id)
  }

  const exit = () => navigate(`/trips/${id}/outfits`)

  if (!trip && !error) return <Screen title="Review outfits" />

  const ready = trip
    ? readiness({ trip, entries, outfits: groups ?? [], today: todayISO() })
    : null

  const progress = coverage.totalGroups > 0 ? reviewProgress(coverage) : null

  return (
    <Screen title="Review outfits" subtitle={trip ? `${trip.emoji} ${trip.name}` : undefined}>
      {error ? <p className="field-error">{error}</p> : null}

      {/*
        * Compact progress, and the way out, on one line.
        *
        * Doc 09 §7 asks for progress without wizard chrome — so a sentence
        * rather than a row of step dots, which say the same thing less clearly
        * and cost a VoiceOver user four meaningless stops.
        */}
      {progress ? (
        <p className="review-bar">
          <span className="review-progress">{progress}</span>
          <button type="button" className="link-button" onClick={exit}>
            See all outfits
          </button>
        </p>
      ) : null}

      {notice ? (
        <p className="banner banner-quiet" role="status">
          {notice}
        </p>
      ) : null}

      {groups !== null && groups.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">No outfits planned</p>
          <p className="empty-state-body">
            Plan outfits first, and this is where you will go through them.
          </p>
          <button type="button" className="button-primary" onClick={exit}>
            Go to outfits
          </button>
        </div>
      ) : null}

      {finished || !current ? (
        groups !== null && groups.length > 0 ? (
          <ReviewSummary
            coverage={coverage}
            reviewed={reviewed}
            headingRef={headingRef}
            nextLabel={ready?.next?.label ?? null}
            nextDetail={ready?.next?.detail ?? null}
            onNext={() =>
              navigate(ready?.next ? routeFor(id, ready.next.route) : `/trips/${id}`)
            }
            onResume={(groupId) => {
              advanced.current = true
              setFinished(false)
              setCursor(groupId)
            }}
            onSeeAll={exit}
          />
        ) : null
      ) : (
        <OutfitPanel
          item={current}
          headingRef={headingRef}
          editing={editing}
          busy={busy}
          canGoBack={reviewed.findIndex((i) => i.group.id === cursor) > 0}
          onBack={back}
          onEdit={() => setEditing(true)}
          onDoneEditing={() => setEditing(false)}
          onSwap={setSwapping}
          onApprove={() => void approve(current.group)}
          onDecideLater={() => void decideLater(current.group)}
          onUndoApproval={() => void undoApproval(current.group)}
        />
      )}

      <SwapSheet
        open={swapping !== null}
        tripId={id}
        target={swapping}
        onClose={() => setSwapping(null)}
        onChanged={(next) => {
          setGroups(next)
          setSwapping(null)
          // Deliberately stays on this outfit. A swap is a change, not a
          // decision — advancing here would approve nothing and look like it had.
          setNotice('Changed. The rest of the outfit is as it was.')
        }}
      />
    </Screen>
  )
}

/* ------------------------------------------------------------------ */
/* one outfit                                                          */
/* ------------------------------------------------------------------ */

interface OutfitPanelProps {
  item: ReviewedOutfit
  headingRef: MutableRefObject<HTMLHeadingElement | null>
  editing: boolean
  busy: boolean
  canGoBack: boolean
  onBack: () => void
  onEdit: () => void
  onDoneEditing: () => void
  onSwap: (target: SwapTarget) => void
  onApprove: () => void
  onDecideLater: () => void
  onUndoApproval: () => void
}

function OutfitPanel({
  item,
  headingRef,
  editing,
  busy,
  canGoBack,
  onBack,
  onEdit,
  onDoneEditing,
  onSwap,
  onApprove,
  onDecideLater,
  onUndoApproval,
}: OutfitPanelProps) {
  const { group } = item
  const approved = group.status === 'approved'

  return (
    <section className="review-panel" aria-labelledby={`review-name-${group.id}`}>
      <h2 className="review-name" id={`review-name-${group.id}`} ref={headingRef} tabIndex={-1}>
        {group.name}
      </h2>

      {item.markers.length > 0 ? (
        <ul className="review-markers">
          {item.markers.map((marker) => (
            <li key={marker.label} className="review-marker">
              <span className="review-marker-label">{marker.label}</span>
              <span className="review-marker-detail">{marker.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        * What this outfit was planned against, as labelled facts.
        *
        * A description list rather than a run-on line: VoiceOver reads each
        * label with its value, so "Weather, usually 55 to 70 degrees" arrives as
        * one statement instead of a temperature floating loose in a sentence.
        * Anything not recorded says so — doc 09 §25 would rather Alex knew there
        * is no forecast than be shown a confident blank.
        */}
      <dl className="review-facts">
        <div className="review-fact">
          <dt>When</dt>
          <dd>{item.when}</dd>
        </div>
        {item.place ? (
          <div className="review-fact">
            <dt>Where</dt>
            <dd>{item.place}</dd>
          </div>
        ) : null}
        <div className="review-fact">
          <dt>What for</dt>
          <dd>{item.activity ?? group.name}</dd>
        </div>
        <div className="review-fact">
          <dt>Weather</dt>
          <dd>{item.conditions ?? 'No forecast stored for these days.'}</dd>
        </div>
        {item.formality ? (
          <div className="review-fact">
            <dt>How dressy</dt>
            <dd>{item.formality}</dd>
          </div>
        ) : null}
      </dl>

      {item.fit.length > 0 ? (
        <p className="review-fit">{item.fit.join(' ')}</p>
      ) : null}

      {/*
        * The garments. Plain text until Alex says he wants to change something —
        * doc 09 §7 asks for exactly three primary decisions, and eight tappable
        * rows above them would be eleven.
        */}
      <ul className="review-slots">
        {group.slots.map((slot) => {
          const label = slot.itemName ?? slot.unmetReason ?? 'Nothing chosen'
          const detail = slot.setAside
            ? 'Not bringing this. Choose something else, or put it back on the list.'
            : slot.itemName && slot.wearings > 1
              ? `Worn ${slot.wearings} days`
              : null

          if (!editing) {
            return (
              <li
                key={slot.id}
                className={`review-slot${slot.itemId ? '' : ' is-empty'}${slot.setAside ? ' is-set-aside' : ''}`}
              >
                <span className="review-slot-role">{slot.roleLabel}</span>
                <span className="review-slot-body">
                  <span className="review-slot-item">{label}</span>
                  {detail ? <span className="review-slot-detail">{detail}</span> : null}
                  {slot.reason && !slot.setAside ? (
                    <span className="review-slot-detail">{slot.reason}</span>
                  ) : null}
                </span>
              </li>
            )
          }

          return (
            <li key={slot.id}>
              <button
                type="button"
                className={`review-slot is-editable${slot.itemId ? '' : ' is-empty'}${slot.setAside ? ' is-set-aside' : ''}`}
                onClick={() =>
                  onSwap({
                    groupId: group.id,
                    slotId: slot.id,
                    roleLabel: slot.roleLabel,
                    itemId: slot.itemId,
                  })
                }
              >
                <span className="review-slot-role">{slot.roleLabel}</span>
                <span className="review-slot-body">
                  <span className="review-slot-item">{label}</span>
                  {detail ? <span className="review-slot-detail">{detail}</span> : null}
                </span>
                <span className="review-slot-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {item.missing.length > 0 ? (
        <p className="review-gap">
          {item.missing.length === 1
            ? `This outfit has no ${item.missing[0]!.roleLabel.toLowerCase()} yet.`
            : `This outfit is missing its ${joinNames(item.missing.map((s) => s.roleLabel.toLowerCase()))}.`}{' '}
          It cannot be approved until every required piece is filled.
        </p>
      ) : null}

      {/*
        * Three primary decisions, and nothing competing with them.
        *
        * `Change something` becomes `Done changing` while the garments are
        * editable, so the count on screen never grows past three.
        */}
      <div className="review-actions">
        {approved ? (
          <button type="button" className="button-quiet" onClick={onUndoApproval} disabled={busy}>
            Undo approval
          </button>
        ) : (
          <button type="button" className="button-primary" onClick={onApprove} disabled={busy}>
            Approve outfit
          </button>
        )}

        <button
          type="button"
          className="button-secondary"
          onClick={editing ? onDoneEditing : onEdit}
          disabled={busy}
        >
          {editing ? 'Done changing' : 'Change something'}
        </button>

        {approved ? null : (
          <button type="button" className="button-secondary" onClick={onDecideLater} disabled={busy}>
            Decide later
          </button>
        )}
      </div>

      {canGoBack ? (
        <button type="button" className="link-button review-back" onClick={onBack}>
          ← Previous outfit
        </button>
      ) : null}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* the end of the review                                               */
/* ------------------------------------------------------------------ */

interface ReviewSummaryProps {
  coverage: ReturnType<typeof outfitCoverage>
  reviewed: ReviewedOutfit[]
  headingRef: MutableRefObject<HTMLHeadingElement | null>
  nextLabel: string | null
  nextDetail: string | null
  onNext: () => void
  onResume: (groupId: string) => void
  onSeeAll: () => void
}

/**
 * Where the walkthrough ends (doc 09 §7).
 *
 * The coverage sentence first, because it is the answer to "am I done" — and it
 * counts DAYS covered as well as outfits approved, so six approved outfits that
 * cover four days of twelve cannot read as finished. Anything left is listed by
 * name with one tap back into it, which is what stops "decide later" from being
 * a way to lose an outfit.
 */
function ReviewSummary({
  coverage,
  reviewed,
  headingRef,
  nextLabel,
  nextDetail,
  onNext,
  onResume,
  onSeeAll,
}: ReviewSummaryProps) {
  const unresolved = reviewed.filter((item) => item.group.status !== 'approved')
  const first = unresolved[0]
  const breakdown = coverageBreakdown(reviewed.map((item) => item.group))
  const uncovered = uncoveredNeeds(coverage)

  return (
    <section className="review-summary">
      <h2 className="review-summary-headline" ref={headingRef} tabIndex={-1}>
        {coverageSentence(coverage)}
      </h2>

      {/*
       * The breakdown doc 09 §7 asks for: approved, deferred, incomplete, and
       * what is simply unanswered. Middot for the eye and a visually-hidden
       * comma for the ear — `·` is not announced at VoiceOver's default
       * punctuation level, so joined facts otherwise run together with no
       * pause. The same fix C1 made on the checklist.
       */}
      {breakdown.length > 0 ? (
        <p className="review-summary-breakdown">
          {breakdown.map((part, index) => (
            <span key={part}>
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
      ) : null}

      {/*
       * The days nothing approved covers — the half that is easiest to omit and
       * hardest to notice missing, because "7 approved outfits" sounds finished
       * and four bare days do not announce themselves.
       */}
      {uncovered > 0 ? (
        <p className="review-summary-uncovered">
          {uncovered === 1 ? 'One day has' : `${uncovered} days have`} no approved outfit yet.
        </p>
      ) : null}

      {/*
       * One primary action, and which one depends on what is actually left.
       *
       * While outfits are outstanding the useful next step is the outfit itself,
       * named — "Review Safari" rather than a count that makes Alex go and find
       * out which. Once nothing is outstanding the judgement is no longer this
       * screen's to make, and `readiness()` answers it: doc 09 §4 keeps that
       * decision in one place so Home, the trip screen and this one cannot
       * recommend three different things.
       */}
      {first ? (
        <>
          <p className="review-summary-body">
            {unresolved.length === 1
              ? 'One outfit still needs review.'
              : `${unresolved.length} outfits still need review.`}{' '}
            Their clothing is not on your packing list until you approve them.
          </p>
          <button
            type="button"
            className="button-primary"
            onClick={() => onResume(first.group.id)}
          >
            Review {first.group.name}
          </button>
          <ul className="review-outstanding">
            {unresolved.map((item) => (
              <li key={item.group.id}>
                <button
                  type="button"
                  className="review-outstanding-row"
                  onClick={() => onResume(item.group.id)}
                >
                  <span className="review-outstanding-name">{item.group.name}</span>
                  <span className="review-outstanding-state">
                    {item.group.status === 'incomplete'
                      ? 'Missing something'
                      : item.group.deferredAt !== null
                        ? 'Left for later'
                        : 'Not reviewed'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="review-summary-body">
            Every outfit is approved and its clothing is on your packing list.
          </p>
          {/*
           * Always one action, never none.
           *
           * `readiness()` returns no next action when a trip is genuinely ready
           * or already finished — correct for Home, which then says so, and
           * wrong here, where the review would end on a wall of text and a
           * secondary link. The fallback goes back to the trip, which is where
           * someone who has just finished reviewing outfits is going anyway.
           */}
          <button type="button" className="button-primary" onClick={onNext}>
            {nextLabel ?? 'Back to the trip'}
          </button>
          {nextDetail ? <p className="hint">{nextDetail}</p> : null}
        </>
      )}

      <button type="button" className="button-secondary" onClick={onSeeAll}>
        See all outfits
      </button>
    </section>
  )
}
