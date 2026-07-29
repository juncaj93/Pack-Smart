import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { writeLastRoute } from '@/lib/lastRoute'
import { OFFLINE_EVENT, ONLINE_EVENT, isOffline } from '@/lib/offline'
import './AppShell.css'

/**
 * The authenticated shell.
 *
 * Deliberately thin: it is a normally-scrolling document, not a fixed-height
 * frame. Navigation lives at the top of each Screen (`PrimaryNav`) rather than
 * in a bar down here — in Safari the bottom strip belongs to the browser's own
 * toolbar. See 09_IMPLEMENTATION_NOTES.md §12.
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
    <div className="app-shell">
      <OfflineBanner />
      <div className="app-content">
        <Outlet />
      </div>
    </div>
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

  return (
    <p className="offline-banner" role="status">
      Offline — showing what you last saw. Changes will not save until you are back.
    </p>
  )
}
