import { EmptyState } from '../components/EmptyState'

/**
 * Doc 02 §10: one unified management area covering clothing, toiletries,
 * electronics, medication, documents, and travel gear. Populated by the
 * spreadsheet import in Milestone 1 and made editable in Milestone 2.
 */
export function MyStuff() {
  return (
    <>
      <h1 className="screen__title">My Stuff</h1>
      <EmptyState
        glyph="👕"
        title="Nothing here yet"
        body="Your clothing and gear arrive with the spreadsheet import in the next milestone."
      />
    </>
  )
}
