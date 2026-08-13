import { PrimaryNav } from '@/components/PrimaryNav'

interface ScreenProps {
  title: string
  subtitle?: string
  /**
   * A compact action beside the heading — the screen's primary action when it
   * belongs in the header rather than in the flow (product doc 02 §10).
   *
   * Deliberately one action, not a slot for a toolbar. A header that grows a
   * second and third control is the desktop dashboard doc 02 rules out.
   */
  action?: { label: string; glyph: string; onClick: () => void }
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
  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="screen-head">
          <h1 className="screen-title">{title}</h1>
          {/*
            * The screen's one action, and nothing beside it.
            *
            * There used to be a second control here on every screen in the
            * product: the sun/moon appearance toggle. It was permanent, it was
            * in the most expensive 44 points the layout has, and Settings has
            * carried the full three-state version of the same preference all
            * along — so the header was spending prime space on a shortcut to a
            * control one tap away. The functionality is not reduced; only the
            * standing cost is (§7 of the V1.1 visual pass).
            */}
          {action ? (
            <button
              type="button"
              className="screen-action"
              onClick={action.onClick}
              aria-label={action.label}
            >
              {/*
                * The drawn chip is smaller than the target that contains it.
                * A 44pt slab of accent colour beside the heading would shout;
                * the requirement is that the TAP area clears 44pt, not that the
                * button look like it.
                */}
              <span className="screen-action-chip" aria-hidden="true">
                {action.glyph}
              </span>
            </button>
          ) : null}
        </div>
        {subtitle ? <p className="screen-subtitle">{subtitle}</p> : null}
        {/* Beneath the page title, above the content it switches (doc 02 §3). */}
        <PrimaryNav />
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
