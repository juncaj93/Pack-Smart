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

### Swipe regression hotfix — `active`

- **Owner:** this session. **Depends on:** nothing.
- **Cause:** the app handled **no touch events at all**. `touch-action: pan-y`
  leaves vertical panning to the browser; a real thumb swipe carries vertical
  drift, so Safari's scroll arbitration ran in parallel with the row's own,
  fired `pointercancel` mid-gesture, and the row reset with the finger still
  down and moving. That loop is the jitter. `preventDefault()` on a *pointer*
  event cannot stop a scroll, and React attaches `touchmove` as **passive**, so
  `onTouchMove` could not either.
- **Why no test caught it:** every existing swipe spec drives `page.mouse`, and
  `touch-action` governs touch input only. The tests exercised a gesture the
  phone was never running.
- **Fix:** a native, non-passive `touchmove` listener that vetoes the browser
  pan for exactly as long as the row owns the axis; plus single-pointer
  ownership, so a second finger cannot re-anchor a gesture in flight.
- **Tests:** `tests/e2e/swipe-touch.spec.ts` — genuine `TouchEvent`s, one frame
  per move, asserting `defaultPrevented`. **Verified to fail against the broken
  build and pass against the fix.**
- **Next action:** merge and deploy when CI is green on the head.

### Release B — guided trip readiness — `PR open` (#30)

- **Delivered in this slice:** `shared/readiness.ts` (one derived state, one
  next action, pure, never stored), Home driven by it, §4.1 essentials calming,
  `technical-docs/12_READINESS.md`.
- **Acceptance met so far:** one clear next action visible on Home; derived from
  real data; optional incompleteness does not block (questions defer themselves
  inside three days); essentials still protected on the packing list; Home
  calmer; no stored status involved.
- **Acceptance NOT yet met:** *"the same trip cannot show contradictory
  readiness across screens"* — the Trip screen still derives its own progress
  and banner. **This is the next action for Release B.**
- **Migration / data impact:** none.
- **Next action:** point `Trip.tsx` at `readiness()`, then the Trips list.

---

## 4. Remaining, in dependency order

Scope for each is in doc 09 §3 and the roadmap brief; only delivery state lives
here.

| Slice | Status | Depends on | Next action |
|---|---|---|---|
| **B2** Trip screen reads readiness | not started | B | Replace Trip.tsx's own progress/banner derivation |
| **B3** Trips list reads readiness | not started | B2 | One state per row, no second definition |
| **B4** Unresolved-question flow | not started | B | One question at a time, deferrable, from `openQuestions` |
| **C1** Necessities completeness + reasons | not started | B | Audit generated categories against doc 09 §6 before building |
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

## 6. Outstanding phone verification

Accumulating for one consolidated session:

| From | What needs a thumb |
|---|---|
| A4b | Packing rules: *How many* field, kind picker, *Use the default*, delete + undo |
| Swipe hotfix | **The gesture itself** — jitter gone, both directions reach their action, list still scrolls, diagonal swipes work |
| Release B | Home's one recommended action at real widths |
