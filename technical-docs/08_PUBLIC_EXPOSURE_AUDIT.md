# Public-exposure audit — 2026-08-06

Run before deciding whether `juncaj93/Pack-Smart` may be made public so hosted
Actions minutes stop counting against the private allowance.

**Visibility was NOT changed. No hosted Actions minutes were spent.**

## Result

**SAFE AFTER SPECIFIC FIXES** — and the fixes are small. No secret was found in
the working tree, in any of the 1,346 blobs reachable from any of the 56
branches, or in the deploy logs. **No history rewrite and no credential rotation
are required.**

## Coverage

| Scanned | How |
|---|---|
| 233 commits, 56 remote branches, 0 tags | all fetched locally first; scan ran over `--batch-all-objects`, so it covered every blob reachable from every ref |
| 1,346 distinct blobs | streamed and grepped for ~30 credential patterns |
| 666 distinct paths ever committed | extension and name matching |
| deleted-but-recoverable files | `--diff-filter=D` against the current index |
| 495 Actions runs | run/job metadata; deploy job log read in full |
| built bundle | `dist/` grepped for secret-shaped strings |

## What is NOT there

- No `.env`, `.pem`, `.key`, `.p12`, `.sqlite`, `.db`, dump, backup or log has
  ever been committed on any branch.
- No Cloudflare API token, GitHub PAT, private key, JWT, OAuth secret, webhook
  secret, bearer token, connection string or session secret — in the tree or in
  history.
- No production D1 file or export. The database is a Cloudflare-hosted resource;
  publishing the source does not publish it.
- `pull_request_target` has never appeared in any commit.
- No auth bypass in application source on any reachable commit. The
  `pack-smart-preview-no-passphrase` marker appears **only** in `deploy.yml`,
  where it is the guard that greps for it.

## Secret-shaped strings that are fine

Seven blobs matched credential patterns. All seven are test constants, and each
names itself as one: `test-session-secret-not-used-anywhere-real`,
`a private passphrase for tests`, `the-passphrase-under-test`,
`integration-test-session-secret`, `pack-smart-e2e-passphrase`.

`scripts/write-dev-vars.mjs` generates a throwaway local passphrase and a random
session secret into a gitignored `.dev.vars`. Alex's real passphrase never enters
a file — `wrangler secret put` only.

## Frontend

- **No `VITE_` variable exists.** The only `import.meta.env` use is
  `import.meta.env.DEV`, a build-time boolean.
- No `process.env` in `src/`.
- No source maps are emitted.
- The built bundle carries no secret-shaped string.

Authentication is enforced in the Worker (`worker/auth.ts`), not in the client,
so nothing depends on source secrecy.

## Actions

**Fork pull requests cannot reach secrets.** All four workflows were read:

| Workflow | Trigger | Secrets | Fork-reachable |
|---|---|---|---|
| `ci.yml` | `push:[main]`, `pull_request` | none | yes, and harmless |
| `visual-qa.yml` | `push:[main]`, `pull_request` | none | yes, and harmless |
| `deploy.yml` | `push:[main]`, `workflow_dispatch` | Cloudflare | **no** |
| `retire-preview.yml` | push to one branch, `workflow_dispatch` | Cloudflare | **no** |

Both secret-bearing workflows fire only on events that require write access to
this repository. A fork cannot push to `main`, cannot push to a branch here, and
cannot dispatch a workflow.

**Secrets are masked in the logs.** Read from deploy run `30998558640`:
`CLOUDFLARE_API_TOKEN: ***` and `CLOUDFLARE_ACCOUNT_ID: ***`. Nothing sensitive
appears in plaintext; the log carries the production URL, a version id, and D1
row counts.

## Personal data

Both workbooks — the tracked one and the deleted
`Master_Packing_Database_Updated(1).xlsx`, which is still recoverable — were
extracted and scanned. **The deleted one is a strict subset: zero strings appear
in it that are not also in the tracked one.**

Across all 334 distinct cell values: **no** email, phone number, street address,
flight number, confirmation code, passport number or payment detail. "Passport"
and "Medication" appear as packing-list *categories*; there are no medication
names or dosages. This is wardrobe and gear data — the category Alex has
approved for exposure.

No email address appears in any file, on any commit.

## Findings

| # | Severity | Where | Lives in | Consequence |
|---|---|---|---|---|
| 1 | **Medium** | `https://pack-smart.juncaj93.workers.dev` in `retire-preview.yml:133`, `product-docs/09…:1611` | tree + history + logs | The production URL, the exact throttle policy (`shared/rate-limit.ts`: 5 failures / 15 min, 15 min max lock) and the exact KDF parameters (`shared/crypto.ts`: PBKDF2-SHA256, 2,000 iterations) all become public together. The passphrase becomes the only barrier, and a discoverable one. |
| 2 | Low | all four workflows | tree | No `permissions:` block, so `GITHUB_TOKEN` uses the repo default rather than least privilege. |
| 3 | Low | `.github/workflows/retire-preview.yml` | tree | A completed one-off workflow still carries Cloudflare secrets and a push trigger. Not fork-reachable, but unnecessary standing surface. |
| 4 | Low | 64 commits authored `juncaj93 <juncaj93@gmail.com>` | history metadata | A personal Gmail becomes public and scrapable. Not fixable by editing files. |
| 5 | Info | `wrangler.jsonc` `database_id` | tree | An identifier, not a credential — access needs the account plus an API token, neither of which is in the repository. |
| 6 | Info | `.DS_Store` (deleted, recoverable) | history | Finder metadata only; no readable directory names beyond the format's own keys. |
| 7 | Info | "Cape Town, 31 Jul – 11 Aug" worked example | docs + tests | A specific destination and date range, presented as the planning example. |

## Conclusions

**Git history:** cleaning current files would achieve nothing, because there is
nothing to clean. **No history rewrite is required. No credential rotation is
required.** The only history-borne item is the commit-author email (finding 4),
which is Alex's call and cannot be removed without rewriting all 233 commits.

**Actions:** public fork pull requests **cannot** access secrets, **cannot**
deploy, **cannot** alter production data and **cannot** consume a privileged
token. Both secret-bearing workflows require write access to trigger.
