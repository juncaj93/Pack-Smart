import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import './NewOutfitSheet.css'

interface NewOutfitSheetProps {
  open: boolean
  busy: boolean
  onClose: () => void
  onCreate: (name: string) => void
}

/**
 * A few common answers, and none of them is a planner category (§26).
 *
 * They exist to save typing, not to classify: tapping one fills the field with
 * a word Alex could have typed, and what is stored is that word. Nothing here
 * is mapped to an `activity_tag` — a tag decides a formality band, a
 * required-slot template and which days a group is assigned to, and inferring
 * one from "Lounging" would quietly make the planner treat this as one of its
 * own outfits (§25, §28, §31).
 *
 * Six, and deliberately not a taxonomy. §26 asks for a few lightweight options
 * rather than a list to scroll, and the field beside them takes anything.
 */
const SUGGESTIONS = ['Lounging', 'Dinner', 'Travel', 'Pool', 'Workout', 'Casual day']

/**
 * Creating an outfit the planner did not think of (§24, §25).
 *
 * One question — *what is it for* — because that is the only thing Pack Smart
 * genuinely cannot work out and the only thing that makes the card mean
 * something when Alex scrolls past it a week later. Everything a planner group
 * carries besides its name is DERIVED from a template this outfit does not
 * have, so asking for any of it would be making him fill in a form on the
 * planner's behalf.
 *
 * The garments come next, in their own sheet, so this one has a single field
 * and a single action.
 */
export function NewOutfitSheet({ open, busy, onClose, onCreate }: NewOutfitSheetProps) {
  const [name, setName] = useState('')

  useEffect(() => {
    if (!open) setName('')
  }, [open])

  const trimmed = name.trim()

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="New outfit"
      /* A named but uncreated outfit is a draft, so a stray drag cannot take it. */
      dirty={trimmed.length > 0}
      dismiss="cancel"
      footer={
        <button
          type="button"
          className="button-primary"
          onClick={() => onCreate(trimmed)}
          disabled={busy || trimmed.length === 0}
        >
          {busy ? 'Creating…' : 'Create outfit'}
        </button>
      }
    >
      <div className="form">
        <label className="field">
          <span className="field-label">What is this outfit for?</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Lounging at the hotel"
            autoFocus
            enterKeyHint="done"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed) onCreate(trimmed)
            }}
          />
        </label>

        {/*
          * Chips that FILL the field rather than replacing it.
          *
          * A radio group would make these the answer and the field an override;
          * they are the other way round. Alex's own words are the outfit's name,
          * and these are six of them he did not have to type — which is why
          * tapping one leaves the field editable with the word in it rather
          * than selecting a state.
          *
          * Plain `.chips`, deliberately not `.chips-compact`. That primitive is
          * a segmented control — one track, no gaps, exclusive by shape — and
          * it says two things that are false here: that picking one un-picks
          * the others, and that the set is the whole answer. It also cannot
          * hold six words at 390px: the screenshot showed `Casual day` running
          * off the right edge of the track and the first two segments touching.
          * Wrapping pills are the primitive the trip sheet's activities already
          * use for exactly this shape of choice.
          */}
        <div className="chips new-outfit-suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className={`chip ${trimmed === suggestion ? 'is-on' : ''}`}
              onClick={() => setName(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>

        <p className="hint">
          Add the clothes next. Pack Smart will not change this outfit when it replans.
        </p>
      </div>
    </BottomSheet>
  )
}
