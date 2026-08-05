/**
 * API contracts shared by the client and the Worker.
 *
 * Both sides import from here so a request or response shape cannot drift
 * between them without a typecheck failure.
 */

/** The single error shape every failing endpoint returns. */
export interface ApiError {
  error: {
    code: ApiErrorCode
    message: string
    /** Present on 429 only: seconds until another attempt is allowed. */
    retryAfterSeconds?: number
  }
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'invalid_passphrase'
  | 'rate_limited'
  | 'bad_request'
  /**
   * The row moved on the server since the client last read it (F2).
   *
   * Only ever raised by a write that ASKED to be conditional. An unconditional
   * PATCH still wins, because online there is nothing stale to protect against —
   * this exists so a change made offline hours ago cannot silently undo a newer
   * one.
   */
  | 'conflict'
  | 'not_configured'
  | 'internal'

export interface LoginRequest {
  passphrase: string
}

export interface SessionResponse {
  authenticated: boolean
  /** Unix seconds at which the current session expires. Absent when signed out. */
  expiresAt?: number
}

export interface HealthResponse {
  ok: boolean
  /** Proves the D1 binding is live, not merely that the Worker deployed. */
  database: 'ok' | 'unavailable'
  migrationsApplied: number
}

/** The four bottom-navigation destinations (product doc 02 §3). */
export const TAB_PATHS = ['/', '/trips', '/my-stuff', '/settings'] as const
export type TabPath = (typeof TAB_PATHS)[number]
