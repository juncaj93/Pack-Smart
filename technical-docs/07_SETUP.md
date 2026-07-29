# Pack Smart — Setup & Deployment Runbook

Status: **Milestone 0.** Written by the Software Engineer; it records how to run
and deploy what M0 built. It adds no architecture decisions — those live in
`01_ARCHITECTURE.md`.

---

## 1. Local development

```bash
npm ci                      # reproducible install from the committed lockfile
npm run db:migrate:local    # apply migrations to the local D1
npm run dev                 # Vite + Worker + local D1, one server, one port
```

`npm run dev` starts one process. The React app and the Worker run together
against a local (miniflare) D1, so `/api` behaves in development exactly as it
does deployed — no dev proxy and no second terminal.

On first run, `.dev.vars` is created automatically with a **throwaway development
passphrase**: `pack-smart-e2e-passphrase`. It is gitignored, it exists only on
your machine, and it is not the production passphrase. An existing `.dev.vars`
is never overwritten.

### Verification

```bash
npm run check   # typecheck → lint → unit tests → build → e2e
```

Individually: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npm run test:e2e`.

---

## 2. What Alex must do — Cloudflare account

These need an interactive browser login and cannot be done by an agent.

```bash
npx wrangler login
npx wrangler d1 create pack-smart
```

`d1 create` prints a `database_id`. Paste it into `wrangler.jsonc`, replacing
`REPLACE_WITH_DATABASE_ID_FROM_WRANGLER_D1_CREATE`. It is an identifier, not a
credential, and is safe to commit.

Cost: **$0.00/month** on the Workers and D1 free tiers, on the free
`*.workers.dev` URL. No custom domain in v1 (`01_ARCHITECTURE.md` §9).

---

## 3. What Alex must do — secrets

**Never send either value through chat, and never commit them.**

### 3.1 Passphrase

Choose a long passphrase you do not use anywhere else. It is the only barrier in
front of your travel dates and medication names.

```bash
npm run hash-passphrase
```

The prompt is hidden and the passphrase is never written to disk or echoed. The
script prints only the derived PBKDF2 hash. Then:

```bash
npx wrangler secret put AUTH_PASSPHRASE_HASH   # paste the printed JSON
```

### 3.2 Session secret

```bash
npm run gen-secret                             # 32 random bytes
npx wrangler secret put SESSION_SECRET         # paste the output
```

Rotating `SESSION_SECRET` invalidates every existing session — that is the
sign-out-everywhere mechanism.

### 3.3 GitHub repository secrets

Needed only by `.github/workflows/deploy.yml`:

- `CLOUDFLARE_API_TOKEN` — Workers Scripts:Edit and D1:Edit
- `CLOUDFLARE_ACCOUNT_ID`

---

## 4. Production actions — explicit approval required

Per CLAUDE.md, none of these happen without Alex saying so:

1. `npx wrangler d1 migrations apply pack-smart --remote` — first write to the
   production database. `npm run db:migrate:remote` is deliberately wired to
   refuse, so it cannot be run by reflex.
2. `npx wrangler deploy` — first production deploy.
3. **Merging to `main`**, which triggers `deploy.yml` and does both of the above.
4. Any destructive migration, ever.

---

## 4a. Passphrase hashing cost — a deviation worth knowing about

`01_ARCHITECTURE.md` §4 requires the passphrase to be verified against a hashed
value in a Worker secret. It does not specify a cost, and the first deployed
version used **210,000 PBKDF2 iterations** — the right figure for a password
database, and about **106 ms of CPU**.

The Workers **free plan allows 10 ms of CPU per request** (§9 commits v1 to that
plan). The runtime therefore killed every login attempt before any handler could
respond, and the app could only report a generic failure. Nothing caught it
before production: the unit tests run in Node and the end-to-end tests drive a
local dev server, neither of which meters CPU.

**Resolution: 2,000 iterations (~1.3 ms), with a hard cap of 20,000 enforced when
reading the secret.**

The trade-off is deliberate and narrow. A high iteration count earns its keep
when a hash sits in a database that might be breached and attacked offline. This
hash lives in a Cloudflare Worker secret, encrypted at rest, reachable only by
someone who already holds account access — who could equally read the D1 data
directly or replace the secret outright. The iterations are defence-in-depth
against incidental exposure, such as a hash pasted into a log or a screenshot.
**The primary control is a long passphrase.**

Raising the cost again needs either the paid plan, which §9 rules out, or moving
the derivation to the client. Worth revisiting if the plan ever changes.

The cap exists so that a secret written by an older setup script produces an
explicit "re-run the setup script" message rather than a request the runtime
kills with no explanation. `tests/unit/worker/cpu-budget.test.ts` pins both.

---

## 4b. Dependency advisories

`npm audit` reports one HIGH advisory against `react-router`:
**GHSA-qwww-vcr4-c8h2 — RSC Mode CSRF Bypass**, affecting `>=7.12.0 <8.3.0`.

**It does not apply here, and the pinned version is deliberate.**

The vulnerability is in React Server Components mode. Pack Smart is a purely
client-side SPA: it imports only `BrowserRouter`, `Routes`, `Route`, `NavLink`,
`Navigate`, `Outlet`, `useLocation` and `useNavigate`. There is no
`createBrowserRouter`, no `RouterProvider`, no loaders or actions, no fetchers,
no server rendering and no RSC. The vulnerable code path is not reachable.

**Do not run `npm audit fix --force` here.** It proposes downgrading to 7.11.0,
which is strictly worse: that version is exposed to roughly a dozen advisories
fixed by 7.18.0, including an unauthenticated RCE via vendored turbo-stream
(GHSA-49rj-9fvp-4h2h), several XSS-via-open-redirect issues, and two DoS
vectors. This was tried and measured, not assumed — 7.11.0 reported twelve
distinct advisories against 7.18.2's one.

The correct action is to stay on the latest 7.x and upgrade once a release above
8.3.0 exists. Re-check at each milestone boundary.

---

## 5. Migrations

- Numbered `NNNN_description.sql` in `/migrations`, applied in order.
- **Forward-only.** Never edit a migration that has already been applied; add a
  new one.
- No `DROP`, no destructive `ALTER`, without explicit approval.
- M0 ships exactly one table, `auth_throttle`. The product schema in
  `02_DATA_MODEL.md` arrives with the milestones that use it.

---

## 6. Backup and restore

Unchanged from `01_ARCHITECTURE.md` §7: D1 Time Travel (30-day PITR), a manual
**Export My Data** export (M11), and written restore steps rehearsed once in M11.
Nothing to configure now — Time Travel is on by default and free.

---

## 7. Testing

| Layer | Tool | Covers |
|---|---|---|
| Pure logic | Vitest | Token signing, passphrase hashing, throttle policy, route restore, API client |
| Worker routes | Vitest + `app.request()` | Login, session guard, rate limiting, SPA fallthrough, security headers |
| Components | Vitest + RTL (jsdom) | BottomSheet, TabBar |
| End-to-end | Playwright **WebKit** @ 390×844 | Unlock, four tabs, deep links, layout constraints, sheet |
| Real device | Manual | `08_MANUAL_IPHONE_CHECKLIST.md` |

### The WebKit requirement

WebKit is the approved engine because it is closest to iOS Safari. CI installs
**only** WebKit, so a silent fall back to Chromium is impossible.

A `chromium-fallback` Playwright project exists for sandboxes where the
Playwright browser CDN is unreachable. It covers **flow logic only, not
rendering fidelity, and does not satisfy the approved testing strategy.** If a
sandbox already has a Chromium of a different build, point at it with
`PW_CHROMIUM_PATH=/path/to/chrome npx playwright test --project=chromium-fallback`.

R11 stands regardless: Playwright reproduces neither ITP storage policy, PWA
standalone mode, safe-area insets, nor the native date wheel. The manual
checklist is not optional.
