import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import { addFromWardrobe, fetchLastLook, type LastLookItem, type LastLookResult } from '@/lib/trips'
import './LastLookSheet.css'

interface LastLookSheetProps {
  open: boolean
  tripId: string
  onClose: () => void
  onAdded: () => void
}

/**
 * One Last Look — the wardrobe review before packing starts.
 *
 * Leads with one short list: the garments that would fill a real gap in the
 * plan. The rest of the closet is reachable only through the search, because
 * product doc 04 §9 is explicit that leading with the full wardrobe encourages
 * overpacking.
 *
 * *Favorites you have not packed* was the second list until H1d, and it went
 * with the flag that filled it — see `shared/last-look.ts` for why nothing took
 * its place.
 */
export function LastLookSheet({ open, tripId, onClose, onAdded }: LastLookSheetProps) {
  const [result, setResult] = useState<LastLookResult | null>(null)
  const [search, setSearch] = useState('')
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setResult(null)
    setSearch('')
    setAdded(new Set())
    setError(null)

    let cancelled = false
    fetchLastLook(tripId)
      .then((data) => {
        if (!cancelled) setResult(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not review your wardrobe.')
      })

    return () => {
      cancelled = true
    }
  }, [open, tripId])

  async function add(item: LastLookItem) {
    if (busy) return
    setBusy(true)
    try {
      await addFromWardrobe(tripId, item.itemId)
      setAdded((prev) => new Set(prev).add(item.itemId))
      onAdded()
    } catch {
      setError('Could not add that.')
    } finally {
      setBusy(false)
    }
  }

  function row(item: LastLookItem) {
    const isAdded = added.has(item.itemId)
    return (
      <li key={item.itemId}>
        <button
          type="button"
          className="look-row"
          onClick={() => void add(item)}
          disabled={busy || isAdded}
        >
          <span className="look-text">
            <span className="look-name">{item.name}</span>
            {item.reason ? <span className="look-reason">{item.reason}</span> : null}
          </span>
          <span className="look-action">{isAdded ? 'Added' : 'Add'}</span>
        </button>
      </li>
    )
  }

  const needle = search.trim().toLowerCase()
  const searchResults = needle
    ? [...(result?.remaining ?? []), ...(result?.nearMatches ?? [])]
        .filter((item) => item.name.toLowerCase().includes(needle))
        .slice(0, 30)
    : []

  const nothingToShow = result !== null && result.nearMatches.length === 0

  return (
    <BottomSheet open={open} onClose={onClose} title="One last look">
      <div className="form">
        {error ? <p className="field-error">{error}</p> : null}

        {result === null ? (
          <p className="hint">Checking your wardrobe…</p>
        ) : (
          <>
            {result.nearMatches.length > 0 ? (
              <section>
                <h3 className="look-heading">Would fill a gap</h3>
                <ul className="look-list">{result.nearMatches.map(row)}</ul>
              </section>
            ) : null}

            {nothingToShow ? (
              <p className="hint">
                Nothing is obviously missing — every outfit is complete.
              </p>
            ) : null}

            <label className="field">
              <span className="field-label">Looking for something specific?</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your wardrobe"
                autoCapitalize="none"
              />
            </label>

            {needle ? (
              searchResults.length > 0 ? (
                <ul className="look-list">{searchResults.map(row)}</ul>
              ) : (
                <p className="hint">Nothing matches “{search.trim()}”.</p>
              )
            ) : null}
          </>
        )}
      </div>
    </BottomSheet>
  )
}
