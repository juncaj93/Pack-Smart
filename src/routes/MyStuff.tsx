import { useCallback, useEffect, useState } from 'react'
import { ItemSheet } from '@/components/ItemSheet'
import { EmptyState, Screen } from '@/components/Screen'
import { CATEGORY_EMOJI, fetchItems, itemSubtitle } from '@/lib/items'
import type { Item } from '@shared/items'
import './MyStuff.css'

type Status = 'loading' | 'ready' | 'error'

export default function MyStuff() {
  const [status, setStatus] = useState<Status>('loading')
  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [archivedCount, setArchivedCount] = useState(0)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await fetchItems({
        includeArchived: showArchived,
        category: category ?? undefined,
        search: search || undefined,
      })
      setItems(data.items)
      setCategories(data.categories)
      setArchivedCount(data.archivedCount)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [category, search, showArchived])

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 250 : 0)
    return () => clearTimeout(timer)
  }, [load, search])

  function openAdd() {
    setEditing(null)
    setSheetOpen(true)
  }

  function openEdit(item: Item) {
    setEditing(item)
    setSheetOpen(true)
  }

  const isFiltered = Boolean(search) || category !== null

  return (
    <Screen
      title="My Stuff"
      subtitle="Everything you own that might go in a bag."
      /*
       * The screen's one primary action, in the header (product doc 02 §10).
       *
       * It lived at the bottom of the list before, which with 118 rows meant it
       * could not be found at all. A floating pill replaced it and worked, but
       * covered the last rows; the header costs no vertical space and is always
       * on screen.
       */
      action={{ label: 'Add item', glyph: '+', onClick: openAdd }}
    >
      <div className="stuff-controls">
        <input
          type="search"
          className="stuff-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search"
          aria-label="Search your items"
          autoCapitalize="none"
          autoCorrect="off"
        />

        {categories.length > 0 ? (
          <div className="chips chip-strip" role="group" aria-label="Filter by category">
            <button
              type="button"
              className={`chip ${category === null ? 'is-on' : ''}`}
              aria-pressed={category === null}
              onClick={() => setCategory(null)}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`chip ${category === c ? 'is-on' : ''}`}
                aria-pressed={category === c}
                onClick={() => setCategory(category === c ? null : c)}
              >
                {CATEGORY_EMOJI[c] ?? ''} {c}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {status === 'loading' ? <p className="stuff-status">Loading your things…</p> : null}

      {status === 'error' ? (
        <EmptyState
          title="Could not load your items"
          body="Something went wrong reaching Pack Smart. Check your connection."
          action={{ label: 'Try again', onClick: () => void load() }}
        />
      ) : null}

      {status === 'ready' && items.length === 0 && !isFiltered ? (
        <EmptyState
          title="Nothing here yet"
          body="Add the clothes and gear you own. Pack Smart only ever suggests things from this list — it will never invent something you do not have."
          action={{ label: 'Add Your First Item', onClick: openAdd }}
        />
      ) : null}

      {status === 'ready' && items.length === 0 && isFiltered ? (
        <EmptyState
          title="Nothing matches"
          body="No items match that search or filter."
          action={{
            label: 'Clear filters',
            onClick: () => {
              setSearch('')
              setCategory(null)
            },
          }}
        />
      ) : null}

      {status === 'ready' && items.length > 0 ? (
        <>
          <ul className="stuff-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`stuff-row ${item.archivedAt ? 'is-archived' : ''}`}
                  onClick={() => openEdit(item)}
                >
                  <span className="stuff-emoji" aria-hidden="true">
                    {CATEGORY_EMOJI[item.category] ?? ''}
                  </span>
                  <span className="stuff-text">
                    <span className="stuff-name">{item.displayName}</span>
                    {itemSubtitle(item) ? (
                      <span className="stuff-meta">{itemSubtitle(item)}</span>
                    ) : null}
                  </span>
                  {item.favorite ? (
                    <span className="stuff-star" aria-label="Favourite">
                      ★
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="stuff-count">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </p>
        </>
      ) : null}

      {status === 'ready' && (archivedCount > 0 || showArchived) ? (
        <div className="stuff-actions">
          {/* An administrative action, and correctly out of the way (doc 02 §2). */}
          <button
            type="button"
            className="button-secondary"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </button>
        </div>
      ) : null}

      <ItemSheet
        open={sheetOpen}
        item={editing}
        onClose={() => setSheetOpen(false)}
        onSaved={() => void load()}
      />
    </Screen>
  )
}
