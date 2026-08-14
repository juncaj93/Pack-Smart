# Post-V1 Intelligence — Session Handoff

**Written 2026-08-14. `main` at `ff3151b`, deployed.**

This is a handoff for the remaining Post-V1 intelligence slices. It exists because
the previous session's most expensive mistakes were all *investigative* rather
than technical — time spent building things that already existed, and time spent
chasing a CI failure that was never in the diff. The sections marked **Do not
repeat** are the ones worth reading before writing any code.

---

## 1. Where things stand

| | |
|---|---|
| `main` | `ff3151b` — deployed, green |
| Open PRs | none |
| Pending migrations | none |
| Known failing tests | none |

Merged and deployed in the last session:

- **#109** Outfits calm UI — counter removed, approved cards tinted, `Approve` reshaped, swap sheet 55px shorter
- **#110** Packing list — `Essential` hidden not deleted, `5 needed` moved right; plus the date-authority fix
- **#112** Item-level plan delta engine + replan surface
- **#113** Outfit swap → packing consequence

### The production bug is closed

`Up North Labor Day` showed outfit cards with no garments and a failing
`Refresh suggestions`. **Cause: a grandfathered trip** — created before the
current planner, carrying group rows a regeneration then repaired. Not a code
defect; it resolved once the trip was replanned against current code.

**Worth considering, not yet done:** other trips created before the same point
may hold the same shape. A read-only audit (`outfit_group` rows with zero
`outfit_slot` children) would say whether any remain. Do not write a repair
migration without first counting what it would touch — CLAUDE.md requires
approval for anything that mutates stored data.

---

## 2. Do not rebuild — this already exists

The previous session's Phase 0 audit found that a large part of the originally
proposed "learning foundation" was **already implemented**. A plan that starts by
building it will duplicate working infrastructure.

| Exists | Where |
|---|---|
| `wear_log` — real wear evidence: `will_wear`, `already_wore`, `not_available`, `too_warm`, `too_cold` | migration 0011-ish, `worker/repos/during-trip.ts` |
| `trip_review_answer` — post-trip answers, `CHECK`-constrained to kinds something can turn into a proposal | migration 0016 |
| `preference_change_suggestion` — `pending` / `accepted` / `dismissed` | `worker/repos/learning.ts` |
| Post-trip proposal engine — `reviewProposals`, `isOutstanding` | `shared/review.ts` |
| Cross-trip proposals — `removalProposals` (threshold 3), `unwornProposals` | `shared/learning.ts` |
| Closet review decisions | `closet_review_decision`, `src/routes/ReviewCloset.tsx` |
| Per-field provenance | `item_field_provenance`, migration 0020 |

**"Behaviour creates a proposal; Alex creates truth" is built.** Treat it as
foundation to extend, never as a greenfield.

### The one rule that governs extending it

`wear_log` gives *positive* evidence only. `already_wore` proves wear. The
**absence** of a row proves nothing — Alex may simply not have opened Today that
day. Any proposal phrased as "you never used this" must be built on a recorded
`not_available` / explicit answer, not on missing rows.

---

## 3. The delta engine — read this before touching any "what changed" copy

`shared/plan-delta.ts`. This is the piece the audit identified as the real gap,
and it is now the shared mechanism. **Do not write per-surface change logic.**

```ts
planDelta(before: PlanSnapshot, after: PlanSnapshot): PlanDelta[]
deltaLines(deltas: PlanDelta[]): string[]   // ≤ DELTA_LINES_SHOWN (3)
planChanged(deltas: PlanDelta[]): boolean
```

`PlanSnapshot` is `{ entries, groups, gaps }` — pass empty arrays for the parts a
surface genuinely does not touch. That emptiness is documentation, not laziness.

### Kinds

`item_added` · `item_removed` · `quantity_changed` · `bag_changed` ·
`timing_changed` · `outfit_changed` · `gap_opened` · `gap_resolved` ·
`approved_outfit_review_required`

