import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomSheet } from '@/components/BottomSheet'
import { Screen } from '@/components/Screen'
import { apiFetch } from '@/lib/api'
import { CATEGORY_EMOJI, fetchItems } from '@/lib/items'
import { forgetUnlocked } from '@/lib/session'
import {
  addAmount,
  describeRule,
  fetchAmounts,
  fetchRules,
  removeAmount,
  restoreAmount,
  saveAmount,
  updateRule,
  type Amount,
  type PackingRule,
} from '@/lib/settings'
import type { Item } from '@shared/items'
import './Settings.css'

interface SettingsProps {
  onSignedOut: () => void
}

/**
 * Settings holds the things Alex changes rarely.
 *
 * Doc 02 keeps uncommon administrative actions out of the way, so this screen is
 * a short list of sheets rather than a wall of controls. Everything that shapes
 * a single trip lives on the trip, not here.
 */
export default function Settings({ onSignedOut }: SettingsProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState<'about' | 'amounts' | 'rules' | null>(null)

  async function signOut() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } finally {
      // Even if the request fails, drop to Unlock — the cookie is either gone
      // or unusable, and stranding Alex in a half-authenticated shell is worse.
      // Forgetting the device matters too: signing out must not leave the
      // offline path willing to show the shell again.
      forgetUnlocked()
      onSignedOut()
    }
  }

  return (
    <Screen title="Settings">
      <ul className="settings-list">
        <li>
          <button type="button" className="settings-row" onClick={() => setOpen('amounts')}>
            <span className="settings-label">Your usual amounts</span>
            <span className="settings-value">How much you pack per day</span>
          </button>
        </li>
        <li>
          <button type="button" className="settings-row" onClick={() => setOpen('rules')}>
            <span className="settings-label">Packing rules</span>
            <span className="settings-value">When each item gets packed</span>
          </button>
        </li>
        <li>
          <button type="button" className="settings-row" onClick={() => navigate('/my-stuff')}>
            <span className="settings-label">My Stuff</span>
            <span className="settings-value">Everything you own</span>
          </button>
        </li>
        <li>
          <button type="button" className="settings-row" onClick={() => navigate('/import')}>
            <span className="settings-label">Import from a spreadsheet</span>
            <span className="settings-value">One-time setup</span>
          </button>
        </li>
        <li>
          <a className="settings-row" href="/api/settings/export" download>
            <span className="settings-label">Download a backup</span>
            <span className="settings-value">Everything, as a file</span>
          </a>
        </li>
        <li>
          <button type="button" className="settings-row" onClick={() => setOpen('about')}>
            <span className="settings-label">About</span>
          </button>
        </li>
      </ul>

      <button type="button" className="button-secondary" onClick={signOut}>
        Sign out
      </button>

      <AmountsSheet open={open === 'amounts'} onClose={() => setOpen(null)} />
      <RulesSheet open={open === 'rules'} onClose={() => setOpen(null)} />

      <BottomSheet open={open === 'about'} onClose={() => setOpen(null)} title="About Pack Smart">
        <p data-selectable>
          A private packing assistant for one person. Every recommendation comes from your own
          wardrobe and rules you can read and change — nothing is guessed, and no paid service is
          involved.
        </p>
        <p className="hint" data-selectable>
          Your data stays in your own database. Nothing is shared, and the site is not indexed by
          search engines.
        </p>
      </BottomSheet>
    </Screen>
  )
}

/* ------------------------------------------------------------------ */

const MAX_PER_DAY = 10

/**
 * Your usual amounts — add, change, remove.
 *
 * Every row here is a real packing rule, so the number on screen is the number
 * the packing list uses. Removing switches the rule off rather than deleting
 * it, which is what makes the undo bar honest.
 */
function AmountsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [amounts, setAmounts] = useState<Amount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [removed, setRemoved] = useState<Amount | null>(null)

  const load = useCallback(async () => {
    try {
      setAmounts((await fetchAmounts()).amounts)
      setError(null)
    } catch {
      setError('Could not load your usual amounts.')
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setAdding(false)
    setRemoved(null)
    void load()
  }, [open, load])

  async function change(amount: Amount, multiplier: number) {
    if (busy || multiplier < 1 || multiplier > MAX_PER_DAY) return
    setBusy(true)
    setAmounts((prev) =>
      (prev ?? []).map((a) => (a.ruleId === amount.ruleId ? { ...a, multiplier } : a)),
    )
    try {
      await saveAmount(amount.ruleId, multiplier)
      setError(null)
    } catch {
      setError('Could not save that.')
      void load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(amount: Amount) {
    if (busy) return
    setBusy(true)
    setAmounts((prev) => (prev ?? []).filter((a) => a.ruleId !== amount.ruleId))
    try {
      await removeAmount(amount.ruleId)
      setRemoved(amount)
      setError(null)
    } catch {
      setError('Could not remove that.')
      void load()
    } finally {
      setBusy(false)
    }
  }

  async function undoRemove() {
    if (!removed) return
    const target = removed
    setRemoved(null)
    try {
      await restoreAmount(target.ruleId)
    } catch {
      setError('Could not put that back.')
    }
    void load()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Your usual amounts">
      <div className="form">
        {error ? <p className="field-error">{error}</p> : null}

        <p className="hint">
          How many of something you pack for each day away. These apply to every new trip; changing
          one here does not alter a trip you have already planned.
        </p>

        {amounts !== null && amounts.length === 0 && !adding ? (
          <p className="hint">
            Nothing has a daily amount yet. Add one for anything you pack by the day — contact
            lenses, underwear, socks.
          </p>
        ) : null}

        {(amounts ?? []).map((amount) => (
          <div key={amount.ruleId} className="field amount-row">
            <span className="field-label">{amount.itemName}</span>
            <div className="amount-controls">
              <div className="stepper">
                <button
                  type="button"
                  onClick={() => void change(amount, amount.multiplier - 1)}
                  disabled={busy || amount.multiplier <= 1}
                  aria-label={`Fewer ${amount.itemName}`}
                >
                  −
                </button>
                <span className="stepper-value" aria-live="polite">
                  {amount.multiplier} {amount.unit}
                </span>
                <button
                  type="button"
                  onClick={() => void change(amount, amount.multiplier + 1)}
                  disabled={busy || amount.multiplier >= MAX_PER_DAY}
                  aria-label={`More ${amount.itemName}`}
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className="amount-remove"
                onClick={() => void remove(amount)}
                disabled={busy}
              >
                Remove
              </button>
            </div>
            {amount.ruleType === 'duration_plus_buffer' && amount.buffer ? (
              <span className="hint">Plus {amount.buffer} spare.</span>
            ) : null}
          </div>
        ))}

        {removed ? (
          <p className="undo-inline" role="status">
            <span>{removed.itemName} removed.</span>
            <button type="button" onClick={() => void undoRemove()}>
              Undo
            </button>
          </p>
        ) : null}

        {adding ? (
          <AmountPicker
            existingItemIds={new Set((amounts ?? []).map((a) => a.itemId))}
            onCancel={() => setAdding(false)}
            onAdded={() => {
              setAdding(false)
              void load()
            }}
          />
        ) : (
          <button type="button" className="button-secondary" onClick={() => setAdding(true)}>
            Add an amount
          </button>
        )}
      </div>
    </BottomSheet>
  )
}

/**
 * Picks something you own and says how many of it per day.
 *
 * Search rather than a long list: 118 items is far too many to scroll past on a
 * phone, and typing three letters is less work than either. Nothing is created
 * here — an amount can only attach to something already in My Stuff, so a typo
 * cannot invent an item the packing list would then ask for.
 */
function AmountPicker({
  existingItemIds,
  onCancel,
  onAdded,
}: {
  existingItemIds: Set<string>
  onCancel: () => void
  onAdded: () => void
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Item[]>([])
  const [chosen, setChosen] = useState<Item | null>(null)
  const [multiplier, setMultiplier] = useState(2)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const needle = search.trim()
    if (needle.length < 2 || chosen) return

    let cancelled = false
    const timer = setTimeout(() => {
      fetchItems({ search: needle })
        .then((result) => {
          if (!cancelled) setResults(result.items.filter((i) => !existingItemIds.has(i.id)))
        })
        .catch(() => {
          if (!cancelled) setError('Could not search your things.')
        })
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search, chosen, existingItemIds])

  async function save() {
    if (!chosen || busy) return
    setBusy(true)
    try {
      await addAmount(chosen.id, multiplier)
      onAdded()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add that.')
      setBusy(false)
    }
  }

  if (chosen) {
    return (
      <div className="field amount-add">
        <span className="field-label">{chosen.displayName}</span>
        {error ? <span className="field-error">{error}</span> : null}
        <div className="stepper">
          <button
            type="button"
            onClick={() => setMultiplier((n) => Math.max(1, n - 1))}
            disabled={busy || multiplier <= 1}
            aria-label="Fewer per day"
          >
            −
          </button>
          <span className="stepper-value" aria-live="polite">
            {multiplier} per day
          </span>
          <button
            type="button"
            onClick={() => setMultiplier((n) => Math.min(MAX_PER_DAY, n + 1))}
            disabled={busy || multiplier >= MAX_PER_DAY}
            aria-label="More per day"
          >
            +
          </button>
        </div>
        <button type="button" className="button-primary" onClick={() => void save()} disabled={busy}>
          Save this amount
        </button>
        <button type="button" className="button-secondary" onClick={() => setChosen(null)}>
          Pick something else
        </button>
      </div>
    )
  }

  return (
    <div className="field amount-add">
      <span className="field-label">What do you pack by the day?</span>
      {error ? <span className="field-error">{error}</span> : null}
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search your things"
        autoCapitalize="none"
        autoFocus
      />

      {search.trim().length >= 2 && results.length === 0 ? (
        <span className="hint">
          Nothing matches. Anything you want an amount for has to be in My Stuff first.
        </span>
      ) : null}

      <ul className="picker-list">
        {results.slice(0, 8).map((item) => (
          <li key={item.id}>
            <button type="button" className="picker-row" onClick={() => setChosen(item)}>
              {CATEGORY_EMOJI[item.category] ?? '•'} {item.displayName}
            </button>
          </li>
        ))}
      </ul>

      <button type="button" className="button-secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function RulesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rules, setRules] = useState<PackingRule[] | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setSearch('')
    setError(null)

    let cancelled = false
    fetchRules()
      .then((result) => {
        if (!cancelled) setRules(result.rules)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your rules.')
      })

    return () => {
      cancelled = true
    }
  }, [open])

  async function toggle(rule: PackingRule) {
    if (busy) return
    setBusy(true)
    const next = !rule.enabled
    setRules((prev) => (prev ?? []).map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)))
    try {
      await updateRule(rule.id, { enabled: next })
    } catch {
      setError('Could not save that.')
      setRules((prev) => (prev ?? []).map((r) => (r.id === rule.id ? { ...r, enabled: !next } : r)))
    } finally {
      setBusy(false)
    }
  }

  const needle = search.trim().toLowerCase()
  const visible = (rules ?? []).filter(
    (rule) => !needle || rule.itemName.toLowerCase().includes(needle),
  )
  const needingReview = (rules ?? []).filter((r) => r.needsReview).length

  return (
    <BottomSheet open={open} onClose={onClose} title="Packing rules">
      <div className="form">
        {error ? <p className="field-error">{error}</p> : null}

        {needingReview > 0 ? (
          <p className="critical-warning">
            {needingReview} {needingReview === 1 ? 'rule needs' : 'rules need'} a look. Pack Smart
            could not work out what {needingReview === 1 ? 'it means' : 'they mean'}, so
            {needingReview === 1 ? ' it is' : ' they are'} not being used.
          </p>
        ) : null}

        <label className="field">
          <span className="visually-hidden">Search rules</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            autoCapitalize="none"
          />
        </label>

        {rules === null ? <p className="hint">Loading…</p> : null}

        <ul className="rule-list">
          {visible.map((rule) => (
            <li key={rule.id}>
              <button
                type="button"
                className={`rule-row ${rule.enabled ? '' : 'is-off'}`}
                onClick={() => void toggle(rule)}
                aria-pressed={rule.enabled}
                disabled={busy}
              >
                <span className="rule-text">
                  <span className="rule-name">{rule.itemName}</span>
                  <span className="rule-what">{describeRule(rule)}</span>
                  {rule.needsReview ? (
                    <span className="rule-review">
                      From your spreadsheet: “{rule.originalText}”
                    </span>
                  ) : null}
                </span>
                <span className="rule-state">{rule.enabled ? 'On' : 'Off'}</span>
              </button>
            </li>
          ))}
        </ul>

        {rules !== null && visible.length === 0 ? (
          <p className="hint">No rules match that.</p>
        ) : null}
      </div>
    </BottomSheet>
  )
}
