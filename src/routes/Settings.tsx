import { useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import { Screen } from '@/components/Screen'
import { apiFetch } from '@/lib/api'

interface SettingsProps {
  onSignedOut: () => void
}

export default function Settings({ onSignedOut }: SettingsProps) {
  const [sheetOpen, setSheetOpen] = useState(false)

  async function signOut() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } finally {
      // Even if the request fails, drop to Unlock — the cookie is either gone
      // or unusable, and stranding Alex in a half-authenticated shell is worse.
      onSignedOut()
    }
  }

  return (
    <Screen title="Settings">
      <button type="button" className="button-primary" onClick={() => setSheetOpen(true)}>
        About Pack Smart
      </button>

      <p className="milestone-note">
        Preferences, packing rules, and data export arrive with the milestones that create them.
      </p>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="About Pack Smart">
        <p data-selectable>
          A private packing assistant for one person. Deterministic rules, no paid AI API, and no
          data leaves Cloudflare except weather lookups.
        </p>
        <p className="milestone-note" data-selectable>
          Milestone 0 — foundation. This sheet is the shared BottomSheet primitive that item
          editing, quantities, and add flows will all use.
        </p>
        <button type="button" className="button-secondary" onClick={signOut}>
          Sign out
        </button>
      </BottomSheet>
    </Screen>
  )
}
