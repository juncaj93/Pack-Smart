import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Screen } from '@/components/Screen'
import { SwapSheet } from '@/components/SwapSheet'
import {
  fetchOutfits,
  fetchTrip,
  generateOutfits,
  setOutfitStatus,
  type OutfitGroup,
  type OutfitSlot,
} from '@/lib/trips'
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
  const [swapping, setSwapping] = useState<{ group: OutfitGroup; slot: OutfitSlot } | null>(null)

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
    } catch {
      setError('Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  if (!trip && !error) return <Screen title="Outfits" />

  return (
    <Screen title="Outfits" subtitle={trip?.name}>
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
        <p className="outfit-notice" role="status">
          {notice}
        </p>
      ) : null}

      {(groups ?? []).map((group) => (
        <section key={group.id} className={`outfit-card is-${group.status}`}>
          <header className="outfit-head">
            <div>
              <h2 className="outfit-name">{group.name}</h2>
              <p className="outfit-count">
                {group.occurrences === 1 ? 'Once' : `${group.occurrences} days`}
                {group.status === 'approved' ? ' · On your packing list' : ''}
                {group.status === 'incomplete' ? ' · Missing something' : ''}
              </p>
            </div>
          </header>

          <ul className="slots">
            {group.slots.map((slot) => (
              <li key={slot.id}>
                <button
                  type="button"
                  className={`slot ${slot.itemId ? '' : 'is-empty'}`}
                  onClick={() => setSwapping({ group, slot })}
                >
                  <span className="slot-role">{slot.roleLabel}</span>
                  <span className="slot-body">
                    <span className="slot-item">{slot.itemName ?? slot.unmetReason}</span>
                    {slot.itemName && (slot.reason || slot.wearings > 1) ? (
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
            className={group.status === 'approved' ? 'button-secondary' : 'button-primary'}
            onClick={() => void toggleApproval(group)}
            disabled={busy}
          >
            {group.status === 'approved' ? 'Undo approval' : 'Approve outfit'}
          </button>
        </section>
      ))}

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
        group={swapping?.group ?? null}
        slot={swapping?.slot ?? null}
        onClose={() => setSwapping(null)}
        onChanged={(next) => {
          setGroups(next)
          setSwapping(null)
        }}
      />
    </Screen>
  )
}
