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
 * make that explicit and check the two things a build can get wrong without
 * failing: shipping the Preview-only diagnostics, or shipping a bundle that
 * does not contain the gesture at all.
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

  test('carries none of the Preview-only diagnostics', async ({ baseURL, request }) => {
    /*
     * `DIAGNOSTICS` is `import.meta.env.MODE === 'preview'`, which Vite replaces
     * with a string literal at build time — so in the default build the whole
     * panel, its stylesheet and every `trace()` call fold away. This is the
     * assertion that keeps that true, because scaffolding that quietly ships is
     * how scaffolding stops being temporary.
     */
    const { sources } = await bundleSources(baseURL!, request)
    const all = sources.join('\n')

    expect(all).not.toContain('pack-smart-gesture-diagnostics')
    expect(all).not.toContain('swipe-diagnostics')
    expect(all).not.toContain('Gesture check')
  })
})
