import { NavLink } from 'react-router-dom'
import type { TabPath } from '@shared/types'
import './PrimaryNav.css'

interface Destination {
  path: TabPath
  label: string
}

/**
 * The four destinations required by product doc 02 §3.
 *
 * Clothing and Non-Clothing are deliberately NOT top-level: they live inside
 * My Stuff, which doc 02 §10 defines as one unified management area.
 */
const DESTINATIONS: Destination[] = [
  { path: '/', label: 'Home' },
  { path: '/trips', label: 'Trips' },
  { path: '/my-stuff', label: 'My Stuff' },
  { path: '/settings', label: 'Settings' },
]

/**
 * Primary navigation — a compact row beneath the page title.
 *
 * This replaced a fixed bottom tab bar. In Safari that bar sat directly on top
 * of Safari's own bottom toolbar: two navigation bars stacked on one edge of the
 * screen, which is why doc 02 §1 now names Safari the primary experience and
 * §3 puts navigation at the top. The same nav is used in standalone mode — one
 * navigation system, not two (doc 02 §3).
 *
 * `aria-label="Primary"` is inherited from the tab bar deliberately: it is the
 * accessible name the whole e2e suite selects on, and there is no reason to
 * churn it for a change that does not alter what this element IS.
 */
export function PrimaryNav() {
  return (
    <nav className="primary-nav" aria-label="Primary">
      {DESTINATIONS.map((destination) => (
        // NavLink sets aria-current="page" on the active link, which is both the
        // accessibility signal and the styling hook for "you are here".
        <NavLink
          key={destination.path}
          to={destination.path}
          end={destination.path === '/'}
          className="primary-nav-item"
        >
          {destination.label}
        </NavLink>
      ))}
    </nav>
  )
}
