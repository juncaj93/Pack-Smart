import { createContext, useCallback, useContext, useMemo, useState } from 'react'

/**
 * The screen's own Add, made available to the toolbar that invokes it.
 *
 * ## Why a registry rather than a switch in the toolbar
 *
 * Add is not one action. It is four, and they differ by route:
 *
 * | Screen | What `+` does |
 * |---|---|
 * | Home | Opens the new-trip sheet |
 * | Trips | Opens the new-trip sheet, with any prefill cleared |
 * | My Stuff | Opens the Add item sheet |
 * | A trip | `Add to this trip` — the trip's own add flow |
 * | Settings | Nothing. There is nothing there to add |
 *
 * `Add to this trip` is the one that makes this worth building properly: it
 * lives on a nested route where the toolbar shows *Trips* as the active
 * destination, and it is not reachable any other way. A centre button that
 * mapped route prefixes to actions would have to re-derive all of that, and the
 * first time a screen changed its own Add the toolbar would quietly keep doing
 * the old thing.
 *
 * So the screen still owns its handler exactly as it did when the control was in
 * its header. `Screen` registers it, the toolbar calls it, and nothing about
 * what any Add DOES is reimplemented here — this moves the affordance and
 * nothing else.
 */
export interface AddAction {
  /** The accessible name — `Add item`, `Plan a Trip`, `Add to this trip`. */
  label: string
  onClick: () => void
}

interface AddActionValue {
  action: AddAction | null
  /** Called by `Screen` when the mounted screen's action changes. */
  register: (action: AddAction | null) => void
}

const Context = createContext<AddActionValue>({ action: null, register: () => {} })

export function AddActionProvider({ children }: { children: React.ReactNode }) {
  const [action, setAction] = useState<AddAction | null>(null)

  /*
   * Identity-stable, so the effect in `Screen` that calls it does not re-run on
   * every render of every screen — which would be a `setState` per render and a
   * render loop.
   */
  const register = useCallback((next: AddAction | null) => setAction(next), [])
  const value = useMemo(() => ({ action, register }), [action, register])

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useAddAction(): AddActionValue {
  return useContext(Context)
}
