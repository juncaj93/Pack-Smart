import { NavLink } from 'react-router-dom'

/**
 * The four destinations from doc 02 §3. Clothing and Non-Clothing are
 * deliberately NOT top-level — they live inside My Stuff.
 */
const DESTINATIONS = [
  { to: '/', label: 'Home', glyph: '🏠' },
  { to: '/trips', label: 'Trips', glyph: '🧳' },
  { to: '/my-stuff', label: 'My Stuff', glyph: '👕' },
  { to: '/settings', label: 'Settings', glyph: '⚙️' },
] as const

export function BottomNav() {
  return (
    <nav className="nav" aria-label="Primary">
      {DESTINATIONS.map(({ to, label, glyph }) => (
        <NavLink key={to} to={to} end={to === '/'} className="nav__item">
          <span className="nav__glyph" aria-hidden="true">
            {glyph}
          </span>
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
