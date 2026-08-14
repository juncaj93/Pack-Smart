import { useEffect, useMemo, useRef, useState } from 'react'
import { ColorDots } from '@/components/ColorDots'
import { SearchInput } from '@/components/SearchInput'
import { fetchItems } from '@/lib/items'
import { greySpelling, storedSpelling, type Item, type ItemKind } from '@shared/items'
import './StuffPicker.css'

interface StuffPickerProps {
  /** Runs the fetch. A picker inside a closed sheet asks for nothing. */
  open: boolean
  /**
   * Which part of the wardrobe this picker is for.
   *
   * `clothing` for adding a garment to an outfit — an outfit slot holds a
   * garment, and offering a toothbrush for one would be the picker inviting a
   * choice the model cannot represent. Null for the packing list, where
   * anything Alex owns can legitimately go in a bag.
   */
  kind?: ItemKind
  /**
   * The search text, owned by the CALLER (§41).
   *
   * Held outside this component so it survives the sheet closing and reopening
   * — Alex searching for a jacket, adding it, closing the sheet and coming back
   * should not have to type it again.
   */
  search: string
  onSearch: (value: string) => void
  /** Items that are already where this picker adds to, by id. */
  taken: ReadonlySet<string>
  /** What a taken row says instead of offering itself again. */
  takenLabel: string
  /** Items added through this picker in this sitting, by id. */
  added: ReadonlySet<string>
  onChoose: (item: Item) => void
  /** What to say when the wardrobe has nothing this picker could offer. */
  emptyMessage: string
  /**
   * One control between the search field and the results.
   *
   * A slot rather than a prop per caller, and it exists for exactly one thing:
   * the packing list's `Unique item`, which has to be reachable WITHOUT
   * scrolling past the results (§8). §10 sketches it after them; below fifty
   * garments on a phone is the bottom-of-a-long-list placement §8 asks for it
   * to be moved OUT of, so it sits above them instead — one quiet row, and the
   * only thing between the search and the clothes.
   */
  belowSearch?: React.ReactNode
  /**
   * Called once the wardrobe has arrived, or has failed to.
   *
   * The picker owns the fetch, so the sheet around it cannot otherwise know
   * whether it is still waiting — and the sheet is the thing whose height moves
   * when the answer lands. Passing it up lets the sheet hold its frame while
   * this list is on its way (see `loading` in BottomSheet.tsx). Fired on the
   * failure path too: an error message is a settled height like any other.
   */
  onReady?: () => void
}

/**
 * One wardrobe browser, for every flow that adds something Alex owns.
 *
 * ## Why this exists rather than a second list
 *
 * Two flows in this pass need the same thing — *find something in My Stuff and
 * put it somewhere* — and the packing list needed it while One Last Look and
 * the swap sheet already had their own. A third and fourth implementation would
 * be four places for the row to disagree about what a garment looks like, and
 * §7 is explicit: do not create a second wardrobe browser.
 *
 * It is deliberately NOT the swap sheet. That one answers "which of my clothes
 * suits THIS slot on THESE days", which needs the planner's eligibility filter,
 * the outfit's other garments and the group's weather. This one answers "where
 * is the thing I am thinking of", which needs a search box and rows — and
 * putting a recommendation on a list with no slot to recommend for would be an
 * opinion invented out of nothing.
 *
 * ## One fetch, and the filtering is local
 *
 * The wardrobe is about 120 rows and `/api/items` already returns all of them.
 * Filtering in memory is what makes typing feel instant, and it is the specific
 * thing §52 warns about: a request per keystroke, or a refetch of the whole
 * wardrobe after each addition, would put the network in the middle of the one
 * interaction that has to feel immediate.
 */
