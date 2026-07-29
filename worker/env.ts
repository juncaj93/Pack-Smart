/**
 * Worker bindings and secrets.
 *
 * Secrets are set with `wrangler secret put` by Alex and never committed.
 * Locally they come from `.dev.vars`, which is gitignored.
 */
export interface Env {
  /** D1 binding declared in wrangler.jsonc. */
  DB: D1Database

  /**
   * The built SPA. Requests that match no static file arrive at the Worker, so
   * non-/api routes are forwarded here to get index.html back and let
   * client-side routing survive a refresh or a deep link.
   */
  ASSETS: Fetcher

  /**
   * JSON produced by `npm run hash-passphrase` — PBKDF2 parameters plus the
   * derived hash. The passphrase itself is never stored anywhere.
   */
  AUTH_PASSPHRASE_HASH?: string

  /** 32+ random bytes used to sign session tokens. Rotating it revokes sessions. */
  SESSION_SECRET?: string
}

export interface AppBindings {
  Bindings: Env
  Variables: {
    /** Set by the auth middleware once a session cookie has verified. */
    sessionExpiresAt: number
  }
}
