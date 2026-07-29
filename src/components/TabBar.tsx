import { NavLink } from 'react-router-dom'
import type { TabPath } from '@shared/types'

interface Tab {
  path: TabPath
  label: string
  icon: string
}

/**
 * The four bottom-navigation destinations required by product doc 02 §3.
 *
 * Clothing and Non-Clothing are deliberately NOT top-level: they live inside
 * My Stuff, which doc 02 §10 defines as one unified management area.
 */
const TABS: Tab[] = [
  { path: '/', label: 'Home', icon: '🏠' },
  { path: '/trips', label: 'Trips', icon: '🧳' },
  { path: '/my-stuff', label: 'My Stuff', icon: '👕' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
]

export function TabBar() {
  return (
    <nav className="tab-bar" aria-label="Primary">
      {TABS.map((tab) => (
        // NavLink sets aria-current="page" on the active link, which is both the
        // accessibility signal and the styling hook.
        <NavLink key={tab.path} to={tab.path} end={tab.path === '/'} className="tab-item">
          <span className="tab-icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