export function StuffPicker({
  open,
  kind,
  search,
  onSearch,
  taken,
  takenLabel,
  added,
  onChoose,
  emptyMessage,
  belowSearch,
  onReady,
}: StuffPickerProps) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * The latest `onReady`, without it being a dependency of the fetch.
   *
   * Both callers pass an inline arrow, so listing it in the array below would
   * make a NEW function every render re-run the effect — refetching the whole
   * wardrobe on every keystroke, which is the one thing the note above this
   * component says must not happen.
   */
  const ready = useRef(onReady)
  useEffect(() => {
    ready.current = onReady
  })

  useEffect(() => {
    if (!open) return

    let cancelled = false
    fetchItems()
      .then((result) => {
        if (cancelled) return
        setItems(result.items)
        ready.current?.()
      })
      .catch(() => {
        if (cancelled) return
        setError('Could not read your wardrobe.')
        ready.current?.()
      })

    return () => {
      cancelled = true
    }
  }, [open])

  const wardrobe = useMemo(
    () => (items ?? []).filter((item) => !kind || item.kind === kind),
    [items, kind],
  )

  const needle = search.trim().toLowerCase()

  /*
   * Searched by what a thing IS, not only by what it is called.
   *
   * The same fields `listItems` matches on the server and the same reason the
   * swap sheet matches them here: after G6 the name carries neither the brand
   * nor the colour, so "columbia" and "black" have to reach their own fields or
   * they stop finding anything. `storedSpelling` on the needle so a search
   * typed the way the rows are SPELLED — `grey` — still finds a column that
   * holds `Gray`.
   */
  const canonical = storedSpelling(needle)
  const matches = useMemo(
    () =>
      wardrobe.filter(
        (item) =>
          !needle ||
          [item.displayName, item.brand, item.color, item.subcategory, item.category].some(
            (field) => (field ?? '').toLowerCase().includes(canonical),
          ),
      ),
    [wardrobe, needle, canonical],
  )

  /*
   * Capped, and only when nothing has been typed.
   *
   * An unsearched picker is a browse — the first fifty rows are as useful as a
   * hundred and twenty, and rendering the lot puts a scroll of a screen and a
   * half inside a sheet. A SEARCH is a question with an answer, so it is never
   * truncated: hiding the garment Alex is looking for behind a limit would be
   * the picker lying about what he owns.
   */
  const shown = needle ? matches : matches.slice(0, 50)

  return (
    <div className="stuff-picker">
      {error ? <p className="field-error">{error}</p> : null}

      <label className="field">
        <span className="visually-hidden">Search My Stuff</span>
        <SearchInput value={search} onChange={onSearch} placeholder="Search My Stuff" />
      </label>

      {belowSearch}

      {items === null && !error ? <p className="hint">Reading your wardrobe…</p> : null}

      {items !== null && wardrobe.length === 0 ? <p className="hint">{emptyMessage}</p> : null}

      {items !== null && wardrobe.length > 0 && shown.length === 0 ? (
        <p className="hint">Nothing in My Stuff matches “{search.trim()}”.</p>
      ) : null}

      <ul className="stuff-picker-list">
        {shown.map((item) => {
          /*
           * A row Alex has just tapped says `Added`, whatever else is true of
           * it — and that ordering is the point.
           *
           * Both flags go true the moment an addition lands: the caller applies
           * the server's reply, so `taken` starts including the garment too.
           * Letting `taken` win would make the row answer a question Alex did
           * not ask (*where is this?*) instead of the one he did (*did that
           * work?*), and the two sheets would say different things for the same
           * tap depending on how quickly their own state updated.
           *
           * `added` is cleared when the sheet closes, so reopening it shows the
           * standing fact — `On the list`, `In this outfit` — which is the right
           * answer once the tap is no longer the news.
           */
          const isAdded = added.has(item.id)
          const isTaken = !isAdded && taken.has(item.id)
          return (
            <li key={item.id}>
              <button
                type="button"
                className="stuff-picker-row"
                onClick={() => onChoose(item)}
                disabled={isTaken || isAdded}
                /*
                 * The colour, spoken (§14).
                 *
                 * The dot beside the name is `aria-hidden` — it is a second
                 * rendering of a fact, and the fact is this string. Composed
                 * into the button's own label rather than left to be computed
                 * from its contents, so what a listener hears is the garment,
                 * who made it and what colour it is, in that order, and never
                 * the word "Add" first.
                 */
                aria-label={[
                  item.displayName,
                  item.brand,
                  greySpelling(item.color),
                  isTaken ? takenLabel : null,
                ]
                  .filter(Boolean)
                  .join(', ')}
              >
                <span className="stuff-picker-text">
                  <span className="stuff-picker-name">{item.displayName}</span>
                  {item.brand ? (
                    <span className="stuff-picker-brand">{item.brand}</span>
                  ) : null}
                </span>
                <ColorDots color={item.color} className="stuff-picker-colors" />
                <span className="stuff-picker-action">
                  {isAdded ? 'Added' : isTaken ? takenLabel : 'Add'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {/*
        * Says the browse is capped, and how to see past it.
        *
        * Without this the list simply stops at fifty and reads as the whole
        * wardrobe — which is the picker asserting Alex does not own something
        * he does. Only in the unsearched case, because a search is never cut.
        */}
      {!needle && matches.length > shown.length ? (
        <p className="hint">
          {matches.length - shown.length} more in My Stuff — search to reach them.
        </p>
      ) : null}
    </div>
  )
}
