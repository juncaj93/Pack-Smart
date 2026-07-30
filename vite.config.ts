import { fileURLToPath, URL } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/*
 * Where the local Worker keeps its D1 state.
 *
 * Unset everywhere normal, so development and the end-to-end suite share the
 * default `.wrangler/state` exactly as before. The visual QA harness sets it, so
 * that run gets a database of its own: it and the e2e suite were writing to the
 * same file, and the screenshots this release is judged on were being taken of a
 * wardrobe carrying e2e fixtures ("Archivable Tee 16857") and forty-five leftover
 * test trips. Evidence of the wrong database is worse than no evidence.
 */
const persistPath = process.env.PACK_SMART_PERSIST_TO

export default defineConfig({
  plugins: [react(), cloudflare(persistPath ? { persistState: { path: persistPath } } : {})],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    // Pinned so the manual iPhone checklist is run against the same target every time.
    target: 'es2022',
  },
})
