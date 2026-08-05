# Pack Smart — product completion checklist

**Canonical, operational, and repository-native.** This is project state, not a
plan. A fresh session with no conversation history should be able to read this
file, run the commands in §0, and know exactly what to do next.

`product-docs/09_PACK_SMART_V2_GUIDED_TRIP_LIFECYCLE.md` remains the approved
SCOPE. This file tracks **delivery** of that scope and does not restate it.

Two rules govern every row:

- **Existence is not completion.** A route that renders, a component that
  mounts, or a green test suite is not a delivered slice. A slice is complete
  when its acceptance criteria are true in production.
- **Nothing here may be inferred from a conversation.** If it is not in the
  repository, in a PR, or in a workflow log, it is not a fact.

---

## 0. How to confirm this file is still true

```
git log --oneline origin/main -5              # what is actually merged
gh/mcp: list_workflow_runs deploy.yml         # what is actually deployed
npm run verify                                # typecheck, lint, unit+integration, build
npm run test:e2e                              # WebKit target (CI is the real evidence)
npm run qa:visual && cat .visual/report.txt    # empty report = mechanical gates pass
```

**Production version** is read from the deploy run's `Deploy Worker` step
(`Current Version ID:`), never assumed from a merge.

### Running the suites in this environment

WebKit cannot be installed here (AUTONOMY §7) — CI on the exact PR head is the
WebKit evidence. Locally, both Playwright configs need Chromium pointed at:

```
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  npx playwright test --project=chromium-fallback

PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  npm run qa:visual
```

A full local run is `npm run verify` (1100 tests), the e2e suite (189), and the
visual harness (32, with an **empty** `.visual/report.txt`).

---

## 0a. Where the next session starts

**Last updated 2026-08-05, after F2, G4, G5 and G2 — and the day hosted CI ran
out of budget.** Everything below is checkable against the repository; nothing is
inferred from a conversation.

### ⛔ Read this before pushing anything

**GitHub-hosted Actions minutes are nearly exhausted — about 200 of 2,000 left,
27 days into the cycle.** A self-hosted runner is the intended fix and cannot be
set up until Alex has his Mac back. Until capacity is restored or explicitly
approved:

- **do not merge to `main`** — it triggers `ci.yml`, `visual-qa.yml` **and**
  `deploy.yml`, and deploys production;
- **do not push to a branch that has an open PR** — `pull_request` fires
  `ci.yml` and `visual-qa.yml`, about 13 minutes a time;
- **do not rerun a workflow.**

**Pushing a branch with NO open PR is free.** All three workflows trigger only
on `push: branches: [main]` and `pull_request`, and nothing is on a schedule —
checked in the workflow files, not assumed. That is how work is preserved
durably here without spending anything: commit, push the branch, open no PR.

Local gates still run and still matter. **They are not a substitute for the
remote gate.** WebKit cannot be installed in this environment (AUTONOMY §7), so
CI on the exact head remains the only WebKit evidence, and nothing ships without
it.

### The state, in five lines

