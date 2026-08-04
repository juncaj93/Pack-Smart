import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BottomSheet } from '@/components/BottomSheet'
import { Screen } from '@/components/Screen'
import {
  fetchAlternatives,
  fetchToday,
  patchEntry,
  recordWear,
  restoreEntry,
  swapForToday,
  type PlannedItem,
  type TodayResponse,
  type TodayUpdate,
  type WearAction,
} from '@/lib/trips'
import {
  CARRY_VISIBLE,
  carryItemCount,
  describeTodayWeather,
  recoveryActions,
  type UnresolvedSlot,
} from '@shared/today'
import './Today.css'

/**
 * Today — the screen the app opens on during a trip.
 *
 * It answers six questions and nothing else: where am I, what am I doing, what
 * am I wearing, what weather matters, is anything unresolved, is there something
 * I need to carry. It is a travel companion, not a second planner, which is why
 * every control that changes the TRIP lives one tap away rather than here.
 *
 * Two rules from product doc 04 §10 hold the whole screen up:
 *
 *   - **Only clothing confirmed as packed may be recommended.** Enforced in
 *     `packedOnly`, server-side, on every path. Nothing here can route around it.
 *   - **An approved outfit is never silently changed.** Everything below that
 *     touches an outfit is something Alex taps, with the consequence written on
 *     the control.
 *
 * The plan itself is read, not recomputed (risk R12) — opening the app twice on
 * the same morning shows the same clothes.
 */

const ADJUSTMENTS: Array<{ action: WearAction; label: string }> = [
  { action: 'too_warm', label: 'Too warm' },
  { action: 'too_cold', label: 'Too cold' },
  { action: 'not_available', label: 'Not available' },
]

