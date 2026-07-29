interface ScreenProps {
  title: string
  subtitle?: string
  children?: React.ReactNode
}

/**
 * The layout primitive every screen sits in.
 *
 * Owns the safe-area padding, the scroll region, and the bottom reservation for
 * the fixed tab bar — so no individual screen has to solve those again, which
 * is the point of front-loading the iPhone primitives into M0 (risk R8).
 */
export function Screen({ title, subtitle, children }: ScreenProps) {
  return (
    <div className="screen scroll-region">
      <div className="screen-inner">
        <h1 className="screen-title">{title}</h1>
        {subtitle ? <p className="screen-subtitle">{subtitle}</p> : null}
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
