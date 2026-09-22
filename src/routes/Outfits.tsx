import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AddToOutfitSheet } from '@/components/AddToOutfitSheet'
import { ColorDots } from '@/components/ColorDots'
import { NewOutfitSheet } from '@/components/NewOutfitSheet'
import { Screen } from '@/components/Screen'
import { SwapSheet, type SwapTarget } from '@/components/SwapSheet'
import { SwipeRow } from '@/components/SwipeRow'
import { useReorderDrag } from '@/components/useReorderDrag'
import { UndoBar, useUndoOffer } from '@/components/UndoBar'
import { useViewState } from '@/lib/viewState'
import { useSlotChoice } from '@/lib/useSlotChoice'
import {
  addOutfitItem,
  createOutfit,
  deleteOutfit,
  fetchOutfits,
  fetchTrip,
  fetchWeather,
  forgetOutfitPairings,
  generateOutfits,
  removeOutfitSlot,
  reorderOutfitSlots,
  setOutfitStatus,
  type OutfitGroup,
} from '@/lib/trips'
import { ApiRequestError } from '@/lib/api'
import { describeOutfits } from '@/lib/outfitReview'
import { explainOutfit, joinNames } from '@shared/outfits'
import { changeSummary, replanNotice, type PlanChange } from '@shared/replan'
import { deltaLines, type PlanDelta } from '@shared/plan-delta'
import { type WeatherDay } from '@shared/weather'
import { type Trip } from '@shared/trips'
import './Outfits.css'

/**
 * Why a replan did not happen, in words Alex can act on or report.
 *
 * Three outcomes, because they have three different answers and the screen used
 * to give all of them the same sentence:
 *
 *   - the request never left the phone — wait for signal, nothing is broken;
 *   - the server answered and said why — say what it said;
 *   - something else — admit that, rather than blaming the network for a bug.
 *
 * The last case is the honest one and the reason this function exists. `Could
 * not plan outfits just now` implied a passing condition, so the only suggested
 * remedy was to try again — which is exactly the wrong advice for a failure
 * that will repeat, and it is what made a real failure on a real trip
 * impossible to diagnose from what the screen said.
 */
export function planFailureMessage(cause: unknown): string {
  if (!navigator.onLine) {
    return 'You are offline, so the plan could not be updated. It will work once you have signal.'
  }
  if (cause instanceof ApiRequestError) {
    /*
     * The server's own sentence, with the code appended.
     *
     * The code is not decoration and not developer detritus leaking onto a
     * product surface: it is the one token that makes a screenshot of this
     * screen enough to find the failure, and Alex reports bugs by screenshot.
     */
    return `${cause.message} (${cause.code})`
  }
  return 'Something went wrong while planning, and it was not the network. Worth reporting.'
}

/**
 * One garment as it reads on an outfit card: colour, name, and what kind of
 * thing it is.
 *
 * Its own component because the row it sits in is a link to the swap sheet
 * ordinarily and plain text while the outfit is being edited (§0y) — two
 * different elements, and a garment that described itself differently in one of
 * them would be the card disagreeing with itself.
 */
