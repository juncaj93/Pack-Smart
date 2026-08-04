import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

/**
 * What the server actually serves.
 *
 * PR #30 shipped a swipe fix that passed every gate and did not work on the
 * phone, and one of the hypotheses that had to be ruled out was the dullest
 * one: that the phone was not running the code the tests ran. That is worth an
 * assertion rather than a belief, because nothing else in the suite would
 * notice.
 *
 * This whole suite already runs against the built artifact — `playwright.config.ts`
 * chains `npm run build` and `vite preview` behind the real Worker, so every
 * spec here exercises production output rather than a dev server. These tests
 * make that explicit.
 *
 * The scaffolding these assertions were written against — a Preview-only
 * diagnostics panel, and a Preview-only branch that skipped the passphrase — has
 * been removed. **The assertions stay.** They are cheap, and the failure they
 * describe is silent: a build that authenticates nobody looks entirely normal to
 * anyone already signed in. A test that only existed while the hazard did would
 * have to be rewritten the next time one appears, which is the moment it is
 * least likely to be.
 */

/** Every first-party script the shell asks the browser to load. */
async function bundleSources(baseURL: string, request: APIRequestContext) {
  const shell = await request.get(baseURL)
  expect(shell.ok()).toBe(true)
  const html = await shell.text()

  const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]!)
  expect(urls.length).toBeGreaterThan(0)

  const sources = await Promise.all(
    urls.map(async (url) => {
      const asset = await request.get(`${baseURL}${url}`)
      expect(asset.ok()).toBe(true)
      return asset.text()
    }),
  )
  return { html, urls, sources }
}

test.describe('the bundle the browser is given', () => {
  test('is a production build, not a dev server', async ({ baseURL, request }) => {
    const { html, urls } = await bundleSources(baseURL!, request)

    // Vite's dev server injects its client and serves unhashed module paths.
    expect(html).not.toContain('/@vite/client')
    expect(html).not.toContain('/@react-refresh')
    // Content-hashed filenames are what make the service worker's cache-first
    // rule for /assets/ safe — a cached one can never be stale.
    for (const url of urls) expect(url).toMatch(/-[A-Za-z0-9_-]{8,}\.js$/)
  })

  test('contains the gesture, so a green suite cannot mean an empty bundle', async ({
    baseURL,
    request,
  }) => {
    const { sources } = await bundleSources(baseURL!, request)
    const all = sources.join('\n')

    // Class names rather than function names: the minifier renames functions,
    // and a test that asserts on a mangled name asserts on the minifier.
    expect(all).toContain('is-tray-open')
    expect(all).toContain('swipe-surface')
    expect(all).toContain('touchmove')
  })

  test('still requires a passphrase', async ({ baseURL, request }) => {
    /*
     * The end-to-end statement of Pack Smart's only security boundary, made
     * against the real built Worker rather than by reading the source: a guarded
     * endpoint, no session, 401.
     *
     * Written during #33, when a Preview build deliberately skipped the
     * passphrase so the swipe could be checked on a phone. That branch is gone,
     * and this outlives it — if anything ever ships a Worker that authenticates
     * nobody, Alex's trips are readable by anyone holding the URL, and this is
     * the test that says so first.
     *
     * `request` has its own cookie jar and this spec never signs in, so the
     * absence of a session is the fixture rather than something to arrange.
     */
    const guarded = await request.get(`${baseURL}/api/trips`)
    expect(guarded.status()).toBe(401)

    const session = await request.get(`${baseURL}/api/auth/session`)
    expect(session.ok()).toBe(true)
    expect(await session.json()).toMatchObject({ authenticated: false })
  })

  test('tells the browser never to keep an API answer of its own', async ({
    baseURL,
    request,
  }) => {
    /*
     * Pack Smart keeps a copy of the trip on the device on purpose — that is
     * what makes the packing list readable on a plane — but it keeps it in
     * **Cache Storage**, where the app can label it as a snapshot and delete it
     * on sign-out. The browser's own HTTP disk cache is a second store with
     * neither property: nothing in the app can enumerate it and nothing can
     * clear it, so whatever lands there outlives the session with no way to end
     * it.
     *
     * Asserted on the 401, because the header has to be on the response
     * whatever the answer — and this is the one an unauthenticated `request`
     * context can see.
     */
    const guarded = await request.get(`${baseURL}/api/trips`)
    expect(guarded.status()).toBe(401)
    expect(guarded.headers()['cache-control']).toBe('no-store')

    const session = await request.get(`${baseURL}/api/auth/session`)
    expect(session.headers()['cache-control']).toBe('no-store')

    // And not on the shell, which is content-hashed and meant to be cached.
    const shell = await request.get(baseURL!)
    expect(shell.headers()['cache-control'] ?? '').not.toContain('no-store')
  })

  test('carries none of the Preview-only diagnostics', async ({ baseURL, request }) => {
    /*
     * The diagnostics panel was Preview-only scaffolding for #33 and has been
     * deleted. This stays as the assertion that would notice it — or anything
     * like it — coming back and reaching production, because scaffolding that
     * quietly ships is how scaffolding stops being temporary.
     */
    const { sources } = await bundleSources(baseURL!, request)
    const all = sources.join('\n')

    expect(all).not.toContain('pack-smart-gesture-diagnostics')
    expect(all).not.toContain('swipe-diagnostics')
    expect(all).not.toContain('Gesture check')
  })
})
