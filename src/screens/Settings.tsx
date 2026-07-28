import { useState } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { api } from '../lib/api'

export function Settings({ onSignedOut }: { onSignedOut: () => void }) {
  const [aboutOpen, setAboutOpen] = useState(false)

  async function signOut() {
    try {
      await api.logout()
    } finally {
      // Even if the request fails, drop back to the passphrase screen — the
      // cookie is HttpOnly, so the server is the only thing that can clear it,
      // and a stale client view helps nobody.
      onSignedOut()
    }
  }

  return (
    <>
      <h1 className="screen__title">Settings</h1>

      <div className="card">
        <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 15 }}>
          Preferences, packing rules, and data export arrive with their milestones.
        </p>
        <button className="btn btn--quiet btn--block" onClick={() => setAboutOpen(true)}>
          About Pack Smart
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="btn btn--quiet btn--block" onClick={signOut}>
          Sign out
        </button>
      </div>

      <BottomSheet open={aboutOpen} title="About Pack Smart" onClose={() => setAboutOpen(false)}>
        <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: 15 }}>
          A private packing assistant built for one person. Recommendations come from your saved
          preferences and structured rules — not from a paid AI service.
        </p>
        <p style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>Milestone 0 — Foundation</p>
        <button className="btn btn--block" onClick={() => setAboutOpen(false)}>
          Done
        </button>
      </BottomSheet>
    </>
  )
}
