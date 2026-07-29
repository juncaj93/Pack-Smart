import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { writeLastRoute } from '@/lib/lastRoute'
import { TabBar } from './TabBar'
import './AppShell.css'

/**
 * The authenticated shell: a scrolling content area above a fixed bottom nav.
 *
 * Also records the current tab, so reopening the app resumes where Alex left
 * off rather than resetting to Home.
 */
export function AppShell() {
  const location = useLocation()

  useEffect(() => {
    writeLastRoute(location.pathname)
  }, [location.pathname])

  return (
    <div className="app-shell">
      <div className="app-content">
        <Outlet />
      </div>
      <TabBar />
    </div>
  )
}
