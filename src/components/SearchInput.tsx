import { useRef } from 'react'
import './SearchInput.css'

interface SearchInputProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  /**
   * The accessible name, for the fields whose name does not already come from
   * a wrapping `<label>`.
   *
   * Deliberately optional and deliberately not defaulted. Four of the eight
   * search fields in the product sit inside a `<label>` that already names
   * them; giving those an `aria-label` as well would override the visible text
   * with a second name, which is how a field comes to be announced as
   * something other than what it says on screen.
   */
  label?: string
  /** Layout hook for the caller's own row — this component owns no width. */
  className?: string
  autoFocus?: boolean
  autoCorrect?: 'on' | 'off'
  autoComplete?: string
}

/**
 * A search field that can be emptied in one tap.
 *
 * There are eight of these in Pack Smart — the wardrobe, the packing list, the
 * swap sheet, One last look, the review picker, and three inside Settings —
 * and until now the only way out of a search was to select the text and delete
 * it, one-handed, beside an open suitcase. This is the whole of the addition:
 * an `×` at the end of the field that is there when there is something to
 * clear and absent when there is not.
 *
 * **Why this component exists rather than a `type="search"` rule in the
 * stylesheet.** WebKit's own cancel button cannot do this job. On desktop
 * Safari and Chrome it is drawn, unstyleable, in the platform's own idea of
 * the right place; on iOS Safari — the platform Pack Smart is FOR — it is not
 * drawn at all. An affordance that exists on the machine the screenshots are
 * taken on and not on the phone the app is used on is worse than no
 * affordance, because nothing about the evidence would say so. `SearchInput.css`
 * removes it and this draws its own.
 *
 * **What it deliberately is not.** Not a general text input. Ordinary fields —
 * a trip name, a unique item, a passphrase — keep their plain `<input>`.
 * Clearing is worth a control where the field is a filter over a list, and the
 * whole value is disposable; it is noise beside a field holding something Alex
 * typed on purpose and means to keep.
 *
 * The wrapper is a `<span>` rather than a `<div>` so this can go straight
 * inside the `<label class="field">` most callers already have, without
 * changing what any of them is allowed to contain.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
  autoFocus,
  autoCorrect,
  autoComplete,
}: SearchInputProps) {
  const input = useRef<HTMLInputElement>(null)

  return (
    <span className={`search-input${className ? ` ${className}` : ''}`}>
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoCapitalize="none"
        /*
         * The return key says `Search` rather than `return` or `Go` (§17).
         *
         * Every one of these fields filters a list as it is typed, so there is
         * nothing to submit and the key's only real job is to put the keyboard
         * away — which is exactly what iOS does with `search` on a field that
         * is not in a form. `go` would promise a navigation that never happens
         * and `done` would claim the task is finished when the results are the
         * point.
         */
        enterKeyHint="search"
        autoCorrect={autoCorrect}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
      />

      {/*
        * Present only when there is something to clear.
        *
        * Not disabled-when-empty: a permanently visible `×` on an empty field
        * is a control that does nothing, sitting in the one part of the field
        * that is always on screen. It is also what keeps the promise cheap —
        * an empty search field looks exactly as it did before this existed.
        */}
      {value !== '' ? (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          /*
           * The focus never leaves the input, rather than being put back
           * afterwards.
           *
           * Preventing the default on pointerdown stops the browser moving
           * focus to the button at all — which on an iPhone is the difference
           * between the keyboard staying up and it dismissing and reopening
           * under Alex's thumb. `focus()` in the handler is the belt to that
           * braces: it covers activation by keyboard, and the case where the
           * field was not focused when the button was tapped.
           */
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('')
            input.current?.focus()
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </span>
  )
}
