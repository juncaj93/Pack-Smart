import { defineConfig, devices } from '@playwright/test'

const PORT = 4174
const BASE_URL = `http://localhost:${PORT}`

/**
 * The visual and interaction QA harness.
 *
 * Separate from `playwright.config.ts` on purpose. That file is the approved
 * correctness suite — WebKit at 390×844, one project, run by CI as a gate. This
 * one exists to produce *evidence*: the same screens at four widths, in their
 * empty and populated states, with the mechanical rules from
 * `VISUAL_ACCEPTANCE.md` §1 asserted rather than eyeballed.
 *
 * Its own port, so a visual run and an e2e run cannot fight over one preview
 * server. Its own database too — `seed-demo.mjs` writes five trips and the real
 * 85-garment wardrobe, which is not what the e2e suite wants underneath it.
 */
export default defineConfig({
  testDir: './tests/visual',
  /*
   * Serial, and not because it is faster.
   *
   * Every spec here drives the same seeded database through the same UI. Two
   * workers packing and un-packing the same checklist would produce screenshots
   * of a state neither of them set up, which is worse than a slow run: the
   * evidence would be wrong rather than merely late.
   */
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'off',
    /* Screenshots are the product of this run, so they are taken explicitly. */
    screenshot: 'off',
    video: 'off',
    /*
     * Signed in once, in globalSetup. Every spec starts inside the app, which is
     * both faster and one less race: `goto('/')` resolves before the app has
     * decided whether to render Unlock or the shell.
     */
    storageState: '.visual/state.json',
  },

  projects: [
    {
      /*
       * WebKit is the approved target and cannot be installed in the agent
       * environment (the Playwright CDN is blocked by the network policy —
       * AUTONOMY.md §7). Chromium at iPhone metrics is what is available for
       * layout and interaction evidence; WebKit rendering is proven by CI.
       */
      name: 'visual',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        ...(process.env.PW_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],

  globalSetup: './tests/visual/seed.ts',

  webServer: {
    command: [
      'node scripts/write-dev-vars.mjs',
      'npx wrangler d1 migrations apply pack-smart --local',
      'npm run build',
      `npx vite preview --port ${PORT}`,
    ].join(' && '),
    url: `${BASE_URL}/api/health`,
    /*
     * Never reuse a running server, even locally.
     *
     * The default (`!process.env.CI`) skips the whole command when something is
     * already listening — including the `npm run build` chained into it. That
     * quietly serves the previous build, and a harness whose entire purpose is to
     * judge the current one then reports on code that is no longer there. It cost
     * an hour of chasing a working gesture that the browser had never been sent.
     */
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
