import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Where Alex was, so coming back is coming back.
 *
 * A search typed into My Stuff, a filter set on a packing list, and how far
 * down either of them is scrolled. Tapping into a trip and back, or checking
 * something in another tab, used to throw all three away — the wardrobe reopened
 * at the top with an empty search box, 119 rows above whatever he had been
 * looking at.
 *
 * ## Why this is not `sessionCache`
 *
 * `sessionCache` holds DATA, and `apiFetch` empties it on every non-GET so a
 * screen cannot show a trip that was just deleted. That is exactly right for
 * data and exactly wrong here: packing one item would wipe the search that
 * found it. This holds no data — only what Alex was looking at — so a write has
 * no bearing on it and it survives one.
 *
 * It is not a second state authority either. Every screen still owns its own
 * `useState`; this is a place to leave a copy on the way out and pick it up on
 * the way in. Nothing reads from here during a render, and nothing here can
 * disagree with the server about anything, because it never holds anything the
 * server knows.
 *
 * **In memory only**, for the same reason as `sessionCache`: it dies with the
 * page, so "private data must not outlive the session" stays true by
 * construction. `forgetViewState` runs on sign-out beside the rest.
 */
const store = new Map<string, unknown>()

export function rememberView<T>(key: string, value: T): void {
  store.set(key, value)
}

export function recallView<T>(key: string): T | undefined {
  return store.get(key) as T | undefined
}

/** Called on sign-out, beside `forgetSessionCache`. */
export function forgetViewState(): void {
  store.clear()
}

/**
 * A piece of screen state that survives leaving the screen.
 *
 * Used exactly like `useState`, and the only difference is where the initial
 * value comes from: whatever this key last held, or the fallback on a first
 * visit. Writing back happens on change rather than on unmount, because an
 * unmount is not guaranteed to run before the page is thrown away.
 */
export function useViewState<T>(key: string, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const remembered = recallView<T>(key)
    return remembered === undefined ? fallback : remembered
  })

  const set = useCallback(
    (next: T) => {
      rememberView(key, next)
      setValue(next)
    },
    [key],
  )

  return [value, set]
}

/**
 * How far down the page was, restored once the content is back on it.
 *
 * `ready` is what makes this work rather than nearly work. Restoring on mount
 * scrolls a page that is still a loading skeleton, the browser clamps the
 * offset to the height of what exists, and Alex lands somewhere near the top
 * with no way to tell why. So the restore waits for the caller to say the list
 * is rendered, and `useLayoutEffect` puts it there before the frame is painted
 * — a visible jump from 0 to 2000px is worse than not restoring at all.
 *
 * ## What this deliberately does not do
 *
 * **No React state, and no work on the scroll thread.** The listener writes a
 * number into a module-level `Map` and nothing else: no `setState`, no
 * re-render, no layout read. A scroll handler that re-renders a 119-row list is
 * how a polish pass makes an app slower than it found it.
 *
 * **No `scrollRestoration` fiddling.** The browser's own restoration works on
 * history entries; this survives an ordinary tab switch, which is not one.
 */
export function useScrollRestore(key: string, ready: boolean): void {
  const restored = useRef(false)

  useLayoutEffect(() => {
    if (!ready || restored.current) return
    restored.current = true

    const saved = recallView<number>(`scroll:${key}`)
    if (saved && saved > 0) window.scrollTo(0, saved)
  }, [key, ready])

  useEffect(() => {
    const record = () => rememberView(`scroll:${key}`, window.scrollY)
    window.addEventListener('scroll', record, { passive: true })
    return () => {
      /*
       * Recorded once more on the way out.
       *
       * The listener fires while scrolling, which covers the ordinary case, but
       * a screen left without ever being scrolled has nothing stored — and a
       * screen scrolled and then navigated away from in the same frame can lose
       * its last position to the passive listener's timing.
       */
      record()
      window.removeEventListener('scroll', record)
    }
  }, [key])
}
