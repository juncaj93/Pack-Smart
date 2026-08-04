import { useCallback, useEffect, useState } from 'react'
import { ItemSheet } from '@/components/ItemSheet'
import { EmptyState, Screen } from '@/components/Screen'
import { recall, remember } from '@/lib/sessionCache'
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
type SortKey = 'category' | 'name' | 'recent' | 'favorite' | 'packed'

/*
 * Phrased as orderings, because the control beside this one is a filter.
 *
 * "Category" and "All categories" sitting side by side read as two halves of the
 * same question — the screenshot made that obvious in a way the code did not.
 * "By category" is unmistakably an answer to "in what order", and it costs two
 * characters.
 */
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'category', label: 'By category' },
  { key: 'name', label: 'A–Z' },
  { key: 'packed', label: 'Most packed' },
  { key: 'recent', label: 'Recently added' },
  { key: 'favorite', label: 'Favorites first' },
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
function sortItems(items: Item[], key: SortKey, packed: Record<string, number>): Item[] {
  const sorted = [...items]
  switch (key) {
    case 'category':
      return sorted.sort((a, b) => a.category.localeCompare(b.category) || byName(a, b))
    case 'recent':
      return sorted.sort((a, b) => b.createdAt - a.createdAt || byName(a, b))
    case 'favorite':
      return sorted.sort((a, b) => Number(b.favorite) - Number(a.favorite) || byName(a, b))
    case 'packed':
      return sorted.sort((a, b) => (packed[b.id] ?? 0) - (packed[a.id] ?? 0) || byName(a, b))
    default:
      return sorted.sort(byName)
  }
}

/**
 * Category first, because 119 items in one alphabetical run is a list you scroll
 * rather than a list you read.
 *
 * Only `Category` groups. The other four sorts exist precisely to cut *across*
 * categories — "Most packed" split into thirteen separate rankings answers a
 * question nobody asked — so they stay one flat list, and the heading that would
 * otherwise appear every few rows is simply absent.
 *
 * Grouping is derived from the same sorted array rather than computed
 * separately, so the order inside a section and the order of the sections can
 * never disagree.
 */
interface Section {
  key: string
  rows: Item[]
}

function sectionsFor(sorted: Item[], key: SortKey): Section[] {
  if (key !== 'category') return [{ key: '', rows: sorted }]

  const sections: Section[] = []
  for (const item of sorted) {
    const last = sections[sections.length - 1]
    if (last && last.key === item.category) last.rows.push(item)
    else sections.push({ key: item.category, rows: [item] })
  }
  return sections
}

/**
 * What one set of filters last answered (P1c).
 *
 * Keyed by the filters, because the unfiltered list and a search for "jacket"
 * are different answers to different questions and handing one back for the
 * other would be a bug, not a stale paint. In practice the key that matters is
 * the empty one: that is what a tab switch asks for.
 */
interface StuffSnapshot {
  items: Item[]
  categories: string[]
  archivedCount: number
  packedCounts: Record<string, number>
}

function snapshotKey(showArchived: boolean, category: string | null, search: string): string {
  return `stuff:${showArchived ? 'archived' : 'live'}:${category ?? ''}:${search}`
}

export default function MyStuff() {
  const firstKey = snapshotKey(false, null, '')
  const cached = recall<StuffSnapshot>(firstKey)

  const [status, setStatus] = useState<Status>(cached ? 'ready' : 'loading')
  const [items, setItems] = useState<Item[]>(cached?.items ?? [])
  const [categories, setCategories] = useState<string[]>(cached?.categories ?? [])
  const [archivedCount, setArchivedCount] = useState(cached?.archivedCount ?? 0)
  const [packedCounts, setPackedCounts] = useState<Record<string, number>>(
    cached?.packedCounts ?? {},
  )

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  /*
   * Category first, not name.
   *
   * The alphabetical default was the right one when this screen was a flat list
   * with nothing else on it. With grouping it is the worse default: "where is the
   * black jacket" is answered by looking under Outerwear, and the only way to
   * answer it alphabetically is to already know the name.
   */
  const [sort, setSort] = useState<SortKey>('category')
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
      setPackedCounts(data.packedTripCounts ?? {})
      setStatus('ready')
      remember<StuffSnapshot>(snapshotKey(showArchived, category, search), {
        items: data.items,
        categories: data.categories,
        archivedCount: data.archivedCount,
        packedCounts: data.packedTripCounts ?? {},
      })
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
          <label className="select-field">
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

          <label className="select-field">
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
          {sectionsFor(sortItems(items, sort, packedCounts), sort).map((section) => (
            <section key={section.key} className="stuff-section">
              {/*
                * The heading exists only under Category — `sectionsFor` returns a
                * single section with an empty key for every other sort, and an
                * empty heading above one flat list is a rule of dead space.
                */}
              {section.key ? (
                <h2 className="section-heading">
                  <span>
                    <span className="stuff-section-emoji" aria-hidden="true">
                      {CATEGORY_EMOJI[section.key] ?? ''}
                    </span>
                    {section.key}
                  </span>
                  <span className="section-count">{section.rows.length}</span>
                </h2>
              ) : null}

              <ul className="stuff-list">
                {section.rows.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`stuff-row ${item.archivedAt ? 'is-archived' : ''}`}
                      onClick={() => openEdit(item)}
                    >
                      {/*
                        * The per-row emoji is redundant once the section heading
                        * carries it, and thirteen copies of the same glyph down
                        * one column is noise. Dropped inside a grouped section
                        * only.
                        */}
                      {section.key ? null : (
                        <span className="stuff-emoji" aria-hidden="true">
                          {CATEGORY_EMOJI[item.category] ?? ''}
                        </span>
                      )}
                      <span className="stuff-text">
                        <span className="stuff-name">{item.displayName}</span>
                        {itemSubtitle(item) ? (
                          <span className="stuff-meta">{itemSubtitle(item)}</span>
                        ) : null}
                      </span>
                      {/*
                        * How many trips this has been packed on, shown only while
                        * sorting by it. A count on every row all the time would be
                        * a second number competing with the name; here it is the
                        * evidence for the order Alex just asked for.
                        */}
                      {sort === 'packed' && (packedCounts[item.id] ?? 0) > 0 ? (
                        <span className="stuff-packed">
                          {packedCounts[item.id]}{' '}
                          {packedCounts[item.id] === 1 ? 'trip' : 'trips'}
                        </span>
                      ) : null}
                      {item.favorite ? (
                        <span className="stuff-star" aria-label="Favorite">
                          ★
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
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
