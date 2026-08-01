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

---

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
| **Swipe hotfix** Touch recognizer | **phone-accepted** | #33 | _recorded on deploy_ | Recognizer replaced. Real-iPhone check **PASSED** — see §3 |
| **B / B2** Readiness model, Home + Trip Details | phone verification pending | #30 | `abbf8958-50e0-4b95-9386-4f37e4056b4c` | No migration, no data impact |

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
| Method | `previews_enabled: false` on the Worker subdomain — **not** URL obscurity |
| Anonymous verification | recorded in the `retire-preview` workflow log |

**If a future slice needs a device preview**, it must not reuse this shape. The
correct design is a separate Worker with its own D1 database and its own seed
data, so a preview URL can never reach real trips. Recorded here so the next
person does not rediscover the shortcut.


#### Next action

None. Phone-accepted, scaffolding removed, preview retired. Merging and
deploying; **Release C resumes at C1**.

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

**Where it resumes, exactly:** from the latest `main` **once the swipe hotfix is
deployed**, at **C1** — give the generated necessities a plain reason, and
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
| **Q1** e2e test isolation | not started | — | Per-file trip fixtures; kills the shared-database flakes in §5a |
| **C1** Necessities completeness + reasons | audited, not started | B | **Findings below.** Give the unexplained rows a reason; decide Day-of |
| **C2** Guided outfit review | not started | C1 | One unresolved outfit at a time; Approve / Change / Later |
| **D1** Synchronisation audit | not started | C2 | Verify each claim in doc 09 §8 against the code first |
| **D2** Packing-list filters + ordering | not started | D1 | Completed-to-bottom, settle before reorder |
| **D3** Bag assignment | not started | D2 | Bag filters only ship if this does |
| **D4** Day-of departure view | not started | D3 | |
| **D5** `Unique item for this trip` rename | not started | — | Copy, a11y labels, docs, tests. Not DB fields |
| **E1** Today screen | not started | D4 | |
| **E2** Weather refresh policy | not started | E1 | Deterministic triggers; distinguish live/cached/seasonal/unavailable |
| **F1** Post-trip review | not started | E1 | Evidence-gated; blocked where During Trip was never used |
| **F2** Offline reliability | not started | F1 | Queue writes **or** document the limitation honestly |
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

**The categories themselves are fine.** Every category doc 09 §6 names is
represented; chargers arrive under Electronics rather than as a category of
their own, which is a naming difference and not a gap.

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

- **e2e shared-database flakes.** `trips.spec.ts › reaches the rest of the
  wardrobe only through search` and `itinerary.spec.ts › reads pasted text into
  days` each fail intermittently in a full run and pass in isolation. CI retries
  once and reports them as `flaky` rather than `failed`. Pre-existing — one was
  observed against `origin/main` before any of this work — and caused by specs
  sharing one database rather than by the product. **Not fixed, deliberately
  recorded**, so it is not rediscovered as new. Worth a slice of its own: give
  the e2e suite per-file trip fixtures.

---

## 6. Outstanding phone verification

Accumulating for one consolidated session:

| From | What needs a thumb |
|---|---|
| A4b | Packing rules: *How many* field, kind picker, *Use the default*, delete + undo |
| ~~Swipe hotfix~~ | ~~The gesture itself~~ — **done, and it passed.** See §3 |
| Release B | Home's one recommended action at real widths |
