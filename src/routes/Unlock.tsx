import { useState } from 'react'
import { ApiRequestError, apiFetch } from '@/lib/api'
import type { SessionResponse } from '@shared/types'
import './Unlock.css'

interface UnlockProps {
  onUnlocked: () => void
}

export default function Unlock({ onUnlocked }: UnlockProps) {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || passphrase.length === 0) return

    setBusy(true)
    setError(null)
    try {
      await apiFetch<SessionResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ passphrase }),
      })
      setPassphrase('')
      onUnlocked()
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'Could not reach Pack Smart. Check your connection.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="unlock">
      <form className="unlock-card" onSubmit={submit}>
        <h1 className="unlock-title">Pack Smart</h1>
        <p className="unlock-subtitle">Enter your passphrase to continue.</p>

        <label className="visually-hidden" htmlFor="passphrase">
          Passphrase
        </label>
        <input
          id="passphrase"
          name="passphrase"
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          disabled={busy}
        />

        {error ? (
          <p className="unlock-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="button-primary"
          disabled={busy || passphrase.length === 0}
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </main>
  )
}
