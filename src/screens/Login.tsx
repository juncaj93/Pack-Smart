import { useState, type FormEvent } from 'react'
import { ApiError, api } from '../lib/api'

export function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || passphrase === '') return

    setBusy(true)
    setError('')

    try {
      await api.login(passphrase)
      setPassphrase('')
      onAuthenticated()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'rate_limited') {
        const minutes = Math.ceil((err.retryAfterSeconds ?? 60) / 60)
        setError(`Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`)
      } else if (err instanceof ApiError && err.code === 'not_configured') {
        setError(err.message)
      } else if (err instanceof ApiError && err.status === 401) {
        setError('That passphrase did not match.')
      } else {
        setError('Could not reach Pack Smart. Check your connection.')
      }
      setBusy(false)
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <div className="login__brand">
        <h1>Pack Smart</h1>
        <p className="login__tagline">Alex&rsquo;s packing assistant</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="passphrase">
          Passphrase
        </label>
        <input
          id="passphrase"
          className="field__input"
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <span className="field__error" role="alert">
          {error}
        </span>
      </div>

      <button className="btn btn--block" type="submit" disabled={busy || passphrase === ''}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
    </form>
  )
}
