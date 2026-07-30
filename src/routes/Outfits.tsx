import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Screen } from '@/components/Screen'
import { SwapSheet, type SwapTarget } from '@/components/SwapSheet'
import {
  fetchOutfits,
  fetchTrip,
  forgetOutfitPairings,
  generateOutfits,
  setOutfitStatus,
  type OutfitGroup,
} from '@/lib/trips'
import { joinNames } from '@shared/outfits'
import type { Trip } from '@shared/trips'
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

  const load = useCallback(async () => {
    try {
      const [tripResult, outfitResult] = await Promise.all([fetchTrip(id), fetchOutfits(id)])
      setTrip(tripResult)
      setGroups(outfitResult.groups)
      setError(null)
    } catch {
      setError('Could not load this trip’s outfits.')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function plan() {
    setBusy(true)
    setNotice(null)
    try {
      const result = await generateOutfits(id)
      setGroups(result.groups)
      if (!result.regenerated) {
        setNotice('Your approved outfits were left as they are.')
      }
    } catch {
      setError('Could not plan outfits just now.')
    } finally {
      setBusy(false)
    }
  }

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

      {(groups ?? []).map((group) => {
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
              <p className="outfit-count">
                {group.occurrences === 1 ? 'Once' : `${group.occurrences} days`}
                {group.status === 'approved' && !blocked ? ' · On your packing list' : ''}
                {group.status === 'incomplete' ? ' · Missing something' : ''}
                {blocked
                  ? ` · Incomplete — you are not bringing the ${joinNames(
                      setAside.map((slot) => slot.itemName ?? 'garment'),
                    )}`
                  : ''}
              </p>
            </div>
          </header>

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
                    ) : slot.itemName && (slot.reason || slot.wearings > 1) ? (
                      <span className="slot-reason">
                        {slot.wearings > 1 ? `Worn ${slot.wearings} days` : ''}
                        {slot.wearings > 1 && slot.reason ? ' · ' : ''}
                        {slot.reason ?? ''}
                      </span>
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
        onChanged={(next) => {
          setGroups(next)
          setSwapping(null)
        }}
      />
    </Screen>
  )
}