- `origin/main` is `62578ff` — **G5 merged (#62)**. Production is
  **`3c59c132-d1d5-4f76-b25e-2c3b59462afc`**, deploy run `30998558640`.
- Schema is at **migration 0017**, applied remotely — 5 commands, and the file
  contains no `UPDATE` and no `DELETE`, so nothing seeded was changed.
- **Four slices shipped this session**: F2 (`fad1f9a8…`, no migration), G4 (with
  F2's record, no migration), G5 (`3c59c132…`, migration 0017). Each version and
  its migration impact is in §4.
- **G2 is a finished release candidate awaiting only the merge decision.** PR
  **#63**, head **`46580bb`**, **remote CI fully green** — `verify` and `visual`
  both succeeded on that exact head at 11:15–11:28 UTC on 2026-08-05. Do not
  push to that branch; do not merge it until CI capacity is a deliberate choice.
- Open PRs: **#63 is live and green**. #15 and #32 remain stale — see §5a.

### The branches, and what each is for

| Branch | Head | State |
|---|---|---|
| `claude/pack-smart-f2-completion-0pk5gu` | `46580bb` | **G2. Frozen.** Remote CI green. PR #63. Pushing to it costs 13 minutes; merging it deploys |
| `claude/ci-cost-audit` | — | The workflow savings below, and this record. **No PR** — safe to push |
| `claude/pack-smart-g5b-import-review` | — | **G5b**, from `origin/main`. **No PR** — safe to push |

Merge order when capacity returns: **#63 (G2) → ci-cost-audit → G5b**. Each is
independent of the others in code; only doc 09 will conflict, and only in
different sections.

### Do these first, in this order

**1. Nothing that spends a hosted minute, until that is a deliberate choice.**
See the block at the top of this section. The work below is all local.

**2. G5b — safe repeat imports.** Scoped in §5a with the measurement:
`POST /api/import/commit` dedupes only within the spreadsheet it was handed and
never consults the database, so a second import of the same file takes **items
123 → 241 and rules 41 → 75**, and a retired rule comes back on a fresh `system`
copy. Two tests in `retired-rules.test.ts` assert that current behaviour, so a
fix has to fail them deliberately rather than improve things silently. It must
land before the final whole-product pass, which includes an import.

**3. G3 and G6 — the last two of Alex's corrections.** Outfit search across the
whole wardrobe, and wardrobe naming. Scope measured in §6a. G6 is last on
purpose: it changes what items are *called*, and several slices assert on names.

**4. The final whole-product pass.** §6 lists what still needs a thumb, and F2
is now on it. One consolidated sitting, in the order
`technical-docs/08_MANUAL_IPHONE_CHECKLIST.md` sets out.

### What this session's four slices established, and must not be broken

- **F2: a queued write dies with the session that made it.** `lock()` empties
  the queue, the session marker is re-checked immediately before every request,
  and replay does not begin until the server has confirmed the session. The
  service worker replays **nothing**, and a source-level test says so.
- **F2: desired state, never a log of taps.** One record per `(entryId, field)`
  is what makes duplicate replay safe by construction rather than by care.
- **G4: the category rank sits BELOW `orderRank`.** Grouping happens inside a
  band and never across one, so D2's completed-to-bottom and the essentials band
  are untouched. `personal_item` is still the stored enum; only the word moved.
- **G5: retiring a rule is a superseding row.** Nothing seeded is ever edited,
  and *Use the default* restores it. An override Alex wrote himself is skipped.
- **G2: an event's identity survives every layer.** `setTripDays` reconciles
  rather than replaces, because `daily_plan.event_id` and `wear_log.event_id`
  reference those rows. `adjustDay` resolves by the garment, not by `.first()`.

### What the last three slices established, and must not be broken

- **F1: nothing asks what the wear log already observes.** *What did you pack
  but never use* is a sentence in the review's summary, never a question. The
  proposals write only `learned` rules, and a rule Alex wrote is named as a
  conflict rather than overwritten.
- **F3: a weather demand the wardrobe cannot meet anywhere does not veto the
  outfit.** `unmet` reports what the plan could not do; `slot.required` decides
  whether it may be approved. They are deliberately different now, and
  collapsing them is what caused the flakes.
- **G1: an archived trip is not evidence.** Both learning queries filter
  `trip.archived_at`. Archiving is the marker — there is deliberately no second
  test-trip flag.

### Two things this session got wrong, worth knowing about

Both were recorded diagnoses that turned out to be false, and both cost real
time before being measured:

1. **`element(s) not found` was read as proof of a refused approval.** It is
   not — a button that has not rendered yet is also not found. The conclusion
   happened to be right for a different reason.
2. **`outfit_pairing` outliving the trip was the recorded leading candidate.**
   Measured directly over twelve accumulating rounds: **zero** incomplete
   groups. It was the weather.

The lesson is the one §5a already asserts and this session nearly failed anyway:
**a diagnosis written down is not a measurement.** The thing that finally worked
was reproducing the state in an integration test against the real workbook.

### The environment hides one whole class of defect

**This sandbox cannot reach the weather service.** `curl` to Open-Meteo returns
nothing, so no forecast ever lands, rain is never likely, and a bug that fires
only when a forecast exists is invisible here and green in every local run. CI
*can* reach it. That asymmetry is why the approval flakes survived weeks of
attention, and it applies to anything else that depends on live weather.

### How the last two slices were run, because it worked

Both E1 and E2 began with an **audit written into this file before any code**,
and in both cases the audit changed the plan: E1's model turned out to be done
and the screen was the gap; half of E2 already existed and was already honest.
F1's audit is already written, for the same reason.

Both slices then proved their tests against the defect — E1 by restoring the
four-sentence block (8 of 17 e2e failed), E2 by five mutations of the model. A
test that cannot fail is not evidence, and `AUTONOMY.md` §8 says so.

And both found real defects in testing rather than in review: E1's cache-key
bug, its blank day, and E2's per-day freshness, its missing weather line, and the
older-schema migration break. Expect the same rate.

**E1 and E2 are complete** — deployed, and **accepted on a real iPhone on
2026-08-04**. Alex's words: *"Everything looked good and behaved correctly… the
screen no longer felt like a dead end."* The record is in §4 and in
`technical-docs/08_MANUAL_IPHONE_CHECKLIST.md`. Do not reopen either without a
measured regression.

### What E1 established, and must not be broken

- **One explanation, however many outfit slots are unfilled**, and a recovery
  action on every one of them. `recoveryActions` cannot return an empty list.
- **`It is in my bag` writes to the packing list and never to the outfit.** The
  approved plan is asserted unchanged against a full snapshot.
- **Only packed clothing may be recommended** (doc 04 §10), still enforced in
  `packedOnly`. Nothing on the screen routes around it.
- **A climate normal never reads as a forecast**, and now neither does a stale
  one — see E2.
- **An unknown time zone is refused, not guessed**, and the fallback is labelled
  where it can be wrong.
- **A day the approved outfit does not reach says so** rather than rendering
  blank.

### The test state a fresh session inherits

| | |
|---|---|
| `npm run verify` | **1275** — typecheck, lint, unit + integration, build |
| e2e, local Chromium | **226**, full runs at 226/226 with **zero flaky** |
| Visual harness | **34**, `.visual/report.txt` **empty** |
| CI WebKit | **222 passed, 1 flaky, 3 skipped** — the seven-flake debt is closed; the one left is `itinerary.spec.ts`, a different cause (§5a) |

The seven were closed in F3, and the cause was a product dead end rather than a
test defect — §5a has the measurement. The one that remains is a genuinely long
apply step, recorded rather than papered over with a bigger number.

### What E2 adds to that list

- **Live, stale, seasonal and unavailable weather never render alike.** The same
  `54–75°F` in two states would be misleading by omission.
- **Opening Today never blocks on the weather service.** A stale forecast is
  refreshed beside the response, not in front of it.
- **A conflict changes nothing.** It is a sentence, the slot it is about, and the
  packed garments that would answer it. `Keep this outfit` is an answer, stored
  against the forecast it answered so a newer one raises it again.
- **Capability is only ever what Alex recorded.** A jacket is not rain
  protection because it is a jacket.

### The performance budget is a contract

`tests/e2e/performance.spec.ts` holds **2 serial round trips for Home and 1 for
every other screen**, and fails the build if one comes back. P1 was accepted on a
phone on that basis. E1 added six new answers to Today inside its existing single
round trip; anything that needs a rung back is a product decision with a real
cost, not a refactor.

## 1. Status vocabulary

| Status | Means |
|---|---|
| `not started` | No branch, no code |
| `active` | Being implemented now |
| `blocked` | Waiting on something named in the row |
| `implemented locally` | Code exists, local gates pass, not pushed |
| `PR open` | Pushed, PR open, CI not yet green on the head |
| `CI green` | Both checks green on the **exact** head |
| `merged` | On `origin/main` |
| `deployed` | Deploy workflow succeeded, version recorded |
| `production verified` | Behaviour confirmed against production |
| `phone verification pending` | Deployed; needs the real-device session |
| `complete` | Acceptance criteria true, phone check done |
| `withdrawn` | Dropped, with the reasoning in the row |

---

## 2. Delivered

| Slice | Status | PR | Version | Notes |
|---|---|---|---|---|
| **A1** Quantities 1–99, typed | complete | #25 | — | One `@shared/quantities` for screen, Worker and rules endpoint |
| **A2** Settings and copy | complete | #26 | — | My wardrobe and About removed |
| **A3** Editable threshold | complete | #27 | — | Exactly-one-number rule only; declines ambiguity |
| **A4a** Precedence documented | complete | #28 | — | `11_RULE_PRECEDENCE.md`, found the `fixed_per_trip` gap |
| **A4b** Rule provenance + creation | phone verification pending | #29 | `128b11a3-a8e0-4aeb-870b-ee6f86c75f1c` | Migration `0011` applied remotely, 5 commands, ✅ |
| **Swipe hotfix** Touch veto | **FAILED on the phone** | #30 | `abbf8958-50e0-4b95-9386-4f37e4056b4c` | Passed every automated gate. **Unusable on a real iPhone.** Superseded by #33 |
| **Swipe hotfix** Touch recognizer | **deployed** | #33 | `9baad615-a72c-4439-9e3c-aa543214c761` | Recognizer replaced. Real-iPhone check **PASSED**. Deploy run `30691345539` |
| **Preview URLs off for good** | **deployed** | #34 | `dc51cfde-fe16-4b30-9d40-f8505a7b828a` | `preview_urls: false` in `wrangler.jsonc`. See the incident note in §3 |
| **B / B2** Readiness model, Home + Trip Details | phone verification pending | #30 | `abbf8958-50e0-4b95-9386-4f37e4056b4c` | No migration, no data impact |
| **B3 / B4** Trips list + question flow — **Release B complete** | phone verification pending | #31 | `7e97ff9b-adae-4d86-a0b6-6cec838359e4` | No migration, no data impact. Recovered from the stale #32; see the note below |
| **C1** Necessities have reasons | **deployed** | #36 | `16fdd292-1b06-49fc-a7f3-14a123657536` | 0 of 32 unexplained, on the real workbook |
| **C2** Guided outfit review | **deployed** | #38 | `bb212c53-a311-44e4-9f08-7ba3a2a1b882` | Migration `0012` applied remotely, 2 commands, ✅. Deploy run `30704185309` |
| **E1** Today — During Trip | **complete** | #53 | `f1411c84-d6f6-4a09-aaeb-4f4a89d353ce` | **No migration.** Schema stays at `0014`; the migration step changed nothing. Deploy run `30934903975`, merged as `2ee8d039` |
| **E2** Weather refresh | **complete** | #54 | `4ecce84c-0f75-4676-9b88-e52286278eaf` | **Migration `0015` applied remotely, 3 commands, ✅.** Additive only — no audit row, because it repairs nothing. Deploy run `30941254839`, merged as `d0c6fca` |
| **F1** Post-trip review | **deployed**, phone verification pending | #56 | `86ac4fad-d126-45a1-b687-293bcfed7420` | **Migration `0016` applied remotely, 4 commands, ✅.** Additive only — one nullable column and one empty table, `rows_written: 0`. Deploy run `30949736665`, merged as `41dd3ae` |

### A4b — recorded in full

- **Acceptance:** a user rule may ask for fewer than a default; removing the
  override restores it exactly; an unrelated rule never reduces a default;
  system/user/learned distinguishable; `fixed_per_trip` is a floor and row order
  cannot change a result; existing seeded rules unchanged after migration.
  **All asserted by test.**
- **Tests:** `rule-precedence.test.ts` (unit), `rule-overrides.test.ts`,
  `rule-source-migration.test.ts` (clean DB, current schema, real workbook),
  `rules.spec.ts` (e2e).
- **Migration:** `0011_rule_source.sql` — additive, forward-only. Two columns,
  one unique index, one backfill.
- **Production data impact:** every existing rule became `source = 'system'`
  superseding nothing; amounts added through *Your usual amounts* backfilled to
  `user` by exact-string match. **No quantity moved on migration.**
- **Still to verify on a phone:** the Packing rules sheet controls — *How many*
  field, four-kind picker, *Use the default*.
- **Next action:** none. Closed pending the consolidated phone session.

---

## 3. In flight

### Swipe regression hotfix, second attempt — **phone-accepted** (#33)

The gate passed. See the result at the end of this section.

#### What happened to the first attempt (#30, `abbf8958`)

> **PR #30's swipe hotfix passed automation and FAILED real-iPhone acceptance.**

That sentence is the record. It passed typecheck, lint, **756** unit and
integration tests, **128** WebKit end-to-end tests including a new
`swipe-touch.spec.ts` written specifically for the defect, and the visual gate
with an empty report. It was deployed to production as version `abbf8958`. On
Alex's iPhone the row still jittered, horizontal movement still did not
progress, and **neither** swipe direction could be completed.

Nothing in this file may describe #30's fix as verified. The automated result
was real and it was not evidence.

#### Ruled out before rewriting anything

| Hypothesis | Finding |
|---|---|
| Production served a stale bundle | **No.** Deploy run `30655112612` put `de87e14a` (#31) live, which contains #30's component. The service worker is network-first for navigations, and `/assets/` filenames are content-hashed |
| A service worker pinned old JavaScript | **No.** `sw.js` caches `/assets/` cache-first, but the names change every build, so a cached one cannot be stale |
| Production code differed from the tested build | **No.** `playwright.config.ts` already runs the e2e suite against `npm run build` behind the real Worker. `tests/e2e/production-bundle.spec.ts` now asserts this rather than leaving it to a comment |
| Parent `touch-action` conflicted | **No.** `body` is `manipulation`, which intersects with the row's `pan-y` to `pan-y` |
| A React key or a list resort ran during the gesture | **Partly.** Not the cause, but real: the tray was MOUNTED when the offset went negative, which is a render under the finger |

#### The actual cause, in the code rather than in the browser

#30 decided the gesture's axis in a **Pointer Event** handler and vetoed the
browser's pan from a **Touch Event** handler. Three consequences, and together
they are every symptom Alex reported:

1. **The veto could only ever be late.** The axis was claimed after 8px of
   travel. WebKit decides whether a touch is a scroll from the first move past
   its own, smaller slop — so for the first two or three `touchmove`s the row
   was still `undecided` and vetoed nothing. Once a pan starts, every later
   `touchmove` arrives with `cancelable === false`, which the veto explicitly
   skipped. **It could only run after it could no longer do anything.**
2. **It relied on an ordering nothing guarantees** — that `pointermove` is
   dispatched before the matching `touchmove` of the same frame. React
   delegates `pointermove` to the root; the veto was a native listener on the
   row.
3. **Losing the axis lost the gesture.** `pointercancel` reset the row, cleared
   its measured width and released the pointer, so it then ignored a finger
   that was still down and still moving. Twitch, snap back, go dead.

#### The technical decision: neither option A nor option B as written

**Option A — a proven gesture primitive — was evaluated and rejected on
evidence, not on taste.** `@use-gesture/react` (pmndrs, ~12kB gzipped,
v10.3.1, actively maintained) was installed and its `DragEngine` source read.
It is *the same architecture that failed*:

- `pointerDown` calls `event.target.setPointerCapture(event.pointerId)` and the
  gesture is driven by Pointer Events by default;
- its answer to coexisting with scroll is `setupScrollPrevention`, which starts
  a **250ms timer** (`DEFAULT_PREVENT_SCROLL_DELAY`) before the drag is allowed
  to begin, and **cancels the gesture outright** if the user moves on the
  prevented axis first. That is a press-and-drag, not a swipe — a quarter of a
  second of dead row before a checklist item starts moving;
- configured for a fast swipe instead, it warns that the target should be
  `touch-action: none`, which removes vertical scrolling from the row entirely.

So the dependency would trade a known failure for a slower one, at 12kB, and
against CLAUDE.md's instruction to avoid unnecessary dependencies. **Recorded
here so the evaluation does not have to be repeated.**

**Option B — removing the swipe — was not necessary**, because the fault was
identifiable in the code rather than mysterious. The tap paths (the row's tick
button and the ⋯ sheet) were verified to carry every action the gesture does,
so removal remains available at any time and would cost no capability.

**What was done: the recognizer was replaced, not patched.**

- `src/components/swipe/recognizer.ts` — the decisions, as pure functions over
  plain numbers. Directly unit-testable for the first time.
- `src/components/swipe/useSwipeGesture.ts` — **Touch Events only** on a touch
  screen. No Pointer Events, no `setPointerCapture`, no `pointercancel`
  handling. Touch events have **implicit capture**, so a release landing on a
  neighbouring row still reaches the right one. The axis is claimed and the pan
  vetoed **in the same handler, from the same event**, at a **5px** lock rather
  than 8. A separate mouse path serves desktop and every `page.mouse` spec.
- **React does not render during a gesture.** The transform and state classes
  are written to the elements. The tray is rendered at rest and hidden with
  `visibility: hidden` — a stronger fix for the scroll-in flash than the
  conditional mount it replaces, and it is what removes the last mid-gesture
  render.
- **The row settles before the list resorts.** `onComplete` is deferred by
  exactly the settle duration, and flushed if the row unmounts first.

Two further defects found and fixed on the way, neither of them the reported
one:

- `lastTouchAt` was initialised to `0`, and event timestamps start near zero —
  so **every mouse gesture in the first half-second after a page load was
  suppressed** as if it followed a touch.
- The trailing-click swallow was a latch. On a phone a vetoed `touchmove`
  suppresses the emulated click entirely, so the flag stayed armed after every
  swipe and would eat the next genuine tap on that row. It is a 400ms window now.

#### Tests, and what they are worth

- **Unit** — `tests/unit/dom/swipe-recognizer.test.ts`: direction locking,
  thresholds, flick guard, cancellation, reset, multi-touch rejection,
  unmeasured rows, and the completion-as-outcome that makes deferred reordering
  possible.
- **DOM** — `tests/unit/dom/SwipeRow.test.tsx`: the veto actually landing,
  **zero renders between the finger landing and the release**, no transition
  against the finger, completion deferred until the settle and flushed on
  unmount, multi-touch abandonment, the tray, the tap path, and the mouse path.
- **Browser** — `tests/e2e/swipe-touch.spec.ts`, rewritten touch-only: partial,
  full, diagonal, vertical, adjacent rows, Undo, search active, completion then
  reorder, Light and Dark.
- **Production bundle** — `tests/e2e/production-bundle.spec.ts`: the served
  assets are a hashed production build, contain the gesture, and contain none
  of the Preview diagnostics.

**One of these tests was itself the same mistake, in miniature.** The
"page still scrolls" case was first written with `page.mouse.wheel`, and CI
answered *"Mouse wheel is not supported in mobile WebKit"* — a Chromium-only
capability reached for to make a claim about the engine the product ships on. It
now asserts the three conditions that actually decide whether a scroll happens
(effective `touch-action`, a scrollable document, and a vertical touch going
un-vetoed) and leaves whether it *feels* like a scroll to action three of the
phone check. Recorded rather than quietly rewritten.

**None of this proves the gesture works on a phone**, and the specs say so in
their own headers. Playwright cannot perform a multi-step touch drag, so the
moves are dispatched — and a dispatched event does not run WebKit's scroll
arbitration, which is the exact mechanism that broke #30.

#### The temporary scaffolding, and its removal

Two things existed only to get the gesture in front of a thumb, and **both are
gone**, in commit `<cleanup>` on this branch:

- an on-screen **gesture diagnostics** panel, built only by
  `vite build --mode preview`;
- a Preview-only branch that **skipped the passphrase**, so the check did not
  start with typing one on a phone.

**Removed, file by file:**

| File | What happened |
|---|---|
| `worker/preview.ts` | deleted |
| `worker/auth.ts` | bypass branch and import deleted; `requireSession` is byte-for-byte what it was before #33 |
| `worker/routes/auth.ts` | bypass branch and import deleted |
| `tsconfig.worker.json` | `vite/client` removed — it was added only for `preview.ts` |
| `src/components/swipe/SwipeDiagnostics.tsx` / `.css` | deleted |
| `src/components/swipe/diagnostics.ts` | deleted |
| `src/components/swipe/useSwipeGesture.ts` | every `DIAGNOSTICS` branch, counter and `trace()` call removed |
| `src/App.tsx` | panel and imports removed; back to its pre-#33 shape |
| `src/components/SwipeRow.tsx` | `index` prop and mount counter removed |
| `src/routes/Trip.tsx` | `index` prop removed |
| `.github/workflows/preview.yml` | deleted — no further unauthenticated previews can be published |

**Kept deliberately, and they are not leftovers:**

| Kept | Why |
|---|---|
| `deploy.yml`'s refusal step | Greps the built Worker and client for both markers and refuses to deploy. Costs one grep; the failure it catches is silent |
| `production-bundle.spec.ts` | Asserts `GET /api/trips` → **401** and `authenticated: false` against the real built Worker. This is the only end-to-end statement of Pack Smart's security boundary and is worth more than the scaffolding that prompted it |
| `swipe-recognizer.test.ts`, `SwipeRow.test.tsx`, `swipe-touch.spec.ts` | The durable regression suite for the fix itself |

#### Retiring the public preview

The preview Alex used, `c1283662`, was public and bound to the **real D1
database** with authentication bypassed. Removing the bypass from the source
fixes every future preview and **does nothing** about a version already
uploaded: a version preview URL is permanent for the life of the version, and
wrangler 4.115 has no `versions delete`. Uploading a corrected version does not
retract an earlier one.

So the fix is the Worker-level setting, which reaches back over versions already
published: **`previews_enabled: false`** on the script's workers.dev subdomain,
applied by `.github/workflows/retire-preview.yml`. It is enforced by Cloudflare
rather than by the URL being hard to guess.

That workflow reads the current settings first and writes back the `enabled`
value it read — changing only `previews_enabled` — because the same endpoint
carries whether the Worker answers on workers.dev **at all**, and production is
served from `pack-smart.juncaj93.workers.dev`. It then proves, with anonymous
unauthenticated requests, that the preview URL no longer serves the app and that
production still answers `401`.

| | |
|---|---|
| Retired URL | `https://c1283662-pack-smart.juncaj93.workers.dev` |
| Method | `previews_enabled: false` on the Worker subdomain, **plus `preview_urls: false` in `wrangler.jsonc`** — not URL obscurity |
| Anonymous verification | `retire-preview` runs `30690745227` and `30691492123` |

##### The retirement did not hold the first time, and that is the lesson

The API call worked and was verified — `404` on the preview, `401` on
production, run `30690745227`. Then #33 merged, and **its own deploy turned
preview URLs straight back on**, saying so in its output:

> Because your `workers.dev` route is enabled and your `preview_urls` setting is
> not in your Wrangler file, Preview URLs will be enabled for this deployment by
> default.

Measured, not inferred: the next retirement run recorded
`attempt 1: /api/trips -> 200` before `attempt 2: -> 404`. The exposed version —
the one carrying the deliberate passphrase bypass — was reachable again for
about **three and a half minutes**, between the deploy finishing at 08:14:59Z
and the setting being reapplied at 08:18:17Z.

**Cause: an API call is a one-off that the next deploy overwrites.** Only the
Wrangler file survives, because every deploy reapplies it. `preview_urls` **is**
a supported Wrangler key; it was missed because only the config schema's
top-level `properties` were searched, and it lives under
`definitions/RawConfig/properties`. #34 puts the line in the file.

**Total exposure of the bypassed preview:** ~10 hours from publication to first
retirement, plus ~3.5 minutes after the deploy re-enabled it. The URL was shared
only in PR #33, which is not a security control and is not counted as one.

**Confirmed closed after #34 deployed** (`dc51cfde`, deploy run `30691884937`):

- the deploy log **no longer carries** the "Preview URLs will be enabled…"
  warning that #33's did;
- `retire-preview` run `30692026306` read `previews_enabled: false` **before**
  writing anything, and its anonymous probe returned `404` on **attempt 1** with
  no propagation wait — the two earlier runs both needed a second attempt, which
  is what a fresh write looks like. Previews were already off, so the config
  survived the deploy rather than the API call being reapplied;
- production answered `401` anonymously in the same run.

##### Reads during the exposure windows — not established, and that is the honest answer

The brief asked for Cloudflare access logs to be inspected for unexpected access
during the recorded windows, *where that is possible without introducing a paid
service*. **It is not, and the inspection was not performed.**

- Cloudflare's per-request HTTP logs (Logpush, and Log Explorer/Analytics with a
  retention window worth searching) are **Enterprise features**. Buying one to
  audit this would be adding a paid service, which CLAUDE.md puts behind Alex's
  explicit approval.
- The Workers dashboard keeps aggregate request metrics, not per-request records
  with paths and outcomes, and its retention is short.
- No `tail`/Logpush consumer was attached to the Worker during either window, so
  no record was captured at the time. Nothing can be recovered after the fact.

**What can be said, and its limits.** The application writes are accounted for
above, and they are Alex's own. That is evidence about **writes only**. It is
**not** evidence that nobody read anything: an unauthenticated GET of the
preview would have returned real trip data and left no trace this project can
inspect. The absence of unexpected writes does not prove the absence of reads,
and this file will not claim it does.

**Assessed risk:** low, and stated as an assessment rather than a finding. The
URL contained a version hash, was published only in PR #33 on a private
repository, and the window was ~10 hours plus ~3.5 minutes. None of that is a
security control, and none of it is proof.

**Not a blocker for C1 or C2**, per the same brief. Recorded so it is never
mistaken later for a clean audit that was actually run.

##### Production data

Nothing in the preview infrastructure wrote to D1 on its own: `versions upload`
uploads code, and neither the preview nor the retirement workflow ran a
migration or any query. The only writes during the exposure were Alex's own
three actions on the packing list — pack, a contextual action, and its Undo —
all of which are ordinary product writes and reversible from the same screen.
`wrangler d1 migrations apply` ran only in the two production deploys, where it
is the normal forward-only step and applied nothing new.

**If a future slice needs a device preview**, it must not reuse this shape. The
correct design is a separate Worker with its own D1 database and its own seed
data, so a preview URL can never reach real trips. Recorded here so the next
person does not rediscover the shortcut.


#### Next action

None. Phone-accepted, scaffolding removed, preview retired **and kept retired**.
Deployed as `9baad615-a72c-4439-9e3c-aa543214c761`, then `dc51cfde-fe16-4b30-9d40-f8505a7b828a`
with the preview-URL config. **Release C resumes at C1.**

#### The real-device result: **PASSED**

Checked by Alex on his iPhone, against preview version
`c1283662-3e02-449d-8b3a-cdb59b8ee1ba` (PR #33, commit `21b9baa`):

| Action | Result |
|---|---|
| Swipe one unpacked item **right** | ✅ works |
| Swipe one item **left** | ✅ works |
| **Scroll** vertically, starting the drag on a row | ✅ normal |
| The jitter and the repeated reset | ✅ **gone** |

**This is the gate #30 failed, and it is the only evidence that counts.** The
swipe interaction is accepted.

### Release B — guided trip readiness — `deployed` through B3

- **Delivered in this slice:** `shared/readiness.ts` (one derived state, one
  next action, pure, never stored), Home driven by it, §4.1 essentials calming,
  `technical-docs/12_READINESS.md`.
- **Acceptance met so far:** one clear next action visible on Home; derived from
  real data; optional incompleteness does not block (questions defer themselves
  inside three days); essentials still protected on the packing list; Home
  calmer; no stored status involved.
- **B2 delivered:** Trip Details now reads the same `readiness()` answer and
  renders its headline, so the two surfaces are provably the same words about
  the same trip (`readiness.spec.ts` follows Home's own card to the trip it
  features and compares them). `todayISO()` moved into `shared/readiness.ts` —
  two screens computing "today" separately is the same duplication in miniature.
- **Acceptance now met:** one clear next action; no contradiction between Home
  and Trip Details; derived from real data; optional incompleteness does not
  block; essentials protected where actionable; Home calmer; no stored status.
- **Migration / data impact:** none.
- **B3 delivered:** the Trips list had a THIRD copy of the countdown, and it did
  not even agree on the words — "9 days" against Home's "9 days to go".
  `departureLabel(trip, today, style)` is now the only thing that computes it,
  in two registers (a list chip has no room for the long form) from one
  `daysBetween`, with a test asserting the registers agree about the same day
  and that `readiness().headline` IS the long form.
- **Release B acceptance — all met:** one clear next action; no contradiction
  across Home, Trips and Trip Details; derived from real data; optional
  incompleteness does not block; essentials protected where actionable; the
  summary screens are calmer; no stored status overrides reality.
- **B4 delivered:** `TripQuestion` asks ONE unanswered question above the
  packing list it would change. All three of doc 09 §5's constraints are
  structural rather than matters of restraint — one question because the model
  already chose which; materially, because every fact offered is proven to be
  one a real rule reads; deferrable, because `Not now` is a peer of the answers
  and stores nothing, so the question returns while the trip still does not
  know. Answers write through `updateTrip`, the same path the trip sheet uses,
  so two answers to one question cannot come to mean different things.
- **Release B is feature-complete.** Every acceptance criterion met and
  asserted.
- **Next action:** none. Release B is closed.

---

### Release C — resuming

Paused for the swipe hotfix above, which was a production-blocking regression.
The gesture is phone-accepted and merging, so the pause is over.

**Where it resumes, exactly:** from the latest `main` — the swipe hotfix is
deployed, current production version `dc51cfde-fe16-4b30-9d40-f8505a7b828a` — at **C1** — give the generated necessities a plain reason, and
decide Day-of. The audit that scopes it was measured before the pause and is
recorded in §4 below: on the approved worked example the real workbook produces
32 rows, **19 with neither a reason nor a breakdown**, and **zero** Day-of
candidates. That measurement is still the scope; it does not need retaking.

Nothing in Release C was started during the pause, so nothing has to be
unpicked.

---

## 4. Remaining, in dependency order

Scope for each is in doc 09 §3 and the roadmap brief; only delivery state lives
here.

| Slice | Status | Depends on | Next action |
|---|---|---|---|
| **B2** Trip screen reads readiness | merged with B | B | Done — headline shared, agreement asserted |
| **B3** Trips list reads readiness | merged | B2 | Done — `departureLabel`, one definition, two registers |
| **B4** Unresolved-question flow | implemented locally | B | Done — `TripQuestion`, one at a time, deferrable |
| **Q1** e2e test isolation | **deployed** | — | Ownership fixtures, run-level teardown, a source-level guard test — and one real product bug: a trip with a daily plan could not be deleted. Version `964e7b83-eb80-4d9a-8598-83d9d9a6ff8b`, PR #40 |
| **C1** Necessities completeness + reasons | **deployed** | B | **0 of 32 unexplained**, asserted against the real workbook. Version `16fdd292-1b06-49fc-a7f3-14a123657536`, PR #36 |
| **C2** Guided outfit review | **deployed**, phone verification pending | C1 | Walkthrough route, `deferred_at` (migration 0012), coverage summary, travel/multi-day markers. Laundry is ruled and implemented (D1b), see §7 |
| **A11-1** The two carried accessibility defects | **deployed** | — | Chips report state; `.check-critical` **2.79 → 5.28:1**. Contrast is a unit test over the real tokens now, not a screenshot review. Shipped with Q1, same version |
| **C2b** Swap sheet knows a group's own dates | **done** | C2 | Dates **derived**, not stored — the proposed `dates_json` column was rejected on inspection. Sheet applies the planner's dressiness ceiling, warmth band and rain demand, and says what it filtered by |
| **D1** Synchronisation audit | **done** | C2 | 17 scenarios measured against real SQL. **12 correct, 4 correctness gaps, 1 needs a ruling.** Scope for D1b below |
| **D1b** The gaps D1 found | **deployed** | D1 | Ownership rule between the two writers, **migration 0013** (merge + unique index), archived-garment conflicts, and a delete path in the rule writer |
| **Laundry** | **deployed** | D1b | Alex's ruling: a four-day cap on ordinary washable clothing, applied where the plan decides how many changes a group needs. See §7 |
| **D1c** Per-group replanning | **deployed** | D1b | An approval freezes its own outfit; drafts replan around it with its garments reserved, and its day count follows the trip |
| **D2** Packing-list filters + ordering | **deployed** | D1b | Filters already shipped; D2 is the ordering — completed-to-bottom, and a snapshot that only settles once the tapping stops |
| **D3** Bag assignment | **deployed** | D2 | Five bags on the checklist row (**migration 0014**), deterministic recommendations that stay overridable, and the bag filters §9 was waiting on. Version `bffdc3c6-234c-4d4b-b138-804525c407b6`, PR #45 |
| **P1** Home and Trips load time | **complete** | — | Not readiness. `App` renders nothing until the session check answers, so every navigation pays a serial round trip — and Home pays a second, discovering its trip before it can ask about it. **Home is 3 rungs deep**, the worst in the app. Server responses are 9–33ms |
| **P1b** Take the session check off the critical path | **complete** | P1 | **Home 3→2, Trips 2→1, My Stuff 2→1**, and the blank frame is gone. One line in `App`; the auth response is unchanged. Sign-out now clears the service worker's data cache, which it never did |
| **P1c** Home paints in stages, tabs remember | **complete** | P1b | Home shows the trip after ONE round trip instead of two, with nothing moving when the rest lands. Tabs repaint from an in-memory snapshot; any write empties it |
| **D4** Day-of departure view | **deployed** | D3 | `Before you go` — three sections in the order you act on them, and then it is empty. Derived from timing, final-check, bag and essential flags; **no schema change** |
| **D5** `Unique item for this trip` rename | **deployed** | — | The field and its accessible name were already renamed; the BUTTON that opens it still said `Add something to this trip`. Now `Add a unique item`, with a test that the two agree |
| **E1** Today screen | **complete** | D4 | One explanation instead of four dead ends, a recovery action on every unresolved slot, city + activity + honest weather, and a destination-local date that refuses to guess. Version `f1411c84-d6f6-4a09-aaeb-4f4a89d353ce`, PR #53. **No migration** |
| **E2** Weather refresh policy | **complete** | E1 | Freshness is a state (`live`/`stale`/`seasonal`/`unavailable`), and conflicts compare the day against the approved outfit without changing it. Version `4ecce84c-0f75-4676-9b88-e52286278eaf`, PR #54. **Migration 0015** |
| **F1** Post-trip review | **deployed**, phone verification pending | E1 | The short sitting after a trip: what the app saw, five optional questions, and proposals that reuse the rule kinds the engine already folds. **Migration 0016**, additive. Found two defects — an undeletable reviewed trip, and a CSS class collision no gate could see |
| **F3** The outfit-approval flakes | **deployed** — `948fe763-24f8-4170-a8a0-50bb184511df`, run `30953773114`, no migration | — | **It was the weather.** Rain promotes the outer layer to required; Alex owns nothing recorded as keeping rain out; so every outfit on a rainy trip was unapprovable. A product dead end, not a test problem — and invisible here because this sandbox cannot reach the forecast service. **CI WebKit went 8 flaky to 1**, and the one left is the itinerary wait, which is a different cause. See §5a |
| **G1** Archived trips out of learning | **deployed** — `d192637a-bd77-44bd-b8d1-fc549a2ed855`, run `30955919074`, no migration | — | Two `WHERE` clauses. `pendingRemovalProposals` had no `trip` join at all, and neither query filtered `trip.archived_at` — so a trip Alex put away still counted towards a proposal. See §6a |
| **F2** Offline reliability | **deployed** — `fad1f9a8-e717-4661-ab22-99b62dad8573`, run `30993878799`, no migration | F1 | The read half was already complete and was not rebuilt. What F2 built is the narrow write queue for `packedQty`, `finalChecked` and `bag`, bound to the session that made it. Audit and delivery below |
| **G2–G6** Alex's corrections | recorded, scoped | — | Several activities a day, outfit search across the wardrobe, Pack now ordering and filters, the seeded rules, wardrobe naming. Scope measured against the repository in **§6a**, with the order and the reasoning for it |
| **Final** Whole-product UX pass | not started | all | Production-like data, all iPhone widths, one phone session |

### C1 — audited before building, and the numbers are the point

Measured against the **real workbook**, imported through the real endpoint, on
the approved worked example (12 days, Cape Town, international, safari + nice
dinner). Reproduce by generating a checklist for that trip and grouping the
entries — the audit probe was deliberately not committed, because a test that
asserted these numbers would be pinning the defect rather than fixing it.

| Measure | Result |
|---|---|
| Rows generated | **32** |
| Categories present | Toiletries 8, Electronics 7, Documents 4, Medication 4, Travel Gear 4, Vision 2, Accessories 1, Grooming 1, Medication Storage 1 |
| Rows with a reason | 8 |
| Rows with a quantity breakdown | 5 |
| **Rows with NO explanation at all** | **19 of 32** |
| **Day-of candidates produced** | **0** |

Two real gaps, both against doc 09 §6:

1. **"Every generated item traceable to a plain reason" is not true today.**
   Nineteen rows — Toothbrush, Wallet, Phone, ID, Deodorant, both chargers,
   Hairspray, Glasses and the rest — arrive with neither a reason nor a
   breakdown. They are not *wrong*; they are simply unexplained, and the doc
   asks for a plain reason on each. Most are `fixed_per_trip: 1` rules whose
   `original_text` exists but is never surfaced onto the row.
2. **Nothing is ever a Day-of candidate.** `packingTiming` supports `day_of`
   and the checklist has a Pack-day-of section and filter, but generation
   produces none for this trip, so the section is permanently empty unless Alex
   moves something into it by hand.

Neither is a code defect to repair quietly — both change what Alex sees on every
trip, so they are C1's actual scope rather than an assumption about it.

#### "Decide Day-of" — decided, by reading the approved plan

The audit left Day-of open. It is **not C1's**, and the approved scope says so
directly (`09_PACK_SMART_V2_GUIDED_TRIP_LIFECYCLE.md` §5):

| Release | Contents |
|---|---|
| **C** | Necessity **explanations**; itinerary→outfit mapping; guided review; grouping; coverage summary |
| **D** | Final packing and **Day-of** — synchronised final list; bag assignment; **Day-of screen**; filters; remaining-item logic |

The same doc's §2 already records the Day-of departure view as **missing**:
"the `day_of` timing exists per item and per row; there is no departure screen."

So generating Day-of candidates in C1 would fill a section with rows Alex has no
flow for — the value of marking something Day-of is the departure view that
consumes it, and that view is D's. **Day-of generation moves to D, with the
screen it exists for.** C1 is the explanations, and nothing else.

#### C1 — delivered and deployed

| | |
|---|---|
| PR | **#36** |
| Deployed version | `16fdd292-1b06-49fc-a7f3-14a123657536` |
| Deploy run | `30696394851` |
| Acceptance | **0 of 32 generated rows unexplained** |
| Quantities | unchanged — Contacts 24, Passport 1, every M4 expectation re-asserted |


**`0 of 32 generated rows unexplained`**, asserted by
`tests/integration/necessity-reasons.test.ts` the way the gap was measured:
the real 119-row workbook, imported through the real endpoint, on the approved
worked example. Not a fixture that agrees with the implementation.

**`shared/explain.ts`** owns the wording and the precedence; `rules.ts` still
owns the arithmetic and cannot be changed by a copy edit. The reason is derived
from the same fold that produced the quantity, in the same call, so the two
cannot drift — the file's invariant 2, extended from the number to the sentence.

| Level | Source | Example |
|---|---|---|
| 1 | The calculation that produced the number | `12 nights × 2` |
| 2 | The condition that let it on the trip | `International trip` |
| 3 | A user's own words | `I always lose one of these` |
| 4 | A system rule's words, if they survive the quality gate | rarely — see below |
| 5 | The rule kind, stated plainly | `One per trip` |

##### The brief's assumption about `originalText` did not survive contact

C1 was scoped on the premise that `PackingRule.originalText` "already stores
useful human-readable rule language". Measured against the real workbook, mostly
it does not. That column is `Default Priority / Quantity Rule`:

| Item | `originalText` |
|---|---|
| Phone, Wallet, ID, Toothbrush | `Critical (Always)` |
| Glasses, Deodorant, Toothpaste | `Always` |
| Rogaine, Hair Gel, Floss | `Usually` |
| Apple Watch Charger | `Explicit Item: Packed if Apple Watch is brought` |

`Usually` is the tier that produced the rule, not a reason. `Explicit Item:` is
importer vocabulary. Surfacing these verbatim would have met the letter of
"surface `originalText`" and shipped exactly the vague filler the slice forbids.

So `usableRuleText` gates level 4 — declining priority shorthand, formulas,
identifiers and anything over 72 characters — and the seeded rows land on level
5 and read `One per trip`. Level 4 is kept above the fallback because a **user's**
rule text is genuinely the best explanation of itself.

##### Two things found while building, neither of them in the brief

- **An overridden row was never re-explained.** The generator skips a row with
  a hand-set quantity entirely, so it kept a null reason forever — and a row
  Alex has taken the trouble to adjust is the last one that should go silent.
  It now refreshes `reason_text` while still never touching his number.
- **And its explanation would have argued with his number.** `11 nights × 2`
  beside a 7 he typed invites the multiplication. An overridden row now states
  the rule as a *rate* — `2 per night` — which is honest next to a total he
  chose. The same applies to the stored breakdown, which is suppressed on the
  row and in the sheet once an override exists.

##### Existing trips

Rows written before C1 have `reason_text` null, and the checklist regenerates
when a trip **changes** rather than when it is read — so without a backfill the
guarantee would hold for new trips only. Opening a trip now repairs it once:
`GET /:id/checklist` regenerates when it finds an engine-owned row with no
reason. `generateChecklist` preserves a hand-set quantity, an exclusion and an
added item by contract, so the repair cannot undo an edit — asserted, with both
kinds of edit set up first.

##### On the row, and in the sheet

Every generated row **has** a reason; not every row **prints** one, and
`rowSecondaryLine` holds the judgement with a test that says why. A single
always-packed item would read `One per trip` — restating what the row already
shows, nineteen times in a row on the seeded catalog. Trip-specific reasons do
print: `International trip`, `Because you are packing Apple Watch`,
`You added this for this trip`. Everything is in the ⋯ sheet under *Why it is
here*, which is now never empty for a generated row, and the row's line sits
inside the row's own button so VoiceOver announces it with the control.

**Quantities did not move.** Contacts 24, Passport 1, and every M4 expectation
are re-asserted inside C1's own suite, because that is where a future copy
change will be made and the guard belongs where the risk is.

##### The accessibility gate rejected the first version, and it was right

Three findings, all inside C1's scope and all measured rather than eyeballed:

- **The reason was welded into the row button's accessible name.** With no
  `aria-label`, the name is computed from contents — which now included the
  whole explanation, so VoiceOver announced ~80 characters of prose before the
  role and the pressed state, on every one of 32 rows, **with no way to skip
  it**: the rotor can mute a description, never a name. Split with
  `aria-labelledby` (the item) and `aria-describedby` (the reason).
- **The test written to prove that was safe asserted nothing.** It read
  `getAttribute('aria-label') ?? innerText()`, and since the button never
  carries an `aria-label` it compared an element's text with its own child's
  text. It could not fail — it would have passed with the meta `aria-hidden`,
  and it *did* pass while the name was the eighty-character version. Replaced
  with `toHaveAccessibleName` / `toHaveAccessibleDescription`, plus an assertion
  that the name does **not** contain the explanation.
- **`.entry-why-label` failed contrast**: 2.61:1 in Light, 4.25:1 in Dark,
  against the 4.5:1 that 12px text needs. Pre-existing, but C1 is what turned it
  from rarely rendered into always rendered, so it is C1's. Moved to
  `--color-text-secondary` (4.93:1 / 7.68:1).

Also fixed: `·` is not spoken at VoiceOver's default punctuation level, so
joined facts ran together with no pause. Every separator now renders a middot
for the eye and a visually-hidden comma for the ear — including the
`· Essential` marker, whose accessible name read `Contact lenses· Essential`
because name computation trims each text node before joining.

**One claim automation cannot settle** is recorded in the manual iPhone
checklist rather than assumed: whether VoiceOver drops `×` and `=` and reads
`12 nights × 2 = 24` as three unrelated numbers. iOS punctuation verbosity is
not reproducible in WebKit automation.

##### The second review rejected the fix, and was right again

The `aria-labelledby` fix keyed its ids on the entry alone — but a row needing a
final check is listed under **two** sections at once, which `groupChecklist`
does on purpose and which the `<li>` key has always accounted for. So both ids
were emitted twice, and an IDREF resolves to the **first in document order**:
the Final check row took its name from the Pack-now copy. Visually identical,
and wrong for exactly the row where `section.allEssential` suppresses the
"Essential" marker — the UX-04 rule, silently defeated.

Keyed by section now. The e2e assertion that catches it was **verified to fail
against the bug** before being kept, because the review had already found one
test in this slice that could not fail.

##### Recorded, not fixed — neither is C1's

| Finding | Why it is deferred |
|---|---|
| Quantity and timing chips in the entry sheet carry no `aria-pressed`; selection is colour plus weight only, so VoiceOver announces a chosen and an unchosen chip identically | Pre-existing, untouched by this diff |
| `.check-critical` ("· Essential") is `--color-text-tertiary` at 14px: **2.79:1** Light, **3.86:1** Dark, both under 4.5:1 | The colour is untouched here (`git diff origin/main -- src/routes/Trip.css` is empty), though C1 edited that element's markup. Worth a slice with the chips |

**Both are now scoped as slice A11-1 in §7 below**, rather than left as two rows
in a table nobody will search for.

#### How the gap was located in the code

`reason` is populated in exactly one place: `computeQuantity` in `shared/rules.ts`
returns `gates.reasons` joined, and `evaluateGates` only ever pushes a reason for
a **`conditional_include`** rule. A row whose quantity came from `fixed_per_trip`
or `per_day` with no conditional gate therefore has `reason: null` by
construction — which is exactly the 19.

The words already exist: `PackingRule.originalText` carries the rule as written
in the workbook (`One per trip.`, and so on), it is stored in
`packing_rule.original_text`, and it is read by the repo. It simply never
reaches the row.

**The change is to give a quantity rule the same voice a gate already has**, so
every generated row can say why it is there. Its acceptance is the audit's own
number: **0 of 32 rows with no explanation**, on the same worked example.

**The categories themselves are fine.** Every category doc 09 §6 names is
represented; chargers arrive under Electronics rather than as a category of
their own, which is a naming difference and not a gap.

---

### C2 — audited before building, the same way C1 was

Measured against the **real workbook**, imported through the real endpoint, on
the approved worked example (12 days, Cape Town, international, safari + nice
dinner), by generating outfits and reading the groups back. The probe was not
committed, for the same reason C1's was not: a test asserting these numbers
would pin the defect rather than fix it.

| Measure | Result |
|---|---|
| Outfit groups produced | **4** — Nice dinners, Safari, Travel days, Casual days |
| Status of each | **all four `draft`** |
| Slots across them | **27**, and **27 filled** |
| `incomplete` groups on this trip | **0** |

**Three real gaps against doc 09 §7, and one guarantee that is already true.**

1. **"One unresolved outfit or group at a time" — missing.** All four groups
   render at once as a list of cards (`src/routes/Outfits.tsx`), each with its
   own Approve button. §2 of the scope doc already says so — "Outfits are a
   list, not a walkthrough" — and the measurement confirms it is four
   simultaneous decisions rather than one.
2. **"Decide later" — missing.** The card offers *Approve outfit* and *Undo
   approval*, and a slot can be changed through the swap sheet, so two of §7's
   three answers exist. There is no way to say "not now" and move on, which is
   the answer that makes a walkthrough safe to enter.
3. **The closing summary — missing.** §7 ends with
   `10 outfit needs covered by 7 approved outfits`. Nothing computes or shows a
   coverage count, so a walkthrough would have no end state to arrive at.

**Already true, verified rather than assumed:** *never silently approve
incomplete*. `setGroupStatus` writes the requested status and then calls
`refreshGroupStatus`, which recomputes from the slots and vetoes an approval
whose required garment is missing — the settled status decides, not the request.
`generateOutfits` marks a group `incomplete` on the same test. No work needed.

**Not yet measured, and C2 must measure before claiming:** whether multi-day and
travel-day outfits are *marked* as such (a group named "Travel days" exists,
which is grouping, not marking), and whether rewear and laundry are respected in
the grouping. Both are §7 clauses; neither is answered by the numbers above.

**Where C2 starts:** the walkthrough surface and the coverage summary are the
scope. The engine underneath produces sensible groups already — four, fully
filled, on the worked example — so this is a review flow over a working planner,
not a replanning slice.

#### The two unmeasured §7 clauses, measured

The clauses, verbatim from `09_PACK_SMART_V2_GUIDED_TRIP_LIFECYCLE.md` §3's
index of §7: *"mark multi-day and travel-day outfits, respect rewear and
laundry"*. Three separate claims, measured separately, because they turned out
to have three different answers.

| Clause | Verdict | Evidence |
|---|---|---|
| Respect **rewear** | **Already satisfied** | `reuseCapacity(item, preferred)` in `shared/outfits.ts` reads the item's own capacity, then Alex's saved `reuse_defaults` preference, then the per-role defaults from doc 04 §6 (`top: 1`, `bottom: 3`, `swim: 2`, jackets and shoes effectively unlimited). `assign()` consumes capacity greedily and records `wearings` per slot, and `clothingDemand` divides by capacity so six days in one jacket is one jacket. Nothing to build. |
| Mark **multi-day and travel-day** outfits | **Partially satisfied — implemented in C2** | The planner already *treated* them differently: `TRAVEL_TEMPLATE` takes the first and last unspoken-for days, and `occurrences` counts each group's days. But nothing said so on screen, and — the real defect — `outfit_group.activity_tag` is NULL for **both** untagged templates, so a stored travel outfit and a stored ordinary day were indistinguishable. `templateFor(activityTag, name)` now resolves them, and `outfitMarkers` states them. |
| Respect **laundry** | **Not implemented, and deliberately not invented** | Measured: zero occurrences of `laundry` in `shared/outfits.ts`, `worker/repos/outfits.ts` or `src/routes/Outfits.tsx`. `laundryAvailable` is a trip fact that the *rules* engine reads and the outfit planner does not. See below. |

**Why laundry was not implemented rather than guessed at.** No canonical
document states how laundry changes reuse. Doc 03 §2 lists `no laundry` as a
phrase to parse into a trip fact; doc 04 line 294 says the opposite of a ledger —
*"V1 should not require Alex to maintain a perfect laundry ledger."* There is no
approved multiplier, no approved threshold, and no approved interaction with
`reuse_defaults`. Inventing one — "laundry doubles every capacity", say — would
be exactly the fabricated capability §7 forbids in its next clause, and it would
change packing quantities on every trip Alex has already answered the question
for. **Recorded as a genuine gap needing a product decision, not as done.** It
is the one part of §7 C2 does not close, and it is named here rather than left
to be rediscovered.

#### C2 — built

**The walkthrough** is a route (`/trips/:id/outfits/review`), not a sheet. §7
forbids a modal prison in the same breath as asking for one outfit at a time,
and on iPhone Safari a sheet that owns the decision *is* that prison — the
edge-swipe back is the gesture Alex already trusts, and a route keeps it working.
Position is component state rather than a URL segment, so Back leaves the review
in one gesture instead of walking backwards through four outfits; every real
decision is stored, so re-entering resumes at the first outfit still wanting an
answer.

**"Decide later"** is `outfit_group.deferred_at` (migration 0012, additive,
one nullable column). Deliberately **not** a fourth `status`: widening that CHECK
means rebuilding the table, which is a destructive migration — and more
importantly deferral is orthogonal to completeness. A deferred outfit is still
`draft` or still `incomplete`, and `readiness()` still counts it as unresolved.

**How a deferred outfit affects the packing list — stated, because §7 asks:**
*it does not.* `syncChecklistFromOutfits` filters on `status = 'approved'`, so a
deferred outfit's clothing is not packed. The screen says so in three places
rather than leaving it to be discovered: the marker detail ("Not on your packing
list until you approve it"), the summary body, and the card. Approving clears the
deferral; an approval the server **refuses** does not, because a refused approval
is not a decision.

**The coverage summary** counts two different units in one sentence, which is why
§7's own example puts both in it: `10 outfit needs covered by 7 approved
outfits`. A need is a day; an outfit is a plan covering several. Counting either
alone reads as more progress than it is, so the partial case says
`6 of 12 outfit needs covered by 1 approved outfit` and the empty case says
`4 outfit needs to cover, none approved yet`.

Under it, the breakdown §7 names — approved, left for later, missing a piece, not
reviewed — and the shortfall: `3 days have no approved outfit yet`. The breakdown
takes the **groups**, not the coverage, because the categories overlap: a
deferred incomplete outfit is counted by both `coverage.deferred` and
`coverage.incomplete`, correctly, and adding those two would count it twice and
then report a negative remainder. Each group lands in exactly one bucket, and a
test asserts the parts sum to the total for every mixture.

**One clear next action, always.** While outfits are outstanding it names the
outfit — `Review Safari`, not a count that makes Alex go and find out which.
Once nothing is outstanding the judgement is no longer this screen's to make and
`readiness()` answers it, so Home, the trip screen and the review cannot
recommend three different things. `readiness()` returns *no* next action for a
trip that is genuinely ready or already finished — correct for Home, wrong for
the end of a walkthrough — so there is a `Back to the trip` fallback rather than
a screen that ends on a secondary link.

**"Show when no eligible replacement exists"** was missing, and the failure was
subtle. The swap sheet had one empty state: *you own nothing that could go here*.
The commoner case — owning several and none of them suiting — rendered as a bare
divider whose sentence began "Everything **else** you own", with nothing above it
for "else" to refer to. That reads as a bug rather than an answer. Both cases now
say which one they are, and the divider drops "else" when there is no list above
it. Tested at the DOM layer (`tests/unit/dom/SwapSheet.test.tsx`) and verified to
fail against the old copy.

**One correctness defect found and fixed.** `swapCandidates` judged suitability
from the role and the template alone — no `maxDressiness` — so a garment the
*planner* had ruled out came back to the swap sheet labelled suitable. It also
fell through to `EVERYDAY_TEMPLATE` for travel days, whose `uses` constraint is
looser. Both fixed; the test was verified to fail against the old behaviour
before being kept.

**Measured and not fixed, recorded honestly:** the swap sheet still cannot apply
the per-group *weather* filters. Those are derived from a group's own dates, and
`outfit_group` has no dates column — deriving them from the wrong days would be
the invented capability §7 forbids. Worth a slice with a `dates_json` column;
not worth a guess.

**Not changed:** the swap sheet still lists unsuitable garments below a labelled
divider with the reason. §7's "only genuinely eligible alternatives" is read as
what is *offered* — the suitable list leads, and the rest is disclosed with an
honest label — because doc 04 §7's existing ruling is explicit that Alex knows
things the app does not, and silently hiding half his wardrobe looks broken
rather than opinionated.

#### C2 — deployed, and what it did to production

| | |
|---|---|
| **PR** | #38, squash-merged as `eb9db83` |
| **Version** | `bb212c53-a311-44e4-9f08-7ba3a2a1b882`, read from the deploy run's `Deploy Worker` step |
| **Deploy run** | `30704185309`, all eleven steps green |
| **Migration** | `0012_outfit_deferral.sql` applied to the remote D1 — `Executed 2 commands in 1.86ms`, ✅ |
| **Preview URLs** | The deploy log carries **no** "Preview URLs will be enabled…" warning. `preview_urls: false` survived another deploy, which is the standing check from the #34 incident |

**Production data impact: none.** One nullable column added to `outfit_group`;
nothing dropped, no CHECK touched, no backfill, no `UPDATE`. Every group that
existed before the migration reads as "not deferred", which is exactly what
every group that existed before the migration was. **No quantity moved and no
packing-list row changed.** Alex's approved outfits are still approved and their
clothing is still on the list.

**Not yet verified in production.** Outbound HTTPS from the agent environment is
gated by network policy, so the live endpoint cannot be curled from here. The
evidence is the deploy log, and it is labelled as such — the same standing
constraint as every slice before it. The phone session in §6 is what closes it.

#### The accessibility gate rejected it, and was right

Six blocking findings on the first version of the review screen. All six fixed;
the four automation can hold now have assertions in `outfit-review.spec.ts`
under *what a screen reader is told*, and **two of those were verified to fail
against the defect** before being kept.

| # | Defect | Fix |
|---|---|---|
| A1 | Every error rendered as a bare `<p>`. No role, no live region, conditionally mounted — while the rest of the codebase already uses `role="alert"` (`ItemSheet`, `Import`, `Unlock`, `Trip`). This new screen was the only one that dropped it | Two always-mounted regions: `alert` for a refusal or a failure, `status` for a confirmation |
| A2 | `disabled={busy}` on the button under the finger moves `activeElement` to `<body>`, and nothing put it back. The advancing paths were rescued by accident; `Undo approval`, the refusal, and every `catch` were not — the buttons beneath silently changed meaning while focus sat at the top of the document | Captured before the disable, restored after it |
| A3 | The approval refusal was a `polite` status in a node inserted already containing its text. Safari does not reliably announce a live region that materialises with its content | `alert`, in a region that already exists |
| A4 | The success confirmation was cancelled by the focus move — a focus change preempts a pending polite announcement. `3 added to your packing list` is the **only** statement anywhere in the flow that approving put anything in the bag, and it was never spoken | Held in a ref and set *after* the focus move |
| A5 | `Change something` rewrites 5–8 rows from text into buttons, all of them above the toggle in DOM order, with no `aria-expanded` and no announcement | `aria-expanded` + `aria-controls`, and focus moves onto the first row that became a control — the landing *is* the announcement |
| A6 | The only visual difference between a readable row and a tappable one was a chevron at **2.61:1**. WCAG 1.4.11 wants 3:1 for anything identifying a control | Chevron to `--color-text-secondary` (4.93:1), and `.is-editable` gains a surface and a border, so the signal does not depend on colour perception at all |

**Two of the fixes were themselves wrong first, and the tests said so.** The
focus restore was a microtask after `setBusy(false)` — it ran before React had
committed, so the button was still `disabled` and `.focus()` was a no-op. And
omitting the stuttering `What for` row only for groups with no activity missed
the worse case: `ACTIVITY_LABELS.nice_dinner` is "Nice dinners" and so is the
group's name, so that row read `Nice dinners … What for, Nice dinners`.

##### The second accessibility pass rejected it again, on four

Nine of thirteen were genuinely closed. The remaining four were fair, and three
of them shared one root cause — **every path that both announces and moves focus
must announce second**, and the first fix had covered two of four paths.

| # | What was still wrong | Fix |
|---|---|---|
| A1 | The regions were inside the loaded branch, behind an early return that fires while the trip and the error are both null. So on the **first** error the screen can produce — the load itself — the alert region was inserted already containing its text. The exact shape the fix exists to avoid, on the earliest error there is | Both regions hoisted above the early return |
| A3 | The refusal announcement was now cut off by the focus restore that A2 had just introduced. `assertive` does not immunise a live region: a focus change is itself a top-priority interruption | Routed through the same post-focus mechanism |
| A4 | `undoApproval` and the swap handler still announced before focus. The comment on `undoApproval` claiming nothing raced it was false, and false *because of* the A2 fix beside it | Same mechanism |
| — | `aria-expanded` on `Change something` stated something untrue. Nothing is shown or hidden; the rows are fully readable in both modes and change from text into buttons. "Change something, collapsed" about a list already read in full is a false programmatic state under 4.1.2 — and the e2e test asserting the attribute had locked it in | Attribute removed; the focus move is what conveys the change, and the test now asserts its absence |

One mechanism replaced the three separate ones: `announce()` queues every outcome
message to the **next frame**. The focus moves on this screen happen in passive
effects and in another component's unmount cleanup, and no single hook runs after
all of them — the next frame does, by construction.

Two corrections to claims this file previously made:

- **The `.is-editable` border does not carry the contrast requirement.** Measured:
  1.21:1 for the border and 1.07:1 for the surface against the page. What closes
  A6 is the chevron at 5.28:1. The border is a real affordance and a poor
  contrast signal, and the CSS comment says so now — the earlier version claimed
  otherwise, and the next person would have felt free to drop the chevron.
- **Giving `.outfit-coverage` a surface and a border made it byte-identical to
  `.outfit-card`**, so the summary looked like a fifth outfit. It is not a panel
  at all now. A summary is a sentence, a count and the next thing to do.

##### And one test that could not fail, caught by mutation rather than by review

The first attempt at the A1 regression test was end-to-end: hold the API
requests open with `page.route`, assert the regions during the loading state. It
**passed against the bug**. The service worker serves those requests and
`page.route` does not intercept it, so the screen had quietly finished loading
and the assertion was reading the happy path.

Moved to `tests/unit/dom/OutfitReview.test.tsx`, where the promise genuinely
never settles — and verified to fail against the defect before being kept.

**And then it happened a second time inside the same slice.** The regression
test written for the announcement ORDERING — the invariant three findings turned
on — used a `MutationObserver` on the live region and a `focusin` listener, and
compared the two sequences. It passed against a deliberately broken
implementation. Observer callbacks are delivered as microtasks, and React
flushes passive effects synchronously for a click, so the heading's focus was
always logged first whether or not the DOM had already been mutated. It measured
observation order, not mutation order.

Rewritten to sample the region's text **inside the focus handler**: if the
region already holds text at the moment focus lands, the announcement came
first. Verified to fail — `the region already held text when focus landed:
["4 added to your packing list."]`.

That is three tests in this repository that asserted an accessibility guarantee
and could not fail. The lesson is now a rule: **a new accessibility assertion is
not finished until it has been run against the defect and seen to fail.** Two of
the three looked more convincing than the tests around them.

##### The third pass accepted, with three follow-ups — all three done

`announce()` worked, but this file and the code comment both explained it
wrongly: the frame boundary is *not* what orders it. React schedules the commit
and the passive flush as separate tasks and the event loop permits a rendering
opportunity between them, so an `rAF` callback genuinely can land in the gap.
What guarantees the order is that the callback **touches no DOM** — it calls a
setter, and every React render entry point flushes pending passive effects
first. So the deferral mechanism is interchangeable and doing DOM work inside it
is not. The comment says that now, because a right result with a wrong stated
cause is what the next person inherits.

Seven non-blocking findings were fixed in the first pass, including one that was
a plain falsehood: the new *"nothing you own suits this"* message keyed off the
**search-filtered** list, so typing a word that matched one unsuitable garment
made the sheet announce that nothing in the wardrobe suited the occasion. It
reads the whole wardrobe now.

Three findings were **verified pre-existing and explicitly not attributed to
C2**: `BottomSheet` does not `inert` the page behind it, the app announces no
route change anywhere, and `ul { list-style: none }` strips list semantics
globally. None is C2's, none is fixed here, and none is hidden.

**No time-of-day claim is made.** §7 asks for it "when relevant"; nothing in the
model records a clock time. `TripDay` holds a date and an activity tag, and the
itinerary parser does not persist times. The review states the activity in Alex's
words — "Nice dinners" carries its own time of day because he chose it — and
infers nothing further. Deriving "Morning" from `safari` would be a fact he never
gave.

### C2b — the replacement sheet judges by what the planner judged by

**The defect.** `swapCandidates` had no idea which days an outfit covered. It
narrowed the wardrobe by slot and by the group's template, and applied **no
weather filter at all** — so a jacket the planner had rejected for being the
wrong warmth came back offered as a suitable replacement, and on a wet safari
morning the sheet could present a jacket that keeps nothing out as the answer.
It also fell through to `EVERYDAY_TEMPLATE` for the travel outfit, which is a
looser filter than the one that planned it.

#### The audit proposed a `dates_json` column. There is no migration, and that is the finding

The brief asked for the proposal to be checked before it was built rather than
after. It does not survive the check:

`assignDays(startDate, endDate, groups, days)` is a **pure function**, and every
one of its inputs is already in the Worker's hand at the moment the sheet asks —
`getTrip` returns the dates and the named days, `listOutfits` returns the groups.
Storing its output would be caching a pure function whose inputs change often:
every trip-date edit, every re-plan, every added or removed occasion invalidates
it. A stale cache of *which days an outfit covers* is exactly the second source
of truth doc 04 §8 exists to prevent — and it would have to be invalidated in
five places to stay honest, where deriving it is correct in one.

Deriving also guarantees what the brief actually asked for: the sheet, the
review panel and During Trip **cannot disagree**, because all three call the
same function on the same inputs. A column can drift from the panel beside it;
a derivation cannot.

| Question the brief asked | Answer |
|---|---|
| Representation | None stored. `assignDays` derived per request, from `trip.startDate`, `trip.endDate`, `trip.days` and every group of the trip |
| Local-date semantics | `YYYY-MM-DD` throughout, the trip's own local days, never a timestamp. `tripDateRange` and `trip_event.event_date` already use this and nothing here changes it |
| Existing outfit groups | Work unchanged and immediately — there is nothing to populate |
| Backfill | Not applicable |
| Duplication | None introduced. The dates exist in exactly one place: the function that computes them |
| Editing | A trip-date change is picked up on the next request with no repair step. Under `dates_json` it would need one |
| Approved outfits and quantities | **Untouched.** The sheet is a query — asserted by a test that re-plans afterwards and compares every slot and status |

#### What the sheet now filters by, and what it says

The same context the planner used: the covered local dates, the destination
those dates belong to (`destinationForDate`, per stop — Cape Town's forecast
never judges a Kruger outfit), the activity, travel-day status, the formality
band, the weather for **those days**, the required slot, and the approved
garment capabilities. `weatherForGroup` was extracted from `generateOutfits` so
there is one reading of weather rather than two.

Three rules the implementation holds to, each named in the brief:

- **Formality and travel status are never inferred from a null activity tag.**
  Both untagged templates carry `activity_tag = NULL`; `templateFor` resolves
  them by the group's stored **name**, which is the only thing the database
  keeps about them. A group matching neither reports no formality rather than a
  guessed one.
- **Weather is never guessed from the trip's overall range when the outfit
  covers specific days.** `weatherForDates` is asked for the group's dates and
  returns `null` when nothing is recorded for them. The `conditions` line is
  then absent — there is no "probably mild".
- **A climate normal is never rendered as a forecast.** It is prefixed
  `Usually`, and a test asserts the prefix.

The sheet states that context in one line — `3–5 Aug · Kruger · Safari · Casual
to Smart casual · 46–57°F · rain likely` — because a sheet that rejects half the
wardrobe without saying what it is judging against is indistinguishable from a
broken one. Every part is omitted when it is not recorded. The middot is
`aria-hidden` with a visually-hidden comma beside it: `·` is not announced at
VoiceOver's default punctuation level.

**Dates are only *claimed* when Alex named his days.** `assignDays` spreads
groups across the calendar either way, and that spread is a reasonable order for
During Trip to walk — but it is not a statement that the safari is on the
Tuesday. So the weather still reads from the spread dates (a forecast for roughly
those days beats none), while the context line falls back to the occurrence
count. Nothing on screen asserts a day he never gave.

#### Tests — 15 integration, 6 DOM, all mutation-checked

The nine cases the brief names, plus the warmth band, which the brief did not
name and which is the half the C2 audit actually caught. Both filters were
verified to fail: `warmthBand: null` fails the warmth test, `needsRainLayer:
false` fails both rain tests, and removing the context line fails five of the six
DOM tests.

**Three of these tests could not have failed as first written**, and all three
are recorded in the file rather than quietly fixed:

1. The forecast fixture ended `as WeatherDay[]` and carried a
   `precipitationChance` field the engine has never read. "Rain likely" was
   never true; the rain assertion passed on an unrelated **warmth** rejection.
   The cast is gone.
2. The two jackets differed in warmth as well as in `weather_tags`, so the rain
   assertion had a second reason to pass. They are now identical but for the tag.
3. They were called "Rain Shell" and "Summer Shell" — and `weather-fit.ts`
   documents *shell* as one of Alex's own words for waterproof, so the untagged
   one was **correctly** read as a rain layer. The test was asserting against
   documented behaviour. Renamed to carry no capability word.

A fourth: `if (!found?.slot) return` is a test that passes when the thing it is
about does not exist. `slotIn` throws instead.

**No deployment requirement.** This is a Worker change with no migration and no
data impact, and it ships with the branch.

### D1 — the Release D synchronisation audit

**Measured before anything was changed.** Every row below was produced by running
the real repositories against real SQL, not by reading the code and reasoning
about it. Six behaviours turned out not to be what the code appeared to say, and
four of those are defects nothing on screen would explain.

Nothing in this slice changes behaviour. It names what is true, what should be
true, and the exact test that would prove each one.

#### The two writers, and why that is the whole story

Two functions write `checklist_entry`, and almost every finding below is about
where they meet:

| Writer | Owns | Trigger |
|---|---|---|
| `generateChecklist` | rows produced by a **packing rule**, plus `always_include` items | trip created, trip edited, checklist regenerated, and once per trip on read as a C1 backfill |
| `syncChecklistFromOutfits` | rows produced by an **approved outfit**, `source = 'outfit_generated'` | an outfit is approved or un-approved, a slot is filled or emptied |

Doc 04 §8 makes approved outfits the source of truth for clothing. The rule
engine is the source of truth for everything with a rule. **Underwear is both** —
a garment carrying the approved 2-per-trip-day basis — and that overlap is
where the list comes apart.

#### The seventeen scenarios

Legend: ✅ already correct · 🧪 correct but untested · 🎨 UX gap · ❌ correctness
gap · ➕ missing feature · ❓ needs a product ruling

| # | Scenario | Measured behaviour today | Class |
|---|---|---|---|
| 1 | Approve an outfit | Its garments arrive with `Worn for …` as the reason; quantities are wearings ÷ reuse capacity; readiness moves `outfits` → `packing` | ✅ |
| 2 | Defer an outfit | Writes `deferred_at` and nothing else. Nothing reaches the list, the draft is preserved, the coverage summary counts it unresolved | ✅ |
| 3 | Edit an approved outfit | `refreshGroupStatus` keeps the approval, re-derives completeness, and the next sync follows the edit | ✅ |
| 4 | Replace a garment | Old garment leaves the list, replacement arrives, every unrelated row is untouched | ✅ |
| 5 | Remove a garment used by **one** outfit | `outfitsUsingItem` names 1 outfit and the slot; `outfitConflicts` reports it on every load; the outfit is **not** edited; undo clears it | ✅ |
| 6 | Remove a garment used by **several** | Same, and names all of them — measured at 2 | ✅ |
| 7 | Add a manual trip item | `source = 'user_added'`, `item_id` NULL, survives both regenerations | ✅ |
| 8 | Remove a manual trip item | Excluded, never deleted; the row and its reason stay restorable | ✅ |
| 9 | **Change trip length** | Quantities that scale with the dates follow. **Two things do not:** the outfit plan (see 13), and a row whose rule has *stopped* applying — a shaver conditioned on `nights >= 3` stays on a one-night trip | ❌ |
| 10 | Change laundry availability | **Nothing happens.** Measured: two identical trips differing only in `laundryAvailable` produce byte-identical checklists | ❓ |
| 11 | Archive a wardrobe item | The row leaves the list on the *next unrelated sync* — silently. The outfit slot goes on naming a garment Alex no longer owns, and `outfitConflicts` reports **nothing** | ❌ |
| 12 | Restore a wardrobe item | Comes back on the next sync. Historical trips kept the name throughout | ✅ |
| 13 | Regenerate | `generateOutfits` refuses over an approved plan — **all of it, on one approval**. Naming four safari days after approving one dinner outfit replans nothing and answers `replanned: false` | ❌ |
| 14 | Copy a trip | Returns a proposal and writes nothing; carries the day plan as offsets, drops offsets past the shorter end, carries no packed state, outfits or forecast | ✅ |
| 15 | Preserve quantity edits | `qty_override` survives both writers. The *explanation* is still refreshed, with `quantityIsUsers` so it cannot offer arithmetic that does not produce the number beside it | ✅ |
| 16 | Preserve exclusions | `excluded_at` is honoured by both writers, in both the update and the delete path | ✅ |
| 17 | **Prevent duplicate rows** | **Fails.** A garment carrying a rule *and* used by an approved outfit grows a new row on every alternating regeneration | ❌ |

#### The four correctness gaps, in full

##### ❌ 17 — the list grows a row every time both writers run

The most serious finding, and the one the existing tests were built not to see.

Measured, on a garment with a `per_day` rule that an approved outfit also uses:

| After | Rows for that one garment |
|---|---|
| rule pass, then outfit pass | `always_packed` 24, `outfit_generated` 1 |
| another rule pass | `always_packed` 24, **`always_packed` 24** |
| another outfit pass | `always_packed` 24, `always_packed` 24, `outfit_generated` 1 |

**Two mechanisms, compounding.** `generateChecklist` keys `existingByItem` on
`item_id` across *every* source, so it picks up the row the outfit writer owns
and rewrites its `source`. `syncChecklistFromOutfits` then filters
`source = 'outfit_generated'`, sees no row it owns, and inserts a fresh one. The
list grows without bound, and Alex sees the same garment listed twice at two
different quantities.

**Why no test caught it.** Two exist and neither can. `does not duplicate rows
when generated twice` runs only `generateChecklist`. `never grows a second row
for the same garment, however many syncs run` runs only
`syncChecklistFromOutfits` — and then counts only rows with
`source = 'outfit_generated'`, so it would pass while looking straight at the
duplicate. Neither interleaves the two writers, which is the only way the defect
appears.

**Intended behaviour.** One row per item per trip. Where both writers want an
item, the **rule wins**: a per-day rule already counts the whole trip, so adding
the outfit's wearings on top would double-count the same days. `generateChecklist`
must claim only rows it owns, `syncChecklistFromOutfits` must skip an item a rule
row already covers, and the invariant belongs in a **unique index on
`(trip_id, item_id)` where `item_id IS NOT NULL`** so a third writer cannot
reintroduce it.

- **Quantity change:** the duplicate disappears; the surviving quantity is the
  rule's, which is what the row already showed.
- **User edits:** unaffected — both writers already refuse to touch an override
  or an exclusion, and the repair must keep the row carrying them.
- **Migration:** additive index, plus a one-pass repair for trips that already
  hold duplicates. **The repair must merge, not delete blindly** — if the
  duplicate carries a `qty_override`, a `packed_qty`, or an `excluded_at`, that
  row is the one to keep.
- **Data risk:** real, and the reason this is a separate reviewed slice.
- **Acceptance test:** seed a garment with a `per_day` rule and an approved outfit
  using it; run `generateChecklist` and `syncChecklistFromOutfits` alternately
  four times; assert exactly one row for that item, at the rule's quantity, and
  assert the unique index rejects a hand-inserted second row.

##### ❌ 9 and 13 — one approval freezes the whole plan

`generateOutfits` returns early if **any** group is approved. That rule is right
in spirit — doc 04 forbids replanning over a decision Alex has made — but it is
applied to the trip rather than to the group. Measured: approving *Nice dinners*
and then naming four safari days leaves `Safari ×1`. The trip screen shows
`replanned: false` and moves on.

The same early return is why a trip-length change does not reach clothing
quantities: `PUT /:id` regenerates the checklist and never asks the outfit
planner anything, and by then the planner would refuse in any case.

**Intended behaviour.** Replan the **draft and incomplete** groups; leave the
approved ones exactly as they are; and say what happened rather than answering
`false` silently — `2 outfits replanned, 1 left as you approved it` is the whole
fix on screen.

- **Quantity change:** yes, and correctly — the clothing for replanned groups
  follows the new day count.
- **User edits:** an approved outfit is never touched. That is the point of the
  split.
- **Repair:** none. Existing trips replan on their next edit.
- **Migration:** none.
- **Acceptance test:** approve one group of four, change the trip length, assert
  the approved group is byte-identical and the other three have new occurrence
  counts; assert the response names both numbers.

##### ❌ 9 — a rule that stops applying leaves its row behind

Measured: a shaver conditioned on `nights >= 3`, on a trip shortened from eleven
nights to one. `generateChecklist` recomputes, `computeQuantity` correctly
answers `null` — and the row stays on the list, because the null branch only
counts a `preserved` and moves on. There is no delete path in that function at
all.

The asymmetry is the tell: `syncChecklistFromOutfits` *does* remove a row it no
longer wants, guarded by the same "unless Alex has touched it" condition. The
two writers disagree about whether an engine-owned row that is no longer wanted
should survive, and only one of them is right.

**Intended behaviour.** Symmetry. An engine-owned row whose rule no longer
applies leaves, exactly as an outfit-owned row does — and, exactly as there,
**never** when it carries a `qty_override`, an `excluded_at`, a non-zero
`packed_qty`, or `source = 'user_added'`. Alex having already packed the thing is
the strongest possible statement that it should stay.

- **Quantity change:** none. Rows either leave or are untouched.
- **User edits:** protected by the same four conditions the outfit writer uses.
- **Migration:** none.
- **Data risk:** a delete path in the rule writer is new, which is why the
  `packed_qty > 0` guard is not optional.
- **Acceptance test:** an item conditioned on `nights >= 3` on an eleven-night
  trip; shorten to one night; assert the row is gone. Then repeat with the row
  packed, and with the row overridden, and assert it survives both.

##### ❌ 11 — an archived garment leaves the list silently and stays in the outfit

Archiving is the documented retirement path (doc 05 §11), and `outfitConflicts`
is the mechanism that keeps the plan and the list from disagreeing — but it
matches only checklist rows Alex has **set aside**, not garments that have left
the wardrobe. Measured: after archiving a garment an approved outfit uses, the
outfit slot still names it, the checklist row survives until some unrelated sync
removes it without a word, and the conflict count is `0`.

**Intended behaviour.** Archiving a garment an approved outfit stands on is
exactly the case §8 was written for: name the outfits, offer a replacement, and
mark the outfit as short of that slot until Alex answers. `outfitConflicts`
already returns the right shape and is already served with every checklist load;
it needs a second arm for `item.archived_at IS NOT NULL`, and archiving needs to
resync the affected trips rather than leaving it to chance.

- **Quantity change:** the archived garment's row leaves — as it does today, but
  at a moment Alex can see and undo.
- **User edits:** untouched.
- **Migration:** none. `archived_at` already exists.
- **Data risk:** none; the query is derived on every read.
- **Acceptance test:** approve an outfit, archive one of its garments, assert the
  conflict is reported with the outfit and slot named, assert restoring the item
  clears it, and assert a *draft* outfit's garment reports nothing — the same
  boundary the exclusion arm already holds.

#### Two things that are correct and structurally unprotected

Recorded rather than fixed, because neither is a defect today:

- **There is no unique index on `(trip_id, item_id)`.** One row per item is held
  by convention in two functions. Finding 17 is what happens when the convention
  slips.
- **`syncChecklistFromOutfits` reports `updated: 18` for a sync that changed
  nothing.** Harmless, and it makes the counts useless as evidence in a test —
  which is why every assertion above reads rows rather than counts.

#### The acceptance tests exist, and were verified to fail

Every test named above was written and run against the current code before this
audit was recorded. **Six fail, and the four guard rails pass** — which is the
point: a test that fails on the defect and a test that proves the fix did not
overreach are two different tests, and D1b needs both.

| Test | Today |
|---|---|
| does not grow a row each time the two writers alternate | ❌ `expected [ 'always_packed=24', …(4) ] to have a length of 1 but got 5` |
| holds for every garment on the list, not only the outfit-owned ones | ❌ `expected [ [ 'tee', 2 ], [ 'shoes', 2 ] ] to deeply equal []` |
| replans the drafts after the days are named, and leaves the approved one alone | ❌ `expected 1 to be 4` |
| follows a trip-length change into the clothing quantities | ❌ `expected 4 to be less than or equal to 3` |
| is reported as a conflict while an approved outfit still stands on it | ❌ `expected [] to include 'shirt'` |
| takes its row off the list | ❌ `expected [ 'Bite Guard', 'Hairspray', …(2) ] to not include 'Shaver'` |
| stops being a conflict once it is restored | ✅ passes — the fix must not break it |
| says nothing when only a draft outfit uses it | ✅ passes — the fix must not widen past approved outfits |
| leaves it alone once it has been packed | ✅ passes — the new delete path must not take it |
| leaves it alone once the quantity is Alex's | ✅ passes — same |

They are held back until **D1b**, because a docs-only slice cannot carry six
failing tests to a green merge, and skipping them would make them tests that
cannot fail — the mistake this repository has now made six times.

#### What the audit did NOT find

Worth stating, because the brief asked for verification rather than a list of
complaints. Scenarios 1–8, 12, 14–16 are correct **and covered by tests that can
fail** — the deferral, the replacement, the one-versus-several conflict naming,
the trip-only item, the override, and the exclusion each have a test that was
verified against its own defect when it was written. Readiness moves correctly
through every transition measured here (`nothing_planned` → `packing` →
`outfits` → `packing`) and is derived on every read, never stored.


### D1b — all four gaps, closed

**Nine acceptance tests, all of which failed against the code before the fix.**
The fourth gap is D1c, below, and is scoped rather than half-shipped.

#### The ownership rule, stated rather than assumed

`generateChecklist` owns rule-driven rows. `syncChecklistFromOutfits` owns
`outfit_generated` rows. **Where both want an item, the rule wins** — a per-day
rule already counts the whole trip, so adding the outfit's wearings on top would
double-count the same days.

That sentence is now enforced in three places rather than believed in two:

1. **The outfit writer reads every row with an item**, not only its own. Filtered
   to `source = 'outfit_generated'` it could not see the row the rule writer had
   taken over, so it inserted a second — and did it again on every alternating
   regeneration. It now skips an item another writer has claimed, and its delete
   loop removes only rows it wrote.
2. **The rule writer takes such a row over** rather than adding beside it, which
   preserves whatever is already packed in it.
3. **Migration 0013** merges the duplicates that exist and adds a
   `UNIQUE INDEX (trip_id, item_id) WHERE item_id IS NOT NULL`.

#### The repair is a merge, and the first draft of it was not

An earlier version of 0013 ranked the duplicates and deleted the losers. That is
a survival contest, not a merge, and it quietly discarded user state: two rows
where one is **excluded** and the other is **packed** both rank as "Alex touched
this", and deleting either loses a decision he made. They are not alternatives —
they are two facts about the same garment.

Every user-owned field is now carried onto the survivor before anything is
removed, and each resolution is stated in the file rather than implied:

| Field | Resolves | Because |
|---|---|---|
| `packed_qty` | MAX | never turn a packed item back to unpacked |
| `excluded_at` | earliest non-null | never turn an excluded item back on; the earliest stamp is when the decision was made |
| `final_checked_at` | earliest non-null | same, for the final check |
| `qty_override` | the one non-null value | the guard below proves there is at most one |
| `required_qty` | MAX | the highest generated quantity survives underneath an override, so restoring the suggestion does not drop to the weaker duplicate |
| `packing_timing` | `day_of` wins | Day-of is a deliberate placement; `last_minute` is its retired spelling and reads as the same thing |
| `source` | `user_added` wins | provenance Alex created outranks generated provenance |
| `is_critical`, `requires_final_check`, `trip_only` | MAX | lowering a flag is the only direction that can lose a warning |
| `reason_text`, `qty_breakdown_json`, `rule_snapshot_json` | first non-null, survivor first | C1 exists so no row goes silent |
| `created_at` / `updated_at` / `sort_order` | MIN / MAX / MIN | the row's true span, and its earliest position |
| `checklist_link` | re-pointed at the survivor | a foreign key must not outlive the row it names |

**There is no bag-assignment column to carry.** Bags are Release D11 and unbuilt;
when they ship, this table is the list of what a merge has to preserve.

**Which row keeps its `id`** is a separate, smaller question, decided by the
precedence Alex's own actions have: a row he added, then one whose quantity he
set, then one he set aside, then one with something in the bag, then the oldest
and lowest id. It matters only because `checklist_link` references it and because
a stable choice makes the migration idempotent.

#### And where two decisions genuinely contradict, it stops

Two rows for the same garment carrying two **different** hand-set quantities are
two explicit statements that cannot both be honoured, and no approved document
says which wins. The migration refuses: a `CHECK` on a temporary table fails the
insert when the count is anything but zero, and it runs **before a single row is
modified**. A failed migration is recoverable; a silently discarded decision is
not.

#### Tested against all five databases the brief names

| # | Database | Result |
|---|---|---|
| 1 | Clean — every migration in order | applies, and the unique index is there afterwards |
| 2 | The **previous production schema** (stood up at 0012, then migrated) | every scenario below runs on it, because that is the schema 0013 will actually meet |
| 3 | Intentionally duplicated fixture rows | 13 conflicting combinations, field by field |
| 4 | **The real 119-row workbook** through the real import endpoint, plus a real generated trip | the list is byte-identical before and after |
| 5 | Rows carrying exclusions, overrides and packed state | each asserted individually, and in combination |

**24 tests.** Three of them could not fail as first written: they put the state
under test on the row that would win selection anyway, which proves the ranking
and nothing about the merge. The survivor is now pinned by a hand-set quantity so
the state under test is always on the row that gets **deleted**. Verified by
mutation — removing the `packed_qty` merge, the guard, or the link re-pointing
each fails its own test.

#### And the first version of it did not run on D1 at all

It used `CREATE TEMP TABLE`, passed all 24 tests, and failed the moment CI stood
a real Worker up: **`not authorized: SQLITE_AUTH`.** D1 refuses temp tables.

The tests could not see it because they run the migration through `node:sqlite`,
where the whole of SQLite is available — and the *local* wrangler run could not
see it either, because the local database already had an earlier 0013 recorded as
applied, so wrangler skipped the file. Two layers of evidence, both looking
somewhere other than at the thing that would fail.

Both are closed:

- An ordinary table, dropped at the end of the migration.
- **Applied through wrangler against a genuinely clean database**, with real
  duplicates in it, and the result read back: one row surviving at
  `required_qty 24`, `qty_override 4`, `packed_qty 3` and `day_of` — three facts
  from two rows, none lost — and `{"duplicate_rows_removed":1,"items_affected":1}`
  in `preference`. That is the D1 engine, the window function, `json_object` and
  all.
- A **source-level guard** over every migration file rejects `CREATE TEMP TABLE`,
  `ATTACH`, `PRAGMA`, explicit transactions and `VACUUM`. Verified by putting the
  temp table back, which fails it.

**How many rows are merged is written down**, into `preference` under
`migration_0013_merged` as `{duplicate_rows_removed, items_affected}`, because
production cannot be inspected from the agent environment and a number the
database recorded is better evidence than a log line that scrolls.

The index is **partial** because `item_id` is NULL for everything Alex adds by
hand, and two of those on one trip is perfectly ordinary.

#### The rule writer can now remove a row

It had no delete path at all, so a shaver conditioned on `nights >= 3` stayed on
a one-night trip. It now removes an engine-owned row whose rule has stopped
applying — with four guards, the fourth of which is new and is the important
one: **anything already packed stays.** Having put the thing in the bag is the
strongest possible statement that it belongs on the list, whatever the rule now
says. `GenerationResult` gained `removed` so the count is reportable rather than
silent.

#### A garment that has left the wardrobe is now a conflict

`outfitConflicts` matched only rows Alex had *set aside*. Archiving is the
documented retirement path (doc 05 §11), so a garment could leave the wardrobe
entirely while an approved outfit went on being built around it, reported
nowhere. It now has a second arm, and carries `why` — because *"you are not
bringing it"* and *"it is no longer in your wardrobe"* are different facts and
only one is true at a time. The banner says the right one.

#### One existing test had to change, and it got stronger

`counts a trip once however many rows it has` inserted a second excluded row for
the same garment on the same trip. **Migration 0013 makes that row impossible**,
so the test now asserts the database refuses it. `COUNT(DISTINCT trip_id)` is
still what the query does; nothing can produce the state it was defending
against. A test that sets up an unreachable state proves nothing.

#### Noticed while measuring, not fixed, not hidden

`planGroups` over-plans a very short trip: two activities plus two travel days is
**four days of outfits on a three-day trip**. Measured at 3 days (total 4) and
4 days (total 4); 5 and 12 days are exact. It is the planner's arithmetic rather
than a synchronisation question, it is not one of D1's seventeen scenarios, and
it is recorded here rather than asserted in a test that would then be about
something the slice never audited.

#### Data impact

**Migration 0013 deletes rows.** It is the only migration in this project that
does, and it is doing so to end a state where Alex sees the same garment twice
at two quantities. It cannot take a row carrying an exclusion, an override, or
anything packed, because those are exactly what it sorts by. Everything else is
additive.

#### Q1 left a hole, and this slice found it by counting rows

Two consecutive full local runs each lost a **different** test to a plain
5-second timeout, and both passed in isolation and in a file-scope run. That is
the signature of a suite getting slower, not a suite that is wrong — the exact
report Q1 exists to make impossible to receive again.

Counting rows found it. The local database held **18 leftover trips and 58
leftover garments**: Q1's run-level teardown matches the shape `ownedName`
produces, and four specs named what they created with a bare timestamp instead
(`Plain words 75418`, `Sleep Mask 1785606555780`), so the teardown could not see
them. Every one of those garments is ranked for every slot of every outfit on
every subsequent run.

Three fixes, all of them the same fix:

1. **Those four specs now use `ownedName`** — `plain-words`, `polish`,
   `readiness` and `rules`. One naming function, which is what the teardown was
   always written against.
2. **The teardown retires wardrobe items too**, which it never did. **Archived,
   not deleted** — there is deliberately no DELETE endpoint for an item (doc 05
   §11), and archiving is the real retirement path: it takes the garment out of
   `listActiveCandidates`, which is the thing that was costing time. The first
   clean run retired **51** items, which is the size of the leak.
3. **The guard test enforces it.** `tests/unit/e2e-isolation.test.ts` now fails
   on a name built from a clock, and it found `rules.spec.ts` — a file the
   row-count investigation had not yet reached.

Proved the Q1 way, not by one green run: **164 passed on a cleaned database, then
164 passed again on the database that run dirtied**, 4.3 and 4.7 minutes.

#### D1b, D1c and laundry — deployed, and what migration 0013 actually did

PR #43 merged to `main` as `c83b016`; the Deploy workflow ran to success as run
`30735984768`. **Version `d211e536-4f26-4e77-8ae4-ab68e14c593d`.**

**Migration 0013 applied cleanly and repaired nothing, because there was nothing
to repair.**

| Question | Production answer |
|---|---|
| Applied? | ✅ `0013_one_row_per_item.sql`, **12 commands in 4.34 ms** |
| Duplicate rows merged | **0** |
| Items affected | **0** |
| Rows skipped | **none** — nothing matched the duplicate query at all |
| Did it abort? | **No.** The irreconcilable-quantity guard ran first and passed; all 12 commands executed |
| Unique index | created and in force |

Read back from the database itself, not inferred from "applied successfully":
`preference.migration_0013_merged` = `{"duplicate_rows_removed":0,"items_affected":0}`,
printed by the new **Record what the migrations repaired** deploy step.

**Zero is the right answer and not a disappointing one.** The defect is real —
reproduced in tests, and in a fixture built from the real workbook — but it needs
a garment carrying a packing rule that an approved outfit also uses, *and*
alternating regenerations of both writers. Alex's production database had not
reached that combination. What shipped is the guarantee that it now cannot.

**Data impact, stated exactly:** no row was deleted, no row was modified, and no
user state was touched. The only change to stored data is the new unique index.
Laundry changes nothing already stored; it changes what future plans generate,
on trips answered *yes* that run longer than four days.

**Not verified against the live endpoint.** Outbound HTTPS from the agent
environment is gated by network policy, so the deploy log and the database's own
audit row are the evidence, and both are quoted above rather than summarised.

### D1c — an approval freezes its own outfit, not the whole trip

**Done.** `generateOutfits` returned early if **any** group was approved.
Approving *Nice dinners* and then naming four safari days left `Safari ×1` for
the life of the trip, and the screen was told `replanned: false`.

The refusal was right and was applied to the wrong thing. It now applies per
group:

- **Approved groups are not deleted and not re-assigned.** The `DELETE` is scoped
  `WHERE status <> 'approved'`, which makes "his swaps are safe" a fact about the
  SQL rather than a promise in a comment.
- **Their garments are reserved while the drafts replan.** `assign` gained
  `alreadyUsed`, seeded from the approved slots — without it the same shirt would
  be planned into a second outfit past what it can be worn.
- **Their day counts follow the trip.** Doc 04 §8 asks for quantities to be
  recalculated when a trip changes, and how many days an outfit covers is not a
  choice Alex made about garments. `redistributeWearings` spreads the new count
  across the garments already in the group, per role, each taking as many days as
  its reuse capacity allows — and a group that cannot reach its new count is left
  short rather than having a garment worn past capacity.
- **A group whose activity Alex removed keeps what it had.** He approved it.
- **The route says what happened.** `replannedCount` and `keptApproved` alongside
  the boolean, because `replanned: false` could not tell "nothing to do" from
  "one approval froze everything" — which is the whole defect. No screen shows
  them yet; both callers navigate straight on, and inventing a panel for them is
  not this slice.

**One deliberate consequence.** A draft outfit can now come out differently after
an approval, because the approved outfit's garments are genuinely reserved where
before they were not. That is explainable — the shirt is in the dinner outfit —
rather than the app changing its mind, and it is the price of not freezing the
whole trip.

**One existing test changed.** `refuses to regenerate over an approved plan`
asserted the whole-trip freeze, which is the defect. The claim worth keeping was
underneath it — the approved outfit is untouched, row and garments alike — and it
is asserted more strictly now, on the id, the status and every slot.


#### D2 — deployed

`4f52b21` on `main`, Deploy run `30853441316`. **Version
`a912ed8d-7d92-45cf-addd-c01925e48487`.**

**No migration, no schema change, no stored data touched.** The order is derived
on every render and the snapshot lives in component state — the `Apply D1
migrations` step ran and had nothing to apply, and
`migration_0013_merged` still reads `{"duplicate_rows_removed":0,"items_affected":0}`
from the release before it.

### D2 — completed items move to the bottom, once the tapping stops

**The filters were already there.** `CHECKLIST_FILTERS` and `filterChecklist`
shipped with the packing list, and doc 09 §9's bag filters are explicitly
conditional on bag assignment, which is D3. So D2 is the ordering half of §4.2,
and the hard part of it is not the sort.

#### The sort is arithmetic

`orderRank` gives every row one readable number: unpacked essential, other
unpacked, left for the day, packed. `orderSection` applies it **stably**, so rows
of equal standing keep the order they arrived in and checking one thing never
reshuffles anything around it.

A packed essential ranks with the packed, not with the essentials. Keeping the
passport pinned to the top all evening after it went in the bag is the opposite
of what the section is for.

#### The steadiness is the feature

Reordering the instant a box is ticked makes the row under Alex's thumb jump away
mid-tap, and doing it four times while he works down a run of adjacent items
turns the list into a slot machine. So the order is a **snapshot**, held until
the tapping stops — `SETTLE_MS` restarts on every change, so a run settles
**once**, at the end.

§4.2 offers "a short restrained transition, or a reorder deferred until the
completion settles… if it is steadier". The deferred reorder is chosen because it
cannot be disorienting: nothing moves at all until Alex has stopped.

#### Two defects the e2e tests found, both real

1. **The first tap reordered immediately.** The snapshot was only taken after
   `SETTLE_MS`, leaving a window right after load with nothing to hold — and a
   tap in that window fell through to the live order. The test found it by
   tapping faster than the timer, which is what Alex does when he already knows
   what he is looking for. The first snapshot is now taken immediately; only
   later ones wait. There is nothing to steady on first load anyway.
2. **A row that appears twice had two positions.** A passport is under Pack later
   AND under Final check (doc 03 §8), so one flat snapshot gave it two indices
   and whichever came last won for both — which sorted a packed row into the
   *middle* of Pack now instead of the bottom. The snapshot is per section now.

#### Three existing tests were relying on the old order

Not flakes, and not fixed by rerunning: they passed on `main` and failed with D2,
in the same order on the same database. D2 sorts unpacked **essentials** to the
top, and an essential is exactly the kind of item that also appears under Final
check — so `.first()` started landing on a row that renders twice, and an
unscoped locator matched two elements.

The tests were positionally coupled to an order that has legitimately changed.
All three now scope to `Pack now` by name, which is the rule `AUTONOMY.md` §6
already states. One was comparing a count of the whole list against a count of
one section; it now compares like with like.

**169 e2e tests** pass, and 13 unit tests cover the ordering, the stability, the
Undo and the snapshot.


### D3 — which bag each thing goes in

Doc 09 §11's five: **Wearing it · Personal item · Carry-on · Checked bag ·
Either bag**. Deliberately not a luggage optimiser — the question this answers is
the one Alex has with one bag open in front of him, *does this go in here*, and a
sixth option is another decision to make rather than one fewer.

#### It belongs to the trip, not to the wardrobe

Where a passport lives is a fact about a **journey**, not about the passport: it
is in the personal item on a long-haul flight and in a hotel safe on a road trip.
Migration 0014 puts `bag` and `bag_source` on `checklist_entry`, and a test
asserts the `item` table gained no such column — because a default written onto
the catalog would carry one trip's answer onto every future one, and nothing
approved asks for reusable defaults yet. A copied trip starts unassigned, which
is the same list the duplicate route already keeps: no packed state, no outfits,
no old forecast.

#### Two columns, because "which bag" and "who decided" are different questions

`bag_source` is `recommended` or `user`, and collapsing them would lose the one
that matters. A recommendation can be improved by a better rule next release; a
choice Alex made may never be silently overwritten.

**A recommendation is never stored.** `bagFor` computes it on read, so improving
the rules improves every existing trip without a migration — and no row ever
carries a decision nobody made. `setBag` writes `bag_source = 'user'`
unconditionally, because it is only ever reached from a tap, and clearing the
choice hands the row back to the suggestion rather than freezing whatever was
suggested at the moment he changed his mind.

#### What it recommends, and what it refuses to guess

Documents, Medication, Vision and Electronics travel in the personal item, and a
critical item Pack Smart cannot categorise does too — `is_critical` is Alex's own
flag, so that is his judgement rather than an inference, and the cautious
direction is the right one: within reach costs a little space, in the hold costs
the trip.

Read from the recorded **category**. **Never from a brand or a name** — "Rolex"
is not evidence and neither is "Passport Holder" in Travel Gear, and a test pins
both. Everything else gets no suggestion at all, because a suggestion on every
row is a screen full of advice.

**Nothing is enforced.** Pack Smart has no approved hard rule, so §11's third
category is empty and says so: every recommendation is overridable, and each one
states its reason, because a recommendation that cannot explain itself is
indistinguishable from a rule.

#### Compact, because §11 asks for compact

The five choices are a **radio group in the row's existing ⋯ sheet** — exactly
one bag is true of a thing at a time, which is the test for whether radio is the
honest role. A permanent five-way control on every row of a forty-row list is the
dense dashboard the iPhone rules exist to prevent.

The row shows the answer in its existing secondary line, and **only Alex's own
choice**: a recommendation beside half the list would say nothing. The suggestion
is worth reading in the sheet, where it can explain itself, and worth acting on
in a bag filter, where it does real work.

Swipe is untouched and is not a way to assign a bag.

#### `Either` had to say which two

`Either` on its own says nothing about *which* two bags, and it has to be told
apart from **unassigned** — which is also a row with no particular bag against
it. So the label is **Either cabin bag**, the sheet adds *"the personal item or
the carry-on, whichever has room"* when it is chosen, and the row shows the
phrase in full.

The distinction is real in the data as well as on screen: `either` is a stored
choice with `bag_source = 'user'`, appears under **both** cabin-bag filters and
under neither hold filter, while an unassigned row appears under none of the
four and shows nothing. Asserted both ways.

#### The filters §9 was waiting on

Four, one per real bag. `Either bag` deliberately has none — a thing that does not
care which cabin bag it is in is not a bag you are standing over, so it appears
under **both** carry-on and personal item instead.

They read the **resolved** bag, so a recommendation Alex has not touched still
shows up under the bag it recommends; filtering the stored column alone would
hide everything he has not personally assigned, which is most of the list.

#### The preservation matrix, all of it asserted

A bag assignment that quietly evaporates is worse than none, because he will have
stopped checking by then. Proved against real SQL: packing and unpacking, Pack
day of and back, a hand-set quantity, two checklist regenerations, an exclusion
and its undo, three outfit synchronisations, and an item he added by hand. Plus:
no second row is ever created, and a new trip inherits nothing.

**27 tests** — 21 integration, 5 DOM, 6 e2e — with the recommendation logic and
the Either-bag filter both mutation-checked. One earlier test could not fail: it
looped over Documents rows in a wardrobe that has none, and passed with
`recommendBag` returning null for everything.

#### P1, P1b, P1c and S1 — deployed

| Slice | PR | Merged as | Deploy run | Version |
|---|---|---|---|---|
| **P1** (harness + docs) | #46 | `220aeb7` | `30885221829` | — |
| **P1b + P1c + S1** | #47 | `90e1d13` | `30890387166` | **`5aac8e62-b54b-431b-ab00-8d08b4aa6f72`** |

**No migration in either.** The `Apply D1 migrations` step ran and had nothing to
apply; the audit read-back reported only `migration_0013_merged` with
`{"duplicate_rows_removed":0,"items_affected":0}`, unchanged since D1b.

**No data impact.** Nothing in P1b, P1c or S1 writes, reads or reshapes a stored
row. What reached production is client rendering, one response header
(`Cache-Control: no-store` on `/api/*`), the service worker's routing order and
its ownership of its own cache deletion.

**Not verified against the live endpoint.** Outbound HTTPS from the agent
environment is gated by network policy, so the deploy log is the evidence and is
labelled as such (§5).

#### P1 — **accepted on a real iPhone, and closed**

**2026-08-04, on cellular.** Alex's result, in his words: *"definitely faster
than before… not instant, but it now feels fast and acceptable on the real
iPhone."*

| | |
|---|---|
| Initial launch | noticeably improved, acceptable |
| Home | noticeably improved |
| Trips | noticeably improved |
| First tab navigation | fast enough |
| Repeat tab navigation | fast |
| Blank-screen delay | **no longer a meaningful problem** |

This is the acceptance criterion §0 asks for and the one the automated numbers
could never be. **P1, P1b and P1c move to `complete`.**

**His ruling, which is now a standing constraint:** do not keep optimising to
chase imperceptible benchmark gains. The regression harness stays and the
security guarantees stay. **P1 reopens only on a MEASURED regression** that makes
Home or Trips noticeably slow again — which `tests/e2e/performance.spec.ts`
catches on its own, because its rung budget fails the build rather than
reporting a number nobody reads.

So the next person to touch Home, Trips, `App`'s auth state or `sessionCache`
should know: **the budget is the contract.** 2 rungs for Home, 1 for the rest.
If a change needs a rung back, that is a product decision with a real cost, not
a refactor.

#### D4 and D5 — deployed

PR #49 merged to `main` on 2026-08-04 as `c535904`; the Deploy workflow ran to
success as run `30893598298`. **Version `df7cddcc-01e7-40bc-b7b7-43efd9096c24`.**

**No migration.** The `Apply D1 migrations` step had nothing to apply — D4 reads
`bag`, `packing_timing`, `requires_final_check`, `final_checked_at` and
`is_critical`, all of which already existed. **No data impact:** the departure
screen writes only what the packing list already writes, through the same
`PATCH /api/trips/:id/checklist/:entryId`.

**Phone verification pending**, and it is the session §6 describes.

#### D3 — deployed

PR #45 merged to `main` on 2026-08-03 as `1cc072f`; the Deploy workflow ran to
success as run `30857458999`. **Version `bffdc3c6-234c-4d4b-b138-804525c407b6`.**

**Migration 0014 applied, and it is additive.** Two nullable columns on
`checklist_entry` — `bag` and `bag_source`, each with a `CHECK` constraint — and
`idx_checklist_bag`. **No data impact:** nothing is rewritten, nothing is
deleted, and every pre-existing row reads as "not assigned", which is what it
is. The migration audit read-back reported only `migration_0013_merged` with
`{"duplicate_rows_removed":0,"items_affected":0}` — 0014 repairs nothing, so it
writes no audit row.

### P1 — measured, and then measured again, because the first harness lied

Alex reports Home and Trips feel slow. Before this, the working theory — mine,
stated as a guess and labelled as one — was readiness being recomputed for every
trip on the list. **It is not.** Nothing in the database is slow: server
responses are 9–33 ms.

`tests/e2e/performance.spec.ts` loads all four screens the same way. My Stuff
and Settings are the control: comparable data, not reported as slow.

#### The harness was wrong three times, and each one is worth keeping

**It measured Settings twice and called one of them Home.** The first version
navigated to `/settings` as its neutral screen before each measurement. That
writes `pack-smart:last-route`, and `App` resumes the stored tab when the app
opens at `/` — so `goto('/')` bounced straight back to Settings. The recorded
`Home: 1 request, chain 1` was a photograph of the wrong screen, and it is the
reason the first conclusion filed here said Home was already the fastest screen
in the app. `about:blank` is the neutral screen now: it kills the page, which is
all the neutral step was ever for, and it writes nothing.

**It measured Home on a database with no trips.** Home's waterfall only exists
when there is a trip to feature. The spec creates its own.

**It called the skeleton "first content".** Every screen renders its
`<Screen title>` while still loading, so waiting for the heading timed the empty
frame. Each screen now names a locator that cannot exist until real data is on
it, and the frame is reported separately as `paint`.

#### What is actually true

| Screen | Requests | Serial chain | Frame | **Answer** |
|---|---|---|---|---|
| **Home** | 4 | **3** | 119 ms | **248 ms** |
| **Trips** | 2 | **2** | 132 ms | 148 ms |
| My Stuff | 2 | **2** | 121 ms | 203 ms |
| Settings | 1 | 1 | 137 ms | 142 ms |

Two separate costs, and the two screens Alex named are the two that pay both.

**One: `App` renders nothing until the session check answers.** Not a splash — a
blank `<div aria-busy>`. No route is mounted, so no route can ask for its data,
so `/api/auth/session` is a serial round trip in front of **every** navigation
and every launch. On the container's loopback that is 30 ms; on hotel wifi it is
the whole difference between a screen that opens and one that thinks about it.

**Two: Home cannot ask for a checklist until `/api/trips` has told it which
trip.** `session → trips → (checklist ‖ outfits)` — three rungs, the deepest in
the app, on the screen the app opens on. That is why Home is on Alex's list at
all, and the first harness hid it completely.

Trips pays only the first cost, which matches "Home and Trips, and Home worse".

The `settled` figure of ~600 ms is Playwright's `networkidle` quiet window, not
work — recorded here so it is not later mistaken for one.

#### What the budget asserts, and what it does not

The harness asserts **shape, not milliseconds** — a CI runner's absolute timings
are not reproducible, and how many round trips a screen needs is what actually
decides whether it feels immediate. The budget is set at what was measured — **3
for Home, 2 for the rest** — so it holds the line rather than flattering the
current code. It also asserts that no screen requests the same thing twice.

#### P1b — scoped, not started

Two changes, and the harness is the acceptance test for both:

1. **The session check must stop gating the render.** A device that has unlocked
   before can mount the shell and issue its data request immediately, with the
   session check running beside it rather than in front of it. The server is
   still the authority — every guarded endpoint 401s on a bad session and the
   401 handler already drops straight to Unlock — so this changes what is
   *rendered* early, never what is *authorised*.
2. **Home must stop discovering its trip before it can ask about it.**

Budget after: **2 for Home, 1 for the rest.**

**Deliberately not attempted here.** Auth is the one thing in Pack Smart where a
clever change is a security change, and it deserves its own slice rather than the
tail end of a performance measurement.

### P1b — the session check runs beside the screen, not in front of it

`App` held a three-state `AuthState` that started at `checking` and rendered
`<div aria-busy>` — nothing — until `/api/auth/session` answered. No route was
mounted, so no route could ask for its data. That is the rung P1 measured in
front of all four screens.

It now starts at `unlocked` when `hasUnlockedBefore()` is true. One line. The
session check still runs, still on every launch, and is still what decides —
it just decides *beside* the first screen's request instead of ahead of it.

| Screen | Chain before | Chain after | Answer before | Answer after |
|---|---|---|---|---|
| **Home** | 3 | **2** | 248 ms | 228 ms |
| **Trips** | 2 | **1** | 148 ms | 121 ms |
| My Stuff | 2 | **1** | 203 ms | 131 ms |
| Settings | 1 | 1 | 142 ms | 121 ms |

The millisecond columns are loopback and understate it badly: what was removed
is a whole round trip, which on the container costs 30 ms and on hotel wifi
costs whatever the wifi costs. The rung count is the honest number. **The blank
frame is gone as well** — the screen Alex sees first is now the app.

#### Why this and not the bootstrap

The design considered first — and implemented on `claude/p1b-bootstrap`, which
is retired unmerged — was for `/api/auth/session` to return the Trips list
alongside an authenticated yes. It was competent work and it is the wrong shape:

- it keeps the blank frame, which is half of what Alex is describing;
- it helps Trips and Home, and **not** My Stuff, which pays the same rung;
- it changes the response of the one endpoint that is reachable without a
  session, which means new reasoning about what may cross that boundary, in
  exchange for less.

Taking the check off the critical path needs no server change at all. The auth
response is byte-identical to what it was.

#### What is optimistic, and what is not

`hasUnlockedBefore()` is a localStorage flag that already existed and that the
offline path already trusted for this exact purpose. It is not a credential, it
carries no session, and the server has never seen it.

- Every `/api/*` route is still behind `requireSession`. What is on screen
  during the optimistic window is the frame — a title and the nav — because
  data can only arrive from a request the server chose to answer.
- A bad or expired session answers **401**; the existing handler forgets the
  device and drops to Unlock. The session check answering `false` does the same
  a beat earlier. Both are tested with the session check deliberately hung, so
  the 401 has to carry it alone.
- Signing out clears the flag, so a signed-out device is back to `checking` and
  cannot take this path.
- A device that has **never** unlocked still waits and still sees the blank
  frame. Guessing Unlock for it would flash the passphrase screen at someone
  whose cookie is valid and whose flag WebKit happened to evict (risk R7).

An e2e test drives the real built Worker with the flag set and no cookie: the
trip exists on the server, and the only thing that reaches the screen is Unlock
— before, after a reload, and after Back.

#### One thing that was wrong before this slice, and is fixed with it

**Signing out did not delete the cached trip.** `public/sw.js` caches every
successful `GET /api/*` so the packing list is readable on a plane, and nothing
ever removed it — the wardrobe, the itinerary and the checklist stayed on the
device after Alex signed out. Not an exposure, because the app shows Unlock and
the endpoints answer 401, but private data outliving the session that owned it.

`clearPrivateCaches()` now runs on sign-out, on a `false` session answer, and on
any 401. It matches `pack-smart-data-` **by prefix**, so a `VERSION` bump cannot
strand a generation. The **shell** cache is deliberately kept: it is
`index.html` and the hashed JavaScript, identical for every visitor, and
deleting it would leave a signed-out phone with no signal unable to reach even
the Unlock screen.

#### Tests

**4 DOM, 4 unit, 3 e2e, plus the lowered budget.** Mutation-checked: restoring
`useState<AuthState>('checking')` fails three of the four DOM tests, including
both that assert the drop to Unlock — with the gate back, the route never mounts,
so neither the request nor the 401 that ends the optimism ever happens.

### P1c — Home paints what it knows, and a tab remembers what it saw

Two changes on the same complaint. P1b removed the rung in front of every
screen; this removes the two remaining reasons Home and Trips feel slow.

#### Home held the whole screen back for its second round trip

`if (loading) return <Screen title="Pack Smart" />`, with `loading` set false
only after the checklist and outfits had landed. So Home knew which trip Alex
was on — name, emoji, dates, the whole card — a full round trip before it
showed him anything at all.

It now paints in two stages, because they are two round trips apart:

| | after | shows |
|---|---|---|
| **stage 1** | `/api/trips` | the featured trip, the other trips, the recent ones |
| **stage 2** | `+ checklist ‖ outfits` | the countdown, the progress bar, the recommended action |

`useful=` in the harness is stage one and `content=` is stage two, and an
assertion says the first is never later than the second — because the obvious
"fix" for a countdown that appears late is to hold the card back again.

**The recommended action is inert while it waits, not mislabelled.** The old
code rendered `ready?.next?.label ?? 'Packing list'` immediately, so for the
first hundred milliseconds the primary button said *Packing list* — and a tap
in that window went to the packing list when the recommendation was *Review 2
outfits*. It is now present, sized, disabled and `aria-busy` until it knows.

**Nothing moves when stage two lands.** The countdown line, the progress bar,
its label and the sentence under the button all hold their exact place while
they wait. The placeholders take their height from a `\00a0` in `::before`
rather than a hand-tuned `em` — the first attempt guessed `0.8em`, was 20 px
short across the card, and pushed `Also coming up` down the screen at the
moment Alex was looking at it. Captured as `home-partial` at every width, in
both appearances, so a future change to that state is reviewed rather than
discovered.

#### Every tab refetched everything, every time

Each route loads in a mount effect, so Home → Trips → Home cost the full
waterfall three times — beside an open suitcase, one-handed, repeatedly.

`sessionCache.ts` is a `Map` in the page's heap. A screen that has been open
once this session paints its last answer immediately and refreshes behind it.

- **In memory only.** Not `localStorage`, not IndexedDB, not the Cache API.
  It dies with the page, which makes "private data must not outlive the
  session" true by construction rather than by remembering to tidy up.
- **Stale is shown, never trusted.** No request is ever skipped. The worst case
  is one paint of data a few seconds old, replaced before Alex has read it.
- **Any write empties all of it.** `apiFetch` clears the store on every non-GET,
  before the request goes out — a `PATCH` that times out may still have been
  applied. Deliberately blunt: a per-key invalidation map is a second model of
  what depends on what, and getting it subtly wrong shows Alex a trip he just
  deleted.
- Cleared on sign-out, on a `false` session answer, and on any 401, next to the
  two clears P1b added.

#### Two tests that could not fail, and what was wrong with them

Both were written, both passed, and both passed with the code they tested
deleted. The reason is the same one `tests/visual/screens.spec.ts` records
against its own `-empty` captures:

**`page.route` does not intercept a request a service worker makes.** With
`sw.js` running, a route handler on `/api/*` sees nothing — the worker's own
`fetch` goes straight to the network. The repeat-navigation test held every API
request and asserted the screen painted anyway; the requests were never held,
the data arrived normally, and it passed with the cache gone. It runs under
`test.use({ serviceWorkers: 'block' })` now.

**Aborting is not the same as holding.** The first version aborted the requests
instead. `sw.js` falls back to its own on-disk cache when a request *fails*, so
the screen painted from the service worker rather than from memory. A held
request never fails and never answers, so nothing but the in-memory snapshot
can put a trip on screen.

**And `.trip-item` was the wrong marker**: Home renders the same rows under
`Also coming up`, so a Trips screen that painted nothing would still have
satisfied it from the tab before. Each assertion now names a marker that exists
on one screen only.

Both fail correctly now — deleting the Trips seeding fails the e2e, and
neutering the write-invalidation fails 7 of the 11 unit tests.

#### What it measures at, on a network that behaves like a network

The harness holds every API response for **250ms** now. Two reasons, and the
second turned out to matter more than the first.

The first is that the rung count has to be a fact rather than an inference. It
compared each request's start against the previous one's finish, which is
causally the right question and on a loopback is decided by about **five
milliseconds** — it read correctly for weeks and then failed in a full parallel
run, which is the worst way for a gate to be wrong. With a fixed 250ms in front
of every answer, requests on one rung start together and the next rung is a
quarter of a second later; the boundary is drawn at half the delay, so the
margin is 125ms instead of 5.

The second is that **the loopback numbers were never the interesting ones.**
30ms round trips understate the whole problem. Held at 250ms, the same four
screens, before and after, measured identically:

| Screen | Rungs | Frame | Answer | | Rungs | Frame | Answer |
|---|---|---|---|---|---|---|---|
| | *before* | | | | *after* | | |
| **Home** | 3 | 378 ms | 1187 ms | → | **2** | **84 ms** | **674 ms**, trip name at **378 ms** |
| **Trips** | 2 | 356 ms | 659 ms | → | **1** | **74 ms** | **370 ms** |
| My Stuff | 2 | 358 ms | 657 ms | → | **1** | 78 ms | **380 ms** |
| Settings | 1 | 362 ms | 367 ms | → | 1 | 93 ms | **98 ms** |

- **The blank frame is gone.** 378ms of nothing at all before any screen drew
  anything, down to 84ms — and what appears at 84ms is the app, not a splash.
- **Home's first useful answer — which trip you are on — moved from 1187ms to
  378ms.** It was the last thing on the screen and it is now the first.
- **Every screen answers in roughly half the time**, and Settings, which reads
  no data at all, is nearly instant instead of paying a round trip for a
  question it never asked.

"Before" is not an estimate: `App`'s optimistic mount and Home's two stages were
reverted, the same harness run, the numbers recorded, and the reverts undone.

Repeat navigation is bounded by React rather than by the network, which no
number here shows because the requests are held indefinitely for that test —
the screen paints anyway or the test fails.

**11 unit tests, 2 e2e, 1 visual capture.**

### S1 — what an adversarial read of P1b and P1c found

The two slices above were reviewed specifically for ways the optimistic mount or
either cache could put protected data on screen. **The core claim held**: on a
cold start the in-memory `Map` is empty, the service worker only serves from
disk when a request *fails*, and a dead cookie on a working network gives an
empty frame, a 401 and Unlock. Five things around it did not hold, and all five
are fixed here.

#### 1. A sign-out that failed was reported as a sign-out — and it was the worse half that survived

`signOut` did its local cleanup in a `finally`: whatever the request did, forget
the device, empty both caches, drop to Unlock. **The session is a cookie the
server clears.** A POST that never arrived — on a plane, behind a captive portal
— leaves it valid and verifying, so the next launch with signal answers
`authenticated: true` and walks straight back in.

Written down, the trade is obvious: what ended was Alex's packing list on the
plane, because `clearPrivateCaches()` had just deleted it. What survived was
the credential.

It now says so, and stays signed in: *"Could not sign out — Pack Smart could not
reach the server. You are still signed in."* Nothing local is discarded, so the
offline copy is still there for the flight.

**The stateless token is recorded in §5a, not fixed here.** Sessions are an HMAC
with a one-year TTL and no server-side store, so no sign-out can revoke a token
already issued. The recovery path is rotating `SESSION_SECRET`, which is what
Alex would do for a lost phone anyway.

#### 2. A second tab kept the app open, and — after P1c — kept repainting it

`forgetSessionCache()` clears the `Map` of the tab it runs in. Nothing listened
for a sign-out in another one, so tab B kept `auth === 'unlocked'` **and** a
populated snapshot: tapping between its tabs repainted the whole trip list from
memory with no request having succeeded. Before P1c a remounted route started
empty and showed nothing until a request answered, which is the property P1b's
own reasoning depends on.

It usually corrected itself within a round trip when the refetch 401'd — but not
offline, where `sw.js` turns a failed request into a **503**, which is not a 401
and does not end a session. Tab B would sit in the signed-in shell showing
snapshots of a session that was over.

A `storage` listener on `pack-smart:unlocked-before` now runs the same lock path.
Only the *removal* is acted on: a `newValue` of `"1"` is another tab signing in.

#### 3. Four copies of "end the session", and one of them could be undone

A 401, a `false` session answer, Sign out, and now another tab all mean the same
thing, and each had its own copy of the cleanup list. They are one `lock()`.

It also closes a race the copies hid: a session check already in flight answers
`authenticated: true` — because it was *asked* before the sign-out — and
`setAuth('unlocked')` on that answer put Alex back inside a beat later. `lock()`
latches a ref that `checkSession` reads **after** its await. Unlocking clears the
latch, so a genuine new session still works.

#### 4. The page could not win the race it was trying to run

`handleApiRead` does not await its `cache.put` — making every read wait on a disk
write would be worse than the problem — so a GET issued a moment before sign-out
can resolve a moment after `clearPrivateCaches()` deletes. And **`caches.open`
on a name that has just been deleted creates it again**, so the response would be
written back into a cache nothing would clear until the next sign-out. Reachable
from Settings itself: open `Your usual amounts`, close it, tap Sign out.

The worker owns the deletion now. It bumps an **epoch** first, so everything
already in the air is excluded before a single key is deleted, then waits for the
writes that had already begun. The page asks over a `MessageChannel` and falls
back to deleting directly — correctly — when no worker controls it, or after two
seconds if one never answers.

#### 5. The backup export could have been cached as the app shell

`Download a backup` is `<a href="/api/settings/export" download>`, and the fetch
handler checked `request.mode === 'navigate'` **before** the `/api/` prefix.
Chromium dispatches that download as a navigation, which meant `handleNavigation`
— which caches what it gets under `'/'` in the **SHELL** cache. The complete data
dump, every trip and every medication name, stored under the key the worker
serves as the app shell offline, in the one cache `clearPrivateCaches()`
deliberately spares.

WebKit historically does not dispatch `fetch` for `<a download>`, so on the
primary target this may never have fired. The ordering is wrong regardless, and
it is now `/api/` first with the export routed straight to the network. A
source-level test asserts the order, because no behavioural test in this
repository would notice it and WebKit could not demonstrate it.

#### 6. Nothing told the browser not to keep an API answer of its own

No `Cache-Control` on any response. The browser's HTTP disk cache is the one
private-data store on the device that sign-out has no mechanism to reach —
`clearPrivateCaches()` enumerates Cache Storage and nothing else. `no-store` on
`/api/*`, asserted against the built Worker.

**5 unit tests for sign-out, 2 for the cross-tab lock, 3 for the worker-owned
clear, 4 source-level for the worker's routing, 1 e2e for the header.**
Mutation-checked: removing the `storage` listener fails the cross-tab test, and
so does removing the in-flight latch.

### D4 — the morning you leave

Doc 09 §12. `Before you go`, at `/trips/:id/day-of`.

Everything else in Pack Smart answers *what am I taking*. This answers a much
narrower question, asked in a hallway with a coat half on: **what is still not
in the bag, and what do I put on.**

So it is deliberately **not the packing list with a filter over it**. The
`Pack day of` filter already exists on the trip screen and still leaves Alex a
forty-row screen to read. The point of a departure view is that there is almost
nothing to read.

#### Three questions, in the order they are answered

| Section | What is in it | The act |
|---|---|---|
| **Wearing it** | resolved bag is `wear` | put it on |
| **Grab these now** | not packed, and either `Pack day of` **or** needs a final check | put it in the bag |
| **Check it is really in there** | packed, needs a final check, not yet confirmed | look |

Then a count of everything else still unpacked, **as a number and not as rows**
— with the essentials among them named, because "9 things still to pack" and
"9 things still to pack, one of which is your medication" are different
sentences and only one of them is worth reading at the door.

`shared/day-of.ts` is pure and total: any checklist produces a valid plan, and
a finished one produces an empty screen, which is the answer.

#### Every row appears exactly once, and that is a departure from the trip screen

`groupChecklist` deliberately shows a final-check row in **two** sections at
once, because there it answers two different questions about a bag. Here there
is one bag and one morning, and a screen whose whole purpose is to empty out
cannot have rows that reappear somewhere else on it. So `wear` wins outright,
and an unpacked final-check row is in `Grab` rather than in both.

The two ticks are **different columns**, which is the reason
`requires_final_check` exists at all: `Grab` writes `packed_qty`, `Check` writes
`final_checked_at`. Confirming has been reachable only from the row's ⋯ sheet
until now — on the one morning it matters, it is the section heading.

#### A recommendation counts here, and the packing list's rule is inverted

The checklist shows only Alex's **own** bag choices, because a suggestion beside
half of forty rows says nothing. On the morning, *what am I wearing* and *where
does this go* are the questions, so `bagFor` — recommendation included — is what
this screen reads.

**Said once per section, not once per row.** The first build put the bag on every
row and half the screen read `Personal item · Personal item · Personal item`.
That is UX-04 again, and it matters more here than anywhere: the section hint
carries it when every row agrees, and the per-row chips come back only when they
genuinely differ.

#### No ⋯ and no left-swipe tray

Quantities, timing, bags and Not bringing are packing-night decisions. On the
morning the only verb is tick, and a row offering four other things to do is
four things to think about in the one place there is no time to think. Rows are
**56px**, above the 44 the rest of the app clears, because this one is tapped
standing up with a bag in the other hand. The right-swipe still packs, so the
gesture is the same gesture.

#### When it is offered

`isDepartureImminent` — **the day itself and the day before**, and never once the
trip has started. Two whole days because a trip that leaves at six in the
morning is packed the night before, and a screen that only appears on the day
appears after the moment it was for. The same function decides the trip screen's
button and the readiness model's recommendation, so the two cannot start
disagreeing about when "before you go" begins.

It also closed a hole in `readiness`: a trip could reach `ready` — *"Ready to
go"* — with a coat still on its hook, because `isPacked` on a `wear` row means
"I have it on" and nothing else looked at it.

#### No schema change

`bag`, `packing_timing`, `requires_final_check`, `final_checked_at` and
`is_critical` all already exist. **No migration.**

**21 unit tests, 5 e2e, 2 visual captures** (`day-of`, `trip-leaving-today`).
Mutation-checked three ways: letting `wear` fall through fails four, dropping
the leftovers from `remaining` fails one, and narrowing the window to the day
itself fails one.

### D5 — the half of the rename that was still the old wording

Doc 09 §4.3 asks for `Unique item for this trip` **consistently in forms,
sheets, buttons, labels, helper text, accessibility labels, tests and docs**.

The field had it. Its accessible name had it. The **button that opens the field**
still read `Add something to this trip` — so the control and the thing it opened
disagreed, which is the exact inconsistency §4.3 exists to remove, and a grep of
the source for the old string would have called the rename finished.

`Add a unique item`. Short enough not to wrap at 360px, and it matches the field
rather than restating it.

The rename is not a wording preference. `Something for this trip` said nothing
about the one thing that distinguishes this row from everything else on the
list: it belongs to this trip alone and never enters the wardrobe — a corkscrew
for one rental, a costume for one evening. That is the whole difference between
it and the Add in My Stuff.

**No database field or API renamed**, as §4.3 requires. `trip_only` and
`tripOnly` are untouched.

**2 e2e.** One asserts the button, the accessible name, the placeholder and the
helper text agree — a test rather than a grep, because a control whose visible
label and accessible name disagree is precisely the half-rename a grep calls
done. The other follows a hand-added row to its sheet, where
`You added this for this trip` is the same distinction in Alex's register.

**Why the explanation is in the sheet and not on the row:** the secondary line
carries the facts that change what to do — how many, which bag, the arithmetic.
A hand-added row has none of them, and "you added this" under every row Alex
typed is the product telling him something he did thirty seconds ago.

---

### E1 and E2 — accepted on a real iPhone, 2026-08-04

One consolidated session, both slices. **Alex's result:** *"Everything looked
good and behaved correctly… the screen no longer felt like a dead end."*

| Today (E1) | |
|---|---|
| Date and destination | clear |
| Activity summary | clear |
| Outfit | easy to understand |
| Carry reminders | useful |
| Layout on iPhone | good |
| **The dead-end feeling** | **gone** |

| Unresolved recovery (E1) | |
|---|---|
| Unresolved slots explained | clearly |
| Recovery actions | made sense |
| `It is in my bag` | worked correctly |
| **The approved outfit** | **unchanged** |

| Weather (E2) | |
|---|---|
| Weather labelling | clear |
| Live / stale / seasonal / unavailable | understandable which was showing |
| Conflict messaging and actions | made sense |
| Anything confusing or incorrect | **none** |

Two rows carry the weight. *The dead-end feeling is gone* is what E1 existed
for — the screen it replaced printed four identical `No suitable packed X found.`
sentences with nothing to tap. And *understandable which was showing* is E2's
whole first half: `54–75°F` is true in three of those states and means something
different in each, and a phone is the only place that judgement counts.

**E1 and E2 are closed.** The full record is in
`technical-docs/08_MANUAL_IPHONE_CHECKLIST.md`.

---

### F1 — audited before building, and half of it was already deployed

**Read this before starting F1.** The *learning* half exists, is wired to a
screen, and is evidence-gated. What does not exist is the *review* — the short
set of questions after a trip.

#### What is already there

`shared/learning.ts`, `worker/repos/learning.ts`, and the
`What Pack Smart has learned` group in Settings. Two proposal kinds, both
derived from evidence Alex never has to type:

| Proposal | Evidence | Threshold |
|---|---|---|
| **Removal** | `checklist_entry.excluded_at` across distinct trips | 3 trips |
| **Unworn** | packed on a completed trip with **no** `wear_log` row for it | 3 trips |

Both already obey the rules F1 asks for:

- **Nothing is stored.** `preference_change_suggestion` exists (migration 0004)
  and is deliberately left unused — a stored suggestion can go stale against the
  history that produced it, a derived one cannot.
- **Nothing is applied silently.** A proposal states what was seen and what
  accepting would do, in Alex's words, and accepting is a separate tap.
- **A critical item's only rule is never disabled**, because that would leave it
  unable to reach any list (doc 02 §9c).
- **Three trips, not two.** Two is a coincidence; a swimsuit removed from two
  winter trips says nothing about the summer. One threshold, not two, because
  two numbers to reason about would be one too many.
- **The unworn query is already evidence-gated** on
  `EXISTS (SELECT 1 FROM wear_log WHERE trip_id = ...)` — which is exactly §4's
  "blocked where During Trip was never used". Without it, a trip where Today was
  never opened would make every packed item look unworn and propose disabling
  the whole wardrobe.

#### What F1 still has to build

The review itself. The brief's questions, and what each is actually worth:

| Question | Status |
|---|---|
| What did you pack but never use? | **Already answered passively.** Do not ask what the wear log can observe |
| What did you forget? | **New.** Nothing on the list can record this; only Alex knows |
| Did you run out of anything? | **New.** A quantity that was too low |
| Was a quantity clearly too high? | **New.** Distinct from "never used" — three of five shirts worn is not an unworn shirt |
| Was an outfit recommendation wrong? | **New** |
| Was something missing from Today or Before you go? | **New** |

The shape is already set by the two existing proposals, and F1 should reuse it
rather than invent a second one: an observation in plain words, an effect stated
before it happens, and an explicit accept. **Explicit user choices outrank
inferred learning** — a trip override, a `user` rule, or an accepted preference
must never be rewritten by a proposal, only proposed against.

#### The second half of the audit — measured 2026-08-04, before any F1 code

Everything below was read out of the repository, not assumed. The baseline it
was measured against: `origin/main = 2a58d0a`, `npm run verify` **1206 passing**.

**Where the review is reached from.** `readiness()` already has a `finished`
stage and it returns `next: null` — the one stage in the model with no
recommended action. That is the hole F1 fills: a finished trip's next action is
its review, and once the review is done it goes back to `null`. No new screen
has to decide when to offer it, because the model that every other screen
already reads decides.

**Why a `reviewed_at` column, and why the answers are stored.** The two existing
proposals are DERIVED and deliberately store nothing, and that reasoning holds
for anything the app can observe. It does not hold here. *What did you forget*
cannot be re-derived from anything — it is the one class of evidence that exists
only because Alex typed it — and a review where he answers nothing is a
completed review that leaves no rows behind. So F1 stores two things and no
more: the **answers** (evidence, not proposals) and **`trip.reviewed_at`**
(whether the sitting happened). The proposals themselves stay derived, from the
answers plus the live rule state, exactly like the existing two.

**Migration 0016 is additive.** One nullable column on `trip` and one new table.
No row is rewritten, nothing is dropped, and a database at 0015 upgrades by
adding two objects. `preference_change_suggestion` stays unused for the reason
already recorded — a stored proposal goes stale against the evidence that
produced it.

**What each answer proposes, and why that mechanism.** Every proposal reuses a
rule kind the engine already folds and Packing rules can already reverse. None
of them invents a second learning architecture:

| Answer | Proposal | Mechanism | Why not something else |
|---|---|---|---|
| Forgot **X** | *Always pack X* | `fixed_per_trip` 1, `source = 'learned'` | A floor since A4b, so it combines rather than replacing a quantity |
| Ran out of **X** | *Pack one spare X* | `spare` +1, `learned` | Scales correctly. A `minimum` of 8 socks would also apply to a weekend; a spare is one more than whatever the trip already worked out |
| Too many **X** | *One step down* | Edits the deciding rule — `per_day`/`per_night`/`duration_plus_buffer` multiplier −1, `fixed_per_trip` −1, or one spare removed | The step follows the rule that produced the number, so a 12-day trip's correction stays a 12-day trip's correction |
| Outfit **G** was wrong | *Stop putting these together* | The existing `forget-pairings` — `forgetGroup` is already the exact inverse of `rememberGroup` | The approval and its lasting effect are already separable (doc 04 §5). The trip's own outfit is not touched |
| Missing from Today / Before you go | Nothing | Recorded and shown back | Honest. There is no rule that expresses "the screen should have said something", and manufacturing one would be the fake-confidence failure doc 06 §3 rules out |

**Where a proposal has to refuse.** Three cases, all of them found by reading
the engine rather than by guessing:

1. **Nothing smaller to change.** *Too many* on an item already at 1 per day
   with no spare has no step down. The review says so — it does not invent a
   `maximum`, which would cap a 30-day trip at a 3-day trip's number.
2. **It was not forgotten, it was removed.** *Forgot X* where X was on the list
   and `excluded_at` is set is a different fact, and the review says which.
   Proposing *always pack X* against a deliberate removal would be the app
   arguing with a decision Alex already made.
3. **Already true.** A spare that already exists at the proposed level, or a
   rule already disabled, produces no proposal at all. This is what stops the
   same answer resurfacing on the next trip.

**Precedence, stated as the rule the code implements.** A proposal may READ any
rule and may only WRITE a `learned` one. Where the deciding rule is `source =
'user'` — something Alex wrote in *Your usual amounts* or *Packing rules* — the
proposal is shown with the conflict named (*"You set this yourself: 3 a day"*)
and accepting is a separate, deliberate act that is described before it happens.
Nothing about a `user` rule changes without that tap. Trip-level overrides are
never touched at all: this trip is over, and its record is what it is.

**Rejection is recorded; the existing two proposals do not need it and this one
does.** A derived proposal that Alex ignores simply reappears when the evidence
does, which is correct for evidence that accumulates. An answer he typed does
not accumulate — declining it once has to be final, or the review would ask
about the same sentence for ever. Hence `resolution` on the answer row:
`pending`, `accepted`, `declined`.

**What the review must not do**, each with the thing in the repository that
makes it possible to get wrong:

- **Not ask what the wear log observes.** `pendingUnwornProposals` already
  answers *packed but never worn*, already gated on the trip having a
  `wear_log`. The review shows that as an observation and never as a question.
- **Not block.** Completion is derived from dates (`tripStatusOn`); nothing in
  F1 gates it. `Finish` writes `reviewed_at` and that is all it does.
- **Not require an answer.** Every question is optional and the finish action is
  always available, including on the first frame.
- **Not show a score.** No confidence, no model words (doc 01 §4).

**API shape.** One resource under the trip, five verbs, mounted the way
`todayRoutes` is: `GET /api/trips/:id/review`, `POST …/review/answers`,
`PATCH …/review/answers/:answerId` (`accepted` | `declined`),
`DELETE …/review/answers/:answerId` (undo a mis-tap before finishing), and
`POST …/review/finish`. Accept and decline are one endpoint rather than two
because they are one decision with two values.

**Performance.** The review is a new screen, so it is bound by the same contract
as every other non-Home screen in `tests/e2e/performance.spec.ts`: **one serial
round trip**. Everything the screen needs comes back from the single `GET`.

#### What was built, and what the audit got wrong

The audit held, with two corrections and one defect found by looking rather than
by testing.

**Delivered.** `shared/review.ts` (the model, pure), `worker/repos/review.ts`,
`worker/routes/review.ts` mounted at `/api/trips/:id/review`, `src/routes/Review.tsx`
at `/trips/:id/review`, and **migration 0016** — `trip.reviewed_at` plus
`trip_review_answer`. Both additive; no row is rewritten.

**Correction 1 — `deleteTrip` did not know about the new table.** A trip Alex
had reviewed **could not be deleted at all**: `trip_review_answer` references
`outfit_group` and `item`, SQLite refused the batch, and `Delete for good` would
have answered 404 with the trip still on screen. This is the `daily_plan` bug of
Q1, one slice later, and it was found the same way — the F1 e2e teardown could
not remove the trips its own specs had reviewed. Fixed, and pinned by
`trip-lifecycle.test.ts` *deletes a trip that has been reviewed*.

**Correction 2 — a CSS class collision that every gate passed.**
`OutfitReview.css` already owns `.review-actions`; the guided outfit walkthrough
is "the review" in that file's vocabulary. This screen shipped with the same
name, inherited `flex-direction: column`, and stacked its two decision buttons
where they should have sat side by side. The e2e suite asserts on roles and
names, and the visual gates measure geometry rather than layout intent, so all
34 visual tests passed with an empty report. **It was caught by opening the
screenshot.** Renamed to `trip-review-`, with the reasoning in `Review.css`.

**What the audit had right, and is worth keeping written down:**

- the `finished` stage was the right place for the entry point, and
  `reviewedAt` was the right gate — the review is offered once;
- `spare` was the right mechanism for *ran out*; the correction stays
  proportional on a weekend and on a fortnight;
- refusing to propose anything for *too many* on an item already at its
  smallest is a real branch, reached by the seeded wardrobe rather than by a
  contrived test;
- the review is reachable **only** from the trip screen, because Home features
  the trip Alex is working on and that is never a finished one.

**Test state.** `npm run verify` **1206 → 1263**. e2e **214 → 226**, zero flaky
across the run. Visual **33 → 34**, report empty. New: `review.test.ts` (28
model), `integration/review.test.ts` (17 against real SQL),
`migration-0016.test.ts` (9), plus the readiness and lifecycle rows above.

**Every claim proved against its defect** — ten mutations, each failing exactly
the test that names it:

| Mutation | Test that caught it |
|---|---|
| `trip_review_answer` dropped from the delete list | deletes a trip that has been reviewed |
| the wear-log gate removed from the summary | says nobody was watching rather than claiming nothing was worn |
| *forgot* stops refusing a deliberate removal | refuses to propose against something he removed himself |
| *too many* caps an item already at its smallest | proposes nothing rather than capping |
| a `user` rule changed without naming the conflict | names the conflict rather than changing it silently |
| the learned rule written as `user` | writes the new rule as learned |
| a seeded default written over instead of superseded | never writes over a seeded default |
| the review offered again after it is done | says nothing more once the review has been done |
| the answer's subject not carried through | carries the subject through |
| an accepted answer made deletable | refuses to remove one that has already been used |
| a question added that the wear log already answers | never asks what it can already see (e2e) |

---

### E2 — weather that says how old it is, and when it disagrees with today

Doc 09 §14. On the Today screen, at `/trips/:id/today`.

#### The audit, before anything was built

Most of what E2 needed already existed and was already honest.

| | State before E2 |
|---|---|
| **Source** | Open-Meteo. Free, no key, no account. Forecast to a 16-day horizon; the archive endpoint averaged over `NORMAL_YEARS` for anything beyond it |
| **Storage** | `trip_weather` since migration 0003 — temps, precipitation probability, wind, `source`, **and `fetched_at`** |
| **Seasonal** | `source = 'climate_normal'`, labelled by `describeWeather` and `weatherForDates`. Correct |
| **Unavailable** | `WeatherStatus` + `WEATHER_STATUS_TEXT`, four honest sentences |
| **Triggers** | Background refresh on trip create and on trip update — so a destination or date change already refreshed |
| **Conflicts** | `demandFor` and `weatherCapability` fed outfit **generation**. Nothing compared a forecast to an outfit already approved |

So E2 is an extension, not a second architecture. Two real gaps:

1. **`fetched_at` was stored and surfaced nowhere.** `refreshWeather` read it to
   decide whether to re-fetch; `listWeather` dropped it on the floor. Every
   screen therefore showed a four-day-old forecast exactly as it showed one
   fetched a minute ago.
2. **Nothing checked today's weather against today's outfit.** The forecast
   shaped what got packed and then stopped mattering.

#### Freshness is a state, and the four never look alike

`freshnessOf(days, fetchedAt, now)` → `live` | `stale` | `seasonal` |
`unavailable`, over the rows for **that day in that place** rather than for the
trip.

`01_ARCHITECTURE.md` §6 already forbade a climate normal reading as a forecast.
This is the same refusal extended to age: `54–75°F` fetched four days ago is a
different claim from `54–75°F` fetched this morning, and the digits say neither.

| State | What is on screen |
|---|---|
| `live` | the numbers, and **nothing else** — a caveat on the ordinary case is noise |
| `stale` | the numbers, dimmed, `Checked 3 days ago`, and `Check again` |
| `seasonal` | `Usually 54–75°F`, plus the tag `Usual weather, not a forecast` |
| `unavailable` | `No weather for today`, and `Check` |

`FORECAST_FRESH_FOR_SECONDS` is one constant governing both when the refresher
bothers looking and when the screen calls what it has stale. Two would drift,
and the drift would be invisible — the screen saying `live` about something the
refresher had already given up on.

#### Refresh without polling

| Trigger | How |
|---|---|
| Trip created or dates changed | already existed — background `waitUntil` |
| Opening Today on a **stale** forecast | background `waitUntil`, beside the response |
| `Check again` | blocking, and the only path that **forces** past the freshness window |

Opening Today never blocks on the network. The response carries what is stored,
labelled honestly, and the fresh forecast lands for the next open — Today keeps
its single serial round trip and the P1 budget is untouched.

`shouldRefresh` fires **only when something is stored and has aged out**. A trip
with no weather at all is deliberately not a reason to reach out on every open:
a destination Open-Meteo cannot find would otherwise cost a network call every
time Alex looked at Today, for ever, to be told the same thing. A person tapping
`Check again` is a reason; a screen opening is not.

#### Conflicts, on band boundaries rather than degrees

| Kind | Raised when | Offers |
|---|---|---|
| `rain` | rain likely and **nothing worn is recorded** as keeping it off | packed garments that are |
| `colder` | the day's low needs a warmer band than the outfit's warmest garment | packed garments reaching that band |
| `hotter` | the day's high needs a lighter band than the outfit's lightest — **and something lighter is packed** | those garments |
| `wind` | above `WIND_THRESHOLD_KPH`, nothing worn recorded for it, **and something packed is** | those garments |
| `forecast_lost` | a forecast existed for this trip and today has none, or only a normal | nothing — the action is `Check again` |

Every threshold is a `warmthNeededFor` band crossing. A band is roughly eight
degrees, so a forecast that moves two says nothing — which is the point: an alert
for a change that alters no clothing decision teaches Alex to ignore the ones
that do.

`hotter` and `wind` are raised **only when something packed would answer them**.
"You will be too warm and there is nothing to do about it" is a sentence with no
next action, which is the E1 dead end wearing a weather hat.

Capability is only ever what Alex recorded. `weatherCapability` decides it, the
same function the planner uses, so a jacket is not rain protection because it is
a jacket — asserted directly: an outfit **with** an outer layer and no recorded
capability still raises the rain conflict, and names that jacket.

#### The outfit does not change, and saying no is an answer

A conflict is a sentence, the slot it is about, and the packed garments that
would answer it. There is nowhere in its output for "and I have applied it".

`Keep this outfit` is a control rather than an ✕, and it is stored against the
**`fetched_at` it answered** — `{ "rain": 1780000000 }` on `daily_plan`. A newer
forecast raises the same conflict again, because it is a different claim about a
different set of numbers. A bare boolean would have let a decision about this
morning's weather silence a warning about tomorrow's, silently, which is the
failure mode weather features are most prone to.

Accepting an alternative is a **day-only adjustment** — the same mechanism the
wear sheet uses — so the approved outfit still says what it always said.

#### Migration 0015

Additive and nullable throughout. No column dropped, no row rewritten, no CHECK
loosened, so it is safe to apply ahead of the code that reads it — which is the
order the deploy workflow applies it in.

- **`trip_destination.timezone`** — captured free from the forecast response,
  which has always been requested with `timezone=auto` and has always carried
  the answer. On the stop rather than the trip, because a trip that flies Cape
  Town to Reykjavik is in two zones. **This is what makes E1's destination-local
  date reachable at all**: `trip.timezone` has existed since 0003 and nothing has
  ever written it, so every trip has been taking the phone's date.
- **`daily_plan.dismissed_json`** — so keeping the outfit survives the screen
  closing.

#### Three defects the tests found, not the review

- **Freshness was measured over the trip's rows, not the day's.** A trip fetched
  an hour ago but holding nothing for the Tuesday being shown reported `live`,
  and the conflict rules then compared an outfit against a forecast that did not
  exist.
- **`live` with no numbers rendered no weather line at all** — a silent hole in
  the four-state guarantee. The line now renders on what a reader can see rather
  than on what the server called it.
- **Two migration tests stand an older schema up and drive it with current
  repositories**, which now read a column that schema lacks. `createTestDatabase`
  takes an explicit `plus` for later additive migrations — which is what
  production does anyway, since the deploy workflow migrates before the Worker
  reads.

#### The release

| | |
|---|---|
| PR | **#54**, merged as `d0c6fca` |
| Version | **`4ecce84c-0f75-4676-9b88-e52286278eaf`** |
| Deploy run | `30941254839` |
| Migration | **`0015_weather_refresh.sql`, applied remotely — 3 commands, ✅** |
| Data impact | **none.** Two nullable columns added; no row rewritten, no default changed, no CHECK loosened. The migration audit reports nothing because there was nothing to repair |

CI on the exact head `d16a873`: both checks green. WebKit reported **7 flaky** —
the same pre-existing outfit-approval set, none of them E2's.

Locally before the merge: **three consecutive full e2e runs at 214/214 with zero
flaky**, the visual harness 33/33 with an empty report, and `npm run verify` at
1206.

---

#### Known limitations, stated rather than discovered

- **The live call cannot be exercised here.** Outbound requests to Open-Meteo are
  blocked in the agent environment (`09_IMPLEMENTATION_NOTES.md` §5), so every
  parser is unit-tested against fixed payloads and the fetch itself is verifiable
  only in production. `parseTimezone` and the `forecast` return shape are in that
  category.
- **`trip_destination.timezone` fills in on the next successful refresh**, not on
  deploy. Until a trip's forecast is fetched again it keeps taking the phone's
  date — which is labelled, and which is what it did before.
- **There is no test-only endpoint that writes a forecast**, deliberately. The
  browser tests intercept the Today response instead; the storage and derivation
  are proved against real SQL in `weather-refresh.test.ts`.

---

### E1 — Today answers the day, instead of apologising four times

Doc 09 §13. `Today`, at `/trips/:id/today`.

The audit below this heading (kept, because it is the measurement E1 was built
against) said the model was done and the screen was a shell. That was right.
E1 changed no rule about what may be recommended and added no schema.

#### What the capture showed, and what replaced it

`.visual/390/today.png` held four identical `No suitable packed X found.`
sentences — top, bottoms, shoes, layer — stacked with no heading above them and
nothing to do about any of them. Plus no date, no city, no weather, and no
primary action.

`shared/today.ts` is the answer, and it is pure: every state the screen can be
in is a state of already-fetched data, so all of it is unit-tested without a
Worker.

| Question | What is on the screen |
|---|---|
| Where am I today? | the city, from `placeForDate` |
| What am I doing? | the stated activity for the date |
| What am I wearing? | the approved outfit, `Wear` |
| What weather matters? | a forecast, or a normal marked as one |
| Is anything unresolved? | **one** explanation and a row per slot |
| Anything to carry? | `Carry today`, grouped, reasons said once |

#### One explanation, however many slots

`todayIssue` folds the gaps into a single `TodayIssue`. Every affected slot is a
**row that opens a sheet**, never a sentence, and `recoveryActions` cannot
return an empty list — the property the old screen violated. The ways out:

| Action | When | What it writes |
|---|---|---|
| `mark_packed` | the garment is on the list and simply unticked | the **packing list** |
| `put_back` | Alex moved it to Not bringing | restore, then pack |
| `wear_instead` | something packed fits the slot | a day-only adjustment |
| `review_outfit` | always | nothing — it navigates |
| `open_list` | when nothing else applies | nothing — it navigates |

`mark_packed` is the one that was missing, and it is the commonest case: the
garment IS in the bag and was never ticked. It writes to the checklist and never
to the outfit, so the approved plan is left exactly as it was — asserted against
a snapshot of every group and every slot.

#### The date is the destination's day where one is recorded

`resolveTodayDate` ranks three sources by what each actually knows: the trip's
own IANA zone, then the phone's calendar date, then UTC. An unrecognised zone
returns **nothing** rather than a guess, and falls through.

The fallback is labelled only where it can be wrong. A phone still on home time
gets an international day wrong and a domestic one right, so a weekend in
Portland says nothing at all. **`trip.timezone` is never written yet** — the
column has existed since migration 0003 and nothing populates it, so today every
trip takes the `device` branch. E2 fills it from the forecast response, which is
what makes the `destination` branch reachable in production.

#### The phone's date is a HEADER, and that is a caching decision

`sw.js` caches `GET /api/*` keyed on the **full URL**. `?today=2026-08-04` would
have minted a fresh cache entry every midnight and missed the previous day's
entirely — on precisely the day an offline read is worth having. It is
`X-Client-Date` instead.

The e2e offline test could not have caught that: within one day the two URLs are
identical online and offline. The proof is a unit test with a faked clock — two
calls, two different days, one URL.

#### Carry today, and the section that had to be rewritten before it shipped

The first cut listed every packed personal-item row flat, each carrying its own
copy of its reason. Four medications read `Keep it with you rather than in a
bag.` four times over, and the section offered **`Show 20 more`**. That is UX-04
and the packing list a second time.

`carryGroups` groups them and says the reason **once**. Four kinds, each of
which has to be true *today* for a reason it can state:

- **documents** — travel days only (first, last, or a day a stop begins or ends)
- **medication** — every day, because that is what medication is
- **rain** — when the forecast says so, naming only garments Alex himself
  recorded as keeping rain off; and saying so out loud when **nothing** packed
  is recorded that way
- **gear** — what this trip specifically triggered

`is_critical` is deliberately **not** a carry reason. Every essential is on the
trip every day of it, so it says nothing a Tuesday does not also say, and
`Before you go` already owns the essentials on the one morning they are the
question.

#### A blank day, found by reading

`garmentForDay` returns nothing past the end of a group's timeline rather than
repeating the last shirt — right, and it meant day five of a four-shirt group
had no `wear`, no `missing`, and nothing on the screen. It now says `Nothing is
planned for today`, names the group, and offers Review outfits.

#### One response, so the performance contract holds

Everything above arrives with the plan. Today keeps its single serial round
trip; `tests/e2e/performance.spec.ts` is untouched.

#### Evidence

- 51 unit and integration tests, 17 e2e, 4 for the request shape.
- **Proven against the defect.** Restoring the four-sentence block fails **8 of
  the 17** e2e tests. Three mutations of the model — UTC returned for a named
  zone, a normal rendered as a forecast, a slot left with no way out — each fail
  their own unit tests. The header choice fails 3 of 4 against a query parameter.
- New captures: `today-live` and `today-resolve-sheet`. The existing `today`
  capture is of a trip with nothing packed, which is how four dead ends survived
  a review that had a screenshot of them.

#### The `approveAll` flake, closed

Doc 09 §5a recorded `today.spec.ts:32` timing out at five seconds on every CI
head. It was never timing. An **incomplete** outfit renders the same
`Approve outfit` button as any other, `refreshGroupStatus` correctly vetoes the
approval, and the helper then waited for an `Undo approval` that was never
coming. Which groups come back incomplete depends on the wardrobe, which is why
it failed some runs and not others.

The helper skips groups that cannot be approved, and setup goes through the API,
so nothing waits on a re-render at all. The Today suite runs in 26s.

#### The release

| | |
|---|---|
| PR | **#53**, merged as `2ee8d039` |
| Version | **`f1411c84-d6f6-4a09-aaeb-4f4a89d353ce`** |
| Deploy run | `30934903975` |
| Migration | **none.** Schema stays at `0014`; the migration step changed nothing |
| Data impact | **none.** No column added, no row rewritten, no default changed |

CI on the exact head `061ac93`: both checks green. WebKit reported **7 flaky,
down from 8–9, and none of them `today.spec.ts`** — see §5a.

---

### E1 — what is already there, and what is missing

**Read this before starting E1.** `src/routes/Today.tsx`, `worker/routes/today.ts`
and `shared/during-trip.ts` all exist, are tested, and enforce the rule that
matters most (doc 04 §10): **During Trip may recommend only clothing confirmed
as packed**, through `packedOnly`, which every recommendation path goes through.
Continuity is enforced too — the plan is persisted, not regenerated, so opening
the app twice on the same morning shows the same clothes (risk R12).

So E1 is not a build from nothing. It is the gap between that and §13, which
asks for **date, city, activity, outfit, weather, adjustment, outer layer**.

`.visual/390/today.png` on the seeded database is the evidence, and it shows:

- **Four identical lines** — `No suitable packed top found.`, `…bottoms…`,
  `…shoes…`, `…layer…` — stacked with no heading above them and nothing to do
  about any of them. That is the empty state of a screen whose entire subject is
  missing, rendered as four sentences of apology.
- **No date, no city, no activity** beyond the outfit group's name
  (`Travel days`) and `Day 1 of 12`.
- **No weather at all**, which §13 names explicitly and which E2 depends on.
- **No primary action.** `Packing list` at the bottom is the only control, and
  it leaves the screen.

The honest scoping is therefore: the model is done, the screen is a shell, and
what it most needs is the empty state — because on a real trip the common case
is *some* slots unfilled, and four apologies is the answer it gives today.

**Do not start E2 first.** Weather has a place on this screen and no place to
sit until this one exists.

### F2 — audited before building, and the read half is already done

**Read this before starting F2.** Every claim below was checked against the
files named, on `db7507e`, not inferred from the brief.

#### What already works, and must not be rebuilt

`public/sw.js` is **network-first for every `GET /api/*`**, keyed by full URL,
writing each successful response into `pack-smart-data-<VERSION>`. That single
rule is what makes the whole read half true — there is no per-screen list to
extend, so every screen the brief names already reads offline once it has been
opened with a connection:

| Screen | Reads offline because |
|---|---|
| Active trip, packing list | `GET /api/trips/:id`, `GET /api/trips/:id/checklist` |
| Today | `GET /api/trips/:id/today` — E1's phone date is a **header**, so the cache key does not change at midnight |
| Before you go | same checklist response `DayOf` already reads |
| Approved outfits, bag assignments | `GET …/outfits`, and `bag` is a column on the checklist row |
| Cached weather | carried inside the trip and Today responses |
| Authenticated bootstrap | `hasUnlockedBefore()` keeps a device that has signed in before inside the app when the session check cannot be answered (`App.tsx`) |

Two exclusions are **deliberate and stay**: `/api/auth/*` (a stale session check
would tell Alex he is signed in when he may not be) and `/api/settings/export`
(the whole database as a file, and it must never land in the shell cache —
`service-worker-routing.test.ts` guards the ordering).

So F2 adds **no read caching at all.**

#### What may be queued, measured against the eligibility rules

The queueable set is exactly the checklist PATCH fields that are an **absolute
value on one row**:

| Field | Where it is tapped | Why it qualifies |
|---|---|---|
| `packedQty` | the packing-list row, the entry sheet's stepper | Absolute. Replaying `packedQty: 5` twice leaves 5 |
| `finalChecked` | `Before you go` | Absolute boolean |
| `bag` | the entry sheet's bag picker | Absolute enum, or `null` to hand the row back |

Held as **desired state keyed by `(entryId, field)`**, never as a log of taps.
Twelve taps on one row are one record; that is what makes duplicate replay safe
**by construction** rather than by care. Ordering is by the moment Alex acted,
and records for one entry are replayed as **one PATCH**, because the endpoint
already takes several fields at once.

#### What stays online-only, and why — each against the rules it fails

| Action | The rule it fails |
|---|---|
| `POST …/today/wear` | An INSERT with **no unique key**. Duplicate replay is not safe, and inventing one is a schema change for an action nobody performs on a plane |
| Add a trip-only item, add from wardrobe | INSERT; the **server mints the id**, so nothing on the row can be idempotent |
| Not bringing / restore | The response carries `affectedOutfits`, and the product requirement (doc 04 §8) is that removal **shows what it costs the plan and offers a replacement**. Offline there is nothing to show. A queued removal would be a silent one |
| `qtyOverride`, `packingTiming` | Absolute values, and they still do not qualify: both are **edits to the plan**, they feed regeneration, and they are made at a desk rather than beside a suitcase. Queueing them buys nothing and widens the conflict surface |
| Trip create/edit, outfit approval, rules, wardrobe | Not row state. Several are multi-row and none is idempotent |

Each of these keeps its current behaviour: the write fails, the row reverts, and
the screen says why.

#### Session binding — what the architecture actually offers

The session is an **HttpOnly cookie**; JavaScript cannot read it, so a queued
record cannot carry the credential and must not try to. What it carries is a
**session marker**: a random id minted at unlock beside `pack-smart:unlocked-before`,
removed by `lock()`. It is not a credential, grants nothing, and is never sent —
its only job is that a record from a previous session **cannot be replayed into
the next one**.

`lock()` in `App.tsx` is where all four end-of-session paths converge (a 401, a
`false` session answer, Sign out here, Sign out in another tab), and it is
therefore where the queue is emptied. Replay re-checks the marker immediately
before it fires, because a sign-out can land between the trigger and the request.

The server stays authoritative: every replayed PATCH is an ordinary
`requireSession` request, and a 401 ends the session and takes the queue with it.

#### Stale-server detection needs one additive change

`checklist_entry.updated_at` already exists and is already maintained by every
setter, but it is **not on the `ChecklistEntry` the client sees**. Exposing it
(no migration — the column is there) lets a queued record remember the row
version it was made against, and lets the PATCH carry `ifUnmodifiedSince`. A row
that moved on the server since is a **409**, the queued value is not applied, and
Alex is offered the choice rather than having either side silently win.

#### What F2 does not touch

No migration. No new dependency. No Background Sync: the service worker must
**never** replay anything, because it outlives the page and knows nothing about
whether the session is still open — replay belongs in the app, behind `lock()`.

#### F2 — delivered

**Three fields, one key, and a marker that dies with the session.**

| | |
|---|---|
| Queue | `localStorage`, one record per `(entryId, field)`, holding **desired state** |
| Eligible | `packedQty`, `finalChecked`, `bag` — nothing else, and §4's audit says why for each refusal |
| Session binding | a random marker minted at unlock, removed by `lock()`, re-checked immediately before every request |
| Conflict | `ifUnmodifiedSince` against the row's `updatedAt`; a row that moved is a **409** and a question, never an overwrite |
| Replay | on launch, on `online`, and on the app's own first live response |
| Migration | **none.** `updated_at` already existed and was already maintained |

**Five decisions worth the words, because each replaced something that looked
right first.**

1. **The in-memory copy of the queue was removed.** It was written to spare a
   `JSON.parse` per reconnect, and it introduced a second answer to "what is
   queued" that `localStorage.clear()` in another tab could make wrong — in
   exactly the case where being wrong means replaying a write that should be
   gone. It was also making a test pass vacuously, which is how it was found.
2. **`clearQueue()` is unconditional.** The version that skipped the write when
   it believed the queue was empty was believing something about storage this
   module does not exclusively own.
3. **Replay waits for the server to confirm the session.** P1b renders the app
   optimistically on a `localStorage` flag; that is the accepted trade for
   *reading* a cached trip and the wrong basis for *sending*. The gate is module
   state, so every page load earns it again.
4. **`checkSession` now refuses to re-enter.** Confirming a session dispatches
   `ONLINE_EVENT` from inside `apiFetch`, and the replay trigger listens to it —
   so the check that was about to confirm the session re-entered itself and
   spent a second round trip on every launch. `performance.spec.ts` holds the
   app to not doing that.
5. **A 409 refuses the whole PATCH, never the fields that happen to be stale.**
   The client sends one row's queued fields together; half-applying them leaves
   a state neither side asked for, and a test asserts the bag is untouched when
   the packed quantity is the conflict.

**And two defects found in testing rather than in review, which is the rate §0a
said to expect.**

- **A failed write went on being applied to the rows.** `applyPending` laid the
  whole queue over the server's answer, including records that had already come
  back 409 — so a conflicted row kept showing Alex's value with no marker beside
  it, which is precisely the silent failure this slice exists to end. It now
  applies only records that have not failed, and a failure asks the screen to
  refetch just as a success does.
- **A newer tap could be thrown away by an older request landing.** The replay
  resolved records by key, so a tap Alex made *while a replay for that same row
  was in the air* — which flaky wifi produces, being good enough to send and not
  good enough to receive — was removed by the older request succeeding. Records
  are now resolved by key **and** the moment they were made, so a replay can only
  ever resolve exactly what it sent.
- **An unknown row version poisoned every field beside it.** `ifUnmodifiedSince`
  was the minimum of the group's versions, and a row read before `updatedAt`
  existed on the response reads as **0** — so one such field mixed with a real
  one sent `ifUnmodifiedSince: 0`, and `updated_at > 0` is true of every row that
  exists. That patch would have 409'd for ever. Zero now means *unconditional*
  rather than *impossible*.

**The service worker replays nothing, and a source-level test says so.** It
would be the obvious home for this — Background Sync exists for it — and it is
wrong: a worker outlives the page, cannot read `localStorage`, and would fire
long after a sign-out with the cookie attached automatically.

**Evidence.**

| | |
|---|---|
| `npm run verify` | **1339** — typecheck, lint, unit + integration, build |
| e2e, local Chromium | **235**, `offline-writes.spec.ts` adds 9 |
| **CI WebKit** | **231 passed, 1 flaky, 3 skipped** — up from 222, because these 9 run on WebKit |
| Visual harness | 34, `.visual/report.txt` **empty** |
| Deploy | run `30993878799`, version **`fad1f9a8-e717-4661-ab22-99b62dad8573`** |
| Migration | **none.** `Apply D1 migrations` ran with nothing to apply — `changed_db: false`, **0 rows written**. Schema stays at 0016 |
| Data impact | nothing is reshaped. `updatedAt` is a field added to a response, read from a column that already existed and was already maintained |

**The one flaky is `itinerary.spec.ts`, which is the pre-existing one §5a
records.** `bags.spec.ts:171` also went flaky on the first (red) run of this
branch and passed on its retry, and did not reappear on the green one — it is
the same spec §5a already lists as having failed once and never reproduced.
Recorded rather than dismissed, and not papered over with a longer timeout.

**Every test was proved against the defect it covers.** Eight mutations of the
queue, each caught: no mid-replay session check (1 fail), append instead of
replace (2), never conditional (1), no session filter (1), 409 treated as
retryable (2), queueing a server refusal (1), the overlay doing nothing (3),
eligibility widened to the plan edits (2), the overlay applying failed writes
(1), a conflict not asking for a refetch (1), an unknown version dragging a real
one down to zero (1), and resolving by key alone rather than by key and moment
(1). The server half was mutated twice —
removing the 409 branch fails 2, hard-coding `updatedAt: 0` fails 4. And with
`patchEntryOrQueue` reduced to its pre-F2 behaviour, **8 of the 9 e2e tests
fail**.

**The e2e spec cuts the network by aborting the PATCH, and removes the service
worker to do it — which CI taught, at the cost of one red run.**

The first CI run failed **8 of 9** of these on WebKit. The cause was the one the
spec's own docblock had claimed to be safe from: **`page.route` does not
intercept a page a service worker is controlling in WebKit**, so every PATCH
went straight through to a live server, nothing was ever queued, and no
`Saved on this phone` marker appeared. It is worth saying plainly that this is
the *good* failure mode — the test could not pass vacuously, and it did not.

The fix is `AUTONOMY.md` §8's standing rule rather than a workaround: anything
faking a response removes the worker first. It is honest here specifically
because **the queue does not involve the worker at all** — `sw.js` returns
immediately for any non-GET, and `service-worker-routing.test.ts` asserts that
line at the source along with the absence of any sync handler. So the offline
READ specs still need the worker and still skip WebKit; these need it gone and
therefore **run on WebKit**, which is more than the read half has ever had.

Two details, because both were got wrong first:

- **The registration is refused, not the container hidden.**
  `'serviceWorker' in navigator` is still true for a getter returning
  `undefined`, so `registerServiceWorker()` walks past its own guard and throws
  on `undefined.register`.
- **The removal is asserted before anything else.** A worker that survived would
  otherwise show up as a missing marker, which reads as a broken feature and is
  not one.

### G4 — audited before building

Measured on the repository at `67a68c0`, not inferred from the wording.

#### The filters as they stand

`CHECKLIST_FILTERS` holds **nine**: Everything, Still to pack, Packed, Pack day
of, Essentials, and one per bag except `either` — Wearing it, Personal item,
Carry-on, Checked bag.

Alex's correction names **five**: Everything, Still to pack, Personal bag,
Carry-on, Checked bag. So four go, and each one goes because the list already
answers its question somewhere better:

| Dropped | Where the answer survives |
|---|---|
| `Packed` | the inverse of *Still to pack*, on a list whose packed rows already sink to the bottom (D2) |
| `Pack day of` | the **Pack later** section is exactly the same set — `filterChecklist` and `sectionFor` share the test — and `Before you go` (D4) is the screen for that moment |
| `Essentials` | essentials already sort to the top of every section (`orderRank` 0) and carry the `· Essential` marker |
| `Wearing it` | a bag filter answers *what goes in this bag*, and nothing goes in this one |

Nothing dropped removes a capability. §4's own filter comment set the test:
*a filter without a moment is a control to scroll past.*

#### The naming, which §6a makes part of the slice

`BAG_LABELS.personal_item` is `Personal item`; Alex's list says **Personal bag**.
One vocabulary chosen once, so the word changes in `BAG_LABELS`, `BAG_SHORT`,
`BAG_SENTENCE` and `BAG_MEANING.either` together — and the **stored enum stays
`personal_item`**, because §6a is explicit that no stored enum meaning changes
for copy.

#### The ordering as it stands

`orderSection` sorts by `orderRank` then arrival index, where arrival is
`sort_order, lower(name_snapshot)` from the SQL. There is **no category rank at
all**, so a toothbrush sits between two t-shirts.

The category rank is therefore additive — `(orderRank, categoryRank, index)` —
and the position of each term is the whole design:

- **`orderRank` still wins**, so D2's completed-to-bottom and the
  essentials-first band are untouched. Category grouping happens *within* a
  band, never across one.
- **The snapshot is untouched**, so D2's "a row does not move while a thumb is
  on it" still holds: `applyOrder` freezes whatever order was last computed and
  only `orderSection` is being changed.

Categories from `CATEGORY_EMOJI`, essentials first and clothing last:

Documents · Medication · Medication Storage · Vision · Electronics · Toiletries ·
Grooming · Travel Gear · **Tops & Outerwear · Bottoms & Swimwear · Accessories &
Undergarments · Footwear**

An unrecognised category sorts with Travel Gear and then alphabetically, so a
custom item lands somewhere predictable rather than somewhere clever.

#### G4 — delivered

**Nine filters became five, and `orderSection` gained a middle key.**

| | |
|---|---|
| Filters | Everything · Still to pack · Personal bag · Carry-on · Checked bag |
| Retired | `Packed`, `Pack day of`, `Essentials`, `Wearing it` — each answered better elsewhere |
| Ordering | `(orderRank, categoryRank, index)` — category sorts **inside** a band, never across one |
| Naming | `Personal item` → **`Personal bag`** in `BAG_LABELS`, `BAG_SHORT`, `BAG_SENTENCE` and `BAG_MEANING.either`. The stored enum is still `personal_item` |
| Migration | **none.** No stored value changes meaning; the rename is copy |

**The category rank sits below `orderRank`, and the e2e test found out why that
matters before a person did.** The first version asserted that each category
appears in exactly one run down the whole of `Pack now`, and it failed against
correct output: `📄📄📄 💊💊💊 👓 🔌🔌 🧴🧴🧴 | 📄 💊💊 👓 🔌🔌🔌 …`. The
categories restart **once**, at the boundary between unpacked essentials and
everything else — because D2's bands outrank the grouping and are supposed to.
The test now reads the section as `(band, category)` pairs and asserts the run
rule *within* each band, plus the boundary itself. That is a stronger assertion
than the one it replaced: it pins the precedence rather than the output.

**Three things the slice must not have broken, each with a test that fails if it
did:**

- a **packed** row never climbs over an unpacked one to join its category;
- an **ordinary** row never climbs over an essential to join its category;
- two rows of one category keep their arrival order, which is what stops ticking
  one t-shirt reshuffling the others beside it (D2).

**Evidence.** `npm run verify` **1343**; e2e local Chromium **237**
(`list-order.spec.ts` adds 3); visual harness 34 with an empty report.
**Mutation-checked**: category above `orderRank` fails 2, no category rank fails
4, unknown categories to the end fails 1, alphabetical clothing fails 1,
restoring a retired filter fails 2, and dropping the rank fails the new e2e.

### G5 — audited before building

Measured against the workbook and the migrations, not inferred from the wording.

#### What the three rules actually are

Read out of `seed-data/Master_Packing_Database_Complete.xlsx`, sheet 2:

| Item | Category | The workbook's rule text | What `parseGearRule` makes of it |
|---|---|---|---|
| `Gas-X` | Medication | `Frequently (Trip Days + 2 days buffer)` | `duration_plus_buffer`, buffer **2** — so **14** on a twelve-day trip |
| `Prescription Sunglasses` | Vision | `Warm weather / outdoor trips` | `conditional_include` on `activities contains outdoor` |
| `Regular Sunglasses` | Vision | `Outdoor trips` | `conditional_include` on `activities contains outdoor` |

**The two sunglasses rules are byte-for-byte the same rule.** The activity list
in `parseGearRule` tests `/outdoor/i` **before** `/warm weather/i`, so
`Warm weather / outdoor trips` never reaches the warm-weather branch. That is
what "legacy duplicate sunglasses rules" means, measured: not two rows that look
alike, but two items sharing one indistinguishable condition — they both appear
or neither does, and no trip can ever want one without the other.

#### The seat cushion is not one of them

§6a already flagged this and the repository confirms it. `Plane Seat Cushion` is
**not a workbook row**. It is one of the five canonical `MISSING_ITEMS` added by
migration 0009, with a `conditional_include` on `flight_hours > 6`, and
`readiness.ts` cites it **by name** as half the reason the long-flight question
is worth asking.

Two consequences, both deliberate rather than incidental:

- **Migration 0009 and `shared/missing-items.ts` are not edited.** They are a
  true record of what was inserted, `missing-items.test.ts` asserts they agree,
  and migrations are forward-only. The rule is retired the same way every other
  one here is — by a superseding row — and the canonical list gains a note
  saying so.
- **The question's wording has to change**, because it names something that is
  no longer added. It becomes *the neck pillow and the compression socks*,
  which are the two the workbook really does add at over five hours — so the
  question still earns its place, and now says something true.

#### Non-destructive by construction

Every change is an **override row**: `source = 'user'`, `supersedes_rule_id`
pointing at the seeded rule, which is exactly the shape `disableRule` and
`editRule` write. Nothing seeded is updated, nothing is deleted, and
*Use the default* restores each one.

| | |
|---|---|
| Gas-X | override with `enabled = 0` |
| Plane Seat Cushion | override with `enabled = 0`, matched on its **stable id** `a1f0b3c2-0003-…`, which 0009 fixed |
| Both sunglasses | override to `fixed_per_trip`, quantity 1, **no condition** — always packed, one each per trip |

`applyPrecedence` drops any rule something supersedes, whatever its type, so an
override may legitimately change the KIND of rule as well as its number — which
is what "always pack this instead of packing it on outdoor trips" is.

**Two guards the migration needs, and why:**

- `WHERE NOT EXISTS (… o.supersedes_rule_id = r.id)` — an override Alex has
  already written is left completely alone. Without it the unique index on
  `supersedes_rule_id` would fail the migration, which is the *safe* failure,
  but silently skipping is the right behaviour and it should be deliberate.
- Matching on `lower(trim(display_name))` for the two workbook items, because
  their ids are import-generated and there is no other handle. It is exact, not
  a LIKE, and it writes **one override per matching rule** — so a wardrobe
  holding two rows called `Regular Sunglasses` gets two, rather than having one
  silently chosen. `CLAUDE.md` asks for likely duplicates to be surfaced rather
  than resolved, and this is the surfacing direction.

#### G5 — delivered

**Migration 0017, additive, four superseding rows and nothing else.**

| | |
|---|---|
| Gas-X | retired — override with `enabled = 0` |
| Plane Seat Cushion | retired — matched by its **stable id**, the only one of the four that has one |
| Prescription Sunglasses | `fixed_per_trip`, quantity 1, no condition |
| Regular Sunglasses | the same, separately |
| Schema | **no table, column, index or CHECK changes.** Rows only |

**Nothing seeded is touched.** Each change is the exact shape `disableRule` and
`editRule` write from Settings — `source = 'user'`, `supersedes_rule_id` naming
the default — so the seeded rule is still there, still enabled, still readable,
and *Use the default* restores it. Two tests hold that: one reads both rows and
asserts the seeded one is untouched, and one writes an override of Alex's own
first and asserts the migration leaves it completely alone.

**`original_text` is rewritten on the two sunglasses rules**, which is the one
place this differs from `createOverride`. The seeded text says `Outdoor trips`;
carrying that onto a rule that now fires every trip would put a sentence on the
row — C1's *why it is here* — that contradicts the row it explains.

**Migration 0009 and `shared/missing-items.ts` are deliberately not edited.**
They are a true record of what was inserted, `missing-items.test.ts` asserts
they agree, and migrations are forward-only. Retiring a rule is not the same act
as pretending it was never seeded. The canonical list gains a note saying which
migration retired it and why.

**The long-flight question changed wording**, because it named something nothing
adds any more. It now says *the neck pillow and the compression socks*, which
are what the workbook really does add over five hours — so the question still
earns its place and now says something true. A test asserts it no longer
mentions the cushion.

**Evidence.** `npm run verify` **1355**. Mutation-checked five ways: keeping the
sunglasses condition fails 3, writing the new rules disabled fails 3, dropping
the Gas-X retirement fails 5, dropping the cushion retirement fails 3, and
removing the already-overridden guard fails 2.

**And a harness defect it exposed.** Two integration tests shuffle rule ids to
prove the fold is order-independent, and neither carried `supersedes_rule_id`
with the permutation — so an override ended up pointing at a *different* rule,
which silently un-retired what it was written to retire. Not a dangling
reference: a wrong one. Both now detach, renumber, and reattach through the same
map.

---

## 5. Standing constraints

- **Never** mark a slice complete because a route or component exists.
- **Never** claim production verification that was not performed. Outbound HTTPS
  from the agent environment is gated by network policy, so the live endpoint
  cannot be curled from here — deploy-log evidence is what exists, and it is
  labelled as such.
- **WebKit** cannot be installed in the agent environment (AUTONOMY §7). CI on
  the exact PR head is the WebKit evidence.
- Phone checks accumulate in `technical-docs/08_MANUAL_IPHONE_CHECKLIST.md` and
  are requested as **one** session, never one per PR.
- Migrations are additive and forward-only. A destructive one needs Alex.

---

## 5a. Known, not hidden

### The CI-cost audit, measured on this session's own runs

**Why it exists:** the account reached 1,800 of 2,000 hosted minutes 27 days
into the cycle, and a large part of that was spent here.

**What a head actually costs**, timed from this session's runs rather than
estimated:

| Workflow | Duration | Where it goes |
|---|---|---|
| `ci.yml` (`verify`) | **11–14 min** | WebKit e2e ~9 min; installing WebKit ~75 s; typecheck + lint + 1,371 unit/integration + build ≈ 2 min |
| `visual-qa.yml` | **3–4 min** | Chromium install and the four-width walk |
| `deploy.yml` | **~2 min** | typecheck + tests + build + migrate + upload |

So **one pushed head ≈ 17 minutes**, and a slice from first push to production
≈ 36 — *if* it is pushed once. PR #60 took four heads: **about 68 minutes for
one slice.**

**Where the waste was, in order of size:**

1. **Documentation-only heads run the full browser suite.** This session pushed
   at least three (F2's phone checklist, F2's production record, G5's production
   record). Roughly **50 minutes** proving a Markdown file does not break WebKit.
2. **Every intermediate head is verified like a release candidate.** The four
   heads of PR #60 were three work-in-progress commits and one candidate.
3. **Playwright browsers are downloaded on every run**, in both workflows.

**What is already right, and was not changed:** both workflows carry
`concurrency: cancel-in-progress: true`, so a new push supersedes a running one
— that is why PR #60's four heads cost 68 rather than more. `actions/setup-node`
already caches npm in all three workflows.

#### The changes prepared on `claude/ci-cost-audit`

| Change | Saves |
|---|---|
| A `What changed` step; the WebKit suite and the visual walk skip a **documentation-only** head | ~14 min per docs head |
| Both heavy suites skip while the pull request is a **draft** | ~14 min per work-in-progress head |
| `ready_for_review` added to the `pull_request` types | — (it is what keeps the gate) |
| `actions/cache` on `~/.cache/ms-playwright` | ~1 min per run; the apt half of `--with-deps` is not cacheable |

**The mandatory gate is preserved, and this is the part worth checking rather
than trusting.** Three things hold it:

- `push: branches: [main]` still runs **everything**, so nothing reaches
  production unverified;
- `github.event.pull_request` is **null** on a push to `main`, so
  `github.event.pull_request.draft != true` is *true* there and every suite runs;
- GitHub refuses to merge a draft, and `ready_for_review` fires a full run — so a
  release candidate cannot reach `main` without one complete run **on its exact
  head**.

**Deliberately not `paths-ignore`.** That stops the whole workflow, and a
required check that never reports blocks a merge rather than speeding it up.
The workflow still runs and still reports; only the expensive steps are skipped.

**Not pushed, and not verified remotely.** These are workflow files: the only
way to test them is to run them, which is the thing being conserved. They are a
prepared change awaiting the same capacity as everything else, and the first run
after they land should be watched rather than assumed.


### G5b — a second import of the workbook duplicates everything

**Found by G5, not caused by it, and measured rather than reasoned about.**

`POST /api/import/commit` dedupes **only within the spreadsheet it was handed** —
exact and identity duplicates among those rows — and never consults the
database. `createItem` runs unconditionally for every unique row, so importing
the same file twice adds a fresh copy of each.

| | Before | After a second import |
|---|---|---|
| Items | 123 | **241** |
| Rules | 41 | **75** |
| Rules named `Gas-X` | 2 | **3** |

The third Gas-X rule is a `system` rule that nothing supersedes, so **a retired
rule comes back**. The same mechanism means a **fresh install would not carry
G5's corrections at all**: migrations run before any import, so 0017 finds
nothing to supersede, and the workbook then arrives with its original rules.

**Two tests assert this as the current behaviour**, in
`tests/integration/retired-rules.test.ts`, so fixing it fails them and the fix
has to be a deliberate act rather than a silent improvement.

**Why it is recorded rather than fixed inside G5.** Alex's live database has the
data and has been corrected by 0017; re-importing is not a normal action;
and making the importer merge against existing rows is its own slice with its
own duplicate-resolution questions (doc 05 §4 already owns that vocabulary).
`CLAUDE.md` asks for likely duplicates to be **surfaced** rather than silently
resolved, so the fix is a review step, not a quiet `INSERT … WHERE NOT EXISTS`.

**Scope when it is done:** commit reconciles against the existing catalog by the
same identity the dry-run already computes; a rule whose default is superseded
by a `user` row is never replaced; and the import history says what it merged.
Do this **before the final whole-product pass**, because the final pass includes
an import.

### The session token cannot be revoked, and Sign out cannot change that

A session is a **stateless HMAC token with a one-year TTL and no server-side
store** (`shared/crypto.ts`, `worker/auth.ts`). `clearSessionCookie` sends a
`Max-Age=0` cookie and nothing else; there is no revocation list and no nonce
table, so a token already in a browser keeps verifying until it expires,
whatever any sign-out does.

**What Sign out really means today:** this browser is told to discard its cookie.
If it obeys, access ends. If the request never reached the server, the cookie is
untouched — which is why S1 stopped claiming otherwise.

**Why it is recorded rather than fixed.** The realistic threat is a lost phone,
and the recovery for that is rotating `SESSION_SECRET` with
`npx wrangler secret put` — one command, invalidates every token everywhere,
which is what Alex would want in that situation and is strictly stronger than a
per-token revocation. Adding an `issuedAt` floor in D1 would make Sign out
revoke as well, at the cost of a read on every guarded request; it is worth doing
if Pack Smart ever stops being a single-user app, and is not worth it now.

**Not a silent limitation:** the failed-sign-out message says "You are still
signed in", which is the only case where the difference is visible to Alex.

### Two test defects P1c surfaced, and the flakes that outlived them

**`readiness.spec.ts` asserted on Home without owning a trip.** Home features the
soonest live trip **on the database**, so no spec can own the one it is looking
at — that is a property of the screen, not a gap in the fixtures. What a spec
can own is whether there is one at all, and this one did not: it read whatever
another file had left behind, and passed right up until a run left the database
empty, where `.home-primary` does not exist and four tests failed with
`Received: 0`. It creates its own trip now. Q1's class, one file it did not
reach.

It also read `.home-countdown`'s text immediately, which after P1c is empty for
one round trip while the readiness loads. It waits for `:not(:empty)`.

**Two specs have each failed exactly once, in a full parallel local run, and
neither has reproduced.**

| Spec | What it was doing | Runs clean since |
|---|---|---|
| `offline.spec.ts:113` | waiting on the service worker to install | 5 |
| `bags.spec.ts:171` | 30s timeout inside the filter walk | 2 |

Both were also run in isolation and beside every other spec that touches a
cache, a sign-out or the same screen. Recorded rather than dismissed, and
recorded rather than "fixed" with a longer timeout, which would only make the
next one take longer to notice. **If either returns:** for `offline`, look at
`serviceWorkerReady` before looking at the caches; for `bags`, at how many trips
the database is carrying by the time it runs — the suite creates about 65 per
run and the teardown is at the end.

### The outfit-approval flake — **measured, and closed. It was the weather.**

**Read this section rather than the one below it.** Everything under
*partly closed in E1* was written before the cause was measured, and two of its
conclusions were wrong. They are left in place because the reasoning is what
produced the measurement, and because a correction is worth more beside the
thing it corrects.

#### What it actually was

`POST /api/trips` starts a forecast fetch in the background — `waitUntil`, by
design, and the comment on `refreshWeatherInBackground` even says why: *"by
which time Alex has tapped through at least one screen to reach Outfits, which
is the first thing that reads it."* Every one of the flaky specs creates a trip
and plans outfits **immediately** afterwards. So whether a forecast had landed
before the planner ran was a race, and the specs were on the wrong side of it.

When a forecast lands and says rain is likely, `assign` promotes the outer layer
to **required**. And **Alex owns nothing recorded as keeping rain out** — the
import already warns about exactly this. So every group on the trip came back
`incomplete`, `refreshGroupStatus` refused every approval, and the Outfits
screen showed four cards each offering an `Approve outfit` button that silently
did nothing.

That is not a test problem. **It is the dead end E1 spent a slice removing from
Today, on a different screen** — and it would have happened to Alex on the first
rainy trip he planned.

#### Why it only ever appeared on CI

CI can reach Open-Meteo. This sandbox cannot — `curl` to the forecast API
returns nothing at all — so no forecast ever lands here, rain is never likely,
the outer layer is never promoted, and the suite is green every time. **The one
environment that could reproduce it was the one nobody could step through**,
which is why it survived weeks of "measure before fixing".

Reproduced deterministically in `tests/integration/rain-approval.test.ts`:
against the **real workbook**, with a forecast at 80% precipitation, every group
came back `incomplete` and `setGroupStatus(..., 'approved')` answered
`{"status":"incomplete"}`. With no forecast, every group is `draft` and the
approval succeeds.

#### The two things the earlier diagnosis got wrong

1. **`element(s) not found` does not mean "refused rather than slow".** A button
   that has not rendered yet is also not found. The distinction separates
   *absent* from *present-but-hidden*; it says nothing about *refused* versus
   *not yet*. The refusal reading happened to be right, for a different reason.
2. **`outfit_pairing` outliving the trip was not the cause.** Measured directly:
   twelve consecutive plan-approve-delete rounds on one database, with pairings
   accumulating and never cleaned up, produced **zero** incomplete groups.
   Pairings change which garment is ranked first, not whether a slot can be
   filled.

And one thing it got wrong by omission: **the seven were not one signature.**
They were three — four `Undo approval` timeouts, two "the review did not
advance", and one itinerary wait — and the membership changes run to run,
because it depends on what the real forecast said that morning.

#### The fix, in two halves

**The product half.** A demand the wardrobe cannot meet *anywhere* no longer
vetoes the outfit. The slot stays unfilled, the sentence is still shown, the gap
is still reported in `unmet` — and the outfit can still be approved. Pack Smart
cannot ask Alex to pack a coat he does not own. E2 then does the rest of the job
at the right moment: the weather conflict on Today says rain is likely and
nothing packed keeps it out, on the day it matters. A slot the **template**
required is untouched — no top that suits a nice dinner is a genuine hole, and
approving around it would put a half-dressed plan on the checklist.

`unmet` and `slot.required` are now deliberately different: one is the report of
what the plan could not do, the other is what decides whether the outfit may be
approved. Collapsing them is what turned *"you own no raincoat"* into *"you
cannot approve anything on this trip"*.

**The test half.** `approveOutfit` and `approvableCard` in `fixtures.ts`. An
incomplete outfit is **still** a legitimate state, so a helper that waits on a
button label is still waiting on the wrong thing: `approveOutfit` waits on the
card's own `is-approved` class, which is the server's answer, and fails
immediately with the reason. `approvableCard` asks for a card that can be
approved rather than for the one called *Safari* — which was two assertions in
one, and only ever the subject of the first. `outfit-review.spec.ts`'s `answer`
watches for the refusal alert and throws rather than running out its poll.

No timeout was raised, nothing was retried, nothing was skipped.

#### Proved against the defect, end to end

With rain forced on for every group:

| | Result |
|---|---|
| defect present (veto restored) | **12 tests fail** across the three files — the recorded class, amplified |
| defect fixed | **26 of 26 pass** |

Plus four mutations of `rain-approval.test.ts`, each failing exactly the test
that names it.

#### What is left: `itinerary.spec.ts`, and it is a different thing

One flake remains and it is **not** in this family. `itinerary.spec.ts` waits
20 seconds for the Outfits heading after *Add these to the trip*, and that step
genuinely is long: a trip update that regenerates the whole checklist, then a
day save that replans every outfit over 123 garments, then a navigation. It has
tipped over 20s twice, on different tests in the file.

Checked and **not** the cause: it is not two outfit replans — `PUT /:id`
regenerates the checklist, `PUT /:id/days` replans the outfits, and only one of
those plans outfits. So the honest next step is to **measure how long the apply
actually takes on CI** rather than to raise the number again, which is why this
is recorded here rather than fixed in the same slice.

---

### The outfit-approval flake — the earlier reading, kept for its reasoning

CI's WebKit run reported **8–9 flaky on every recent head**, always the same
set, always downstream of the same act: approving an outfit and then waiting for
what it changed.

#### `today.spec.ts` is closed, and the cause was not timing

`approveAll` at `today.spec.ts:32` clicked *Approve outfit* and waited five
seconds for *Undo approval*. The five seconds were never the problem.

An **incomplete** outfit renders exactly the same `Approve outfit` button as a
complete one. `refreshGroupStatus` correctly vetoes the approval — a required
slot is unfilled or set aside — the card stays incomplete, and the button never
becomes *Undo approval*. The helper was waiting for a transition that was never
going to happen. Which groups come back incomplete depends on the wardrobe at
the moment the outfits were planned, so it failed some runs and not others.

Raising the timeout would have made it fail slower. E1's helper skips groups
that cannot be approved, and drives setup through the API, so nothing waits on a
re-render at all. The Today suite runs in 26 seconds.

#### The remaining seven, and what the CI log says about them

On PR #53's head, seven remain — `outfit-review.spec.ts` (3),
`replace-or-remove.spec.ts` (2), `outfits.spec.ts` (1), `itinerary.spec.ts` (1).
None is `today.spec.ts` any more.

The log's wording is the new evidence, and it is worth quoting:

```
Locator: locator('.outfit-card').filter({ hasText: 'Safari' })
           .first().getByRole('button', { name: 'Undo approval' })
Error: element(s) not found
```

**`element(s) not found`, not `not visible`.** The card is on the page; the
button with that name is not on it — which is the refused-approval signature
above, in three more files. So the class is one bug, not five, and the fix is
the same shape: assert on the card's own status class (`is-approved`), which the
server's answer decides, rather than on a button label that reads identically in
two different states.

**What is still open is WHY the outfit is incomplete at that moment**, and the
honest answer is that it has not been measured. The candidates, in order of how
much shared state they touch:

1. **`outfit_pairing` outlives the trip.** Approving writes lasting pairings
   (`rememberGroup`); un-approving forgets them. Every spec that approves an
   outfit therefore changes how the planner composes outfits for every *other*
   spec running beside it. That is a genuine cross-spec channel that trip
   ownership does not close, and it fits "always downstream of approving".
2. Wardrobe items created and archived by other specs while a plan is generated.
3. `syncChecklistFromOutfits` racing a concurrent write to the same catalog rows.

Measure before fixing. A guess here would produce a test that passes for the
wrong reason, which is the failure mode this section exists to prevent.

### The two stale open PRs, and the one fact recovered from them

**#32 — `Record Release B as deployed, and the exact next step` (31 July).** Its
"exact next step" was C1, which shipped in #36, and merging it would put a stale
next-action back at the top of §3. **It carried one record that was nowhere
else**, though, and that record is now in §2: **B3/B4 deployed at version
`7e97ff9b-adae-4d86-a0b6-6cec838359e4`** via #31. That is the whole of its
remaining value; the rest is superseded by everything between C1 and D5.

**#15 — `UX streamlining, trip lifecycle, packing controls…`.** 585 lines of a
new `product-docs/07_UX_STREAMLINING_AND_DATA_COMPLETENESS.md`, a document
nothing in the repository references. Its subject matter was overtaken by the
V2 lifecycle brief and by Releases A–D.

**Neither is closed here**, because closing another session's PR is Alex's call
rather than a tidy-up, and because a closed PR is harder to read than an open
one if he ever wants what is in them. They are recorded so that nobody reads
"3 open PRs" as unfinished work.

### Two one-off local failures, recorded rather than dismissed

Separately from the above: `offline.spec.ts:113` and `bags.spec.ts:171` have each
failed in a full parallel **local** run. If either returns: for `offline`, look
at `serviceWorkerReady` before the caches; for `bags`, at how many trips the
database is carrying — the suite creates about 60 per run and tears down at the
end.

#### `offline.spec.ts` — a NEW test that shipped with a race, and the race is closed

E2 added `Today stays readable with the network cut`, and it failed roughly one
full parallel run in three while passing twenty times in isolation. It was not
flaky and it was not the service worker.

Clicking `Unlock` **starts** the login POST; it does not finish it.
`serviceWorkerReady` then waits on a completely different async chain —
registration and shell precache — so under load it was satisfied while the
session cookie was still in flight, and the `fetch` that created the trip went
out unauthenticated. The response was a 401 whose body has no `trip`, and the
test read `body.trip.id` straight off it, so the whole thing surfaced as
`Cannot read properties of undefined`.

**Measured, not guessed.** A scratch spec that removed the wait entirely
returned **401 on 6 of 8 runs**, with the body quoted. The fix is `signIn`,
which waits for the primary navigation — that cannot render until the session
check has answered, which is the actual state transition. The other three specs
in that file survived by accident: each clicks a nav link next, and Playwright's
actionability wait happens to cover the same gap.

The lesson generalises, and it is the same one as the `approveAll` flake above:
**wait on the state you mean, not on a state that usually arrives after it.**

**`bags.spec.ts:171` recurred during E1** — once, at the 30s *test* timeout
rather than at a 5s assertion timeout, which points at an **action** waiting for
actionability rather than at an assertion waiting for a value. The suspect is
the `.check-main` click after the bag filter is cleared: D2 moves completed rows
to the bottom on a snapshot that only settles once the tapping stops, and
Playwright will not click an element it considers still moving. Four full runs
since have been clean, including four repeats of `bags.spec.ts` in isolation, so
it is recorded rather than fixed on a guess.

### The e2e isolation defects — **fixed in Q1**

Everything below this heading was measured before Q1 and is kept as the record
of what was wrong. Q1 closed the causes; the entries stay so the class is
recognised if it returns.

**Four distinct mechanisms**, not one flaky suite:

| # | Mechanism | Evidence | Fix |
|---|---|---|---|
| 1 | **Three specs acted on a trip they did not own.** `/api/trips` answers `ORDER BY start_date DESC`, so `trips[0]` is whichever trip another spec last created. `swipe`, `swipe-touch` and `necessity-reasons` packed rows, unpacked them and asserted on the reasons of a borrowed trip while its owner mutated it | The single line `const trip = trips[0]`, in three files | `createTrip()` per file, deleted in `afterEach`. Guarded by `tests/unit/e2e-isolation.test.ts` |
| 2 | **Two specs mutated GLOBAL rows.** `packing_rule` is not trip-scoped, so setting *Contacts* to 42 per day changed every other spec's quantities for as long as it was set — including the `12 nights × 2 = 24` arithmetic `necessity-reasons` asserts | Cleanup was the last line of the test body, so any failure above it skipped | Own the item; tear down in `afterEach`, which is the only path that mattered |
| 3 | **Nothing was ever deleted.** **176 trips** had accumulated in the local database. Every one is loaded by the Trips screen and by every readiness check | A full run took **4.2 min** on a fresh database and **6.1 min** on the same one later — and one test tipped over a wait that had been comfortable | A run-level `globalTeardown` removing only names matching `ownedName`'s shape |
| 4 | **Unique names came from a clock.** `${prefix} ${Math.floor(performance.now())}` collides when two workers reach the same millisecond, and a collision means one spec's locator matching another spec's trip | Ten specs | `ownedName()` — owner, counter and a random suffix |

**Two latent bugs surfaced the moment the borrowed trip went away**, which is
the argument for owning it:

- `swipe-touch › the tap path still works` read the row's NAME from
  `rows.first()` and its BOX from `rows.first()` again, with an `ensurePacked`
  between them that reorders the list. It tapped one row and asserted on
  another. It only ever passed because the borrowed trip usually arrived with
  that row already unpacked, making the reorder a no-op.
- The same test tapped at viewport coordinates without scrolling first. A fresh
  trip has a taller header, so the first row sat at **y≈629 in a 664px
  viewport** — half of it below the fold — and the tap landed on nothing.

**And a real product bug, found by the teardown rather than by a test.**
`daily_plan.outfit_group_id` is a foreign key, and `TRIP_SCOPED_DELETES` removed
`outfit_group` **before** `daily_plan` — so SQLite refused the batch and **a trip
whose Today screen had ever been opened could not be deleted at all**. `Delete
for good` answered 404 and the trip stayed on the list.

It survived every existing test because none of them made a `daily_plan`: the
only spec that writes one is `today.spec.ts`, the only spec that deletes a trip
is `trips.spec.ts`, and no test had ever done both. The end-to-end teardown found
it by trying to remove every trip the suite had created and failing on exactly
those two. Fixed by moving `daily_plan` and `wear_log` ahead of the rows they
reference; the regression test in `trip-lifecycle.test.ts` was verified to fail
with `FOREIGN KEY constraint failed` against the old order.

**The proof, because one green run proves nothing here.** Four runs, and the
awkward ones are the middle two — a second run against a database the first one
dirtied, and the files in the opposite order:

| Run | Database | Workers | Order | Result |
|---|---|---|---|---|
| A | fresh | 1 (CI's setting) | default | **164 passed, 0 flaky** — 4.3 min |
| B | **the one A just used** | 1 | default | **164 passed, 0 flaky** — 4.2 min |
| C | **the one B just used** | 1 | **reversed** | **164 passed, 0 flaky** — 4.6 min |
| D | fresh | 2 (local default) | default | **164 passed, 0 flaky** — 3.1 min |

The CI run on C2's final head reported **11 flaky**. The B row is the one that
matters most: before Q1 a second run against the same database took 6.1 minutes
and failed a test; it is now no slower than the first.

**One thing that is NOT a defect and must not be "fixed":** approving an outfit
writes `outfit_pairing`, a **catalog** table that deliberately outlives the trip
(doc 04 §5 criterion 3, migration 0008). So a second run against the same
database genuinely plans differently, by design. Tests must not assume a
pristine wardrobe; they must not delete pairings to get one.

---

### Before Q1 — the original entries



- **e2e shared-database flakes.** `trips.spec.ts › reaches the rest of the
  wardrobe only through search` and `itinerary.spec.ts › reads pasted text into
  days` each fail intermittently in a full run and pass in isolation. CI retries
  once and reports them as `flaky` rather than `failed`. Pre-existing — one was
  observed against `origin/main` before any of this work — and caused by specs
  sharing one database rather than by the product. **Not fixed, deliberately
  recorded**, so it is not rediscovered as new. Worth a slice of its own: give
  the e2e suite per-file trip fixtures.
- **The same defect, in a worse form: a LOCAL database a failed run poisons.**
  Found during C2, and worth stating separately because it does not look like a
  flake. `shell.spec.ts › adds an amount, changes it, removes it, and puts it
  back` adds an amount to *Bombas Socks* and removes it again at the end. The
  picker it uses excludes items that already have an amount
  (`results.filter((i) => !existingItemIds.has(i.id))`), so a run that fails
  *before* the removal leaves the rule behind — and **every later run of that
  test then fails immediately**, with a timeout waiting for a `.picker-row` that
  can no longer exist. It is not intermittent after the first failure; it is
  permanent until `.wrangler/state` is deleted.
  Verified rather than assumed: the leftover
  `packing_rule.original_text = 'Set in Your usual amounts'` row was read
  straight out of the local D1 file, and the suite passed again on a fresh
  database. Q1 should fix the cause; until then, **a local e2e failure in this
  test means "reset the database", not "the product broke"**.
- **C2 made this class measurably worse, and that is worth saying.** The CI run
  on C2's first head reported **7 flaky**; the run on its final head reported
  **11**, all in the same cluster — clicking *Approve outfit* on a card and
  waiting for it to become *Undo approval* (`outfits.spec.ts`,
  `replace-or-remove.spec.ts`, `today.spec.ts`, and C2's own spec). Every one
  passed on retry, and the same cluster was already flaky before C2 existed, so
  it is not a new defect. But C2 adds six end-to-end tests that each create a
  trip and plan outfits against the one shared database, and more contention on
  a contended resource is exactly what turns retries into failures.
  **Q1 is now the highest-value slice in §4 that is not a product feature.**
- **Two defects in C2's own end-to-end tests, found by CI and not by the local
  run**, because CI uses **one worker** and the local fallback uses two, so
  every round trip is slower there and a race that never opens locally opens
  reliably on CI. Both fixed:
  - `answer()` clicked the next decision as soon as the outfit CHANGED, which
    can be a moment before the request that changed it has settled — and
    clicking a disabled button is a no-op that looks exactly like a click, so
    the following wait timed out against a screen that never had its chance to
    move. It waits for the button to be enabled now.
  - The closing summary labelled a **deferred and incomplete** outfit "Missing
    something" while the breakdown above it counted the same outfit under "left
    for later". One outfit, two labels, and no way to tell they were the same
    one. The row now buckets deferral first, matching `coverageBreakdown`, and
    the test asserts the two **agree** rather than asserting an incidental
    ordering.
  Local runs should use `--workers=1` before trusting a green e2e result.
- **The same family again, on GLOBAL state rather than a trip.** `shell.spec.ts
  › a typed amount is saved…` sets *Contacts* to 42 per day and puts it back at
  the end. The amount is **global**, so while it is set every other spec's
  packing list is reading a number that is about to change back — and the whole
  `Your usual amounts` group mutates one shared list from two parallel workers.
  Observed failing once in a full run on a clean database during C2, and
  **31/31 in isolation on a clean database**, which is what makes it this class
  and not a product defect. The C2 diff does not touch `Settings.tsx`.
  Q1 is the fix: per-file fixtures, and amounts that are not global for the
  duration of a test.

---

## 6. Outstanding phone verification

Accumulating for one consolidated session:

| From | What needs a thumb |
|---|---|
| A4b | Packing rules: *How many* field, kind picker, *Use the default*, delete + undo |
| ~~Swipe hotfix~~ | ~~The gesture itself~~ — **done, and it passed.** See §3 |
| Release B | Home's one recommended action at real widths |
| C2 | The guided outfit review: three decisions one-handed, auto-advance, edge-swipe back out of the review, and whether focus moving to each outfit's name reads well under VoiceOver |
| D3 | Bag assignment from the row sheet, the bag filters, and handing a row back to the suggestion |
| ~~P1~~ | ~~Whether it actually feels fast~~ — **passed, 2026-08-04, on cellular. See §4.** |
| D4 | `Before you go`: whether the rows are big enough to hit one-handed while standing, holding something in the other hand |
| S1 | Sign out with a connection and without one, and a sign-out in a second Safari tab |
| D5 | One word, on one button |
| F1 | The post-trip review: the five questions one-handed, the wardrobe picker's search and scroll, and whether the summary reads as *shown* rather than *asked* |
| F2 | Packing in real Airplane Mode: the ticks staying, `Saved on this phone` under VoiceOver, a force-quit between the tap and the reconnect, and a sign-out with one still pending |
| ~~E1 / E2~~ | ~~Today, the unresolved-slot recovery, and the four weather states~~ — **done, and it passed. 2026-08-04.** See §4 |

**Two rows are struck through, and both were verified on 2026-08-04.** P1 on
cellular, and E1 + E2 in one consolidated Today and weather session. Everything
else in the table is still outstanding and is written up as one sitting in
`technical-docs/08_MANUAL_IPHONE_CHECKLIST.md` under *Release D and P1*, in a
deliberate order — the D4 part needs the state the earlier parts leave behind.

---

## 6a. Alex's corrections — queued, with the scope measured

Five product corrections raised on **2026-08-04**, after F1 shipped. Recorded
here rather than acted on immediately, because the instruction was explicit: do
not interrupt a coherent slice in progress, and none of these is a correctness
prerequisite for F1.

**Every "scope" line below was checked against the repository**, not inferred
from the wording. Two of them turned out to be far smaller than they read, and
one turned out to touch a canonical list that needs saying out loud.

### G0 — trip archive and delete: **already shipped. Withdrawn.**

Raised, then withdrawn the same day once found. For the record, so nobody
re-opens it: `POST /:id/archive`, `POST /:id/restore` and `DELETE /:id` all
exist, the Trips screen carries archive/restore and a two-step *Delete for good*
with an explicit "cannot be undone", and `TRIP_SCOPED_DELETES` names every
trip-owned table children-first — F1 added `trip_review_answer` to it, and
`trip-lifecycle.test.ts` holds that a reviewed trip can still be deleted.

**One half of the request survives the withdrawal and is a real open question:**
does an **archived** trip still feed learning? `pendingRemovalProposals` and
`pendingUnwornProposals` filter on `item.archived_at`, on `excluded_at`, on
`trip.end_date` and on the wear-log gate — but **neither filters on
`trip.archived_at`**. So a trip Alex has put away still counts towards "you have
taken this off your list on 3 trips". That is a one-line correctness fix in two
queries, it is squarely F1's family, and it is **G1** below rather than a
re-opening of trip management.

### G1 — archived trips must not feed learning

| | |
|---|---|
| **Depends on** | nothing; F1 is already deployed |
| **Scope** | two `WHERE` clauses. `pendingRemovalProposals` has no `trip` join at all and needs one; `pendingUnwornProposals` already joins `trip` and needs `AND t.archived_at IS NULL` |
| **Not in scope** | deleted trips (they contribute nothing by construction — the rows are gone), and any change to what archiving means |

**Acceptance:** an archived trip's removals and unworn items produce no
proposal; un-archiving restores its evidence; a completed, un-archived trip is
unaffected; deleting a trip removes its evidence and leaves accepted `learned`
rules alone, because those are `packing_rule` rows and no trip owns them.

**Test/demo trip isolation** is the same mechanism and needs no second one:
archiving is the durable marker, it is not a name match or a timestamp, and the
e2e teardown already deletes what it created by the shape `ownedName()` produces.
The failure mode worth a test is the one the request names — a **failed**
teardown leaving a trip behind — and archived-excludes-learning makes that
harmless as long as the teardown archives what it cannot delete.

### G2 — more than one activity on a day

**Much smaller than it reads, and the schema is already right.**

`trip_event` is keyed by `(trip_id, event_date, sort_order)` with no uniqueness
on the date, and `setTripDays` already writes **one row per entry**, not one per
date. `getTrip` reads them back in order. So storage, the writer and the reader
all already support a beach afternoon and a formal dinner on the same date.

The collapse is in two places, both client-side:

| Where | What it does |
|---|---|
| `Days.tsx` | holds `Map<date, activityTag>` — one activity per date, by construction |
| `Itinerary.tsx`'s apply | merges into `new Map(trip.days.map(d => [d.date, d]))`, dropping a second entry for the same date — **and its own `dayKey()` already says a date can hold two**, so the reader and the writer disagree inside one file |

| | |
|---|---|
| **Depends on** | nothing structural. **No migration.** |
| **Scope** | the two maps above, the "Which days?" UI (entries grouped under a date, an `Add another activity` action), and an audit of every consumer of `Trip.days` for a one-per-date assumption — `planGroups`, `assignDays`, `weatherForGroup`, `dayOfPlan`, Today |
| **Risk** | `assignDays` spreads groups across dates; two groups wanting the same date is the case to get right |

**Acceptance:** beach + formal dinner produce separate outfit needs; sightseeing
+ casual lunch may share one; adding a second activity after an approval leaves
the approved outfit alone (D1c already freezes approved groups); removing one of
several leaves the others; the packing list follows deterministically; swimwear
never replaces the daytime outfit.

### G3 — outfit search must reach the whole wardrobe

| | |
|---|---|
| **Depends on** | G2 only in that both touch the outfit planner; independent otherwise |
| **Scope** | `swapCandidates` and `SwapSheet`. C2b already made the sheet say what it filtered by; this adds a deliberate way past the filter |
| **Constraint that must not move** | doc 04 §10 — During Trip and Today may recommend only **packed** clothing. Planning is a different moment and may reach the whole active wardrobe; the two must not be conflated |

**Acceptance:** recommended alternatives first; a search that reaches every
active wardrobe item; a jacket findable from a `Layer` slot; a mismatch
explained rather than prevented; the explicit choice preserved against a later
replan (which is `filled_by = 'user_swap'`, already stored); archived items
still excluded.

### G4 — Pack now ordering and the bag filters

| | |
|---|---|
| **Depends on** | nothing. D2 (completed-to-bottom) and D3 (bags) are both shipped and both must keep working |
| **Scope** | `checklist-order.ts` gains a category rank; `CHECKLIST_FILTERS` is replaced |
| **Must not break** | D2's rule that a row does not move while a swipe or inline edit is live, and does not jump during rapid taps — `checklist-order.test.ts` holds it |

Filters become **Everything / Still to pack / Personal bag / Carry-on / Checked
bag**, with `Either cabin bag` appearing under **both** cabin filters and
unassigned rows under neither. Category order: essentials and documents first,
clothing last, and within clothing a stable order rather than alphabetical.

**Naming is part of the slice, not a follow-up.** `BAG_SENTENCE`/`BAG_SHORT`
already hold the user-facing words; one vocabulary, chosen once, and **no stored
enum meaning changes for copy**.

### G5 — the seeded packing rules Alex does not want

| | |
|---|---|
| **Depends on** | nothing |
| **Needs saying** | **`Plane Seat Cushion` is not an imported workbook rule.** It is one of the five canonical `MISSING_ITEMS` added by migration 0009, with a `conditional_include` on `flight_hours > 6` — and `readiness.ts` cites it by name as half the reason the long-flight question is worth asking. Removing it means editing that canonical list and that question's wording, which is a deliberate act rather than a rule deletion |

Gas-X and the two sunglasses rules are imported workbook rules and are ordinary
to retire. The sunglasses replacement is **two rules for two items** —
prescription and non-prescription, one each per trip — resolved by **stable item
id**, not by name matching, because the wardrobe may hold ambiguous duplicates.

**Non-destructive by construction:** retiring a rule is `disableRule`, which
writes a superseding row and never touches the seeded one, so *Use the default*
still restores it. Finalized trips are not rewritten; a regeneration reconciles
them, and manual rows and explicit edits survive (that is D1b's ownership rule).

### G6 — wardrobe names that repeat their own fields

| | |
|---|---|
| **Depends on** | nothing |
| **Scope** | an import-time and display-time normalisation: `Various colors Pair of Thieves boxer briefs` → title `Boxer briefs`, brand `Pair of Thieves`, detail `Various colors` |
| **The hard part** | telling a generated repetitive name from one Alex means. Deterministic cleanup **only** where the title demonstrably contains the row's own `brand` or `color` values; anything ambiguous is left alone and gets an edit path instead |

**Acceptance:** the item id never changes, so approved outfits, checklist rows,
`outfit_pairing`, learned rules and archived state all survive untouched; search
still finds the brand and the colour even though neither is in the title any
more — which means searching across title, brand, colour and notes rather than
forcing keywords into the visible name.

### The order these will be done in

Alex's suggested order, adjusted where the repository shows a safer one, and the
reasoning is recorded because the change is deliberate:

| | Slice | Why here |
|---|---|---|
| 1 | **G1** archived trips out of learning | Two `WHERE` clauses, and it protects F1's own family. Smallest thing with the largest correctness return |
| 2 | **F2** offline reliability | Already audited and next in the approved roadmap. Moved **ahead** of G2–G6: it is the last unbuilt item of the original plan, and every one of G2–G6 changes a screen F2 has to cache |
| 3 | **G4** Pack now ordering and filters | Self-contained, no schema, and it is the screen Alex uses most |
| 4 | **G5** the seeded rules | Self-contained. Ahead of G6 because it is about rules, and G6 renames the items those rules point at |
| 5 | **G2** several activities on a day | The largest, and the one whose planner assumptions need the most care |
| 6 | **G3** outfit search across the wardrobe | Touches the same planner as G2; cheaper after it |
| 7 | **G6** wardrobe naming | Last on purpose: it changes what items are *called*, and every slice above asserts on names |
| 8 | **Final** whole-product pass | Unchanged |

**G0 is withdrawn** and **G1 replaces the half of it that was real.** F1 is
already deployed, so nothing here gates it.

---

## 7. Scoped, not lost

### A11-1 — the two carried accessibility defects

Both were found during C1's accessibility review, both were correctly judged
**not C1's to fix**, and both would otherwise live only as rows in a "recorded,
not fixed" table. Scoped here so the slice exists rather than the memory of it.

| # | Defect | Where | Measured |
|---|---|---|---|
| 1 | Quantity and timing chips carry no `aria-pressed`. Selection is colour plus font weight only, so VoiceOver announces a chosen chip and an unchosen one identically | the checklist entry sheet | Read from the markup; no `aria-pressed`, no `role="radio"`, no other selected-state hook |
| 2 | `.check-critical` ("· Essential") uses `--color-text-tertiary` at 14px | `src/routes/Trip.css` | **2.79:1** Light, **3.86:1** Dark. WCAG AA wants 4.5:1 for text this size |

**Scope.** Give the chips a real selected state a screen reader can hear —
`aria-pressed` on toggles, or a radio group where the choice is genuinely
exclusive — and move `.check-critical` to `--color-text-secondary`
(**4.93:1** / **7.68:1**, already measured and already the colour C1 moved
`.entry-why-label` to). Audit the other tertiary-on-14px text in the same pass;
`--color-text-tertiary` measures 2.79:1 on the light surface and 2.57:1 on the
light background, so any *text* using it fails, and only decorative glyphs
(`aria-hidden` chevrons) may keep it.

**Acceptance.** A test that fails against each defect before it is fixed — the
C1 lesson, in writing: that release shipped one accessibility test that could not
fail, and the review caught it. Contrast is arithmetic and belongs in a unit
test over the token values, not in a screenshot.

#### A11-1 — delivered

| Defect | Before | After |
|---|---|---|
| Entry-sheet chips carried no selected state | VoiceOver said "2, button" whether chosen or not | Quantity chips report `aria-pressed`; timing chips are a named `radiogroup` of `radio`s |
| `.check-critical` — the "· Essential" marker | **2.79:1** Light, **3.86:1** Dark | **5.28:1** Light, **6.99:1** Dark |

**Two semantics, because they are two different things.** The timing set is a
radio group: `packingTiming` is never null and never outside `TIMINGS`, so
"exactly one is chosen" is a fact about the data rather than a convention the
screen keeps — and it matches `AppearanceChoice`, the pattern already here. The
quantity set is not: `qtyOverride` can be null or a number those five chips do
not offer, and *Use suggested* is an **action** sitting among them, which a
`radiogroup` may not contain. `aria-pressed` describes each of those honestly on
its own.

**The contrast fix is deliberately not the danger colour.** Doc 06 §3 rules out
alarm fatigue, and an essential a fortnight before departure is not an
emergency — `readiness()` decides when it becomes one. The marker moved to the
same `--color-text-secondary` the meta line beside it already used, so it costs
nothing in restraint and stays quieter than the item name. The meaning was never
in the colour: the word "Essential" is text.

**Both test sets were verified to fail against their defects.** Six of nine chip
assertions fail with the ARIA removed; the contrast test fails with
`--color-text-tertiary on the row is 2.79:1 in Light`.

**And the first contrast test could not fail**, which is now three times in this
repository. It asserted that `--color-text-secondary` meets AA — true, and
proving nothing, because putting `.check-critical` back on tertiary would leave
it green. It reads `Trip.css`, finds which variable that class actually uses, and
measures **that** one.

**Not blocking.** Neither defect is new, neither was introduced by C1 or C2, and
neither blocks a release. C2 avoided adding a third instance: `.outfit-markers`
and `.review-fact dt` take `--color-text-secondary` for exactly this reason, with
the measurement in the CSS comment beside them.

#### Q1 and A11-1 — deployed

PR #40 merged to `main` on 2026-08-01; the Deploy workflow ran to success as
run `30711870627`. **Version `964e7b83-eb80-4d9a-8598-83d9d9a6ff8b`.**

**No migration.** The `Apply D1 migrations` step ran and had nothing to apply —
0012 was already live from C2. **No data impact:** nothing in this release
writes, reads or reshapes a stored row. What reached production is two
behavioural fixes — the trip-delete ordering in `TRIP_SCOPED_DELETES`, and the
chip semantics and `.check-critical` colour — plus tests, fixtures and docs.

**Not verified against the live endpoint.** Outbound HTTPS from the agent
environment is gated by network policy, so the deploy log is the evidence and is
labelled as such (§5).

### Laundry — **ruled, and implemented**

Alex's ruling, 2026-08-01: laundry is a **deterministic cap on the number of days
of ordinary washable clothing that have to be carried.** Four days, when
`laundry_available = yes`. On a twelve-day trip an ordinary washable top with a
rewear capacity of 1 needs **four** distinct wears instead of twelve.

#### It is a fact about the trip, never about the garment

A t-shirt's `reuseCapacity` is still 1. Laundry does not make a shirt wearable
twice unwashed, and nothing in the copy says it does — the explanation reads
`4 days of clothing · laundry available`, which is about how much has to be in
the bag at once. A test asserts that no line mentions rewear or reuse capacity in
the same breath as laundry.

#### Where the cap bites, and why it had to move

The first implementation capped the finished quantity in `clothingDemand`, and
**it did nothing at all.** A twelve-day casual group already picks twelve
different t-shirts at one wearing each, so no single garment's total ever
exceeded four to be capped. The cap belongs in `assign`, in the loop that decides
how many *changes of a garment* a group needs — that is the number laundry
actually changes, and the row quantities follow from it.

Its own test could not fail either, for exactly the same reason, and now measures
changes of a garment rather than one row's number.

#### What it may reduce, and what it may never touch

An **allowlist**, because the failure modes are asymmetric: wrongly cutting a
swimsuit leaves Alex short on a trip, and wrongly sparing a t-shirt costs him a
t-shirt of luggage.

| May be reduced | Never reduced |
|---|---|
| `T-Shirt`, `Tank Top`, `Shirt`, `Pants`, `Shorts`, `Basics`, `Underwear`, at dressiness **Smart casual or below** | `Outerwear`, `Mid-Layer` — a layer is what has to still be there while everything else is in the machine |
| slot roles `top` and `bottom` | `Shoes`, `Sandals`, `Swimwear`, `Accessories` — each named in the ruling |
| | anything **dressier than Smart casual** — a dress shirt for the one nice dinner is not a rotation |
| | anything with an **unrecorded** subcategory or dressiness — unknown washing suitability |

Read from `subcategory` and `dressiness`, which are recorded catalog data.
**Never from the brand or the name** — "Lululemon" is not evidence, and neither
is "Machine Wash" in a title. A test proves two garments differing only in
subcategory are judged differently.

There is a second guard the plan applies while it chooses: the cap only stops the
loop while **everything chosen for that slot so far is ordinary washable
clothing**. One garment that must not be reduced and the slot goes back to
covering the whole group.

#### Precedence — laundry sits fourth

1. explicit trip-level edit
2. explicit user rule or override
3. accepted learned preference
4. **laundry adjustment**
5. system default
6. fallback

`Underwear — 2 per day` therefore stays at **24** on a twelve-day trip with
laundry, and a test says so. It falls out of D1b's ownership rule rather than
needing new machinery: a garment with a rule is owned by the rule writer, and the
outfit writer — which is where the cap lives — contributes nothing for it. Making
an individual rule laundry-sensitive is a later, separate change; this slice does
not touch the rule builder.

#### The three "change nothing" cases, kept distinct

`laundryAvailable` is three-valued and the check is `=== true`, not truthy:

- **answered no** — unchanged
- **never answered** — unchanged. An unanswered question is not a no and is
  certainly not a yes, and it must never pack *less* than it did before this
  shipped
- **four days or fewer** — unchanged, and no laundry explanation is rendered for
  a quantity laundry did not affect

And it can only ever lower a number. The mechanism is a `break`, not a formula.

#### Existing trips are not silently recalculated

Reading a checklist cannot move a clothing quantity: the C1 explanation backfill
runs `generateChecklist`, which owns rule rows only, and the clothing half moves
only when Alex approves an outfit or edits a slot. A test regenerates twice on a
finalized trip and asserts every clothing quantity is where it was.

**15 tests, mutation-checked.** Setting the cap to 99 fails three; widening the
allowlist fails the category test; making `laundryCapFor` always return null
fails three more.
