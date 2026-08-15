import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { SESSION_EXPIRED_EVENT, apiFetch } from '@/lib/api'
import { readLastRoute } from '@/lib/lastRoute'
import { clearPrivateCaches } from '@/lib/privateCache'
import {
  UNLOCKED_KEY,
  endSession,
  forgetUnlocked,
  hasUnlockedBefore,
  rememberUnlocked,
  startSession,
} from '@/lib/session'
import { forgetSessionCache } from '@/lib/sessionCache'
import { forgetViewState } from '@/lib/viewState'
import { allowReplay, clearQueue, denyReplay, replay, replayAllowed, watchOtherTabs } from '@/lib/writeQueue'
import { ONLINE_EVENT } from '@/lib/offline'
import DayOf from '@/routes/DayOf'
import Days from '@/routes/Days'
import Home from '@/routes/Home'
import Import from '@/routes/Import'
import Itinerary from '@/routes/Itinerary'
import MyStuff from '@/routes/MyStuff'
import OutfitReview from '@/routes/OutfitReview'
import Outfits from '@/routes/Outfits'
import PackByBag from '@/routes/PackByBag'
import Review from '@/routes/Review'
import ReviewCloset from '@/routes/ReviewCloset'
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

  /*
   * One way out of the app, used by every path that can end a session.
   *
   * A 401 from anywhere, a session check that answers `false`, and the unlock
   * flag being cleared in another tab all mean the same thing and must all leave
   * the same state behind — the device forgotten, both caches emptied, Unlock on
   * screen. Three copies of that list is how one of them quietly loses a line.
   *
   * Settings no longer offers a Sign out button, and this is unchanged by that:
   * the button called `lock` after the server confirmed the logout, and it was
   * never the only caller. Removing a control removed a caller, not a path.
   *
   * `ended` is what stops a session check that was already in flight from
   * putting Alex back inside afterwards. It answers `authenticated: true`
   * because it was ASKED before the sign-out, and `setAuth('unlocked')` on that
   * answer would undo the whole thing a beat later. A ref rather than state
   * because the check reads it after an await, where a captured state value is
   * whatever it was when the request started.
   */
  const ended = useRef(false)

  const lock = useCallback(() => {
    ended.current = true
    /*
     * The pending writes go FIRST, and before the unlock flag.
     *
     * They are private data — what Alex packed, and when — and they are also
     * intent addressed to a session that is ending, so replaying them later
     * would be acting on his behalf in a session he did not open. `clearQueue`
     * empties the whole key rather than only this session's records, so a
     * record left by any earlier one goes with it.
     *
     * `endSession` and `forgetUnlocked` are then the second guard: without the
     * flag there is no marker, and without the marker nothing is eligible for
     * replay even if a write somehow survived the line above.
     */
    clearQueue()
    denyReplay()
    endSession()
    forgetUnlocked()
    forgetSessionCache()
    // What Alex was looking at goes with the session that showed it to him.
    forgetViewState()
    void clearPrivateCaches()
    setAuth('locked')
  }, [])

  /*
   * One session check at a time, and the reason is not tidiness.
   *
   * A successful `apiFetch` dispatches `ONLINE_EVENT` from inside itself, and
   * the replay trigger below listens to it — so without this guard, the very
   * check that is about to confirm the session re-enters this function while
   * it is still in flight. That is a second round trip on every launch, which
   * `performance.spec.ts` holds the app to not spending.
   */
  const checking = useRef(false)

  const checkSession = useCallback(async () => {
    if (checking.current) return
    checking.current = true
    try {
      const session = await apiFetch<SessionResponse>('/api/auth/session')
      if (ended.current) return
      if (session.authenticated) {
        rememberUnlocked()
        /*
         * The server has now SAID this session exists, which is what the write
         * queue waits for (F2). The optimistic render below is allowed to show
         * a cached trip on a localStorage flag; it is not allowed to send a
         * write on one.
         */
        allowReplay()
        void replay()
        setAuth('unlocked')
      } else {
        // The server says no, whatever the optimistic render assumed.
        lock()
      }
    } catch {
      if (ended.current) return
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
    } finally {
      checking.current = false
    }
  }, [lock])

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  /*
   * Anything queued offline goes out as soon as there is somewhere to send it
   * (F2).
   *
   * Three triggers, because each catches a case the others miss:
   *
   * - launch, once the app is inside — covers a restart with writes still
   *   pending, which is the common case: the phone was closed on the plane and
   *   opened at the gate.
   * - `online` — the OS noticing airplane mode go off.
   * - `ONLINE_EVENT` — Pack Smart's own first successful request. This is the
   *   one that catches captive-portal wifi, where `navigator.onLine` was true
   *   the whole time and nothing the OS says ever changes.
   *
   * `replay` is cheap when there is nothing to send and refuses to run twice at
   * once, which matters because `ONLINE_EVENT` fires on every live response.
   */
  useEffect(() => {
    if (auth !== 'unlocked') return
    /*
     * Until the session has been confirmed there is nothing to replay INTO, so
     * the trigger asks the server who we are instead. That is the offline-launch
     * case: the check failed on the plane, and the first sign of signal is the
     * moment to try it again — after which `checkSession` starts the replay
     * itself.
     */
    const run = () => (replayAllowed() ? void replay() : void checkSession())
    if (replayAllowed()) void replay()
    window.addEventListener('online', run)
    window.addEventListener(ONLINE_EVENT, run)
    const unwatch = watchOtherTabs()
    return () => {
      window.removeEventListener('online', run)
      window.removeEventListener(ONLINE_EVENT, run)
      unwatch()
    }
  }, [auth, checkSession])

  // Any 401 from anywhere drops straight back to Unlock.
  useEffect(() => {
    const onExpired = () => lock()

    /*
     * And so does the unlock flag being cleared in another tab.
     *
     * `storage` fires in every OTHER tab on the origin, so removing the unlock
     * flag is a signal the rest of them can hear. Without this the second tab
     * kept `auth === 'unlocked'` and — since P1c — kept a Map full of the trip,
     * so tapping between its tabs would repaint the whole packing list from
     * memory with no request having succeeded. It normally corrects itself
     * within a round trip when the refetch 401s, but not offline: the service
     * worker turns a failed request into a 503, which is not a 401 and does not
     * end a session. "Signed out on this device" has to mean the device.
     *
     * Only the removal is acted on. A `newValue` of "1" is another tab signing
     * IN, which is not this tab's business.
     */
    const onStorage = (event: StorageEvent) => {
      if (event.key !== UNLOCKED_KEY) return
      if (event.newValue !== null) return
      onExpired()
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
      window.removeEventListener('storage', onStorage)
    }
  }, [lock])

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
          // A new session, so the latch that was holding the old one shut
          // opens again. Without this the next `checkSession` — after a
          // reload, or on the next mount — would refuse to unlock.
          ended.current = false
          rememberUnlocked()
          // And a new name for it, so nothing queued under the previous one can
          // be replayed into this one (F2).
          startSession()
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
        <Route path="/trips/:id/bags" element={<PackByBag />} />
        <Route path="/trips/:id/days" element={<Days />} />
        <Route path="/trips/:id/day-of" element={<DayOf />} />
        <Route path="/trips/:id/itinerary" element={<Itinerary />} />
        <Route path="/trips/:id/outfits" element={<Outfits />} />
        <Route path="/trips/:id/outfits/review" element={<OutfitReview />} />
        <Route path="/trips/:id/today" element={<Today />} />
        <Route path="/trips/:id/review" element={<Review />} />
        <Route path="/my-stuff" element={<MyStuff />} />
        <Route path="/my-stuff/review" element={<ReviewCloset />} />
        <Route path="/import" element={<Import />} />
        <Route
          path="/settings"
          element={<Settings />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
