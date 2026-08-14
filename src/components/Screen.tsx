import { useEffect } from 'react'
import { useAddAction } from '@/components/AddAction'

interface ScreenProps {
  title: string
  subtitle?: string
  /**
   * The screen's Add, which the bottom toolbar's centre control invokes.
   *
   * This used to draw a `+` beside the heading. The affordance moved to the
   * toolbar; the handler did not move anywhere. Each screen still owns what its
   * own Add does — `Plan a Trip`, `Add item`, `Add to this trip` — and the
   * toolbar only calls it, so nothing about what Add MEANS is reimplemented in
   * the navigation (§8, §44).
   *
   * `glyph` is gone: there is one Add control in the product now and it draws
   * its own `+`.
   *
   * Deliberately one action. A header that grows a second and third control is
   * the desktop dashboard doc 02 rules out, and so is a toolbar that does.
   */
  action?: { label: string; onClick: () => void }
  children?: React.ReactNode
}

/**
 * The layout primitive every screen sits in.
 *
 * Owns the safe-area padding and the primary navigation — so no individual
 * screen has to solve those again, which is the point of front-loading the
 * iPhone primitives into M0 (risk R8).
 *
 * It no longer owns a scroll region: the DOCUMENT scrolls now. A fixed-height
 * shell with a scrolling box inside it stops Safari collapsing its toolbar,
 * because from Safari's point of view the page never moves. See
 * 09_IMPLEMENTATION_NOTES.md §12.
 *
 * **What the header is allowed to cost.** On a 390×664 Safari viewport the old
 * header spent 110px before any screen's content began — 157px once a subtitle
 * was involved — on a title, a theme button and a row of four tabs. The tabs
 * cannot shrink: 44px is the touch minimum and the one number here that is not
 * ours to trade. So the savings came from everything else. The title dropped
 * from 28px to 22px with tight leading, the subtitle became secondary text, the
 * gaps came down a step each, and the permanent sun/moon left the header
 * entirely for the three-state control that was already in Settings.
 */
export function Screen({ title, subtitle, action, children }: ScreenProps) {
  const { register } = useAddAction()

  /*
   * Registered as an effect rather than during render, because it writes state
   * that lives above this component — and cleared on unmount, so a screen with
   * no Add cannot inherit the last screen's. `label` and the handler identity
   * are the dependencies: a screen whose Add changes what it does (the trip
   * screen, when its trip loads) re-registers, and one that merely re-renders
   * does not.
   */
  const label = action?.label
  const onClick = action?.onClick

  useEffect(() => {
    register(label && onClick ? { label, onClick } : null)
    return () => register(null)
  }, [label, onClick, register])

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="screen-head">
          <h1 className="screen-title">{title}</h1>
        </div>
        {subtitle ? <p className="screen-subtitle">{subtitle}</p> : null}
        {/*
          * No navigation here any more.
          *
          * `PrimaryNav` was a sticky 44px row beneath this title on every
          * screen. Navigation moved to one floating bar at the bottom, which is
          * reachable one-handed and gives these 44px back to the content — see
          * `BottomToolbar` for why that bar is shaped the way it is, and
          * `13_VISUAL_SYSTEM.md` for what the move actually cost and bought.
          */}
        {children}
      </div>
    </div>
  )
}

interface EmptyStateProps {
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}

/**
 * Product doc 02 §11: every empty state provides one obvious next action.
 * In M0 the actions are honest placeholders — nothing invents trip data.
 */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-body">{body}</p>
      {action ? (
        <button type="button" className="button-primary" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
