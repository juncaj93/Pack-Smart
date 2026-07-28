import type { ReactNode } from 'react'

/**
 * Doc 02 §11: every empty, loading, and error state provides one obvious next
 * action. This component makes that the path of least resistance.
 */
export function EmptyState({
  glyph,
  title,
  body,
  action,
}: {
  glyph: string
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <span className="empty__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="empty__title">{title}</span>
      <p className="empty__body">{body}</p>
      {action}
    </div>
  )
}
