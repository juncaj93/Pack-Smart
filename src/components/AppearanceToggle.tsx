import { useEffect, useState } from 'react'
import {
  applyAppearance,
  resolve,
  storeAppearance,
  storedAppearance,
  watchDeviceAppearance,
  type Appearance,
} from '@/lib/appearance'
import './AppearanceToggle.css'

/**
 * Sun / moon, top right of every screen.
 *
 * One tap, not a settings trip: this is the control Alex reaches for when the
 * room is dark and the phone is not, and burying it three taps down in Settings
 * would make it useless for the moment it exists to serve.
 *
 * **It is a two-state toggle over a three-state preference.** The stored choice is
 * `system | light | dark`; tapping picks the theme that is NOT currently showing
 * and stores it explicitly. So the first tap leaves `system` behind for good,
 * which is the honest reading of "I want it light *now*" — a choice that silently
 * reverted the next time the phone changed would be worse than no control at all.
 *
 * The glyph shows what you will GET, not what you have. A moon means "tap for
 * dark". That is the convention iOS uses and the one that survives being looked at
 * for half a second in the dark.
 */
export function AppearanceToggle() {
  const [choice, setChoice] = useState<Appearance>(() => storedAppearance())
  const [resolved, setResolved] = useState(() => resolve(storedAppearance()))

  /*
   * The boot script in `index.html` has already set the attribute, so this is not
   * what paints the first frame. It re-applies on mount so that React's state and
   * the DOM cannot drift, and follows the device for as long as the choice is
   * `system`.
   */
  useEffect(() => {
    setResolved(applyAppearance(choice))
    if (choice !== 'system') return
    return watchDeviceAppearance(() => setResolved(applyAppearance('system')))
  }, [choice])

  function flip() {
    const next: Appearance = resolved === 'dark' ? 'light' : 'dark'
    storeAppearance(next)
    setChoice(next)
  }

  const wantsDark = resolved !== 'dark'

  return (
    <button
      type="button"
      className="appearance-toggle"
      onClick={flip}
      /*
       * The accessible name says the ACTION, because that is what a screen reader
       * user needs from a button. `aria-pressed` would describe a state this
       * control does not really have — it is not "dark mode on/off", it is
       * "switch to the other one".
       */
      aria-label={wantsDark ? 'Switch to dark appearance' : 'Switch to light appearance'}
    >
      <span className="appearance-glyph" aria-hidden="true">
        {wantsDark ? '🌙' : '☀️'}
      </span>
    </button>
  )
}
