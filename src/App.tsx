import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { BottomNav } from './components/BottomNav'
import { api } from './lib/api'
import { recallRoute, rememberRoute } from './lib/last-route'
import { Home } from './screens/Home'
import { Login } from './screens/Login'
import { MyStuff } from './screens/MyStuff'
import { Settings } from './screens/Settings'
import { Trips } from './screens/Trips'

type AuthState = 'checking' | 'authenticated' | 'anonymous'

export function App() {
  const [auth, setAuth] = useState<AuthState>('checking')
  const [resumeTo, setResumeTo] = useState<string | null>(null)
  const location = useLocation()

  const checkSession = useCallback(async () => {
    try {
      const { authenticated } = await api.session()
      setAuth(authenticated ? 'authenticated' : 'anonymous')
    } catch {
      setAuth('anonymous')
    }
  }, [])

  useEffect(() => {
    // Resume where Alex left off, decided once at startup so later navigation
    // isn't hijacked.
    setResumeTo(recallRoute())
    void checkSession()
  }, [checkSession])

  useEffect(() => {
    if (auth === 'authenticated') rememberRoute(location.pathname)
  }, [auth, location.pathname])

  if (auth === 'checking') {
    // Deliberately blank rather than a spinner: the session check is a local
    // round trip, and a flashing spinner is worse than a beat of nothing.
    return <div className="app" aria-busy="true" />
  }

  if (auth === 'anonymous') {
    return <Login onAuthenticated={() => setAuth('authenticated')} />
  }

  const shouldResume = resumeTo !== null && location.pathname === '/' && resumeTo !== '/'

  return (
    <div className="app">
      <main className="app__main">
        {shouldResume ? (
          <Navigate to={resumeTo} replace />
        ) : (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/trips" element={<Trips />} />
            <Route path="/my-stuff" element={<MyStuff />} />
            <Route path="/settings" element={<Settings onSignedOut={() => setAuth('anonymous')} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
      <BottomNav />
    </div>
  )
}
