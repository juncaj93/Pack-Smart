import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import { ApiRequestError } from '@/lib/api'
import { archiveItem, createItem, restoreItem, updateItem } from '@/lib/items'
import {
  ALL_CATEGORIES,
  DRESSINESS_LABELS,
  PACKING_TIMING_LABELS,
  USAGE_FREQUENCY_LABELS,
  WARMTH_LABELS,
  defaultsForCategory,
  type Item,
  type ItemInput,
  type PackingTiming,
  type UsageFrequency,
} from '@shared/items'
import './ItemSheet.css'

/** The two answers, in the order the checklist row's sheet uses. */
const TIMINGS: PackingTiming[] = ['anytime', 'day_of']

interface ItemSheetProps {
  open: boolean
  /** null = adding a new item. */
  item: Item | null
  onClose: () => void
  onSaved: () => void
}

const EMPTY: ItemInput = { displayName: '', category: 'Tops & Outerwear' }

function toInput(item: Item): ItemInput {
  return {
    kind: item.kind,
    displayName: item.displayName,
    category: item.category,
    subcategory: item.subcategory,
    color: item.color,
    brand: item.brand,
    notes: item.notes,
    favorite: item.favorite,
    usageFrequency: item.usageFrequency,
    warmth: item.warmth,
    dressiness: item.dressiness,
    typicalUses: item.typicalUses,
    ownedQuantity: item.ownedQuantity,
    isCritical: item.isCritical,
    requiresFinalCheck: item.requiresFinalCheck,
    defaultPackingTiming: item.defaultPackingTiming,
  }
}

/**
 * Add and edit, in the shared bottom sheet.
 *
 * Product doc 05 §8: name, category, colour and typical use are shown up front;
 * everything else hides behind "More details" so adding a garment stays a
 * twenty-second job on a phone. Only name and category are actually enforced —
 * refusing to save for a missing colour would cost more than it gains.
 */
