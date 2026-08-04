import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { SESSION_EXPIRED_EVENT, apiFetch } from '@/lib/api'
import { readLastRoute } from '@/lib/lastRoute'
import { clearPrivateCaches } from '@/lib/privateCache'
import { forgetUnlocked, hasUnlockedBefore, rememberUnlocked } from '@/lib/session'
import { forgetSessionCache } from '@/lib/sessionCache'
import Days from '@/routes/Days'
import Home from '@/routes/Home'
import Import from '@/routes/Import'
import Itinerary from '@/routes/Itinerary'
import MyStuff from '@/routes/MyStuff'
import OutfitReview from '@/routes/OutfitReview'
import Outfits from '@/routes/Outfits'
import Settings from '@/routes/Settings'
import Today from '@/routes/Today'
import Trip from '@/routes/Trip'
import Trips from '@/routes/Trips'
import Unlock from '@/routes/Unlock'
import type { SessionResponse } from '@shared/types'

type AuthState = 'checking' | 'locked' | 'unlocked'

export default function App() {
  /*
   * A device that has unlocked before starts INSIDE the app, and the session
   * check runs beside the first screen rather than in front of it (P1b).
   *
   * This used to be `'checking'` for everyone, which rendered a blank div until
   * `/api/auth/session` answered. No route was mounted, so no route could ask
   * for its data, so every launch and every reload paid a serial round trip
   * before it started the one that actually fetches something. Measured: one
   * whole rung in front of all four screens, and three rungs deep on Home
   * (doc 09, P1).
   *
   * **This changes what is RENDERED early, never what is AUTHORISED.** Nothing
   * here is a credential and nothing here grants anything:
   *
   * - `hasUnlockedBefore` is a localStorage flag the offline path already
   *   trusts for exactly this purpose. It says "this device signed in once",
   *   which is a hint, not a claim about now.
   * - Every `/api/*` endpoint is still guarded by `requireSession` on the
   *   server. What is on screen during the optimistic window is the empty
   *   frame — a title and the nav — because data can only arrive from a
   *   request the server chose to answer.
   * - A bad or expired session answers 401, the 401 handler below forgets the
   *   device and drops to Unlock. The session check answering `false` does the
   *   same thing a beat earlier.
   * - Signing out clears the flag, so a signed-out device is back to
   *   `'checking'` and cannot take this path at all.
   *
   * A device that has NOT unlocked before still waits, and still sees the blank
   * div. Guessing Unlock for it would flash the passphrase screen at someone
   * whose cookie is perfectly valid and whose flag WebKit happened to evict.
   */
  const [auth, setAuth] = useState<AuthState>(() =>
    hasUnlockedBefore() ? 'unlocked' : 'checking',
  )
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
      if (session.authenticated) {
        rememberUnlocked()
        setAuth('unlocked')
      } else {
        /*
         * The server says no, whatever the optimistic render assumed. The
         * cached responses belonged to that session and go with it.
         */
        forgetUnlocked()
        forgetSessionCache()
        void clearPrivateCaches()
        setAuth('locked')
      }
    } catch {
      /*
       * A network failure is not proof of a bad session.
       *
       * The session check is deliberately never served from cache — telling
       * Alex he is signed in when he may not be is worse than asking again. But
       * offline he cannot answer either, and locking him out of a cached
       * packing list on a plane is the exact failure offline reads exist to
       * prevent. So a device that has unlocked before stays in; the guarded
       * endpoints still 401 if the session really has expired, which drops
       * straight back to Unlock.
       */
      setAuth(hasUnlockedBefore() ? 'unlocked' : 'locked')
    }
  }, [])

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  // Any 401 from anywhere drops straight back to Unlock.
  useEffect(() => {
    const onExpired = () => {
      forgetUnlocked()
      forgetSessionCache()
      void clearPrivateCaches()
      setAuth('locked')
    }
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
          rememberUnlocked()
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
        <Route path="/trips/:id/days" element={<Days />} />
        <Route path="/trips/:id/itinerary" element={<Itinerary />} />
        <Route path="/trips/:id/outfits" element={<Outfits />} />
        <Route path="/trips/:id/outfits/review" element={<OutfitReview />} />
        <Route path="/trips/:id/today" element={<Today />} />
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
