import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppearanceChoice } from '@/components/AppearanceChoice'
import { BottomSheet } from '@/components/BottomSheet'
import { Screen } from '@/components/Screen'
import { apiFetch } from '@/lib/api'
import { CATEGORY_EMOJI, fetchItems } from '@/lib/items'
import {
  acceptCorrection,
  acceptRemoval,
  decideCorrection,
  restoreSetAside,
  addAmount,
  createRule,
  deleteRule,
  describeRule,
  fetchAmounts,
  fetchRules,
  fetchSuggestions,
  removeAmount,
  restoreAmount,
  restoreDefault,
  RULE_KINDS,
  saveAmount,
  updateRule,
  updateRuleThreshold,
  type Amount,
  type PackingRule,
  type Suggestions,
  type RuleChange,
} from '@/lib/settings'
import type { Item } from '@shared/items'
import { readThreshold, thresholdUnit } from '@shared/rule-threshold'
import {
  MAX_QUANTITY,
  MIN_QUANTITY,
  QUANTITY_RANGE_MESSAGE,
  readQuantity,
} from '@shared/quantities'
import { SearchInput } from '@/components/SearchInput'
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
  const [open, setOpen] = useState<'amounts' | 'rules' | 'suggestions' | null>(null)

  /*
   * Set when the sign-out request never reached the server.
   *
   * This used to be a `finally`: whatever happened, forget the device, wipe
   * both caches, drop to Unlock. That looks like signing out and is not one.
   * The session is a cookie the SERVER clears; if the POST never arrived, the
   * cookie is still there and still valid, so the next launch with signal
   * answers `authenticated: true` and walks straight back in — having, in the
   * meantime, deleted the offline copy of the trip Alex was relying on.
   *
   * The wrong half of that trade is obvious once it is written down: what ended
   * was his packing list on the plane, and what survived was the credential.
   * A sign-out that did not happen says so.
   */
  const [signOutFailed, setSignOutFailed] = useState(false)

  async function signOut() {
    setSignOutFailed(false)
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } catch {
      setSignOutFailed(true)
      return
    }

    /*
     * The server has cleared the cookie. Everything local goes with it — and
     * `App` owns that list, because a 401, a `false` session answer and a
     * sign-out in another tab all have to leave exactly the same state behind.
     * This screen's job ends at knowing the request succeeded.
     */
    onSignedOut()
  }

  return (
    <Screen title="Settings">
      {/*
        * Grouped by what Alex is trying to do, not by which sheet it opens.
        *
        * Seven flat rows made every setting look equally likely to be the one he
        * wanted, and nothing distinguished the two that change how packing works
        * from the one-time administration (UX-13). The chevron is the other half: a
        * row that opens something has to look like it does.
        */}
      <h2 className="section-heading settings-group">How packing works</h2>
      <ul className="settings-list row-list">
        <li>
          <button type="button" className="settings-row" onClick={() => setOpen('amounts')}>
            <span className="settings-text">
              <span className="settings-label">Your usual amounts</span>
              <span className="settings-value">How much you pack per day</span>
            </span>
            <span className="settings-mark" aria-hidden="true">›</span>
          </button>
        </li>
        <li>
          <button type="button" className="settings-row" onClick={() => setOpen('rules')}>
            <span className="settings-text">
              <span className="settings-label">Packing rules</span>
              <span className="settings-value">When each item gets packed</span>
            </span>
            <span className="settings-mark" aria-hidden="true">›</span>
          </button>
        </li>
        {/*
          * The second door to Review Closet Items (H1d), and the reason there
          * are two.
          *
          * The note further down this file argues against a "My wardrobe" row
          * that only navigated to a primary tab, and the argument stands. This
          * is different: the review queue is not a tab, it has no permanent
          * place in the navigation, and it genuinely changes how packing works
          * — which is the section it is in. My Stuff carries the other entry
          * because that is where Alex is when he notices his closet needs it.
          */}
        <li>
          <button
            type="button"
            className="settings-row"
            onClick={() => navigate('/my-stuff/review')}
          >
            <span className="settings-text">
              <span className="settings-label">Review closet items</span>
              <span className="settings-value">
                Help Pack Smart improve your recommendations
              </span>
            </span>
            <span className="settings-mark" aria-hidden="true">›</span>
          </button>
        </li>
      </ul>

      {/*
        * `Learning`, not `What Pack Smart has learned` (§7).
        *
        * A group label is scanned, not read, and this one was a sentence sitting
        * above a row that begins "What Pack Smart has noticed" — the heading and
        * its only row shared four words and a grammatical shape, so the eye had
        * to read both to find out they were not the same thing. The heading
        * names the group; the row says what is in it.
        */}
      <h2 className="section-heading settings-group">Learning</h2>
      <ul className="settings-list row-list">
        <li>
          <button type="button" className="settings-row" onClick={() => setOpen('suggestions')}>
            <span className="settings-text">
              <span className="settings-label">What Pack Smart has noticed</span>
              <span className="settings-value">Changes it suggests from your own trips</span>
            </span>
            <span className="settings-mark" aria-hidden="true">›</span>
          </button>
        </li>
      </ul>

      {/*
        * There is no "My wardrobe" section here.
        *
        * It held one row that navigated to My Stuff — which is a primary tab,
        * permanently on screen, one tap away from everywhere. A second door to
        * the same room is not a setting; it is a link that makes Settings longer
        * and teaches Alex that this screen is where you go to find things.
        * Settings is for the things that change how Pack Smart behaves.
        */}

      <h2 className="section-heading settings-group">Data and backup</h2>
      <ul className="settings-list row-list">
        <li>
          <a className="settings-row" href="/api/settings/export" download>
            <span className="settings-text">
              <span className="settings-label">Download a backup</span>
              <span className="settings-value">Everything, as a file</span>
            </span>
            <span className="settings-mark" aria-hidden="true">↓</span>
          </a>
        </li>
        <li>
          <button type="button" className="settings-row" onClick={() => navigate('/import')}>
            <span className="settings-text">
              <span className="settings-label">Import from a spreadsheet</span>
              <span className="settings-value">One-time setup</span>
            </span>
            <span className="settings-mark" aria-hidden="true">›</span>
          </button>
        </li>
      </ul>

      <h2 className="section-heading settings-group">Appearance</h2>

      {/*
        * The whole of the appearance preference, and now the only copy of it.
        *
        * There used to be a sun/moon in the header of every screen — a two-state
        * toggle over this three-state choice, permanently occupying the most
        * expensive 44 points in the layout so that one of the three states was
        * one tap closer. This control was always here and always did more; the
        * header is where the cost was. Removing the shortcut takes nothing away
        * from what Alex can set, and gives every screen its top-right corner
        * back (§7 of the V1.1 visual pass).
        *
        * It gets a heading of its own rather than sitting under "This app",
        * because it is now the only way to reach the setting and a heading is
        * how a settings screen is scanned.
        */}
      <AppearanceChoice />

      {/*
        * And no About.
        *
        * It said Pack Smart is private, uses no paid service, and keeps its data
        * in Alex's own database. All true, all things he decided, and none of
        * them a control — an app he built for himself does not need to introduce
        * itself to him. Nothing here is legally required, so it goes rather than
        * staying because most apps have one.
        */}

      {/* Last, quiet, and left-aligned — the one thing here that ends a session. */}
      <button type="button" className="button-quiet settings-signout" onClick={signOut}>
        Sign out
      </button>

      {signOutFailed ? (
        <p className="field-error settings-signout-error" role="alert">
          Could not sign out — Pack Smart could not reach the server. You are
          still signed in. Try again when you have a connection.
        </p>
      ) : null}

      <SuggestionsSheet open={open === 'suggestions'} onClose={() => setOpen(null)} />
      <AmountsSheet open={open === 'amounts'} onClose={() => setOpen(null)} />
      <RulesSheet open={open === 'rules'} onClose={() => setOpen(null)} />

    </Screen>
  )
}

