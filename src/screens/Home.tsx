import { useNavigate } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'

/**
 * Doc 02 §4: Home prioritizes the current or next trip. With no trips yet, the
 * one obvious action is to create the first one. Trip cards, packing progress,
 * and the During Trip variant arrive with their milestones — this screen
 * deliberately shows nothing speculative in the meantime.
 */
export function Home() {
  const navigate = useNavigate()

  return (
    <>
      <h1 className="screen__title">Home</h1>
      <EmptyState
        glyph="🧳"
        title="No trips yet"
        body="Pack Smart builds your packing plan once it knows where you're going."
        action={
          <button className="btn" onClick={() => navigate('/trips')}>
            Create Your First Trip
          </button>
        }
      />
    </>
  )
}
