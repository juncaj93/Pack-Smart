import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { SESSION_EXPIRED_EVENT, apiFetch } from '@/lib/api'
import { readLastRoute } from '@/lib/lastRoute'
import Home from '@/routes/Home'
import Import from '@/routes/Import'
import MyStuff from '@/routes/MyStuff'
import Settings from '@/routes/Settings'
import Trip from '@/routes/Trip'
import Trips from '@/routes/Trips'
import Unlock from '@/routes/Unlock'
import type { SessionResponse } from '@shared/types'

type AuthState = 'checking' | 'locked' | 'unlocked'

export default function App() {
  const [auth, setAuth] = useState<AuthState>('checking')
  const location = useLocation()

  /*
   * Read the stored tab during the FIRST RENDER, not in an effect.
   *
   * AppShell records the current route in its own effect, and child effects run
   * before the parent's — so an effect here would always read "/" back, having
   * just been overwritten by the shell mounting at "/". A lazy initializer runs
   * before any effect at all, which removes the race rather than ordering around it.
   */
  const [resumePath, setResumePath] = useState<string | null>(() => {
    // Only resume when landing at the root; never override a real deep link.
    if (window.location.pathname !== '/') return null
    const last = readLastRoute()
    return last && last !== '/' ? last : null
  })

  const checkSession = useCallback(async () => {
    try {
      const session = await apiFetch<SessionResponse>('/api/auth/session')
      setAuth(session.authenticated ? 'unlocked' : 'locked')
    } catch {
      // A network failure is not proof of a bad session, but the shell has
      // nothing to show without one, so Unlock is the honest fallback.
      setAuth('locked')
    }
  }, [])

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  // Any 401 from anywhere drops straight back to Unlock.
  useEffect(() => {
    const onExpired = () => setAuth('locked')
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  // Consume the resume target once it has been honoured, so tapping Home later
  // in the session goes to Home rather than bouncing back to the resumed tab.
  useEffect(() => {
    if (resumePath && location.pathname === resumePath) setResumePath(null)
  }, [location.pathname, resumePath])

  if (auth === 'checking') {
    // Deliberately blank: a spinner that flashes for 30ms is noise, not feedback.
    return <div aria-busy="true" />
  }

  if (auth === 'locked') {
    return (
      <Unlock
        onUnlocked={() => {
          setAuth('unlocked')
        }}
      />
    )
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          path="/"
          element={resumePath ? <Navigate to={resumePath} replace /> : <Home />}
        />
        <Route path="/trips" element={<Trips />} />
        <Route path="/trips/:id" element={<Trip />} />
        <Route path="/my-stuff" element={<MyStuff />} />
        <Route path="/import" element={<Import />} />
        <Route
          path="/settings"
          element={<Settings onSignedOut={() => setAuth('locked')} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
