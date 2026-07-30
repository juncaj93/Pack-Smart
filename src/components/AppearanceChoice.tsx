import { useEffect, useState } from 'react'
import {
  appearanceChoice,
  setAppearanceChoice,
  subscribeToAppearance,
  type Appearance,
} from '@/lib/appearance'
import './AppearanceChoice.css'

/**
 * System / Light / Dark, in Settings.
 *
 * The sun/moon in the header is a two-state toggle over a three-state
 * preference: tapping it picks the theme that is not showing and stores it
 * explicitly, which is the honest reading of "I want it light *now*" but leaves
 * `System` behind for good. There has to be a way back, and it belongs here
 * rather than as a third state cycled through by the header button — a control
 * beside an open suitcase should do one obvious thing, not three.
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

  // The header toggle writes the same preference, so this follows it rather than
  // only its own taps.
  useEffect(() => subscribeToAppearance(() => setChoice(appearanceChoice())), [])

  return (
    <div className="appearance-choice">
      {/*
        * A radio group, not three buttons that happen to be exclusive. The
        * semantics are what tell a screen reader that picking one un-picks the
        * others, and they are free.
        */}
      {/*
        * Labelled like every other row on this screen. The radio group carries
        * the name for a screen reader either way, but three unlabelled chips tell
        * a sighted person nothing about what they change.
        */}
      <span className="appearance-label" id="appearance-label">
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
