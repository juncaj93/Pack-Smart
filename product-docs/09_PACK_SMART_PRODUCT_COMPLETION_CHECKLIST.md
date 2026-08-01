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
| **Swipe hotfix** Touch recognizer | **deployed** | #33 | `9baad615-a72c-4439-9e3c-aa543214c761` | Recognizer replaced. Real-iPhone check **PASSED**. Deploy run `30691345539` |
| **Preview URLs off for good** | **deployed** | #34 | `dc51cfde-fe16-4b30-9d40-f8505a7b828a` | `preview_urls: false` in `wrangler.jsonc`. See the incident note in §3 |
| **B / B2** Readiness model, Home + Trip Details | phone verification pending | #30 | `abbf8958-50e0-4b95-9386-4f37e4056b4c` | No migration, no data impact |
| **C1** Necessities have reasons | **deployed** | #36 | `16fdd292-1b06-49fc-a7f3-14a123657536` | 0 of 32 unexplained, on the real workbook |
| **C2** Guided outfit review | **deployed** | #38 | `bb212c53-a311-44e4-9f08-7ba3a2a1b882` | Migration `0012` applied remotely, 2 commands, ✅. Deploy run `30704185309` |

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
| **C2** Guided outfit review | **deployed**, phone verification pending | C1 | Walkthrough route, `deferred_at` (migration 0012), coverage summary, travel/multi-day markers. Laundry is the one §7 clause left open — no canonical rule exists, see §7 |
| **A11-1** The two carried accessibility defects | **deployed** | — | Chips report state; `.check-critical` **2.79 → 5.28:1**. Contrast is a unit test over the real tokens now, not a screenshot review. Shipped with Q1, same version |
| **C2b** Swap sheet knows a group's own dates | **done** | C2 | Dates **derived**, not stored — the proposed `dates_json` column was rejected on inspection. Sheet applies the planner's dressiness ceiling, warmth band and rain demand, and says what it filtered by |
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

### Laundry in outfit planning — needs a product decision

Doc 09 §7 asks the planner to *"respect rewear and laundry"*. Rewear it does
(measured above). Laundry it does not, and **no canonical document says what
respecting it would mean** — doc 03 §2 makes `no laundry` a trip fact to parse,
and doc 04 line 294 explicitly rules out a laundry ledger. There is no approved
multiplier, threshold, or interaction with `reuse_defaults`.

Implementing one would change packing quantities on every trip Alex has already
answered the laundry question for, which is precisely what C1 was forbidden from
doing to explanation copy. **Blocked on a product decision, and recorded as
blocked rather than quietly marked complete.**
