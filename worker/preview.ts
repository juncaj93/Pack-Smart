/**
 * The Preview build's passphrase bypass.
 *
 * **This is scaffolding for one real-device check, and it comes out before the
 * swipe hotfix merges.**
 *
 * ## Why it exists
 *
 * The swipe hotfix cannot be signed off by CI — PR #30 passed every automated
 * gate and was unusable on a phone — so the gate is Alex opening a Preview URL
 * and doing three things with his thumb. Typing a passphrase on a phone before
 * each attempt is friction on the one check the release depends on.
 *
 * ## Why it cannot reach production
 *
 * `import.meta.env.MODE` is replaced by Vite with a string literal at build
 * time, and the Cloudflare Vite plugin builds the WORKER through Vite as well
 * as the client — verified, not assumed: a probe compiled to
 * `'PROBE_PREVIEW_ON'` under `vite build --mode preview` and
 * `'PROBE_PREVIEW_OFF'` under `npm run build`.
 *
 * So in the production build this constant is a literal `false`, every branch
 * guarded by it is dropped, and the marker below does not appear in the bundle.
 * Three things enforce that rather than trusting it:
 *
 *  - `.github/workflows/deploy.yml` refuses to deploy a Worker bundle
 *    containing the marker;
 *  - `tests/e2e/production-bundle.spec.ts` asserts a guarded endpoint still
 *    answers 401 without a session, against the real built Worker;
 *  - the existing auth tests run under `MODE === 'test'`, where this is false,
 *    so none of them are weakened.
 *
 * ## What it does NOT change
 *
 * The session machinery, the passphrase hash, the rate limiter, the cookie, and
 * every other route are untouched. This adds one branch in front of the guard,
 * and only in a build that says `preview` on the tin.
 *
 * ## What Alex should know
 *
 * A Worker version preview URL is public, and `versions upload` binds it to the
 * REAL D1 database. While a preview with this in it is up, anyone holding that
 * URL can read and write the actual trips and wardrobe. That is the cost of
 * removing the passphrase, it is why the on-screen banner says so, and it is
 * why this is deleted rather than left in.
 */

export const PREVIEW_NO_PASSPHRASE = import.meta.env.MODE === 'preview'

/**
 * Appears in the built Worker only when the bypass was compiled in.
 *
 * The string is what `deploy.yml` greps for, so it must stay a plain literal
 * that survives minification — exported and referenced, never inlined into a
 * condition the optimiser can fold away.
 */
export const PREVIEW_MARKER = 'pack-smart-preview-no-passphrase'

/** A far-future expiry, so nothing downstream has to special-case a missing one. */
export const PREVIEW_SESSION_EXPIRES_AT = 4102444800
