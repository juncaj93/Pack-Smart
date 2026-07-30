import { useCallback, useEffect, useState } from 'react'
import { ItemSheet } from '@/components/ItemSheet'
import { EmptyState, Screen } from '@/components/Screen'
import { CATEGORY_EMOJI, fetchItems, itemSubtitle } from '@/lib/items'
import type { Item } from '@shared/items'
import './MyStuff.css'

type Status = 'loading' | 'ready' | 'error'

/**
 * How the list is ordered.
 *
 * Sorting is done here rather than on the server. The whole wardrobe is a hundred
 * or so rows and already in memory, so a round trip per sort change would add
 * latency to a control whose entire value is that it answers instantly — and it
 * would make "sort" a reason to refetch data that has not changed.
 */
type SortKey = 'name' | 'recent' | 'category' | 'favourite'

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'category', label: 'Category' },
  { key: 'recent', label: 'Recently added' },
  { key: 'favourite', label: 'Favourites first' },
]

const byName = (a: Item, b: Item) =>
  a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })

/**
 * Every comparator falls back to the name.
 *
 * Without it, two items of the same category or the same star come back in
 * whatever order the database felt like, and the list visibly reshuffles when
 * nothing about it changed. A stable order is the difference between a sort
 * control and a shuffle button.
 */
function sortItems(items: Item[], key: SortKey): Item[] {
  const sorted = [...items]
  switch (key) {
    case 'category':
      return sorted.sort((a, b) => a.category.localeCompare(b.category) || byName(a, b))
    case 'recent':
      return sorted.sort((a, b) => b.createdAt - a.createdAt || byName(a, b))
    case 'favourite':
      return sorted.sort(
        (a, b) => Number(b.favorite) - Number(a.favorite) || byName(a, b),
      )
    default:
      return sorted.sort(byName)
  }
}

export default function MyStuff() {
  const [status, setStatus] = useState<Status>('loading')
  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [archivedCount, setArchivedCount] = useState(0)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('name')
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

        {/*
          * Two dropdowns, where thirteen chips used to scroll sideways.
          *
          * The strip was already an improvement on six wrapped rows (UX-07), but it
          * still spent a whole row on filtering and hid every option past the third
          * behind a horizontal scroll nobody discovers. A select shows all thirteen
          * in one tap, costs half a row, and leaves room for the sort control
          * beside it — which is the thing 119 items actually needed.
          *
          * Native `<select>` on purpose: iOS renders it as the system wheel, which
          * is better than anything worth building here and free.
          */}
        <div className="stuff-selects">
          <label className="stuff-select">
            <span className="visually-hidden">Filter by category</span>
            <select
              value={category ?? ''}
              onChange={(e) => setCategory(e.target.value || null)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_EMOJI[c] ? `${CATEGORY_EMOJI[c]} ` : ''}
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="stuff-select">
            <span className="visually-hidden">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORTS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
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
            {sortItems(items, sort).map((item) => (
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
