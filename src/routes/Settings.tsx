import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomSheet } from '@/components/BottomSheet'
import { Screen } from '@/components/Screen'
import { apiFetch } from '@/lib/api'
import {
  describeRule,
  fetchPreferences,
  fetchRules,
  savePreference,
  updateRule,
  type PackingRule,
  type Preference,
} from '@/lib/settings'
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
  const [open, setOpen] = useState<'about' | 'preferences' | 'rules' | null>(null)

  async function signOut() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } finally {
      // Even if the request fails, drop to Unlock — the cookie is either gone
      // or unusable, and stranding Alex in a half-authenticated shell is worse.
      onSignedOut()
    }
  }

  return (
    <Screen title="Settings">
      <ul className="settings-list">
        <li>
          <button type="button" className="settings-row" onClick={() => setOpen('preferences')}>
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

      <PreferencesSheet open={open === 'preferences'} onClose={() => setOpen(null)} />
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

function PreferencesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [preferences, setPreferences] = useState<Preference[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setPreferences((await fetchPreferences()).preferences)
      setError(null)
    } catch {
      setError('Could not load your settings.')
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function change(preference: Preference, multiplier: number) {
    if (busy || multiplier < 0 || multiplier > 10) return
    setBusy(true)
    setPreferences((prev) =>
      (prev ?? []).map((p) => (p.key === preference.key ? { ...p, multiplier } : p)),
    )
    try {
      await savePreference(preference.key, multiplier)
    } catch {
      setError('Could not save that.')
      void load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Your usual amounts">
      <div className="form">
        {error ? <p className="field-error">{error}</p> : null}

        <p className="hint">
          These apply to every new trip. Changing one here does not alter a trip you have already
          planned.
        </p>

        {(preferences ?? []).map((preference) => (
          <div key={preference.key} className="field">
            <span className="field-label">{preference.label}</span>
            <div className="stepper">
              <button
                type="button"
                onClick={() => void change(preference, preference.multiplier - 1)}
                disabled={busy || preference.multiplier <= 0}
                aria-label={`Fewer ${preference.label.toLowerCase()}`}
              >
                −
              </button>
              <span className="stepper-value" aria-live="polite">
                {preference.multiplier} {preference.unit}
              </span>
              <button
                type="button"
                onClick={() => void change(preference, preference.multiplier + 1)}
                disabled={busy || preference.multiplier >= 10}
                aria-label={`More ${preference.label.toLowerCase()}`}
              >
                +
              </button>
            </div>
            <span className="hint">{preference.help}</span>
          </div>
        ))}
      </div>
    </BottomSheet>
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