### What it deliberately ignores, and why that is the valuable half

Ordering, `reason` text, `qtyBreakdown`, and `packedQty` all move on almost every
regeneration. A delta that surfaced them would fire every single time and teach
Alex the line means nothing within two trips. **If you find yourself adding a
kind for one of these, the feature is wrong, not the engine.**

### Two identity decisions that will bite if reversed

- **Checklist rows match by `entry.id`.** `generateChecklist` UPDATEs survivors
  in place rather than delete-and-reinsert, so the id is stable for exactly the
  rows whose identity is stable. Matching on `itemId` loses trip-only rows, which
  have none.
- **Outfit groups match by `name`.** Ids are minted fresh on every plan; the
  template is what persists. This is the same rule the replan uses.

`excludedAt` is treated as *leaving the plan*, not as an attribute change —
`Not bringing changed` describes a column; `Removed` describes the plan.

### Already wired

| Surface | File | Snapshot passed |
|---|---|---|
| Replan | `worker/routes/outfits.ts` `POST /generate` | groups only |
| Outfit swap | `worker/routes/outfits.ts` `PUT /:groupId/slots/:slotId` | entries only |

### Not yet wired — the obvious next candidates

- `PUT /trips/:id/days` (`worker/routes/trips.ts:212`) — itinerary changes
- `PUT /trips/:id` (`:159`) — trip edits that regenerate the checklist
- bag assignment changes
- laundry answer changes

Each is the same shape: snapshot before, mutate, snapshot after, return `deltas`.

### Latest intent — do not reimplement it

On the client, deltas ride `settle` in `useOptimisticWrite`, which is already
gated:

```ts
const current = () => tickets.current.get(key) === mine
.then((result) => { if (!current()) return; edit.settle?.(result) })
```

A slow response for something Alex has already changed again cannot print over
the newer state. **Route new deltas through `settle`** rather than adding a
second versioning scheme.

---

## 4. Remaining slices

Roughly in dependency order. None is blocking; all are real.

### A. Bag-by-bag packing *(largest genuine gap)*

An optional view over the **same authoritative checklist** — never a second list.

- `BagKey = 'wear' | 'personal_item' | 'carry_on' | 'checked' | 'either'`
  (`shared/checklist.ts:288`)
- Entries carry `bag` and `bagSource` (`'user'` = Alex chose, otherwise inferred)
- Bag planning already exists in `shared/bags.ts` (`planBags`)

Requirements: show only bags this trip actually uses; no row appears in two
places; preserve delayed-bag resilience, liquids rules and explicit gaps; never
invent an assignment to fill a slot. Entry point concept: `Pack by bag`.

### B. Smarter physical packing stages

**Audit the vocabulary before designing.** Two systems already exist and must not
be tripled:

- `packing_timing`: `anytime` · `night_before` · `day_of` · `last_minute`
- `ChecklistSection`: `pack_now` · `pack_later` · `final_check` · `not_bringing`
  (mapping lives in `sectionFor`, `shared/rules.ts:553`)

Goal is defaulting to the currently actionable stage rather than showing four
large sections at once. Departure-day critical-item behaviour must survive.

### C. Cross-trip learning — extend only

`shared/learning.ts` has `removalProposals` (threshold 3) and `unwornProposals`.
Genuinely missing proposal types: repeated **outfit substitution**, repeated
**bag override**, repeated **timing override**, repeated **quantity correction**.

Keep evidence explainable — count, recency, context. No opaque scores. One
coherent model across post-trip review, Review Closet, and Settings → Learning.

### D. Recurring closet-gap insights

`CoverageGap` exists (`shared/essentials.ts`, kinds `unreachable` | `missing`).
Surface only *recurring* structural gaps; resolved gaps stop appearing; archived
items must not falsely satisfy coverage. **Not a shopping feature.**

### E. Smarter past-trip reuse

> Reuse structure, not stale output.