export function ItemSheet({ open, item, onClose, onSaved }: ItemSheetProps) {
  const [draft, setDraft] = useState<ItemInput>(EMPTY)
  const [showMore, setShowMore] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(item ? toInput(item) : { ...EMPTY })
    setShowMore(false)
    setFieldErrors({})
    setError(null)
  }, [open, item])

  function set<K extends keyof ItemInput>(key: K, value: ItemInput[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  /** Changing category pre-fills sensible starting values, never overwriting typed ones. */
  function onCategoryChange(category: string) {
    const defaults = defaultsForCategory(category)
    setDraft((prev) => ({
      ...prev,
      category,
      kind: defaults.kind ?? prev.kind,
      warmth: prev.warmth ?? defaults.warmth ?? null,
      dressiness: prev.dressiness ?? defaults.dressiness ?? null,
      reuseCapacity: prev.reuseCapacity ?? defaults.reuseCapacity ?? null,
      isCritical: prev.isCritical ?? defaults.isCritical,
      requiresFinalCheck: prev.requiresFinalCheck ?? defaults.requiresFinalCheck,
      defaultPackingTiming: prev.defaultPackingTiming ?? defaults.defaultPackingTiming,
    }))
  }

  async function save() {
    if (busy) return
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      if (item) await updateItem(item.id, draft)
      else await createItem(draft)
      onSaved()
      onClose()
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setFieldErrors(caught.fields)
        setError(caught.message)
      } else {
        setError('Could not save. Check your connection and try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function toggleArchive() {
    if (!item || busy) return
    setBusy(true)
    try {
      if (item.archivedAt) await restoreItem(item.id)
      else await archiveItem(item.id)
      onSaved()
      onClose()
    } catch {
      setError('Could not update. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const isClothing = (draft.kind ?? 'clothing') === 'clothing'

  return (
    <BottomSheet open={open} onClose={onClose} title={item ? 'Edit item' : 'Add item'}>
      <div className="form">
        <label className="field">
          <span className="field-label">Name</span>
          <input
            value={draft.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            placeholder="Black zip-up"
            autoCapitalize="words"
            enterKeyHint="done"
          />
          {fieldErrors.displayName ? <span className="field-error">{fieldErrors.displayName}</span> : null}
        </label>

        <label className="field">
          <span className="field-label">Category</span>
          <select value={draft.category} onChange={(e) => onCategoryChange(e.target.value)}>
            {ALL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {fieldErrors.category ? <span className="field-error">{fieldErrors.category}</span> : null}
        </label>

        {isClothing ? (
          <label className="field">
            <span className="field-label">Color</span>
            <input
              value={draft.color ?? ''}
              onChange={(e) => set('color', e.target.value)}
              placeholder="Black"
              autoCapitalize="words"
            />
          </label>
        ) : null}

        {/*
          * One row, not a labelled field.
          *
          * A `field-label` reading "Favorite" above a full-width button reading
          * "☆ Not a favorite" said the same word twice and spent about 100px of a
          * sheet that has to fit the whole common task on one screen (UX_AUDIT
          * U5). The button already says what it is and what state it is in, which
          * is what a label is for.
          *
          * Still a 44px target across the full width — the saving is the label
          * and its gap, not the thing Alex taps.
          */}
        <button
          type="button"
          className={`toggle field-toggle ${draft.favorite ? 'is-on' : ''}`}
          aria-pressed={draft.favorite ?? false}
          onClick={() => set('favorite', !draft.favorite)}
        >
          {draft.favorite ? '★ Favorite' : '☆ Not a favorite'}
        </button>

        {/*
          * When this gets packed, for good — and NOT behind "More details".
          *
          * Stored on the ITEM rather than on one trip's copy of it, so a bite guard
          * or a toothbrush is day-of on every future trip without being set again.
          * That makes it a fact about the thing, like its category, rather than the
          * optional detail the disclosure below is for. It was inside the disclosure
          * at first and the end-to-end test could not find it, which is a fair proxy
          * for Alex not finding it either.
          *
          * `EntrySheet` keeps the same control for a one-trip exception.
          */}
        <div className="field">
          <span className="field-label">When to pack it</span>
          <div className="chips">
            {TIMINGS.map((timing) => (
              <button
                key={timing}
                type="button"
                className={`chip ${(draft.defaultPackingTiming ?? 'anytime') === timing ? 'is-on' : ''}`}
                aria-pressed={(draft.defaultPackingTiming ?? 'anytime') === timing}
                onClick={() => set('defaultPackingTiming', timing)}
              >
                {PACKING_TIMING_LABELS[timing]}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="disclosure" onClick={() => setShowMore((v) => !v)}>
          {showMore ? 'Fewer details' : 'More details'}
        </button>

        {showMore ? (
          <>
            <label className="field">
              <span className="field-label">Brand</span>
              <input value={draft.brand ?? ''} onChange={(e) => set('brand', e.target.value)} autoCapitalize="words" />
            </label>

            <div className="field">
              <span className="field-label">How often you use it</span>
              <select
                value={draft.usageFrequency ?? 'new'}
                onChange={(e) => set('usageFrequency', e.target.value as UsageFrequency)}
              >
                {Object.entries(USAGE_FREQUENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {isClothing ? (
              <>
                <div className="field">
                  <span className="field-label">Warmth</span>
                  <select
                    value={draft.warmth ?? ''}
                    onChange={(e) => set('warmth', e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">Not sure</option>
                    {WARMTH_LABELS.map((label, i) => (
                      <option key={label} value={i}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <span className="field-label">Dressiness</span>
                  <select
                    value={draft.dressiness ?? ''}
                    onChange={(e) => set('dressiness', e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">Not sure</option>
                    {DRESSINESS_LABELS.map((label, i) => (
                      <option key={label} value={i}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div className="field">
                <span className="field-label">Essential</span>
                <button
                  type="button"
                  className={`toggle ${draft.isCritical ? 'is-on' : ''}`}
                  aria-pressed={draft.isCritical ?? false}
                  onClick={() => set('isCritical', !draft.isCritical)}
                >
                  {draft.isCritical ? 'Must not be forgotten' : 'Ordinary item'}
                </button>
              </div>
            )}

            <label className="field">
              <span className="field-label">How many you own</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.ownedQuantity ?? ''}
                onChange={(e) => set('ownedQuantity', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="Leave blank if not sure"
              />
              {fieldErrors.ownedQuantity ? (
                <span className="field-error">{fieldErrors.ownedQuantity}</span>
              ) : null}
            </label>

            <label className="field">
              <span className="field-label">Notes</span>
              <textarea rows={3} value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
            </label>
          </>
        ) : null}

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="button" className="button-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : item ? 'Save changes' : 'Add to My Stuff'}
        </button>

        {item ? (
          <button type="button" className="button-secondary destructive" onClick={toggleArchive} disabled={busy}>
            {item.archivedAt ? 'Restore to My Stuff' : 'Archive'}
          </button>
        ) : null}

        {item && !item.archivedAt ? (
          <p className="hint">
            Archiving hides this from future packing suggestions. It stays on trips you have already
            taken, and you can restore it at any time.
          </p>
        ) : null}
      </div>
    </BottomSheet>
  )
}
