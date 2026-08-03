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
  | 'not_configured'
  | 'internal'

export interface LoginRequest {
  passphrase: string
}

export interface SessionResponse {
  authenticated: boolean
  /** Unix seconds at which the current session expires. Absent when signed out. */
  expiresAt?: number
  /**
   * The trips list, carried on the authenticated answer only (P1b).
   *
   * The client cannot render any route until it knows whether it is signed in,
   * so the session check was a serial gate in front of every screen's first data
   * request. Attaching the one list Home and Trips both read removes that round
   * trip without the client ever sending a request it is not entitled to make:
   * the server decides, and an unauthenticated answer carries nothing.
   *
   * Absent — not empty — when signed out, so "locked" and "signed in with no
   * trips" cannot be confused for one another.
   */
  trips?: unknown[]
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
