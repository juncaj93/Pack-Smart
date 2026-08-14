import { NavLink, useLocation } from 'react-router-dom'
import { useAddAction } from '@/components/AddAction'
import { useKeyboardUp } from '@/lib/keyboard'
import type { TabPath } from '@shared/types'
import './BottomToolbar.css'

interface Destination {
  path: TabPath
  label: string
  /** The icon's path data, drawn by `ToolbarIcon`. */
  icon: string
}

/**
 * Four icons, drawn rather than typed.
 *
 * The first version used Unicode glyphs — `⌂ ⊙ ❑ ⚙` — and they were visibly not
 * a set: each comes from a different typeface's idea of a symbol, so the gear
 * rendered much heavier than the house beside it and the weights jumped along
 * the bar. Four inline paths on one stroke width are a set, and they are not a
 * dependency (§10): no package, no font, about ten lines of geometry.
 *
 * Deliberately plain shapes rather than imitations of Apple's own symbols.
 *
 * `Settings` is sliders instead of a gear on purpose: a gear's teeth are noise
 * at 18px and it was the one icon that read as a smudge.
 */
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  trips: 'M3.5 7.5h17v12h-17zM9 7.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.5',
  stuff: 'M3.5 6.5h17v4h-17zM5 10.5V20h14v-9.5M10 14.5h4',
  settings: 'M4 8h10M18 8h2M4 16h2M10 16h10M16 6v4M8 14v4',
} as const

/**
 * The four destinations required by product doc 02 §3, two either side of Add.
 *
 * Clothing and Non-Clothing are deliberately NOT top-level: they live inside My
 * Stuff, which doc 02 §10 defines as one unified management area.
 */
const LEFT: Destination[] = [
  { path: '/', label: 'Home', icon: ICONS.home },
  { path: '/trips', label: 'Trips', icon: ICONS.trips },
]

const RIGHT: Destination[] = [
  { path: '/my-stuff', label: 'My Stuff', icon: ICONS.stuff },
  { path: '/settings', label: 'Settings', icon: ICONS.settings },
]

/**
 * Routes that hide the toolbar, as one rule rather than a decision per screen.
 *
 * The rule has two halves and **both** are required:
 *
 * 1. it is a guided flow — a sequence Alex is walked through to a completion,
 *    with its own controls at the bottom of the screen; and
 * 2. it carries its own way out, by name.
 *
 * The first half alone is why hiding is wanted: a navigation bar under a
 * walkthrough puts two competing sets of controls on the same edge, and invites
 * leaving the flow half-finished by tapping something unrelated.
 *
 * The second half is why `/import` is **not** on this list, despite reading
 * like one. It has no back link and calls `navigate` nowhere: the navigation is
 * its only exit, so hiding the toolbar there would strand Alex on it. That is
 * the "redundant control was the sole route" regression §43 names, and it was
 * caught by `polish.spec.ts` asserting navigation on every screen rather than by
 * anyone noticing.
 *
 * The three below all exit by name — `Back to My Stuff`, `Back to the trip` —
 * and `tests/e2e/bottom-toolbar.spec.ts` asserts that for each, because a hidden
 * toolbar plus a missing exit is a trapped screen.
 */
const FOCUSED = [
  /^\/my-stuff\/review$/,
  /^\/trips\/[^/]+\/review$/,
  /^\/trips\/[^/]+\/outfits\/review$/,
]

export function isFocusedRoute(pathname: string): boolean {
  return FOCUSED.some((pattern) => pattern.test(pathname))
}

/**
 * Primary navigation — one compact floating bar at the bottom of the screen.
 *
 * This replaced `PrimaryNav`, a sticky row beneath each page title, which had
 * itself replaced a full-width fixed tab bar (`09_IMPLEMENTATION_NOTES.md` §12).
 * The distinction that matters, and the reason this is not simply that bar
 * returning: it **floats**, with a margin on all sides, so it reads as a control
 * sitting on the page rather than as a second toolbar welded to the same edge as
 * Safari's own. The earlier bar's failure was that it looked like browser
 * chrome; this is shaped so it cannot.
 *
 * `aria-label="Primary"` is inherited deliberately: it is the accessible name a
 * dozen e2e specs select on, and there is no reason to churn it for a change
 * that does not alter what this element IS.
 */
export function BottomToolbar() {
  const { pathname } = useLocation()
  const { action } = useAddAction()
  const keyboardUp = useKeyboardUp()

  // Not rendered at all rather than hidden with CSS: a focused flow should not
  // have four navigation controls in its tab order (§39).
  if (isFocusedRoute(pathname)) return null

  /*
   * Out of the way entirely while the keyboard is up (§18).
   *
   * A bar floating above the keyboard covers the form it belongs to, and on
   * iOS a `position: fixed` element does not move when the keyboard opens — so
   * "reposition" would mean pinning it to the top of the keyboard, which is
   * where the sheet's own primary action already is. Leaving is the honest
   * answer: nobody navigates while typing, and it comes straight back.
   */
  if (keyboardUp) return null

  return (
    <nav className="toolbar" aria-label="Primary">
      {LEFT.map((destination) => (
        <ToolbarLink key={destination.path} destination={destination} />
      ))}

      {/*
        * The centre action, and the one control here that is not navigation.
        *
        * `disabled` rather than absent on a screen with nothing to add — which
        * today is Settings and every nested trip route that is not the trip
        * itself. Removing it would move the other four controls sideways
        * between routes, and §16 asks for a toolbar that does not reposition;
        * inventing an action for those screens would change what Add means,
        * which §8 forbids outright.
        */}
      <button
        type="button"
        className="toolbar-add"
        onClick={action?.onClick}
        disabled={!action}
        aria-label={action?.label ?? 'Add'}
      >
        <span className="toolbar-add-glyph" aria-hidden="true">
          +
        </span>
      </button>

      {RIGHT.map((destination) => (
        <ToolbarLink key={destination.path} destination={destination} />
      ))}
    </nav>
  )
}

/**
 * One icon, at one stroke width.
 *
 * `aria-hidden`, because the label underneath already names the destination —
 * announcing both would read every destination twice. Nothing here depends on
 * seeing the shape (§39).
 */
function ToolbarIcon({ path }: { path: string }) {
  return (
    <svg
      className="toolbar-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  )
}

function ToolbarLink({ destination }: { destination: Destination }) {
  return (
    /*
     * `NavLink` sets `aria-current="page"` on the active link, which is both the
     * accessibility signal and the styling hook. The router is the only source
     * of active state (§28) — there is no selection held here, so browser Back,
     * Forward and a cold deep link all arrive correct without anything to sync.
     *
     * `end` only on Home. Without it `/` would match every route in the product;
     * with it everywhere, `/trips/:id/outfits` would leave the toolbar with no
     * active destination at all. Prefix matching is what makes a nested trip
     * route show Trips (§26), and `/my-stuff/review` show My Stuff.
     */
    <NavLink
      to={destination.path}
      end={destination.path === '/'}
      className="toolbar-item"
    >
      <ToolbarIcon path={destination.icon} />
      <span className="toolbar-label">{destination.label}</span>
    </NavLink>
  )
}
