# Pack Smart — autonomous UX delivery

**Canonical.** This file decides how design and UX work is selected, reviewed, accepted, and
repaired. It exists so the work survives the end of any one chat session: everything an agent needs
in order to pick up the next task is in this repository, not in a conversation.

Nothing here changes the product rules. `CLAUDE.md` and `/product-docs` remain the constitution.

---

## 1. Source-of-truth precedence

When two documents disagree, the higher one wins, and the lower one gets **repaired** rather than
argued with:

1. Alex's latest explicit ruling
2. The latest recorded Technical Lead ruling (a merged PR body or `technical-docs/`)
3. Approved product behaviour and the accepted visual direction
4. `/product-docs`
5. `/technical-docs`
6. `technical-docs/10_AUDIT_AND_ROADMAP.md` and `UX_AUDIT.md`
7. The code as it stands
8. Superseded plans and old discussion

Finding a contradiction is a **documentation defect**. Fix the stale file in the same PR and say so.
Do not ask Alex to adjudicate something two approved documents already answer.

---

## 2. What is owned here, and what is not

**Owned — decide and proceed, no approval needed:** spacing, type scale, radii, colour tokens
already in the palette, component decomposition, CSS architecture, icon choice and placement,
routine copy, ordinary interaction patterns, gesture accelerators, loading/empty/error/offline
states, motion timing, accessibility fixes, test repair, screenshot review, stale documentation,
which UX finding is worked next.

**Not owned — ask Alex, one question, with a recommendation:**

| Situation | Why it is his |
|---|---|
| Two materially different product experiences are both defensible | Taste is the deciding factor, not evidence |
| An existing approved feature would be removed or substantially changed | Scope is his |
| A destructive migration, or anything that can lose stored data | `CLAUDE.md` |
| A paid service or recurring cost | `CLAUDE.md` |
| A missing credential or app installation | Only he can grant it |
| A major architecture replacement | `01_ARCHITECTURE.md` is approved |
| A production deploy outside the standing low-risk delegation | `CLAUDE.md` |
| Real hardware disagrees with automation | Only he has the phone |

Never send a routine status update. Never ask him to compare padding values, read logs, run
Terminal commands, or carry information between workstreams.

---

## 3. The lifecycle

One finding at a time, and each one passes every gate before the next starts.

```
UX_AUDIT.md finding
      ↓  (product-design-lead picks the highest-impact open finding)
scoped task, written into the PR body
      ↓  (frontend-worker implements on the active branch)
npm run verify            ← typecheck, lint, unit + integration, build
      ↓
npm run qa:visual         ← real production build, seeded data, 4 widths
      ↓
interaction + visual + accessibility review   ← against VISUAL_ACCEPTANCE.md
      ↓  reject → repair task, back to implement
      ↓  accept
UX_AUDIT.md finding marked done, with the evidence
      ↓
release-reviewer: the whole release, not the increment
      ↓
merge + deploy under the standing delegation, or one concise decision request
```

**The review gate is not optional and is not self-certified.** A finding is accepted only against
the written criteria in `UX_ACCEPTANCE.md` and `VISUAL_ACCEPTANCE.md`, with screenshots from
`npm run qa:visual` as the evidence. "It matches the task I wrote" is not acceptance — the task can
be wrong.

---

## 4. Repository-native state

Conversation memory is not state. These are:

| State | Where it lives |
|---|---|
| What is wrong with the product | `UX_AUDIT.md`, one row per finding, with status |
| What "good" means | `UX_ACCEPTANCE.md`, `VISUAL_ACCEPTANCE.md`, `INTERACTION_PATTERNS.md` |
| What is in flight | The single active PR, its body kept current |
| What has been rejected and why | A PR comment naming the finding and the criterion it failed |
| What still needs a real phone | `technical-docs/08_MANUAL_IPHONE_CHECKLIST.md` |
| Evidence | `qa:visual` artefacts, uploaded by CI, never committed |

Finding ids are stable (`UX-01`…). Commits, PR comments, and audit rows reference them, so a fresh
session can reconstruct the whole picture from `git log --grep UX-`.

### Labels

`ux-audit-ready` · `design-active` · `implementation-active` · `ready-for-interaction-qa` ·
`ready-for-visual-qa` · `ux-changes-requested` · `ready-for-accessibility-review` ·
`ready-for-integration` · `ready-for-release` · `production-verification` · `blocked-human-only`

One label at a time on the active PR. `blocked-human-only` means a question is outstanding and
implementation on that finding has stopped — everything unrelated continues.

---

## 5. Roles

Defined in `.claude/agents/`. Each is a separate reviewer with its own criteria so that no one
approves their own work:

- `product-design-lead` — picks the finding, writes the scoped task, owns hierarchy and IA
- `frontend-worker` — implements, and only implements
- `interaction-reviewer` — gestures, thresholds, feedback, reversal, keyboard
- `visual-qa` — screenshots against `VISUAL_ACCEPTANCE.md`, empty and populated
- `accessibility-reviewer` — labels, order, focus, contrast, gesture alternatives
- `release-reviewer` — the release as a whole, CI on the actual head, deploy readiness

---

## 6. Commands

| Command | What it is for |
|---|---|
| `npm run verify` | typecheck → lint → unit/integration → build. The correctness gate. |
| `npm run seed:demo` | Representative data into the local database through the real API. |
| `npm run qa:visual` | Screenshots + measurements of every named screen at 4 widths. |
| `npm run qa:visual -- --update` | Refresh the committed baseline manifest after accepted change. |
| `npm run test:e2e` | The approved WebKit target. CI runs this; see §7. |

