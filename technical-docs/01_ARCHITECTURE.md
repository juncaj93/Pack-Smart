# Pack Smart — Architecture

Status: **Approved.** Authority: below `/product-docs`, above implementation behavior.

## 1. Guiding choice

One platform, one deploy, one database, no idle suspension, **$0.00/month**.

Pack Smart is a private single-user app used a handful of times a year. Every architectural decision
favors *still working in six months without maintenance* over flexibility or scale.

## 2. Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite, React Router, hand-written CSS with custom properties |
| Backend | A single Cloudflare Worker (Hono) serving both the API and the static assets |
| Database | Cloudflare D1 (SQLite), raw SQL via prepared statements, numbered `.sql` migrations |
| Auth | Single passphrase → server-set `HttpOnly; Secure; SameSite=Lax` cookie, 1-year expiry |
| Hosting | Cloudflare Workers free tier on the free `*.workers.dev` URL — **no custom domain in v1** |
| Weather | Open-Meteo forecast + climate + geocoding (free, no API key, no account) |
| Import | SheetJS, parsed **client-side**, posted to the API as normalized JSON |
| Backups | D1 Time Travel (30-day PITR) + manual **Export My Data** + written restore steps |
| PWA | `manifest.webmanifest`, iOS icons, `apple-mobile-web-app-*` meta, service worker |
| Testing | Vitest (pure logic) + Playwright WebKit @ 390×844 + a manual iPhone Safari checklist |
| Deployment | GitHub Actions → `wrangler deploy` on push to `main` |

### Runtime dependency budget

React, React DOM, React Router, Hono, SheetJS (import only, lazy-loaded). Dev-only: Vite,
TypeScript, Vitest, Playwright, Wrangler.

**Deliberately absent:** Redux, TanStack Query, Tailwind, any ORM, any UI component library, any
analytics SDK. Every one of these was considered and rejected as maintenance surface we would have
to keep alive between trips.

## 3. Why a server at all

A pure client-side PWA storing everything in IndexedDB is cheaper and would be wrong.

WebKit evicts script-writable storage for sites unused for roughly seven days. Alex packs a few
times a year. After import the website is the source of truth (doc 01 §4), so losing it means
re-entering the whole wardrobe by hand.

**Therefore: the server database is the source of truth. Client storage is only a cache and an
outbound mutation queue.**

## 4. Authentication

One passphrase, verified server-side against a hashed value held in a Worker secret, exchanged for a
session cookie.

The cookie must be **set by the server** with `HttpOnly`. This is not a style preference: WebKit caps
*JavaScript-set* cookies at 7 days, while server-set `HttpOnly` cookies persist to their stated
expiry. With a 1-year expiry Alex logs in about once a year instead of before every trip.

- `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`
- The login endpoint is rate-limited.
- The session value is a signed random token, not a hash of the passphrase.
- Every route except `POST /api/auth/login` and the static assets requires a valid session.

Cloudflare Access was considered and rejected: it adds a platform dependency and periodic re-auth
redirects that are awkward inside an installed PWA.

## 5. Offline scope (strictly prioritized)

Implemented in this order so partial completion still leaves a usable product:

1. **Read** the active trip and the Today plan offline — the hotel-and-airport case.
2. **Queue** checklist toggles, packed quantities, worn status, and simple During Trip actions,
   with idempotency keys, replayed on reconnect.
3. **Require connectivity** for inventory administration, import, and trip creation — online-only
   by design.
4. **Never let sync work block the core.** If mutation replay is not solid by M10 it finishes in M11.
   Offline *reads* are not negotiable; offline *writes* are.

## 6. Weather

Open-Meteo, chosen because it needs no API key and no account, so there is no credential to rotate
and nothing to renew between trips.

- Within the ~16-day forecast horizon: use the forecast.
- Beyond it: use **climate normals**, and label them as such in the UI ("Typical late-July
  conditions"), never as a forecast. Presenting a normal as a forecast is fabricated confidence and
  is forbidden by doc 02 §4.
- Every response is cached in `trip_weather` with its `source`, so the app degrades to cached or
  normal data rather than failing outfit generation when the API is unreachable.

## 7. Backups and restore

Three layers, all inside Cloudflare, no stored third-party credentials:

1. **D1 Time Travel** — 30-day point-in-time restore, built in, free, no configuration.
2. **Export My Data** — a manual button producing a complete JSON dataset covering every table.
3. **Written restore instructions** — kept in this document, §7.1, and rehearsed once in M11.

An automated weekly Worker→GitHub snapshot was proposed and **removed from v1**: it would require a
stored GitHub token and create a second standing copy of personal travel and medication data for a
benefit Time Travel already covers. It may be reconsidered after launch; the export format is a
complete restorable dataset, so adding it later needs no schema change.

### 7.1 Restore procedure

*To be completed and rehearsed in M11. Placeholder retained so the gap is visible rather than
forgotten.*

1. **Recent accidental damage (within 30 days)** — `wrangler d1 time-travel restore <db>
   --timestamp=<iso8601>`. Confirm with a row count against a known-good table before proceeding.
2. **From a JSON export** — run the import-restore script against an empty database created by
   `wrangler d1 migrations apply`, then verify counts per table against the export's manifest.
3. **Platform loss** — create a new D1 database, apply migrations, restore from the most recent JSON
   export, redeploy the Worker.

## 8. Privacy

Trip data — including medication names — is stored unencrypted at rest in Cloudflare D1 behind
authentication. This is proportionate for a private single-user app and keeps the data queryable and
exportable. Application-level encryption would break querying and add key management for no real
threat-model benefit. No third-party analytics. No data leaves Cloudflare except weather lookups,
which send only a coordinate and a date range.

## 9. Cost

**$0.00/month.** Expected usage is roughly three orders of magnitude below every free-tier limit — a
heavy packing session is a few hundred requests against a 100,000/day allowance.

| Service | Risk of becoming paid | Exit |
|---|---|---|
| Cloudflare Workers / D1 | Free tier terms could change; Workers Paid is $5/mo | D1 is SQLite — a dump restores into any SQLite host |
| Open-Meteo | Free for non-commercial; commercial needs a plan | Swap the single `weather.ts` adapter |
| Custom domain | **Not in v1** | ~$10–12/yr and a DNS change if ever wanted; no code impact |

Nothing in this stack requires a card on file.

## 10. iPhone Safari constraints

These are established once in M0 as global primitives rather than fixed per screen:

- `100dvh`, never `100vh` — and as a **minimum** height, never a fixed one. The document scrolls;
  the app is not a fixed-height frame with a scrolling box inside it. Safari only collapses its
  toolbar when the page itself scrolls, and a fixed-height shell silently prevents that.
- `env(safe-area-inset-*)` on bottom sheets, and on page bottoms so standalone content clears the
  home indicator. **Nothing is fixed to the bottom of the viewport** — in Safari that strip belongs
  to the browser's toolbar (product doc 02 §2).
- **16px minimum font size on every input** — anything smaller triggers focus zoom
- 44px minimum touch targets
- Momentum scrolling and overscroll containment inside sheets
- No hover-dependent behavior anywhere
- No horizontal scrolling on any core screen
