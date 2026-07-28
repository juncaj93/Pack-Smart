import { EmptyState } from '../components/EmptyState'

/** Trip creation lands in Milestone 3. */
export function Trips() {
  return (
    <>
      <h1 className="screen__title">Trips</h1>
      <EmptyState
        glyph="🗺️"
        title="No trips yet"
        body="Trip setup arrives in a later milestone. Nothing to see here yet."
      />
    </>
  )
}