`qa:visual` writes to `.visual/` (gitignored). CI uploads it as an artefact, so review is grounded
in images rather than claims, without the repository carrying disposable screenshots.

### End-to-end tests own their data

One database serves the whole e2e suite — one Worker, one D1, seeded once. That is not going to
change: a database per file would mean a Worker per file, and the point of these tests is that they
exercise the real deployed shape.

So isolation is **ownership**, not separation. `tests/e2e/fixtures.ts` is the pattern, and it is not
optional for new work:

| Need | Use | Never |
|---|---|---|
| A trip to act on | `createTrip(page, { owner: 'YourSpec' })` + `deleteTrip` in `afterEach` | `fetch('/api/trips')` and take `trips[0]` |
| To sign in | `signIn(page)` | A local copy of the passphrase dance |
| A name | `ownedName('YourSpec')` | `Date.now()` or `performance.now()` alone — two workers reach the same millisecond |
| To set a usual amount, a rule, or anything else **global** | `createOwnedItem` + `clearAmounts` in `afterEach` | A seeded item like *Contacts* or *Bombas Socks* |

Three rules behind the table:

1. **Never read `trips[0]`.** `/api/trips` is `ORDER BY start_date DESC`, so it returns whichever
   trip another spec last created. Three files were packing rows on a trip they did not own while
   its owner asserted on it — that single line is where most of doc 09 §5a came from.
2. **Clean up in `afterEach`, never in the last line of the test.** `packing_rule` is global, so an
   amount left behind changes every other spec's quantities — and the amount picker hides items that
   already have one, so a test that died before its cleanup could never find its item again. That was
   not a flake; it was permanent until the local database was deleted.
3. **Follow a row by name, not by position.** Packing moves a row into another section. `rows.first()`
   before an action and `rows.first()` after it are different rows.

And two things worth knowing before trusting a green run:

- **Run `--workers=1` locally.** CI uses one worker; the local fallback defaults to more, so every
  round trip is slower on CI and races that never open locally open there reliably. Two C2 defects
  were found only that way.
- **`page.touchscreen.tap` takes viewport coordinates**, and the fallback viewport is 664px tall.
  Call `scrollIntoViewIfNeeded()` before reading a `boundingBox()` to tap, or the tap silently lands
  on nothing.

---

## 7. What automation here cannot prove

Recorded so it is never claimed:

- **WebKit cannot be installed in the agent environment** — the Playwright browser CDN is blocked by
  the network policy. Local runs use the documented `chromium-fallback` project; the approved
  `iphone-webkit` target runs on CI, and **CI on the actual PR head is the WebKit evidence.**
  The sandbox's pre-supplied Chromium is not necessarily the build Playwright expects, and when it
  is not, *every* test fails identically with `Executable doesn't exist at …chromium_headless_shell-<n>`
  — an environment fault that looks exactly like a broken branch. Point at the supplied binary:
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --project=chromium-fallback`,
  which `npm run qa:visual` honours too. Never `npx playwright install`.
- Chromium at 390×844 is not iOS Safari: ITP storage policy, the native date wheel, real safe-area
  insets, standalone PWA mode, momentum scrolling feel, and Safari's toolbar collapse are all
  outside it. Those go to `08_MANUAL_IPHONE_CHECKLIST.md` as one consolidated session.
- **Local Chromium green is supporting evidence for gesture FLOW. Exact-head WebKit is the
  authoritative gate for iPhone-specific gesture behaviour.** Not a formality: the sheet-drag pass
  shipped a gesture that did nothing at all on a quick flick, and every local run was green. A move
  is delivered to whatever is under the finger; the two engines disagree about how coarse those
  moves are and about how `pointerup` and the `click` after it are targeted, and that disagreement
  is exactly where touch gestures break. Local green means the flow is not obviously broken. It does
  not mean the gesture works.
- **`mouse.wheel` does not exist in mobile WebKit**, and a wheel is not a gesture Alex can make. A
  scrolling assertion that needs one is testing something no phone does, on an engine that refuses
  to do it. Drive a touch drag, or assert the scroll property directly and say which you did.
- Haptics are not available to this web runtime in any reliable form. Never claim them.
- Screenshot review catches layout and hierarchy. It does not catch how something *feels* under a
  thumb. That is what the phone session is for.

---

## 8. The harness is part of what gets reviewed

Three findings in this release (UX-17, UX-19, UX-20) were invisible until the *evidence* was fixed,
not the product — see `UX_AUDIT.md`, "The evidence was wrong before the product was". Every one of
them passed every gate while showing the reviewer something that was not the product.

So, before trusting a screenshot:

- **A capture that cannot fail is not evidence.** Any state simulated by intercepting the network
  must assert the interception took effect — that the trip list really is empty, that the error
  really is on screen — before the shutter opens. A `-empty` screenshot of a populated screen is
  worse than no screenshot, because it closes the question.
- **`page.route` cannot see the service worker.** Ours is network-first for `GET /api/*` and makes
  that fetch itself. Anything faking an API response has to remove the worker first, and anything
  that needs the worker (the offline captures) must not have it removed.
- **Check what the database actually holds.** The visual run gets its own state directory
  (`PACK_SMART_PERSIST_TO`); if a screenshot shows a garment nobody owns, the harness is pointed at
  the wrong one.
- **Dark is reviewed, not assumed.** A token that reads correctly in Light can do nothing in Dark —
  `--color-danger` is a red on white in one theme and a pale pink in the other. The captures prefixed
  `dark-` exist so that is seen rather than reasoned about.
