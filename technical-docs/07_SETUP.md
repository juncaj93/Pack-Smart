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
