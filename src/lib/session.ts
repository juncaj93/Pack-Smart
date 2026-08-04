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
