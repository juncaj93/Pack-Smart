import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import { ApiRequestError } from '@/lib/api'
import { archiveItem, createItem, restoreItem, updateItem } from '@/lib/items'
import { DressinessContexts } from '@/components/DressinessContexts'
import { contextForLevel, type DressinessContext } from '@shared/dressiness'
import { RatingChoice } from '@/components/RatingChoice'
import {
  ALL_CATEGORIES,
  COMFORT_LABELS,
  PACKING_TIMING_LABELS,
  USAGE_FREQUENCY_LABELS,
  VERSATILITY_LABELS,
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
  /**
   * The row as the server just wrote it.
   *
   * Passed rather than announced, so the list can show the new values in the
   * same tick the sheet closes. `onSaved()` used to take nothing and every
   * caller answered it with a refetch — which leaves a window where the sheet
   * has closed, the list still holds the OLD row, and reopening it seeds the
   * editor from stale data. Narrow, but it is the screen telling Alex his edit
   * did not happen.
   */
  onSaved: (saved: Item) => void
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
    usageFrequency: item.usageFrequency,
    warmth: item.warmth,
    dressiness: item.dressiness,
    dressinessContexts: item.dressinessContexts,
    typicalUses: item.typicalUses,
    ownedQuantity: item.ownedQuantity,
    comfort: item.comfort,
    versatility: item.versatility,
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

  /** A default level as the single-context set it means, or nothing at all. */
  function contextsFromDefault(level: number | null): DressinessContext[] {
    const context = contextForLevel(level)
    return context === null ? [] : [context]
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
      /*
       * The category's suggested level, as the one context it means (H1c).
       *
       * Only when Alex has not already ticked something — `defaultsForCategory`
       * has always been a starting point, never an overwrite. One context, not
       * a broadened set, exactly as migration 0022 and the importer do: a
       * default is a guess, and a guess does not get to claim three contexts.
       */
      dressinessContexts:
        prev.dressinessContexts?.length
          ? prev.dressinessContexts
          : contextsFromDefault(defaults.dressiness ?? null),
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
      const saved = item ? await updateItem(item.id, draft) : await createItem(draft)
      onSaved(saved)
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
      const saved = item.archivedAt ? await restoreItem(item.id) : await archiveItem(item.id)
      onSaved(saved)
      onClose()
    } catch {
      setError('Could not update. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const isClothing = (draft.kind ?? 'clothing') === 'clothing'

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={item ? 'Edit item' : 'Add item'}
      /*
       * Save is pinned, not the last thing in the form.
       *
       * At the end of a scrolling form it goes below the fold on a 664px
       * viewport — which is what Safari actually gives a page on an iPhone 14,
       * against the 844px screen every measurement here used to assume. Pinned,
       * it is on screen at any height, and it is the only answer to the open
       * half of `UX_AUDIT` U5: reachable with the keyboard raised, by
       * construction rather than by luck.
       */
      footer={
        <button type="button" className="button-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : item ? 'Save changes' : 'Add to My Stuff'}
        </button>
      }
    >
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
          * The Favorite toggle used to sit here, and it is gone (H1d).
          *
          * It was the only way to WRITE the star, and removing it is what makes
          * the rest of the retirement honest: with the toggle still here and the
          * ranker no longer reading it, Alex would have kept setting a
          * preference that changed nothing. The two ratings below are its
          * replacement and they are strictly more expressive — a favourite that
          * he suffers for a nice dinner is `Comfort 1, Versatility 4`, and no
          * single bit could ever have said that.
          */}

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

                {/*
                  * Where it works — a multi-select, replacing the single
                  * `<select>` this used to be (H1c).
                  *
                  * The old control could only record one level, so an Oxford
                  * shirt had to be filed as either Smart casual or Dressy and
                  * the planner never learned it was both. `Not sure` is gone as
                  * an OPTION because it is now a STATE: tick nothing, and
                  * nothing is recorded.
                  */}
                <DressinessContexts
                  value={draft.dressinessContexts ?? []}
                  onChange={(contexts) => set('dressinessContexts', contexts)}
                />

                {/*
                  * The two ratings only Alex can give (H1b).
                  *
                  * Behind `More details` with everything else optional, because
                  * doc 05 §8 is explicit that saving must not require optional
                  * data — and a rating nobody asked for is exactly the homework
                  * H1 was scoped to avoid. Leaving them alone IS *Not sure*.
                  *
                  * Clothing only. Comfort and versatility are questions about
                  * wearing something; a passport has neither, and asking would
                  * be the irrelevant-trait noise doc 09 §7 rules out.
                  */}
                <RatingChoice
                  id="item-comfort"
                  label="Comfort"
                  value={draft.comfort ?? null}
                  labels={COMFORT_LABELS}
                  onChange={(value) => set('comfort', value)}
                />

                <RatingChoice
                  id="item-versatility"
                  label="Versatility"
                  value={draft.versatility ?? null}
                  labels={VERSATILITY_LABELS}
                  onChange={(value) => set('versatility', value)}
                  hint="Left alone, Pack Smart works this out from what you use it for."
                />
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