function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export default function Today() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [data, setData] = useState<TodayResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [acting, setActing] = useState<PlannedItem | null>(null)
  const [resolving, setResolving] = useState<UnresolvedSlot | null>(null)
  const [showAllCarry, setShowAllCarry] = useState(false)
  const [options, setOptions] = useState<Array<{ itemId: string; name: string }> | null>(null)

  const date = params.get('date') ?? undefined

  const load = useCallback(async () => {
    try {
      setData(await fetchToday(id, date))
      setError(null)
    } catch {
      setError('Could not load today’s plan.')
    }
  }, [id, date])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!acting || !data) {
      setOptions(null)
      return
    }
    let cancelled = false
    fetchAlternatives(id, data.date, acting.role)
      .then((result) => {
        if (!cancelled) setOptions(result.options)
      })
      .catch(() => {
        if (!cancelled) setOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [acting, data, id])

  /**
   * Takes the server's whole answer, not just the plan.
   *
   * A swap can empty the unresolved section and change what the carry list
   * names. Merging only `plan` left the explanation above it describing a state
   * that had stopped being true one tap earlier.
   */
  function applyUpdate(update: TodayUpdate) {
    setData((prev) => (prev ? { ...prev, ...update } : prev))
  }

  async function act(item: PlannedItem, action: WearAction, replaceWith?: string | null) {
    if (!data || busy) return
    setBusy(true)
    try {
      applyUpdate(await recordWear(id, data.date, item.itemId, action, replaceWith))
      setActing(null)
    } catch {
      setError('Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  async function swap(fromItemId: string, toItemId: string) {
    if (!data || busy) return
    setBusy(true)
    try {
      applyUpdate(await swapForToday(id, data.date, fromItemId, toItemId))
      setActing(null)
      setResolving(null)
    } catch {
      setError('Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * "It is in my bag" — the answer to the commonest unresolved slot there is.
   *
   * This writes to the PACKING LIST, not to the outfit. Alex is correcting a
   * fact about his suitcase, and the approved outfit is left exactly as it was;
   * the garment simply becomes eligible again because it is now packed. That is
   * the difference between resolving a dead end and quietly rewriting a plan.
   */
  async function markPacked(slot: UnresolvedSlot) {
    if (!slot.entryId || busy) return
    setBusy(true)
    try {
      // Two writes for a row Alex had excluded, because Not bringing and
      // unpacked are separate facts and putting the row back does not tick it.
      const restored = slot.excluded ? await restoreEntry(id, slot.entryId) : null
      await patchEntry(id, slot.entryId, {
        packedQty: Math.max(1, restored?.requiredQty ?? 1),
      })
      setResolving(null)
      await load()
    } catch {
      setError('Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  const weatherLine = useMemo(
    () => (data ? describeTodayWeather(data.weather) : null),
    [data],
  )

  if (!data) {
    return (
      <Screen title="Today">
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </Screen>
    )
  }

  const { plan, wearLog, dates, issue, carry } = data
  const index = dates.indexOf(data.date)
  const isCurrentDay = data.date === data.todayDate

  const context = [data.place?.name, data.activity?.label].filter(Boolean).join(' · ')

  /**
   * Wearing something else in an unresolved slot.
   *
   * A day-only adjustment on the daily plan — the same mechanism the wear sheet
   * uses — so the approved outfit still says what it always said. The planned
   * garment is the thing being replaced, which is why the slot has to be matched
   * back to its plan entry; a slot with no garment behind it has nothing to hang
   * an adjustment on, and the control is not offered for one.
   */
  async function swapFromSlot(slot: UnresolvedSlot, toItemId: string) {
    const from = plan.missing.find((gap) => gap.role === slot.role)?.itemId
    if (!from) return
    await swap(from, toItemId)
  }

  /*
   * The first few, then the rest behind one tap.
   *
   * Counted across the groups rather than within them, so the section is a
   * fixed size on the screen however the reminders happen to be distributed. A
   * group is never cut in half — it is shown whole or it waits.
   */
  const total = carryItemCount(carry)
  const visibleCarry = showAllCarry ? carry : (() => {
    const out: typeof carry = []
    let shown = 0
    for (const group of carry) {
      if (shown > 0 && shown + group.items.length > CARRY_VISIBLE) break
      out.push(group)
      shown += group.items.length
    }
    return out
  })()
  const hidden = total - carryItemCount(visibleCarry)

  return (
    <Screen title="Today" subtitle={formatDay(data.date)}>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      {/*
        * Where and what, in one line, above everything else.
        *
        * `role="status"` rather than a heading: it changes when Alex pages
        * between days, and the change is the thing worth announcing. It renders
        * only when there is something true to say — an empty grey line under the
        * date would be worse than no line.
        */}
      {context ? (
        <p className="today-context" role="status">
          {context}
        </p>
      ) : null}

      {weatherLine ? (
        <p className={`today-weather ${weatherLine.seasonal ? 'is-seasonal' : ''}`}>
          <span className="today-weather-text">{weatherLine.text}</span>
          {/*
            * A climate normal is never allowed to read as a forecast
            * (`01_ARCHITECTURE.md` §6). The word `Usually` is already in the
            * text; this says it a second way, for the same reason the trip
            * screen does — the number is what gets read, and the number looks
            * identical either way.
            */}
          {weatherLine.seasonal ? (
            <span className="today-weather-tag">Usual weather, not a forecast</span>
          ) : null}
        </p>
      ) : null}

      {/*
        * The one caveat this screen carries, and only where it can matter.
        *
        * Shown when the trip crosses a border and nothing recorded says which
        * time zone it crosses into — which is exactly when a phone still on home
        * time puts Alex on the wrong day. A domestic trip says nothing, because
        * on a domestic trip the phone is right.
        */}
      {data.dateCaveat && isCurrentDay ? (
        <p className="today-date-note">
          Day from your phone — no time zone recorded for this trip.
        </p>
      ) : null}

      <div className="day-nav">
        <button
          type="button"
          onClick={() => setParams({ date: dates[index - 1]! })}
          disabled={index <= 0}
          aria-label="Previous day"
        >
          ‹
        </button>
        <span className="day-label">
          {plan.groupName ?? 'No outfit planned'}
          <span className="day-of">
            Day {index + 1} of {dates.length}
            {isCurrentDay ? '' : ' · not today'}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setParams({ date: dates[index + 1]! })}
          disabled={index >= dates.length - 1}
          aria-label="Next day"
        >
          ›
        </button>
      </div>

      {plan.wear.length > 0 ? (
        <section className="today-section">
          <h2 className="section-title">Wear</h2>
          <ul className="today-list">
            {plan.wear.map((item) => (
              <li key={item.itemId}>
                <button
                  type="button"
                  className={`today-row ${wearLog[item.itemId] ? 'is-logged' : ''}`}
                  onClick={() => setActing(item)}
                >
                  <span className="today-role">{item.roleLabel}</span>
                  <span className="today-body">
                    <span className="today-name">{item.name}</span>
                    {wearLog[item.itemId] ? (
                      <span className="today-note">{data.actionLabels[wearLog[item.itemId]!]}</span>
                    ) : item.reason ? (
                      <span className="today-note">{item.reason}</span>
                    ) : null}
                  </span>
                  <span className="today-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        * What is unresolved — said ONCE.
        *
        * The screen this replaces printed `No suitable packed top found.` four
        * times over, with nothing to do about any of them. On a real trip some
        * slots unfilled is the ordinary case, so it gets one explanation, a row
        * per affected slot naming the garment, and a way out of each.
        */}
      {issue.kind !== 'none' ? (
        <section className="today-section today-issue" aria-labelledby="today-issue-title">
          <h2 className="today-issue-title" id="today-issue-title">
            {issue.headline}
          </h2>
          <p className="today-issue-detail">{issue.detail}</p>

          {issue.slots.length > 0 ? (
            <ul className="today-list today-issue-list">
              {issue.slots.map((slot) => (
                <li key={slot.role}>
                  <button
                    type="button"
                    className="today-row"
                    onClick={() => setResolving(slot)}
                    disabled={busy}
                  >
                    <span className="today-role">{slot.roleLabel}</span>
                    <span className="today-body">
                      <span className="today-name">
                        {slot.plannedName ?? `Nothing packed for this`}
                      </span>
                      <span className="today-note">
                        {slot.excluded
                          ? 'On your Not bringing list'
                          : slot.alternatives.length > 0
                            ? `${slot.alternatives.length} packed ${
                                slot.alternatives.length === 1 ? 'alternative' : 'alternatives'
                              }`
                            : 'Nothing packed could take its place'}
                      </span>
                    </span>
                    <span className="today-chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <button
              type="button"
              className="button-primary"
              onClick={() =>
                navigate(issue.kind === 'no_outfit' ? `/trips/${id}/outfits` : `/trips/${id}`)
              }
            >
              {issue.kind === 'no_outfit' ? 'Review outfits' : 'Open packing list'}
            </button>
          )}
        </section>
      ) : null}

      {carry.length > 0 ? (
        <section className="today-section">
          <h2 className="section-title">Carry today</h2>
          {/*
            * The reason belongs to the GROUP, not to the row.
            *
            * The first version printed `Keep it with you rather than in a bag.`
            * under four consecutive medications. Four identical lines is not
            * explanation, it is wallpaper — the lesson the packing list and
            * `Before you go` both already learned (UX-04).
            */}
          {visibleCarry.map((group) => (
            <div key={group.kind} className="today-carry-group">
              <p className="today-carry-heading">{group.title}</p>
              <p className="today-carry-why">{group.why}</p>
              {group.items.length > 0 ? (
                <ul className="today-carry-list">
                  {group.items.map((item) => (
                    <li key={item.key} className="today-carry-item">
                      {item.label}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
          {/*
            * Progressive disclosure rather than a scroll. What fits beside the
            * outfit shows; the rest stays away unless it is asked for.
            */}
          {hidden > 0 ? (
            <button
              type="button"
              className="button-quiet"
              onClick={() => setShowAllCarry(true)}
            >
              Show {hidden} more
            </button>
          ) : null}
        </section>
      ) : null}

      {/*
        * The way back to the list — unless the panel above is already offering
        * it. Two buttons to the same place, one under the other, is the screen
        * asking twice and answering neither.
        */}
      {issue.kind === 'nothing_packed' ? null : (
        <button type="button" className="button-secondary" onClick={() => navigate(`/trips/${id}`)}>
          Packing list
        </button>
      )}

      <BottomSheet
        open={acting !== null}
        onClose={() => setActing(null)}
        title={acting?.name ?? ''}
      >
        <div className="form">
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={() => acting && void act(acting, 'will_wear')}
          >
            I will wear this
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={() => acting && void act(acting, 'already_wore')}
          >
            Already wore this
          </button>

          <p className="hint">
            Or take it out of today. Pack Smart will offer something else from your bag.
          </p>

          <div className="chips">
            {ADJUSTMENTS.map((adjustment) => (
              <button
                key={adjustment.action}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => acting && void act(acting, adjustment.action)}
              >
                {adjustment.label}
              </button>
            ))}
          </div>

          {options === null ? null : options.length === 0 ? (
            <p className="hint">You have nothing else packed that could take its place.</p>
          ) : (
            <>
              <p className="hint">Swap for something else you packed:</p>
              <ul className="swap-list">
                {options.map((option) => (
                  <li key={option.itemId}>
                    <button
                      type="button"
                      className="swap-row"
                      disabled={busy}
                      onClick={() => acting && void swap(acting.itemId, option.itemId)}
                    >
                      <span className="swap-name">{option.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </BottomSheet>

      {/*
        * The way out of an unresolved slot.
        *
        * One sheet, three or four controls, no wizard. Every one of them is
        * something Alex asserts — that the garment is in fact packed, that he
        * wants something else today, that the outfit itself should change. Pack
        * Smart decides none of it, which is what keeps an approved outfit
        * approved.
        */}
      <ResolveSheet
        slot={resolving}
        busy={busy}
        onClose={() => setResolving(null)}
        onMarkPacked={markPacked}
        onWearInstead={(slot, itemId) => void swapFromSlot(slot, itemId)}
        onReviewOutfit={() => navigate(`/trips/${id}/outfits`)}
        onOpenList={() => navigate(`/trips/${id}`)}
      />
    </Screen>
  )
}

function ResolveSheet(props: {
  slot: UnresolvedSlot | null
  busy: boolean
  onClose: () => void
  onMarkPacked: (slot: UnresolvedSlot) => void
  onWearInstead: (slot: UnresolvedSlot, itemId: string) => void
  onReviewOutfit: () => void
  onOpenList: () => void
}) {
  const { slot, busy } = props
  const actions = slot ? recoveryActions(slot) : []

  return (
    <BottomSheet
      open={slot !== null}
      onClose={props.onClose}
      title={slot?.plannedName ?? (slot ? `Today’s ${slot.roleLabel.toLowerCase()}` : '')}
    >
      {slot ? (
        <div className="form">
          <p className="hint">
            {slot.excluded
              ? 'You moved this to Not bringing, so Today leaves it out.'
              : slot.plannedName
                ? 'Today only suggests things you have confirmed are in your bag.'
                : 'Nothing you have packed fits this part of the outfit.'}
          </p>

          {actions.includes('put_back') ? (
            <button
              type="button"
              className="button-primary"
              disabled={busy}
              onClick={() => props.onMarkPacked(slot)}
            >
              Put it back and mark it packed
            </button>
          ) : null}

          {actions.includes('mark_packed') ? (
            <button
              type="button"
              className="button-primary"
              disabled={busy}
              onClick={() => props.onMarkPacked(slot)}
            >
              It is in my bag
            </button>
          ) : null}

          {actions.includes('wear_instead') ? (
            <>
              <p className="hint">Or wear something else you packed, today only:</p>
              <ul className="swap-list">
                {slot.alternatives.map((option) => (
                  <li key={option.itemId}>
                    <button
                      type="button"
                      className="swap-row"
                      disabled={busy}
                      onClick={() => props.onWearInstead(slot, option.itemId)}
                    >
                      <span className="swap-name">{option.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={props.onReviewOutfit}
          >
            Review outfits
          </button>

          {actions.includes('open_list') ? (
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={props.onOpenList}
            >
              Open packing list
            </button>
          ) : null}
        </div>
      ) : null}
    </BottomSheet>
  )
}
