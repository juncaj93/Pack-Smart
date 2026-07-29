import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const BASE_URL = `http://localhost:${PORT}`

/**
 * End-to-end configuration.
 *
 * WebKit at 390×844 is the approved target (technical-docs/01_ARCHITECTURE.md §2,
 * risk R11) because it is the engine closest to iOS Safari. R11 is also explicit
 * that this still does not reproduce ITP storage policy, PWA standalone mode,
 * safe-area insets, or the native date wheel — so the manual iPhone checklist in
 * technical-docs/08_MANUAL_IPHONE_CHECKLIST.md remains mandatory before any
 * milestone is called complete.
 *
 * The `chromium-fallback` project exists only for environments where the
 * Playwright browser CDN is unreachable and WebKit cannot be installed. It
 * covers flow logic, NOT rendering fidelity, and does not satisfy the approved
 * testing strategy. Run it with `--project=chromium-fallback`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'iphone-webkit',
      use: { ...devices['iPhone 14'] }, // WebKit, 390×844, mobile, touch
    },
    {
      name: 'chromium-fallback',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        // Lets a sandbox with a pre-supplied Chromium of a different build point
        // at it instead of downloading one. Unset everywhere else, so CI and a
        // developer machine use Playwright's own managed browser.
        ...(process.env.PW_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],

  // Runs the production build behind the real Worker, so routing, the asset
  // fallthrough, and the auth cookie are exercised as they will be deployed.
  webServer: {
    command: 'npm run build && npx vite preview --port ' + PORT,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
