import { useNavigate } from 'react-router-dom'
import { EmptyState, Screen } from '@/components/Screen'

export default function Home() {
  const navigate = useNavigate()

  return (
    <Screen title="Pack Smart">
      <EmptyState
        title="No trips yet"
        body="Trips arrive in a later milestone. The foundation is in place: you are signed in, and the app is installed and navigable."
        action={{ label: 'Create Your First Trip', onClick: () => navigate('/trips') }}
      />
      <p className="milestone-note">
        Milestone 0 — foundation only. Trip setup is M3; the packing checklist is M4–M5.
      </p>
    </Screen>
  )
}
