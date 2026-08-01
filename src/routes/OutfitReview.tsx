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
  /** The control that was under the finger when `busy` disabled it. */
  const restoreFocus = useRef<HTMLElement | null>(null)

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
      announce({ error: 'Could not load this trip’s outfits.' })
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

  /*
   * Announces the new outfit by moving focus to its name, THEN says what the
   * last decision did.
   *
   * Only on an advance. Stealing focus on first paint would fight VoiceOver's
   * own landing place.
   *
   * Nothing is announced here — see `announce()` for why every outcome message
   * is deliberately held until after whatever focus move its commit performs.
   */
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

  /**
   * Gives focus back to the control that was disabled under the finger.
   *
   * `disabled` on the focused button moves `document.activeElement` to
   * `<body>` — verified, not assumed — and nothing put it back. On the paths
   * that advance, the focus move to the next heading rescues it by accident;
   * on `Undo approval`, on a refusal, and on every failure there is no advance,
   * so a keyboard user was left at the top of the document while the buttons
   * beneath silently changed meaning.
   *
   * An EFFECT on `busy`, not a microtask after `setBusy(false)`. The first
   * version used the microtask and did nothing at all: it ran before React had
   * committed the re-render, so the button was still `disabled` and `.focus()`
   * on a disabled element is a no-op. The e2e assertion caught it.
   *
   * Declared after the advance effect on purpose. Effects run in order, so an
   * advance claims focus first and this then sees that something already has
   * it and leaves well alone.
   */
  useEffect(() => {
    if (busy) return
    const target = restoreFocus.current
    restoreFocus.current = null
    if (!target || !target.isConnected) return
    if (document.activeElement !== document.body) return
    target.focus()
  }, [busy])

  /**
   * Says what just happened — always AFTER whatever focus move this commit makes.
   *
   * One mechanism, because there turned out to be four paths and the first fix
   * only covered two. A focus change is a top-priority interruption in
   * VoiceOver: it cuts off a live-region announcement that started microseconds
   * earlier, whether that region is `polite` or `assertive`. So every path that
   * both announces and moves focus has to announce second, and "every path"
   * includes the ones where the focus move is somebody else's — `undoApproval`
   * is followed by the focus RESTORE, and a swap is followed by `BottomSheet`
   * returning focus in its own unmount cleanup.
   *
   * A frame, rather than an effect. The focus moves in this screen happen in
   * passive effects and in another component's cleanup; there is no single hook
   * that reliably runs after all of them. The next frame is after all of them,
   * by construction, and costs one repaint of a region nobody is looking at.
   */
  function announce(next: { notice?: string; error?: string }) {
    requestAnimationFrame(() => {
      if (next.notice !== undefined) setNotice(next.notice)
      if (next.error !== undefined) setError(next.error)
    })
  }

  /** Runs a decision, remembering where focus was before the button vanished. */
  async function act(work: () => Promise<void>) {
    restoreFocus.current = document.activeElement as HTMLElement | null
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      await work()
    } catch {
      announce({ error: 'Could not save that.' })
    } finally {
      setBusy(false)
    }
  }

  async function approve(group: OutfitGroup) {
    await act(async () => {
      const result = await setOutfitStatus(id, group.id, 'approved')
      setGroups(result.groups)

      if (result.refused) {
        /*
         * Never advance past an outfit that was not approved — moving on would
         * read as acceptance of a decision the server declined to make. Said as
         * an ERROR rather than a status: it is a refusal of the action just
         * taken, and `polite` on a screen where focus has just moved is the
         * same as silence.
         */
        announce({ error: 'Fill the missing pieces before approving this outfit.' })
        return
      }

      announce({
        notice:
          result.sync.added > 0 ? `${result.sync.added} added to your packing list.` : 'Approved.',
      })
      advance(group.id)
    })
  }

  async function decideLater(group: OutfitGroup) {
    await act(async () => {
      const result = await deferOutfit(id, group.id, true)
      setGroups(result.groups)
      announce({ notice: 'Left for later. Nothing about it has changed.' })
      advance(group.id)
    })
  }

  async function undoApproval(group: OutfitGroup) {
    await act(async () => {
      const result = await setOutfitStatus(id, group.id, 'draft')
      setGroups(result.groups)
      /*
       * Through `announce` like everything else. There is no advance here, but
       * the focus RESTORE that follows would cut the announcement off just the
       * same — an earlier comment claiming nothing raced it was wrong, and it
       * was wrong because of the focus fix added beside it.
       */
      announce({
        notice:
          result.sync.removed > 0
            ? `${result.sync.removed} removed from your packing list.`
            : 'No longer approved.',
      })
    })
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

  /**
   * The two announcement regions, extracted so they can be rendered on BOTH
   * sides of the loading state.
   *
   * They were inside the loaded branch only, behind an early return that fires
   * while `trip` and `error` are both null — so on the one failure the screen
   * can produce before anything else, the load failure, the guard flipped false
   * and the alert region was inserted into the DOM *already containing its
   * text*. That is exactly the shape these regions exist to avoid, on the
   * earliest error there is. A live region has to exist first and then change.
   *
   * Two regions rather than one, because the two things differ in urgency: a
   * refusal or a failure interrupts, a confirmation waits its turn.
   */
  const announcements = (
    <>
      <div role="alert" aria-live="assertive">
        {error ? <p className="field-error">{error}</p> : null}
      </div>
      <div role="status" aria-live="polite">
        {notice ? <p className="banner banner-quiet">{notice}</p> : null}
      </div>
    </>
  )

  if (!trip && !error) return <Screen title="Review outfits">{announcements}</Screen>

  const ready = trip
    ? readiness({ trip, entries, outfits: groups ?? [], today: todayISO() })
    : null

  const progress = coverage.totalGroups > 0 ? reviewProgress(coverage) : null

  return (
    <Screen title="Review outfits" subtitle={trip ? `${trip.emoji} ${trip.name}` : undefined}>
      {announcements}

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
          /*
           * Deliberately stays on this outfit. A swap is a change, not a
           * decision — advancing here would approve nothing and look like it
           * had. Announced after the frame, because closing the sheet hands
           * focus back to the slot button in `BottomSheet`'s own cleanup.
           */
          announce({ notice: 'Changed. The rest of the outfit is as it was.' })
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

  const slotsRef = useRef<HTMLUListElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  /* Only a DELIBERATE toggle moves focus — not the first paint, and not a
     re-render caused by a swap landing. */
  const toggled = useRef(false)

  useEffect(() => {
    if (!toggled.current) return
    toggled.current = false
    if (editing) slotsRef.current?.querySelector('button')?.focus()
    else toggleRef.current?.focus()
  }, [editing])

  /*
   * No `aria-labelledby` on the section below.
   *
   * Naming the region with the very heading focus lands on made VoiceOver
   * announce the outfit's name twice on every advance — once as the region
   * boundary, once as the heading. The `h2` already structures the panel.
   */
  return (
    <section className="review-panel">
      <h2 className="review-name" ref={headingRef} tabIndex={-1}>
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
        {/*
          * Only when it adds something the heading has not already said.
          *
          * A travel group has no activity at all, and its name is the answer.
          * A tagged group can be worse: `ACTIVITY_LABELS.nice_dinner` is
          * "Nice dinners" and so is the group's name, so the row read
          * "Nice dinners … What for, Nice dinners". Omitting on the null case
          * alone missed that, which the e2e assertion caught.
          */}
        {item.activity && item.activity !== group.name ? (
          <div className="review-fact">
            <dt>What for</dt>
            <dd>{item.activity}</dd>
          </div>
        ) : null}
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
      <ul className="review-slots" id={`review-slots-${group.id}`} ref={slotsRef}>
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
                  {/* Kept in edit mode too — entering it must not quietly
                      remove the reason the garment was chosen. */}
                  {slot.reason && !slot.setAside ? (
                    <span className="review-slot-detail">{slot.reason}</span>
                  ) : null}
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
            : `This outfit is missing its ${joinNames(item.missing.map((s) => s.roleLabel.toLowerCase()))}.`}
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

        {/*
          * Activating this rewrites every garment row above it from text into a
          * button. Nothing said so: focus stayed here, the label changed
          * underneath it, and a VoiceOver user had already read past a list
          * that was now interactive with no way to know.
          *
          * The fix is the FOCUS MOVE, not an ARIA attribute — landing on the
          * first row that became a control is the announcement.
          *
          * `aria-expanded` was tried and removed: nothing is shown or hidden
          * here. The rows are fully readable in both modes; they change from
          * text into buttons. Announcing "Change something, collapsed" about a
          * list the user can already read in full is a false programmatic state
          * under 4.1.2 — a worse defect than the silence it was meant to fix.
          */}
        <button
          type="button"
          className="button-secondary"
          ref={toggleRef}
          onClick={() => {
            toggled.current = true
            if (editing) onDoneEditing()
            else onEdit()
          }}
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