function SlotContent({
  slot,
  swatch = true,
}: {
  slot: OutfitGroup['slots'][number]
  /**
   * False while the outfit is being edited.
   *
   * The colour is there to help CHOOSE a garment, and editing is not choosing —
   * it is ordering and removing. Measured at 390px: the column costs 32px that
   * the three edit controls need, and without it `Crewneck Sweater` is one line
   * instead of two on every row of the card.
   */
  swatch?: boolean
}) {
  return (
    <>
      {/*
        * The garment first, its slot second (§7).
        *
        * The role was a fixed 56px column on the left of every row, so the
        * thing being scanned for started a third of the way into the card and
        * `Deconstructed Sneakers` wrapped where it had no need to. It is the
        * same fact, on the metadata line where the brand and colour already
        * live: `Shoes · New Balance · White` reads as what kind of thing this
        * is, which is what the column was for, and it costs no width.
        *
        * The accessible name is unchanged in content and improved in order — a
        * screen reader hears the garment before its category, which is the same
        * reordering the eye gets.
        */}
      {/*
        * The colour, leading the garment it belongs to.
        *
        * It was between the metadata and the chevron, so the dots formed a band
        * down the card's right edge — a palette you could read, but a trailing
        * ornament rather than part of the garment's identity. Leading,
        * `● T-Shirt` reads as one thing.
        *
        * The wrapper is always rendered and the dots inside it are not.
        * `ColorDots` returns nothing for the eleven wardrobe strings that are
        * not colours — `Various Colors`, `Suede` — and without a reserved column
        * those rows would start 20px to the left of the rest, so every card with
        * one honest gap in it would read as ragged. The column is spacing, not a
        * placeholder dot: nothing is drawn, and nothing is claimed.
        */}
      {swatch ? (
        <span className="slot-swatch">
          <ColorDots color={slot.itemColor} />
        </span>
      ) : null}
      <span className="slot-body">
        <span className="slot-item">{slot.itemName ?? slot.unmetReason}</span>
        <span className="slot-meta">
          {[
            slot.roleLabel,
            ...(slot.itemDetail && !slot.setAside ? [slot.itemDetail] : []),
            ...(slot.setAside ? ['Not bringing'] : []),
          ].map((part, index) => (
            <span key={part} className={part === 'Not bringing' ? 'slot-warning' : undefined}>
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
    </>
  )
}

/**
 * One outfit's garments: swipe a row to take it out, drag its handle to move it
 * (doc 09 §0y).
 *
 * Its own component because `useReorderDrag` is a hook and there is one list
 * per card — and because the list is now the only part of the card with a
 * gesture in it, which is worth being able to read in one place.
 *
 * ## The two gestures, and the visible controls behind them
 *
 * `INTERACTION_PATTERNS.md` §1 is unconditional: a gesture is an accelerator
 * and never the only way to do anything. Both of these have a tap-only route,
 * and both routes are in the swap sheet the row already opens —
 * `Take it out of this outfit`, `Move up` and `Move down`. That is §1's "the
 * detail sheet" rather than a second set of controls on the card, which is what
 * keeps a card being read from carrying the weight of a card being edited.
 *
 * The handle is a real focusable button for the same reason: Arrow Up and Arrow
 * Down move the row without any pointer at all.
 */
function SlotList({
  group,
  busy,
  onOpen,
  onRemove,
  onReorder,
}: {
  group: OutfitGroup
  busy: boolean
  onOpen: (slot: OutfitGroup['slots'][number], position: number) => void
  onRemove: (slot: OutfitGroup['slots'][number]) => void
  onReorder: (order: string[]) => void
}) {
  const ids = group.slots.map((slot) => slot.id)
  const { listRef, startDrag, dragging } = useReorderDrag(ids, onReorder)

  /** One place up or down, for the keyboard and for the swap sheet's buttons. */
  function nudge(position: number, direction: -1 | 1) {
    const to = position + direction
    if (to < 0 || to >= ids.length) return
    const order = [...ids]
    order[position] = ids[to]!
    order[to] = ids[position]!
    onReorder(order)
  }

  return (
    <ul className="slots" ref={listRef}>
      {group.slots.map((slot, position) => {
        const name = slot.itemName ?? slot.roleLabel

        return (
          <li key={slot.id} className={dragging === slot.id ? 'is-dragging' : undefined}>
            {/*
              * No right-hand action, and the row says so by not moving that way.
              *
              * The checklist's right-swipe means "packed", which is the one
              * unambiguous thing a packing row can be. A garment in an outfit
              * has no equivalent — it is not packed, it is worn — so the row
              * reveals Remove on the left and refuses to travel right at all.
              */}
            <SwipeRow
              className="slot-swipe"
              disabled={busy}
              leftActions={[
                {
                  label: 'Remove',
                  glyph: '✕',
                  destructive: true,
                  onSelect: () => onRemove(slot),
                },
              ]}
            >
              <div
                className={`slot ${slot.itemId ? '' : 'is-empty'}${
                  slot.setAside ? ' is-set-aside' : ''
                }`}
              >
                {/*
                  * The row's own tap target, and it is a button inside the
                  * swipe surface rather than the surface itself: the handle
                  * beside it must not be inside it, because a button inside a
                  * button is neither valid HTML nor announceable.
                  */}
                <button
                  type="button"
                  className="slot-open"
                  onClick={() => onOpen(slot, position)}
                >
                  <SlotContent slot={slot} />
                </button>

                {/*
                  * The grip, where the chevron used to be.
                  *
                  * Three lines is what a draggable row looks like everywhere,
                  * so it needs no legend — and the chevron it replaces was
                  * saying "this opens" about a row that still opens when it is
                  * tapped anywhere else. `touch-action: none` in the CSS is
                  * what claims the vertical gesture from the page's own scroll;
                  * the rest of the row keeps `pan-y` and still scrolls.
                  */}
                <button
                  type="button"
                  className="slot-grip"
                  aria-label={`Reorder ${name}`}
                  disabled={busy || group.slots.length < 2}
                  onTouchStart={(event) => startDrag(slot.id, event)}
                  onMouseDown={(event) => startDrag(slot.id, event)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                    event.preventDefault()
                    nudge(position, event.key === 'ArrowUp' ? -1 : 1)
                  }}
                >
                  <span aria-hidden="true">☰</span>
                </button>
              </div>
            </SwipeRow>
          </li>
        )
      })}
    </ul>
  )
}

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

  /*
   * What the last replan did, held only until the next load.
   *
   * Deliberately not persisted and deliberately not merged into `changes`: this
   * is the consequence of one action Alex just took, and a record of it that
   * outlived the moment would be the change-history panel §16 rules out.
   */
  const [deltas, setDeltas] = useState<PlanDelta[]>([])

  /** P1A: applies the choice at once and persists behind it. */
  const chooseSlot = useSlotChoice(id, setGroups, setError, setDeltas)
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

  /*
   * The two authoring flows, and the one search they share (§40, §41).
   *
   * `authoring` is the outfit the Add-item sheet is open on, by id rather than
   * by object, so a replan that replaces every group leaves the sheet pointed
   * at the same outfit rather than at a stale copy of it.
   */
  const [creating, setCreating] = useState(false)
  const [authoring, setAuthoring] = useState<string | null>(null)
  const [authorSearch, setAuthorSearch] = useViewState(`trip:${id}:outfit-add-search`, '')
  const undo = useUndoOffer()

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
      setDeltas(result.deltas ?? [])
      setNotice(replanNotice(result))
    } catch (cause) {
      /*
       * What actually failed, rather than that something did.
       *
       * `Could not plan outfits just now.` was all this said, whatever went
       * wrong — and it is a dead end in the sense doc 06 §3 means: it names no
       * cause, offers no next step, and reads the same whether the phone is on
       * a plane or the server rejected the trip. When Alex hit it on a real
       * trip there was nothing on the screen, and nothing in this catch, that
       * could tell either of us which of those it was.
       *
       * The server already answers with a coded, human message
       * (`apiError`), and `ApiRequestError` carries it. Saying it is not
       * leaking internals: this is a single-user app, Alex is the only
       * audience, and a message he can read back is the difference between a
       * bug report and a shrug.
       */
      setError(planFailureMessage(cause))
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
      setDeltas([])
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

  /**
   * Creates the outfit, then goes straight on to the clothes (§27).
   *
   * Sequential rather than stacked: the naming sheet closes before the picker
   * opens, because two sheets on top of each other is an interaction rejection
   * in `VISUAL_ACCEPTANCE.md` §3 and because the first one has nothing left to
   * say once it has been answered.
   *
   * The Undo is the way back out of a mistyped outfit. It deletes the group
   * outright, which is safe for exactly this kind: `deleteOutfit` refuses
   * anything the planner wrote, and a manual outfit with no garments in it has
   * nothing on the packing list to lose.
   */
  async function create(name: string) {
    setBusy(true)
    try {
      const result = await createOutfit(id, name)
      setGroups(result.groups)
      setCreating(false)
      setAuthoring(result.groupId)
      undo.offer({
        message: `${name} added to your outfits`,
        undo: async () => {
          setAuthoring(null)
          setGroups((await deleteOutfit(id, result.groupId)).groups)
        },
      })
    } catch {
      setError('Could not create that outfit.')
    } finally {
      setBusy(false)
    }
  }

  /** Deletes an outfit Alex wrote. The planner's are undone by un-approving. */
  async function remove(group: OutfitGroup) {
    setBusy(true)
    try {
      const result = await deleteOutfit(id, group.id)
      setGroups(result.groups)
      setDeltas(result.deltas ?? [])
    } catch {
      setError('Could not remove that outfit.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Stores a new order for one outfit's garments (§0y).
   *
   * Applied at once and persisted behind it, the same shape every other edit on
   * this screen has (P1A). A drag that waited a round trip before the row
   * settled would feel broken on a train, and there is nothing to lose — the
   * order is the whole of the state, so a failure reloads it from the server
   * rather than guessing.
   *
   * The whole group's ids go up. `reorderSlots` on the server refuses anything
   * less, and this is the reason: a partial list would have to invent positions
   * for the slots it was not told about.
   */
  async function reorderSlots(group: OutfitGroup, order: string[]) {
    const byId = new Map(group.slots.map((slot) => [slot.id, slot]))
    const reordered = order.map((slotId) => byId.get(slotId)).filter((slot) => slot !== undefined)
    if (reordered.length !== group.slots.length) return

    setGroups((current) =>
      (current ?? []).map((g) => (g.id === group.id ? { ...g, slots: reordered } : g)),
    )

    try {
      setGroups((await reorderOutfitSlots(id, group.id, order)).groups)
    } catch {
      setError('Could not save that order.')
      await load()
    }
  }

  /**
   * Takes a garment out of an outfit (§0y).
   *
   * Undo rather than a confirmation, because it is reversible and
   * `INTERACTION_PATTERNS.md` §4 is explicit that a dialogue on a reversible
   * action is a defect. The undo re-adds the garment and then puts it back in
   * the position it came from — a garment restored to the end of the list is
   * not the same outfit, and the order is now something Alex has an opinion
   * about.
   */
  async function dropSlot(group: OutfitGroup, slot: OutfitGroup['slots'][number]) {
    const itemId = slot.itemId
    const name = slot.itemName ?? slot.roleLabel
    const wasAt = group.slots.findIndex((s) => s.id === slot.id)

    setBusy(true)
    try {
      const result = await removeOutfitSlot(id, group.id, slot.id)
      setGroups(result.groups)
      setDeltas(result.deltas ?? [])

      // Nothing to put back. An empty slot carries no garment, so re-adding it
      // would mean inventing one — the undo simply is not offered.
      if (!itemId) return

      undo.offer({
        message: `${name} taken out of ${group.name}`,
        undo: async () => {
          const added = await addOutfitItem(id, group.id, itemId)
          const back = added.groups.find((g) => g.id === group.id)
          if (!back) {
            setGroups(added.groups)
            return
          }
          const order = back.slots.map((s) => s.id).filter((s) => s !== added.slotId)
          order.splice(wasAt, 0, added.slotId)
          setGroups((await reorderOutfitSlots(id, group.id, order)).groups)
        },
      })
    } catch {
      setError('Could not take that out of the outfit.')
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
        * What the replan actually did, under what prompted it.
        *
        * `notice` reports a count — `2 outfits planned again` — which says work
        * happened without saying what it produced. These name the garment and
        * the outfit, computed by diffing the plan rather than written from the
        * action, so the sentence cannot claim a change that did not occur.
        *
        * Transient by construction: `deltas` is state from the last replan and
        * is cleared on the next load, so nothing here becomes a change-history
        * panel (§16). Empty when the plan did not move, which is the case this
        * exists to be honest about.
        */}
      {deltaLines(deltas).length > 0 ? (
        <ul className="outfit-deltas">
          {deltaLines(deltas).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
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

          <SlotList
            group={group}
            busy={busy}
            onOpen={(slot, position) =>
              setSwapping({
                groupId: group.id,
                slotId: slot.id,
                roleLabel: slot.roleLabel,
                itemId: slot.itemId,
                /* So the sheet can offer Move up and Move down, which are the
                 * tap-only route to the grip's drag (§0y). */
                position,
                count: group.slots.length,
              })
            }
            onRemove={(slot) => void dropSlot(group, slot)}
            onReorder={(order) => void reorderSlots(group, order)}
          />

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
          {/*
            * One more garment, without losing one (§18, §19).
            *
            * A quiet row under the clothes rather than a button beside the
            * approval: it belongs to the LIST above it, it is used once or
            * twice per outfit, and a third control in the footer would put it
            * in competition with Approve — which is the one thing on the card
            * that has to be obvious. It costs a 44px row on every card and
            * nothing at all in the footer, which is where §38's "do not make
            * the cards permanently taller" is actually spent.
            */}
          <button
            type="button"
            className="outfit-add-item"
            onClick={() => setAuthoring(group.id)}
            aria-label={`Add an item to ${group.name}`}
          >
            <span aria-hidden="true">+</span> Add item
          </button>

          <footer className="outfit-foot">
            <span className={`outfit-state ${approved ? 'is-on' : ''}`}>
              {approved ? 'Approved' : 'Draft'}
            </span>
            <span className="outfit-foot-actions">
              {/*
                * Only for an outfit Alex wrote (§29).
                *
                * A planner group has no Remove and must not: one deleted here
                * would be back on the next replan looking like a bug, and
                * un-approving is how an approved one is undone. His own outfit
                * has neither of those routes — nothing regenerates it — so
                * without this a mistyped outfit would be permanent.
                */}
              {group.source === 'user' ? (
                <button
                  type="button"
                  className="outfit-why-toggle"
                  onClick={() => void remove(group)}
                  disabled={busy}
                  aria-label={`Remove ${group.name}`}
                >
                  Remove
                </button>
              ) : null}
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
        * The one way to add an outfit (§39, §40).
        *
        * Below the cards, beside the replan, and quiet. Above them it would
        * compete with the plan itself for the first viewport; as a full-width
        * primary it would compete with the replan, which is the page's own
        * action. It is the same weight and the same place as `Review one at a
        * time` — both are things you do to the plan as a whole rather than to
        * an outfit.
        *
        * Rendered whatever the plan holds, including an empty one: a trip with
        * no plan yet is exactly when "I already know what I want to wear" is
        * worth answering, and the empty state's own `Plan Outfits` sits above
        * it as the other answer.
        */}
      <button
        type="button"
        className="button-quiet outfit-add"
        onClick={() => setCreating(true)}
        disabled={busy}
      >
        + Add outfit
      </button>

      {/*
        * The way into the guided walkthrough (doc 09 §7, C2).
        *
        * The counted `Review 5` control that used to open it sat ABOVE the
        * cards, which is what earned its removal: a call to action telling Alex
        * to do the thing every card below already offers. But the walkthrough
        * itself is not a second copy of `Approve` — it is the one-at-a-time
        * path, with the planning facts and the three decisions — and taking the
        * counter away took the only door to it with it. Nothing else in the app
        * routes to `outfits/review`; the feature was reachable only by typing
        * the URL.
        *
        * So it comes back as what it actually is: navigation, below the cards,
        * without a number. Below, because a walkthrough offered before the
        * cards competes with them, while one offered after them is the
        * alternative it should have been all along. Without a number, because
        * the count was the part that was noise — `outfit-card.is-approved`
        * already says how far along Alex is, in no space at all.
        *
        * Only while something is unresolved: a walkthrough over a fully
        * approved plan has nothing to stop at.
        */}
      {(groups ?? []).some((group) => group.status !== 'approved') ? (
        <button
          type="button"
          className="button-quiet outfit-walkthrough"
          onClick={() => navigate(`/trips/${id}/outfits/review`)}
        >
          Review one at a time
        </button>
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
        /*
         * The two gestures on the card, as controls that can be tapped (§0y).
         *
         * Resolved from the live groups by id rather than closed over the row
         * that opened the sheet: a replan replaces every group object, and a
         * stale reference would move or remove a slot in an outfit that no
         * longer exists.
         */
        onRemove={() => {
          const target = swapping
          if (!target) return
          const group = (groups ?? []).find((g) => g.id === target.groupId)
          const slot = group?.slots.find((s) => s.id === target.slotId)
          if (group && slot) void dropSlot(group, slot)
        }}
        onMove={(direction) => {
          const target = swapping
          if (!target) return
          const group = (groups ?? []).find((g) => g.id === target.groupId)
          if (!group) return
          const ids = group.slots.map((slot) => slot.id)
          const from = ids.indexOf(target.slotId)
          const to = from + direction
          if (from < 0 || to < 0 || to >= ids.length) return
          const order = [...ids]
          order[from] = ids[to]!
          order[to] = ids[from]!
          void reorderSlots(group, order)
        }}
      />

      <NewOutfitSheet
        open={creating}
        busy={busy}
        onClose={() => setCreating(false)}
        onCreate={(name) => void create(name)}
      />

      <AddToOutfitSheet
        open={authoring !== null}
        tripId={id}
        /* By id rather than by object, so a replan that replaces every group
         * leaves this pointed at the same outfit rather than a stale copy. */
        group={(groups ?? []).find((group) => group.id === authoring) ?? null}
        search={authorSearch}
        onSearch={setAuthorSearch}
        onClose={() => setAuthoring(null)}
        onAdded={(result, item) => {
          setGroups(result.groups)
          /*
           * Undo for the addition (§43), and the only one offered for it.
           *
           * `removeSlot` takes the row out altogether rather than emptying it,
           * because a slot Alex added has no template behind it — an empty
           * `Layer` on a planner outfit is a gap worth showing, and an empty
           * row on an outfit he composed is a thing he never asked for.
           */
          undo.offer({
            message: `${item.displayName} added to ${result.groups.find((g) => g.id === authoring)?.name ?? 'the outfit'}`,
            undo: async () => {
              setGroups((await removeOutfitSlot(id, authoring!, result.slotId)).groups)
            },
          })
        }}
      />

      <UndoBar offer={undo} />
    </Screen>
  )
}
