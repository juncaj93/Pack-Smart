import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AddActionProvider } from '@/components/AddAction'
import { BottomToolbar } from '@/components/BottomToolbar'
import { writeLastRoute } from '@/lib/lastRoute'
import { OFFLINE_EVENT, ONLINE_EVENT, isOffline } from '@/lib/offline'
import './AppShell.css'

/**
 * The authenticated shell.
 *
 * Deliberately thin: it is a normally-scrolling document, not a fixed-height
 * frame. A fixed-height shell with a scrolling box inside it stops Safari
 * collapsing its own toolbar, because from Safari's point of view the page never
 * moves (`09_IMPLEMENTATION_NOTES.md` §12). The toolbar below is
 * `position: fixed` and changes none of that — the document still scrolls.
 *
 * Navigation lives in one floating bar at the bottom, rendered here rather than
 * inside `Screen`, so it is mounted once for the life of the session: a nav
 * remounted per route is a nav that can flash or jitter as routes change (§16).
 *
 * Also records the current route, so reopening the app resumes where Alex left
 * off rather than resetting to Home.
 */
export function AppShell() {
  const location = useLocation()

  useEffect(() => {
    writeLastRoute(location.pathname)
  }, [location.pathname])

  return (
    <AddActionProvider>
      <div className="app-shell">
        <OfflineBanner />
        <div className="app-content">
          <Outlet />
        </div>
        <BottomToolbar />
      </div>
    </AddActionProvider>
  )
}

/**
 * Says when what is on screen came from the cache rather than the server.
 *
 * Not a warning and not an error — the trip is still perfectly readable. It just
 * has to be honest about being a snapshot, because silently showing stale
 * packing progress beside an open suitcase is worse than showing none.
 */
function OfflineBanner() {
  // Starts from the latched value: the first failed request happens before
  // this component exists.
  const [offline, setOffline] = useState(isOffline)

  useEffect(() => {
    const goOffline = () => setOffline(true)

    // `sync` re-reads both signals; the browser's own online/offline events are
    // the only notice given when airplane mode is switched on or off.
    const sync = () => setOffline(isOffline())

    window.addEventListener(OFFLINE_EVENT, goOffline)
    window.addEventListener(ONLINE_EVENT, sync)
    window.addEventListener('offline', sync)
    window.addEventListener('online', sync)
    return () => {
      window.removeEventListener(OFFLINE_EVENT, goOffline)
      window.removeEventListener(ONLINE_EVENT, sync)
      window.removeEventListener('offline', sync)
      window.removeEventListener('online', sync)
    }
  }, [])

  if (!offline) return null

  /*
   * The second sentence changed with F2, and it had to.
   *
   * It used to read "Changes will not save until you are back", which was true
   * of everything and is now true of most things. Packing, unpacking, the final
   * check and the bag are kept and sent on reconnect; planning edits still are
   * not. So the banner says what IS kept rather than making a blanket promise
   * in either direction — and the row itself says `Saved on this phone`, which
   * is where the per-change answer belongs.
   */
  return (
    <p className="offline-banner" role="status">
      Offline — showing what you last saw. Packing is kept and sent when you are back.
    </p>
  )
}