/* ------------------------------------------------------------------ */

/*
 * `MAX_PER_DAY` is gone. The range lives in `@shared/quantities` now, because
 * this file and the Worker each had their own copy of it and a third number
 * lived inline in the rules endpoint — three constants, one database column.
 */

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
    if (busy || multiplier < MIN_QUANTITY || multiplier > MAX_QUANTITY) return
    setBusy(true)
    setAmounts((prev) =>
      (prev ?? []).map((a) => (a.ruleId === amount.ruleId ? { ...a, multiplier } : a)),
    )
    try {
      /*
       * The answer replaces the row, because the id can move underneath it.
       *
       * Since A4b an amount is not always the same database row: editing a
       * seeded default writes a user-owned rule that replaces it, and putting
       * the number back deletes that rule again. Both change which id is in
       * force, and this screen was keeping the one it started with — so a
       * second edit could address a row that no longer existed and come back
       * "That amount is no longer there" for an amount sitting on screen.
       *
       * Optimistic first so the number never lags the thumb, then reconciled
       * with what was actually stored.
       */
      const saved = await saveAmount(amount.ruleId, multiplier)
      setAmounts((prev) => (prev ?? []).map((a) => (a.ruleId === amount.ruleId ? saved : a)))
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
    <BottomSheet open={open} onClose={onClose} title="Your usual amounts" loading={amounts === null}>
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
          /*
           * Two lines, not four.
           *
           * Each of these used to take a name line, a stepper row, a Remove
           * beside it and a "Plus 2 spare" line of its own — about 200px to say
           * "two contacts a day, plus two spare" (UX_AUDIT U4). Four amounts
           * filled the sheet, and Alex has more than four.
           *
           * The name and the stepper share the top line because they are the
           * question and the answer. Everything derived from that answer — the
           * unit, the buffer — collapses into one quiet line beneath, which is
           * where Remove goes too: it is the least likely thing on the row to be
           * wanted, so it gets the least prominent corner rather than a place
           * beside the control Alex actually came for.
           */
          <div key={amount.ruleId} className="amount-row">
            <span className="amount-text">
              <span className="amount-name">{amount.itemName}</span>
              {/*
                * The whole fact in one sentence, including the buffer, stacked
                * under the name rather than given a line of its own. The unit
                * moved off the stepper to here: repeating "per day" on every row
                * restated the paragraph at the top of the sheet and made the
                * stepper the widest thing in the control.
                */}
              <span className="amount-fact">
                {amount.multiplier} {amount.unit}
                {amount.ruleType === 'duration_plus_buffer' && amount.buffer
                  ? `, plus ${amount.buffer} spare`
                  : ''}
              </span>
            </span>

            <div className="stepper">
              <button
                type="button"
                onClick={() => void change(amount, amount.multiplier - 1)}
                disabled={busy || amount.multiplier <= 1}
                aria-label={`Fewer ${amount.itemName}`}
              >
                −
              </button>
              {/*
                * Typed, not only stepped.
                *
                * The ceiling moved from 10 to 99, and eight taps of a `+` was
                * already the real complaint at 10 — at 99 a stepper alone would
                * be unusable. `inputMode="numeric"` raises the number pad on
                * iOS; the value is committed on blur so every keystroke does not
                * fire a request, and rejected input springs back to the stored
                * number rather than saving something Alex did not type.
                */}
              <input
                className="stepper-value stepper-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                defaultValue={amount.multiplier}
                key={`${amount.ruleId}-${amount.multiplier}`}
                aria-label={`How many ${amount.itemName}`}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => {
                  const typed = readQuantity(e.currentTarget.value)
                  if (typed === null) {
                    e.currentTarget.value = String(amount.multiplier)
                    setError(QUANTITY_RANGE_MESSAGE)
                    return
                  }
                  setError(null)
                  if (typed !== amount.multiplier) void change(amount, typed)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
              <button
                type="button"
                onClick={() => void change(amount, amount.multiplier + 1)}
                disabled={busy || amount.multiplier >= MAX_QUANTITY}
                aria-label={`More ${amount.itemName}`}
              >
                +
              </button>
            </div>

            {/*
              * Remove is a glyph, not the word, and it is the last thing on the
              * row. It had its own 44px line before — which made a row TALLER
              * than the four-line version it replaced, because a touch target
              * that big sets the height of whatever line it is on. It is also the
              * least likely thing here to be wanted, so it gets the corner
              * furthest from the control Alex opened the sheet for, and an undo
              * behind it rather than a confirmation in front.
              */}
            <button
              type="button"
              className="amount-remove"
              onClick={() => void remove(amount)}
              disabled={busy}
              aria-label={`Remove ${amount.itemName}`}
            >
              <span aria-hidden="true">✕</span>
            </button>
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

        {/*
          * Not offered until the amounts it sits under have arrived.
          *
          * This one is BELOW the list — deliberately, because four rows is not a
          * scroll (see the note in the rules sheet, which is fifty and therefore
          * has Add above). But below a list that does not exist yet is a button
          * in a place it is about to leave: with the sheet's own height now held
          * still, this control was still measured dropping 297px the moment the
          * rows landed, which is the same silent mis-tap one control smaller.
          *
          * A button that will move is worse than a button that is not there yet,
          * so it appears once, where it belongs.
          */}
        {amounts === null ? <p className="hint">Loading…</p> : null}

        {amounts !== null &&
          (adding ? (
            <AmountPicker
              existingItemIds={new Set(amounts.map((a) => a.itemId))}
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
          ))}
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
            onClick={() => setMultiplier((n) => Math.min(MAX_QUANTITY, n + 1))}
            disabled={busy || multiplier >= MAX_QUANTITY}
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
      {/*
        * `aria-label`, because the label above it is a sibling `span` rather
        * than a wrapper — so the field's only name was its placeholder, which
        * disappears the moment anything is typed. Caught by the mechanical gate
        * as `no-accessible-name` the first time this state was ever captured.
        */}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search your things"
        label="What do you pack by the day?"
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
              {CATEGORY_EMOJI[item.category] ?? ''} {item.displayName}
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
  const [adding, setAdding] = useState(false)
  const [removed, setRemoved] = useState<PackingRule | null>(null)

  const load = useCallback(async () => {
    try {
      setRules((await fetchRules()).rules)
      setError(null)
    } catch {
      setError('Could not load your rules.')
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setSearch('')
    setError(null)
    setAdding(false)
    setRemoved(null)
    void load()
  }, [open, load])

  /*
   * Replaces the row the screen asked about with the row that came back.
   *
   * Matching on `listedRuleId` rather than on the returned id is what makes
   * changing a default work: the first edit to one answers with an override
   * that did not exist a moment ago, and matching on its own id would append a
   * second row for the same item instead of replacing the one Alex touched.
   */
  function replaceRule(next: RuleChange) {
    setRules((prev) => (prev ?? []).map((r) => (r.id === next.listedRuleId ? next : r)))
  }

  async function toggle(rule: PackingRule) {
    if (busy) return
    setBusy(true)
    const next = !rule.enabled
    setRules((prev) => (prev ?? []).map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)))
    try {
      replaceRule(await updateRule(rule.id, { enabled: next }))
      setError(null)
    } catch {
      setError('Could not save that.')
      setRules((prev) => (prev ?? []).map((r) => (r.id === rule.id ? { ...r, enabled: !next } : r)))
    } finally {
      setBusy(false)
    }
  }

  async function restoreToDefault(rule: PackingRule) {
    if (busy) return
    setBusy(true)
    try {
      replaceRule(await restoreDefault(rule.id))
      setError(null)
    } catch {
      setError('Could not put the original back.')
      void load()
    } finally {
      setBusy(false)
    }
  }

  /*
   * Removing a rule Alex wrote is a real delete, so it gets an undo rather than
   * a confirmation (INTERACTION_PATTERNS). Undo re-creates it from what the row
   * held — everything a created rule has is on screen, so nothing is lost in
   * the round trip.
   */
  async function remove(rule: PackingRule) {
    if (busy) return
    setBusy(true)
    setRules((prev) => (prev ?? []).filter((r) => r.id !== rule.id))
    try {
      await deleteRule(rule.id)
      setRemoved(rule)
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
      await createRule(target.itemId, target.ruleType, target.quantityValue ?? 1)
    } catch {
      setError('Could not put that back.')
    }
    void load()
  }

  const needle = search.trim().toLowerCase()
  const visible = (rules ?? []).filter(
    (rule) => !needle || rule.itemName.toLowerCase().includes(needle),
  )
  const needingReview = (rules ?? []).filter((r) => r.needsReview).length

  return (
    <BottomSheet open={open} onClose={onClose} title="Packing rules" loading={rules === null}>
      <div className="form">
        {error ? <p className="field-error">{error}</p> : null}

        <label className="field">
          <span className="visually-hidden">Search rules</span>
          <SearchInput value={search} onChange={setSearch} placeholder="Search" />
        </label>

        {/*
          * Add sits ABOVE the list, where the amounts sheet has it below.
          *
          * Not an inconsistency worth removing: that list is four rows long and
          * this one is every rule Alex owns — around fifty after the import.
          * A primary action reachable only by scrolling past fifty rows is not
          * immediately accessible (doc 02), and the phone is where that costs
          * the most.
          */}
        {adding ? (
          <RulePicker
            onCancel={() => setAdding(false)}
            onAdded={() => {
              setAdding(false)
              void load()
            }}
          />
        ) : (
          <button type="button" className="button-secondary" onClick={() => setAdding(true)}>
            Add a rule
          </button>
        )}

        {rules === null ? <p className="hint">Loading…</p> : null}

        {/*
          * Directly above the list it is about, and not above the search field.
          *
          * It used to be the first thing in the sheet, which put a block of text
          * that does not exist until the rules land ABOVE the two controls that
          * are on screen while they are still loading. Alex reaching for `Add a
          * rule` had it pushed down by three lines the moment the reply arrived
          * — the same defect as the sheet's own height jump, one banner smaller.
          * Everything above this point is now on screen from the first frame and
          * stays where it is; what appears below it is new either way.
          *
          * Reads better here too: it is a statement about the rules underneath
          * it, so it sits with them rather than above the box used to search
          * them.
          */}
        {needingReview > 0 ? (
          <p className="critical-warning">
            {needingReview} {needingReview === 1 ? 'rule needs' : 'rules need'} a look. Pack Smart
            could not work out what {needingReview === 1 ? 'it means' : 'they mean'}, so
            {needingReview === 1 ? ' it is' : ' they are'} not being used.
          </p>
        ) : null}

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

              {/*
                * The numbers worth changing, each where there is exactly one.
                *
                * A threshold — the 5 in "any flight of at least 5 hours" — and a
                * quantity, for the kinds whose number is not already editable in
                * Your usual amounts. Doc 09 §18 is explicit that this must not
                * become a generic rule builder over raw database fields, so a
                * rule with two numeric comparisons shows neither field and says
                * so rather than guessing which was meant.
                *
                * Outside the toggle button, because a field inside a button
                * cannot be typed into.
                */}
              <div className="rule-extras">
                <RuleThresholdField rule={rule} onSaved={replaceRule} onError={setError} />
                <RuleQuantityField rule={rule} onSaved={replaceRule} onError={setError} />

                {rule.canDelete ? (
                  <button
                    type="button"
                    className="amount-remove"
                    onClick={() => void remove(rule)}
                    disabled={busy}
                    aria-label={`Remove the rule for ${rule.itemName}`}
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                ) : null}
              </div>

              {/*
                * What this changed, and the way back.
                *
                * A default is never overwritten, so there is always something
                * exact to return to — which is the half of "you can change it"
                * that makes changing it safe.
                */}
              {rule.overridesDefault ? (
                <p className="rule-changed">
                  <span>{describeChange(rule)}</span>
                  <button type="button" onClick={() => void restoreToDefault(rule)} disabled={busy}>
                    Use the default
                  </button>
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        {rules !== null && visible.length === 0 ? (
          <p className="hint">No rules match that.</p>
        ) : null}

        {removed ? (
          <p className="undo-inline" role="status">
            <span>Rule for {removed.itemName} removed.</span>
            <button type="button" onClick={() => void undoRemove()}>
              Undo
            </button>
          </p>
        ) : null}
      </div>
    </BottomSheet>
  )
}

/**
 * What Alex changed about a default, in one line.
 *
 * Three different sentences, because there are three different changes and
 * "Changed from Always packed" on a row that reads *Always packed — Off* is a
 * line that describes the change by restating the rule. What moved is whether
 * it is used at all, so that is what the line says.
 */
function describeChange(rule: PackingRule): string {
  const original = rule.overridesDefault
  if (!original) return ''
  if (!rule.enabled && original.enabled) return 'Turned off. It is on by default.'
  if (rule.enabled && !original.enabled) return 'Turned on. It is off by default.'
  return `Changed from ${describeRule({ ...original, dependsOnName: rule.dependsOnName })}.`
}

/**
 * Writes a rule for something Alex owns.
 *
 * Four kinds, and no condition builder: doc 09 §18 rules out exposing raw trip
 * facts, and a rule that fires on a condition Alex cannot see the wording of is
 * exactly the unexplainable recommendation doc 09 §25 forbids.
 *
 * A rule added here COMBINES with whatever the item already has. It can raise a
 * quantity and it can cap one, but it cannot quietly reduce a default — asking
 * for fewer than a default is a change to that default, which is what the
 * number on its own row does.
 */
function RulePicker({ onCancel, onAdded }: { onCancel: () => void; onAdded: () => void }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Item[]>([])
  const [chosen, setChosen] = useState<Item | null>(null)
  const [ruleType, setRuleType] = useState(RULE_KINDS[0]!.ruleType)
  const [quantity, setQuantity] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const needle = search.trim()
    if (needle.length < 2 || chosen) return

    let cancelled = false
    const timer = setTimeout(() => {
      fetchItems({ search: needle })
        .then((result) => {
          if (!cancelled) setResults(result.items)
        })
        .catch(() => {
          if (!cancelled) setError('Could not search your things.')
        })
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search, chosen])

  async function save() {
    if (!chosen || busy) return
    setBusy(true)
    try {
      await createRule(chosen.id, ruleType, quantity)
      onAdded()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add that.')
      setBusy(false)
    }
  }

  if (chosen) {
    const kind = RULE_KINDS.find((k) => k.ruleType === ruleType)!
    return (
      <div className="field amount-add">
        <span className="field-label">{chosen.displayName}</span>
        {error ? <span className="field-error">{error}</span> : null}

        <div className="rule-kinds" role="group" aria-label="What kind of rule">
          {RULE_KINDS.map((option) => (
            <button
              key={option.ruleType}
              type="button"
              className={`rule-kind ${option.ruleType === ruleType ? 'is-chosen' : ''}`}
              aria-pressed={option.ruleType === ruleType}
              onClick={() => setRuleType(option.ruleType)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="hint">{kind.help}</span>

        <div className="stepper">
          <button
            type="button"
            onClick={() => setQuantity((n) => Math.max(MIN_QUANTITY, n - 1))}
            disabled={busy || quantity <= MIN_QUANTITY}
            aria-label="Fewer"
          >
            −
          </button>
          <span className="stepper-value" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((n) => Math.min(MAX_QUANTITY, n + 1))}
            disabled={busy || quantity >= MAX_QUANTITY}
            aria-label="More"
          >
            +
          </button>
        </div>

        <button type="button" className="button-primary" onClick={() => void save()} disabled={busy}>
          Save this rule
        </button>
        <button type="button" className="button-secondary" onClick={() => setChosen(null)}>
          Pick something else
        </button>
      </div>
    )
  }

  return (
    <div className="field amount-add">
      <span className="field-label">What is the rule about?</span>
      {error ? <span className="field-error">{error}</span> : null}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search your things"
        label="What is the rule about?"
        autoFocus
      />

      {search.trim().length >= 2 && results.length === 0 ? (
        <span className="hint">
          Nothing matches. Anything you want a rule for has to be in My Stuff first.
        </span>
      ) : null}

      <ul className="picker-list">
        {results.slice(0, 8).map((item) => (
          <li key={item.id}>
            <button type="button" className="picker-row" onClick={() => setChosen(item)}>
              {CATEGORY_EMOJI[item.category] ?? ''} {item.displayName}
            </button>
          </li>
        ))}
      </ul>

      <span className="hint">
        For how many you pack each day, use Your usual amounts instead.
      </span>

      <button type="button" className="button-secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/**
 * The quantity in a rule, for the kinds whose number has no other home.
 *
 * `per_day` and its family are absent deliberately: their number is the whole
 * of `Your usual amounts`, and a second field editing the same column is how
 * two screens start disagreeing about what Alex last said. The conditional
 * kinds are absent too — their quantity is "one, when it fires", and a stepper
 * beside it would imply a choice that changes nothing.
 */
const QUANTITY_EDITABLE = new Set(['fixed_per_trip', 'minimum', 'maximum', 'spare'])

function RuleQuantityField({
  rule,
  onSaved,
  onError,
}: {
  rule: PackingRule
  onSaved: (rule: RuleChange) => void
  onError: (message: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  if (!QUANTITY_EDITABLE.has(rule.ruleType)) return null

  const current = rule.quantityValue ?? 1

  async function commit(raw: string) {
    const typed = readQuantity(raw)
    if (typed === null || typed === current) return typed === null
    setBusy(true)
    try {
      onSaved(await updateRule(rule.id, { quantityValue: typed }))
      onError(null)
    } catch {
      onError('Could not change that number.')
    } finally {
      setBusy(false)
    }
    return false
  }

  return (
    /*
     * "How many" is visible, not only announced.
     *
     * A bare box holding `1` under a row reading "Always packed" says nothing
     * about what the number is — the threshold field beside it looks identical
     * and means something else entirely, and its unit ("hours", "nights") is
     * what tells them apart. `aria-label` names the item as well, because
     * "How many" repeated down a list of fifty rules is no use to anyone
     * navigating by control.
     */
    <label className="rule-threshold">
      <span className="rule-threshold-unit">How many</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={busy}
        aria-label={`How many ${rule.itemName}`}
        defaultValue={current}
        key={`${rule.id}-${current}`}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          void commit(e.currentTarget.value).then((rejected) => {
            if (rejected) {
              e.currentTarget.value = String(current)
              onError(QUANTITY_RANGE_MESSAGE)
            }
          })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
    </label>
  )
}

/**
 * The editable number in a rule, where there is exactly one.
 *
 * Its own component because it holds a draft: typing "1" on the way to "12"
 * must not save a rule that fires on every flight over an hour. The value is
 * committed on blur or Enter, and springs back to what is stored when what was
 * typed is not a number the rule can use.
 */
function RuleThresholdField({
  rule,
  onSaved,
  onError,
}: {
  rule: PackingRule
  onSaved: (rule: RuleChange) => void
  onError: (message: string | null) => void
}) {
  const threshold = readThreshold(rule.condition)
  const [busy, setBusy] = useState(false)
  if (!threshold) return null

  const unit = thresholdUnit(threshold.fact, threshold.value)

  async function commit(raw: string) {
    const typed = readQuantity(raw)
    if (typed === null || typed === threshold!.value) return typed === null
    setBusy(true)
    try {
      onSaved(await updateRuleThreshold(rule.id, typed))
      onError(null)
    } catch {
      onError('Could not change that number.')
    } finally {
      setBusy(false)
    }
    return false
  }

  return (
    <label className="rule-threshold">
      <span className="visually-hidden">{`Change the number for ${rule.itemName}`}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={busy}
        defaultValue={threshold.value}
        key={`${rule.id}-${threshold.value}`}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          void commit(e.currentTarget.value).then((rejected) => {
            if (rejected) {
              e.currentTarget.value = String(threshold.value)
              onError(QUANTITY_RANGE_MESSAGE)
            }
          })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      {unit ? <span className="rule-threshold-unit">{unit}</span> : null}
    </label>
  )
}

/**
 * What Alex's own history suggests changing (product doc 04 §7).
 *
 * Reading this sheet changes nothing. Accepting a proposal is the explicit act
 * that makes a permanent change, and it is reversible in Packing rules — the two
 * halves `CLAUDE.md` requires of any lasting preference change.
 */
export function SuggestionsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [found, setFound] = useState<Suggestions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setDone(null)
    fetchSuggestions()
      .then(setFound)
      .catch(() => setError('Could not load suggestions just now.'))
  }, [open])

  async function run(key: string, work: () => Promise<Suggestions>, said: string | null) {
    setBusy(key)
    try {
      setFound(await work())
      setDone(said)
      setError(null)
    } catch {
      setError('Could not save that.')
    } finally {
      setBusy(null)
    }
  }

  const removals = found?.removals ?? []
  const unworn = found?.unworn ?? []
  const corrections = found?.corrections ?? []
  const closet = found?.closet ?? []
  const nothing =
    found !== null &&
    removals.length + unworn.length + corrections.length + closet.length === 0

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="What Pack Smart has noticed"
      loading={found === null}
    >
      {error ? <p className="field-error">{error}</p> : null}
      {done ? <p className="hint">{done}</p> : null}

      {found === null && !error ? <p className="hint">Looking at your trips…</p> : null}

      {/*
        * Nothing noticed is the normal state and says so plainly, rather than
        * showing an empty panel that looks broken (doc 02 §11).
        */}
      {nothing ? (
        <p className="hint sheet-empty">
          Nothing yet. Once you have taken the same thing off a few packing lists — or moved the
          same thing to the same bag a few times — Pack Smart will offer to remember it.
        </p>
      ) : null}

      {[...removals, ...unworn].map((proposal) => (
        <div key={proposal.ruleId} className="suggestion">
          <p className="suggestion-what">{proposal.message}</p>
          <p className="hint">{proposal.effect}</p>
          <button
            type="button"
            className="button-secondary"
            onClick={() =>
              void run(
                proposal.ruleId,
                () => acceptRemoval(proposal.ruleId),
                `${proposal.itemName} will not be added automatically. You can turn it back on in Packing rules.`,
              )
            }
            disabled={busy === proposal.ruleId}
          >
            {busy === proposal.ruleId ? 'Saving…' : 'Stop adding it'}
          </button>
        </div>
      ))}

      {/*
        * A repeated correction, and THREE answers rather than one (P4c).
        *
        * The two families above offer a single button because their proposal is
        * a single claim — stop adding this. A correction is a question, and a
        * question with only a yes is a question that comes back forever: until
        * this existed, a suggestion Alex disagreed with reappeared on every
        * open, which is the fastest way to teach him the panel is not worth
        * reading.
        *
        * `Not now` is not a soft no. It withdraws the question until he asks
        * for it back from the empty state below, which is the same escape hatch
        * Review Closet Items has — a question put off has to be findable rather
        * than lost.
        */}
      {corrections.map((proposal) => {
        const key = `${proposal.subject} ${proposal.topic}`
        return (
          <div key={key} className="suggestion">
            <p className="suggestion-what">{proposal.message}</p>
            <p className="hint">{proposal.effect}</p>
            <div className="button-row">
              <button
                type="button"
                className="button-secondary"
                onClick={() =>
                  void run(key, () => acceptCorrection(proposal.change), `Remembered for ${proposal.itemName}.`)
                }
                disabled={busy === key}
              >
                {busy === key ? 'Saving…' : 'Remember it'}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() =>
                  void run(key, () => decideCorrection(proposal.subject, proposal.topic, 'declined'), null)
                }
                disabled={busy === key}
              >
                No thanks
              </button>
            </div>
            <button
              type="button"
              className="button-quiet"
              onClick={() =>
                void run(key, () => decideCorrection(proposal.subject, proposal.topic, 'not_sure'), null)
              }
              disabled={busy === key}
            >
              Not now
            </button>
          </div>
        )
      })}

      {/*
        * A hole in the wardrobe that keeps coming back (P4d).
        *
        * Two answers rather than three, and the missing one is the point: there
        * is no *Remember it*, because nothing Pack Smart can write would close
        * this. The only thing that closes it is owning something, so the card
        * names the gap and stops.
        *
        * It is emphatically not shopping. No link, no search, no product — the
        * fix is the same sentence the coverage warnings on the trip screen
        * already use, because recording something in My Stuff is the only
        * action the app knows about. Whether Alex buys anything is not its
        * business.
        */}
      {closet.map((gap) => {
        const key = `${gap.subject} ${gap.topic}`
        return (
          <div key={key} className="suggestion">
            <p className="suggestion-what">{gap.message}</p>
            <p className="hint">{gap.fix}</p>
            <div className="button-row">
              <button
                type="button"
                className="button-secondary"
                onClick={() =>
                  void run(key, () => decideCorrection(gap.subject, gap.topic, 'declined'), null)
                }
                disabled={busy === key}
              >
                No thanks
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() =>
                  void run(key, () => decideCorrection(gap.subject, gap.topic, 'not_sure'), null)
                }
                disabled={busy === key}
              >
                Not now
              </button>
            </div>
          </div>
        )
      })}

      {/*
        * The way back to what was set aside, offered where it is useful rather
        * than as a standing control: at the bottom, and only when there is
        * something to bring back.
        */}
      {found?.setAside ? (
        <button
          type="button"
          className="button-quiet"
          onClick={() => void run('restore', () => restoreSetAside(), null)}
          disabled={busy === 'restore'}
        >
          Show what I set aside
        </button>
      ) : null}
    </BottomSheet>
  )
}
