import { useEffect, useState } from 'react'
import {
  appearanceChoice,
  setAppearanceChoice,
  subscribeToAppearance,
  type Appearance,
} from '@/lib/appearance'
import './AppearanceChoice.css'

/**
 * System / Light / Dark, in Settings — and now the only appearance control in
 * the product.
 *
 * There used to be a sun/moon in the header of every screen: a two-state toggle
 * over this three-state preference, which could reach Light and Dark but never
 * find the way back to System. It was permanent, it sat in the most expensive
 * 44 points of the layout, and it was a shortcut to a control one tap away on a
 * screen that is itself one tap away. The V1.1 visual pass took the shortcut out
 * and left the whole preference here (§7).
 *
 * `System` is the only one of the three that keeps changing after it is chosen,
 * so it says what it will do rather than sitting there as a bare word.
 */
const CHOICES: Array<{ key: Appearance; label: string }> = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
]

export function AppearanceChoice() {
  const [choice, setChoice] = useState<Appearance>(appearanceChoice)

  /*
   * Kept subscribed even though this is now the only writer.
   *
   * `applyAppearance` is also called from the boot script and from the device
   * listener when the choice is `system`, and a second tab is a second writer of
   * the same stored preference. Following the shared value rather than only its
   * own taps is what stops this control ever showing a stale answer.
   */
  useEffect(() => subscribeToAppearance(() => setChoice(appearanceChoice())), [])

  return (
    <div className="appearance-choice">
      {/*
        * A radio group, not three buttons that happen to be exclusive. The
        * semantics are what tell a screen reader that picking one un-picks the
        * others, and they are free.
        */}
      {/*
        * Named for a screen reader, not printed for a sighted one.
        *
        * The section heading directly above this block already says
        * "Appearance"; a second copy inside it was the same word twice in
        * fourteen points of vertical space. `aria-labelledby` still needs an
        * element to point at, so it stays — just not on screen.
        */}
      <span className="visually-hidden" id="appearance-label">
        Appearance
      </span>

      <div className="chips" role="radiogroup" aria-labelledby="appearance-label">
        {CHOICES.map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={choice === option.key}
            className={`chip ${choice === option.key ? 'is-on' : ''}`}
            onClick={() => setAppearanceChoice(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className="appearance-note">
        {choice === 'system'
          ? 'Follows your phone, changing with it.'
          : `Always ${choice}, whatever your phone is set to.`}
      </p>
    </div>
  )
}