Carry planning assumptions forward, then regenerate from current dates, weather,
wardrobe, rules and learned preferences. Never clone checklist rows, old
forecasts, archived garments or settled outfits. This is directly relevant to the
grandfathered-trip bug above.

### F. Surprising quantity explanations

`rowExplanationParts` (`shared/checklist.ts`) already holds the arithmetic and
the sheet already shows it under *Why this many*. The slice is deciding **which**
quantities are surprising enough to explain inline. Rows stay compact; do not
restore arithmetic to every row — that was removed deliberately.

---

## 5. Do not repeat — hard-won rules

### CI truth

- **A green badge can mean *skipped*.** The workflow skips WebKit when the diff
  touches only docs — and a **zero-file diff satisfies that condition**. An empty
  "control" commit returned green in 80 seconds having run no e2e at all. Always
  check step 12 (`End-to-end tests (WebKit @ 390x844)`) is `success`, not
  `skipped`.
- **Retries share the database.** "Failed twice in one job" does not prove
  determinism. Use a fresh job.
- **Local green is not enough for environment-specific defects.** The sandbox
  cannot reach the weather service; CI can. That difference hid a real bug.
- **Do not call a test failure a harness problem without evidence.** One session
  lost an evening to that assumption; the tests were right.

### Date authority

Product semantics are **the traveller's local calendar day** and are correct.
`resolveTodayDate` (`shared/today.ts`) ranks: destination IANA zone → device date
→ UTC. The destination zone is saved from the weather response.

**Never derive a user-facing trip date in a test from
`new Date().toISOString().slice(0, 10)`.** The e2e default destination is Cape
Town (`Africa/Johannesburg`, UTC+2), so from 22:00 UTC the app is correctly on
tomorrow and a UTC-derived fixture is on yesterday. Use `todayForTrip(page,
tripId)` from `tests/e2e/fixtures.ts`, which asks the same endpoint the screen
renders from.

`currentDateFor` is pinned in `tests/unit/worker/today.test.ts` with Kiritimati
(UTC+14) and Midway (UTC−11), so the chain is proven at any hour rather than only
inside the window that once broke CI.

### Route regression

**Before deleting a control because it looks redundant, check what routes through
it.** Removing the `Review 5` counter removed the only navigation into
`/trips/:id/outfits/review` — an approved, deployed feature — leaving it reachable
only by typing the URL. It is now reached via the quiet `Review one at a time`
below the cards. Do not reintroduce the counter; do not remove that link.

### CSS specificity

Two single-class selectors of equal specificity are resolved by Vite's
concatenation order. This has silently dropped a rule **five times**. Use
compound selectors (`.button-quiet.outfit-walkthrough`, `.chips-compact.swap-scope`).
See `13_VISUAL_SYSTEM.md` §12.

### Look at the screen

Three defects last session were invisible in code review and obvious in a
screenshot. `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run qa:visual` writes
to `.visual/390/`. The env var is required in this sandbox — without it Playwright
looks for a headless shell that is not installed.

---

## 6. Working agreements

- Feature branch → PR → **exact-head green with WebKit confirmed executed** →
  merge → deploy. Merging to `main` **is** a production deploy.
- Never merge red, never weaken CI, never paper over a failure with retries,
  sleeps or raised timeouts.
- Additive migrations only; destructive ones need explicit approval.
- No paid APIs. Deterministic, explainable intelligence only.
- Mutation-test load-bearing behaviour: apply the mutation, confirm the *right*
  test fails, restore, confirm green. A test that cannot fail is not a test.
- Silence is a feature. If a change did nothing, the screen says nothing.

---

## 7. Suggested first move

Start with **A (bag-by-bag)** — the largest genuine gap, entirely additive, and it
exercises the delta engine's `bag_changed` kind which is currently defined but
unused by any surface.

Before writing code: read `/product-docs`, `shared/bags.ts`, and
`src/routes/Trip.tsx`'s checklist rendering. The bag view must be a *lens* over
the same entries — the moment it holds its own rows, the two plans can disagree.
