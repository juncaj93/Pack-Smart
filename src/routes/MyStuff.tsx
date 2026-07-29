import { EmptyState, Screen } from '@/components/Screen'

export default function MyStuff() {
  return (
    <Screen title="My Stuff" subtitle="Clothing, toiletries, electronics, medication, documents, and travel gear.">
      <EmptyState
        title="Nothing imported yet"
        body="The seed workbook import is Milestone 1, and managing items is Milestone 2."
      />
    </Screen>
  )
}
