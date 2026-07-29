import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BottomSheet } from '@/components/BottomSheet'
import { Screen } from '@/components/Screen'
import {
  fetchAlternatives,
  fetchToday,
  recordWear,
  swapForToday,
  type DayPlan,
  type PlannedItem,
  type TodayResponse,
  type WearAction,
} from '@/lib/trips'
import './Today.css'

/**
 * Today — the screen the app opens on during a trip.
 *
 * Everything here comes from the stored plan and the bag. Nothing is
 * recalculated on open, because seeing different clothes on a second glance at
 * the same morning is what makes an app feel unreliable (risk R12).
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

  function applyUpdate(update: { plan: DayPlan; wearLog: Record<string, WearAction> }) {
    setData((prev) => (prev ? { ...prev, plan: update.plan, wearLog: update.wearLog } : prev))
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

  async function swap(item: PlannedItem, toItemId: string) {
    if (!data || busy) return
    setBusy(true)
    try {
      applyUpdate(await swapForToday(id, data.date, item.itemId, toItemId))
      setActing(null)
    } catch {
      setError('Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return (
      <Screen title="Today">
        {error ? <p className="field-error">{error}</p> : null}
      </Screen>
    )
  }

  const { plan, wearLog, dates } = data
  const index = dates.indexOf(data.date)

  const nothingPacked = plan.wear.length === 0 && plan.bring.length === 0 && plan.missing.length === 0

  return (
    <Screen title="Today" subtitle={formatDay(data.date)}>
      {error ? <p className="field-error">{error}</p> : null}

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

      {nothingPacked ? (
        <div className="empty-state">
          <p className="empty-state-title">Nothing packed yet</p>
          <p className="empty-state-body">
            Today only suggests things you have confirmed are in your bag. Tick items off on your
            packing list and they will appear here.
          </p>
          <button type="button" className="button-primary" onClick={() => navigate(`/trips/${id}`)}>
            Open packing list
          </button>
        </div>
      ) : null}

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

      {plan.missing.length > 0 ? (
        <section className="today-section">
          {plan.missing.map((gap) => (
            <div key={gap.role} className="today-gap">
              <p className="today-gap-title">
                {gap.alternatives.length === 0
                  ? `No suitable packed ${gap.roleLabel.toLowerCase()} found.`
                  : `${gap.name} is not packed.`}
              </p>
              {gap.alternatives.length > 0 ? (
                <ul className="today-alternatives">
                  {gap.alternatives.slice(0, 4).map((alternative) => (
                    <li key={alternative.itemId}>
                      <button
                        type="button"
                        className="chip"
                        disabled={busy}
                        onClick={() =>
                          void swap(
                            { ...alternative, role: gap.role, roleLabel: gap.roleLabel },
                            alternative.itemId,
                          )
                        }
                      >
                        {alternative.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {plan.bring.length > 0 ? (
        <section className="today-section">
          <h2 className="section-title">Bring</h2>
          <ul className="bring-chips">
            {plan.bring.map((item) => (
              <li key={item.itemId} className="bring-chip">
                {item.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <button type="button" className="button-secondary" onClick={() => navigate(`/trips/${id}`)}>
        Packing list
      </button>

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
                      onClick={() => acting && void swap(acting, option.itemId)}
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
    </Screen>
  )
}
