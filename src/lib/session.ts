/**
 * Remembers that this device has unlocked successfully before.
 *
 * The session cookie is HttpOnly and lasts a year, so it cannot be read from
 * JavaScript — the app can only find out whether it is still valid by asking
 * the server. Offline, that question has no answer.
 *
 * A network failure is not evidence of a bad session, so dropping to Unlock
 * would lock Alex out of his own packing list on a plane, with a passphrase
 * that cannot be checked either. This flag is the missing piece: it says
 * "this device has signed in before", which is enough to show the cached trip.
 *
 * It is not a credential and grants nothing. Every API call still carries the
 * real cookie, and any 401 drops straight back to Unlock.
 */

/**
 * Exported, because a second tab watches it.
 *
 * `storage` events fire in every OTHER tab on the same origin, so this key
 * removing itself is how a sign-out in one tab reaches the ones Alex left open
 * (`App.tsx`). Nothing else needs the string.
 */
export const UNLOCKED_KEY = 'pack-smart:unlocked-before'

const KEY = UNLOCKED_KEY

export function rememberUnlocked(): void {
  try {
    window.localStorage.setItem(KEY, '1')
  } catch {
    /* private browsing, or storage full. Worth nothing more than a lost hint. */
  }
}

export function forgetUnlocked(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* see above */
  }
}

export function hasUnlockedBefore(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* which session this is                                               */
/* ------------------------------------------------------------------ */

/**
 * A name for the current signed-in session, so a write queued in one cannot be
 * replayed in another (F2).
 *
 * **It is not a credential and it authorises nothing.** It is never sent to the
 * server, never checked by it, and holding it grants no access — every request
 * still carries the real HttpOnly cookie and is still refused by
 * `requireSession` if that cookie is gone. Its only job is the negative one: a
 * pending write whose marker is not the current marker is discarded rather than
 * replayed.
 *
 * The session cookie itself cannot do this job, because JavaScript cannot read
 * it. So the smallest reliable mechanism is a random id minted beside the
 * unlock flag and removed by the same `lock()` that removes it.
 */
export const SESSION_ID_KEY = 'pack-smart:session-id'

function randomId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    /* Older engines, and any context where `crypto` is unavailable. Uniqueness
     * is all that is needed — nothing here is a secret. */
    return `s-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/**
 * The current session's marker, minting one if this device is inside the app
 * without it.
 *
 * Minting on read matters for the device that was already signed in when this
 * shipped: it has an unlock flag and no marker, and refusing to give it one
 * would leave offline writes permanently ineligible until the next sign-out.
 */
export function sessionId(): string | null {
  try {
    if (window.localStorage.getItem(KEY) !== '1') return null
    const existing = window.localStorage.getItem(SESSION_ID_KEY)
    if (existing) return existing
    const minted = randomId()
    window.localStorage.setItem(SESSION_ID_KEY, minted)
    return minted
  } catch {
    /* Without storage there is no queue either, and both fail the same way. */
    return null
  }
}

/** A new session, and deliberately a new name for it. */
export function startSession(): string | null {
  try {
    window.localStorage.removeItem(SESSION_ID_KEY)
  } catch {
    /* see above */
  }
  return sessionId()
}

export function endSession(): void {
  try {
    window.localStorage.removeItem(SESSION_ID_KEY)
  } catch {
    /* see above */
  }
}
