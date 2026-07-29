import { EmptyState, Screen } from '@/components/Screen'

export default function Trips() {
  return (
    <Screen title="Trips">
      <EmptyState
        title="Nothing planned"
        body="Creating a trip — destination, dates, and activities — is Milestone 3."
      />
    </Screen>
  )
}
