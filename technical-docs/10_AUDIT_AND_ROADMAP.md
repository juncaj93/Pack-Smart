# Pack Smart — Whole-product audit and roadmap

**Canonical.** This file is the standing record of what is actually built, what only looks built, and
what happens next. It supersedes prior summaries — including the "not built, and why" table in
`09_IMPLEMENTATION_NOTES.md` §3, which was written from memory and has been wrong twice.

Audited against the code at `20de121` (production version `ced9a5bd`). Every claim below was checked
by reading the implementation, not by trusting a note.

---

## 1. Method

Four sweeps, each chosen because it finds a *specific* class of lie:

| Sweep | Finds |
|---|---|
| Every schema column vs. every identifier in `worker/ shared/ src/` | fields written and ignored |
| Every route vs. every client call path | server features with no way to reach them — **and this sweep produced a false positive; see §2 "Absent"** |
| Every `preference` key vs. its readers | settings that appear to work and change nothing |
| Every "learning" input in the mission vs. its consumers | storage masquerading as intelligence |

---

## 2. Status of every meaningful capability

### Complete and verified on a real device

Passphrase auth and the one-year session · the app shell · **top navigation and document
scrolling** (Safari's toolbar collapses — confirmed on hardware) · My Stuff list, add, edit, archive,
restore · the header **+** control · trip creation and derived facts · the rules engine and generated
checklist · Pack Now / Pack Later / Final Check / Not Bringing · quantity overrides and undo ·
outfit planning with hard filters then lexicographic scoring · per-day activity tagging → one outfit
per occurrence · During Trip using only packed items · One Last Look · workbook import and duplicate
detection · usual amounts (add, remove, undo, and they genuinely change the next list) · trip emoji ·
itinerary **text** import · **saved-outfit pairings** with announcement and Undo.

**Doc 04 §5 is complete** — all eight ranking criteria implemented.

### Complete, awaiting real-device acceptance (not blocking)

| Capability | Why it is not verified |
|---|---|
| **Past Trips / Plan again** | Integration and e2e cover it; never exercised on the phone. |
| **Climate normals labelling** | Open-Meteo is unreachable from CI, so **no test has ever seen a real normal.** A normal presented as a forecast is the one way weather can mislead. |
| **Real itinerary link / booking PDF** | Same: the build environment cannot fetch either. |
| **Live forecast** | Same. Parsers fail to *nothing*, so the worst case is no weather rather than wrong weather. |

### Partially wired

| Capability | Reality |
|---|---|
| **`trip_event`** | Only `activity_tag` is read; `dressiness`, times and indoor/outdoor are stored and consulted by nothing. **Left that way deliberately — see §4a**, which shows wiring them would change no recommendation. |
| **`trip.status`** | Display status is *derived* from dates (correct). The stored column's `packing` and `active` values are never written. The endpoint, repo function and client helper have now been **removed** (§4b); the column stays because dropping it is destructive. |

### Absent

| Capability | Evidence |
|---|---|
| ~~Essentials-coverage check at trip time~~ | **Built** (slice 1). Was the most valuable gap: `coverageWarnings()` ran only at import and only looked for a rain layer. |
| ~~Learning from removals~~ | **Built** (slice 2), from `excluded_at`, which was already recorded. |
| ~~Learning from wear~~ | **Built** (slice 3), from `wear_log`, guarded so a trip where During Trip was never opened does not make every item look unworn. |
| ~~Explicit preference-change proposals~~ | **Built** (slices 2–3) and `preference_change_suggestion` is now permanently unnecessary: proposals are **derived**, so they cannot go stale against the history that produced them. |
| **Learning from additions** | Still absent. Trip-only additions are not counted, so something added by hand every time is added by hand forever. The lowest-value of the four learning inputs, because adding is a one-tap action Alex has already chosen to take. |
| ~~Data export / backup~~ | **This finding was WRONG and is withdrawn.** Settings has had **Download a backup** since M10 (`Settings.tsx:79`), as a plain `<a href="/api/settings/export" download>`. My route sweep grepped `src/lib/*.ts` for fetch paths, and an anchor is not a fetch — so the sweep reported a working feature as missing. Recorded rather than deleted, because the *method* was flawed, not just the conclusion: **a "no caller" result means nothing until it is re-checked across all of `src/`, including plain links and form actions.** |
| **`checklist_link`** | Table created by migration 0004; **never written, never read.** `09_IMPLEMENTATION_NOTES.md` claims it "is what keeps that true in both directions" — that claim is false. Sync works via `checklist_entry.source` instead. |

### Dead / unreachable

**Removed in slice 6:** `/api/trips/:id/status`, its `STATUSES` constant, and `setTripStatus()` in
both the repo and the client.

**Still present, deliberately (§4b):** `GET /api/import/history` and
`POST /api/trips/:id/checklist/generate` — unreachable from the UI, harmless, plausible recovery
paths. `item.source_row_json` is write-only and defensible as import provenance. The three dead
tables/columns stay because dropping them is destructive.

---

## 3. The finding that matters most

**Pack Smart prevents forgetting to *pack* an essential. It does not prevent forgetting to *plan*
one.**

Checklist candidacy is "has at least one enabled rule" (`checklist.ts:160`). An item with no rule
never reaches any list. And `criticalOutstanding` — the "Still not packed" line on Home and Trip —
filters *entries that already exist*:

```ts
criticalOutstanding: bringing.filter((e) => e.isCritical && !isPacked(e))
```

So both silent-omission paths are wide open:

1. **The item does not exist.** No charger in inventory → no charger on any list, forever, with no
   warning. The app looks complete and confident.
2. **The item exists with no rule.** Medication in My Stuff but no rule → same outcome.

This is priority 1 in the mission ("prevent missing medication, documents, chargers, essential
gear") and it is the one place the product can fail Alex badly while appearing to work. Everything
else in this audit is smaller.

---

## 4. Roadmap, in mission-priority order

Each slice ships as a stable commit with docs and regression tests.

| # | Slice | Priority | State |
|---|---|---|---|
| 1 | **Essentials coverage** — a trip-time check naming essentials that are absent from inventory, or present with no rule. Honest and specific, never inventing an item. | 1 | **done** |
| 2 | **Learn from repeated removals** — counted across trips, proposed explicitly and reversibly. Needed **no** new table: `excluded_at` already held the evidence, so `preference_change_suggestion` stays unused rather than being populated — a derived proposal cannot go stale against the history that produced it. | 5 | **done** |
| 3 | **Learn from wear** — "packed and never worn" over finished trips, proposed explicitly and reversibly. | 5 | **done** |
| 4 | ~~Connect per-event formality and time of day~~ | 4 | **withdrawn — see §4a** |
| 5 | ~~Data export~~ — **already shipped.** The finding was wrong; see §2. | 10 | withdrawn |
| 6 | **Remove dead code** — partly done; scope and the deliberate exclusions are in §4b. | 12 | **done, scoped** |

### 4a. Why slice 4 was withdrawn

The audit said `trip_event.dressiness`, times and indoor/outdoor were "stored and consulted by
nothing", which is true. What the audit did **not** check is whether wiring them would change any
recommendation. It would not, and that makes it work with no user value:

- **Formality is already carried** by the activity template's own band — `wedding` is `[3,4]`,
  `nice_dinner` `[2,4]`, `hiking` `[0,1]` — and capped trip-wide by `trip.maxDressiness`. A per-event
  dressiness value would duplicate what the activity tag already says.
- **The itinerary already detects the formal cases.** `ACTIVITY_PATTERNS` maps `black tie` and
  `rehearsal dinner` to `wedding`, and `fine dining` / `tasting menu` / `michelin` to `nice_dinner`.
- **Indoor/outdoor** is implicit in the same templates, and its practical consequence — warmth, rain,
  wind — is already handled per group from that group's own dates.
- **Time of day** has no consumer that would change a garment. Morning safari and evening dinner are
  already separate groups because they are separate activities.

Honouring a per-day dressiness that *differs* from its activity's band would additionally require
splitting a group by date, since slots are chosen per group. That is real complexity for a case the
activity system already covers.

`CLAUDE.md` says to challenge unnecessary complexity, and the mission says not to prioritise what is
easy to code over what helps Alex. Filling three columns so the schema looks tidy, with nothing on
screen changing, is exactly that trade made the wrong way. **Withdrawn, with the reasoning recorded
so it is a decision rather than an omission.**

If a real need appears — an itinerary that says "black tie" on a day whose activity is *not* dressy —
the shape is known: split that day into its own group.

### 4b. What slice 6 removed, and what it deliberately did not

**Removed** — genuinely inert, no server behaviour changed:

- `POST /api/trips/:id/status`, its `STATUSES` constant, `setTripStatus()` in the repo, and
  `setTripStatus()` in the client. Display status is derived from dates; nothing ever wrote `packing`
  or `active`. The whole path was surface that looked like a feature.

**Corrected** — the false claim in `worker/repos/outfits.ts` that `checklist_link` "keeps that true in
both directions". What actually does it is `checklist_entry.source`.

**Deliberately kept:**

| Kept | Why |
|---|---|
| the `checklist_link` **table** | Dropping it is a **destructive migration**, which needs Alex's approval. It is inert and costs nothing where it is. |
| the `trip.status` **column** | Same: in the backup export, and dropping it is destructive. |
| `preference_change_suggestion` | Same. Now permanently unnecessary — proposals are derived, not stored (§4, slice 2). |
| `POST /api/trips/:id/checklist/generate` | Unreachable from the UI but a plausible recovery path, and removing it buys nothing. |
| `GET /api/import/history` | Same — harmless, read-only, useful for diagnosis. |

The pattern: **delete code, not data.** Removing an endpoint is reversible in a commit; dropping a
table is not.

### Where this cycle stopped, and why

**The roadmap is now complete.** Slices 1, 2, 3 and 6 are done; slice 4 is withdrawn with its
reasoning in §4a.

Two things need Alex, and only Alex:

1. **Dropping the three dead tables/columns** (`checklist_link`, `preference_change_suggestion`,
   `trip.status`) is a destructive migration. Not done, not scheduled — raised here so it is a
   decision rather than a silence.
2. The **standing production-only checks** below.

## 4c. Next cycle — found by inspection after the roadmap closed

### Doc 04 §8's replace-or-remove flow is server-ready and UI-absent

Approved **v1** scope, not v1.1. Doc 04 §8 requires that when a clothing item is removed from the
checklist, Pack Smart should *"identify outfits using it, offer to replace it, allow removal anyway,
with affected outfits marked incomplete."*

Evidence:

- `outfitsUsingItem()` exists (`worker/repos/outfits.ts:557`).
- The exclude route calls it and **returns `affectedOutfits` in the response**
  (`worker/routes/trips.ts:357-361`).
- **No client code reads that field.** Grepping `src/` for `affectedOutfits` finds nothing.

So the API pays to compute it on every removal and the answer is thrown away. Removing a garment
that three approved outfits depend on is silently accepted, and those outfits are left quietly
incomplete — which is the "two conflicting clothing plans" doc 04 §8 exists to prevent.

**This is the highest-value remaining item**, because it is a correctness gap in an approved
requirement rather than a new feature.

#### A second defect, in the data the server already returns

`outfitsUsingItem()`'s own comment reads *"Which **approved** outfits use a garment"* — but the query
has **no status filter**:

```sql
SELECT g.name FROM outfit_slot s
  JOIN outfit_group g ON g.id = s.outfit_group_id
 WHERE g.trip_id = ? AND s.item_id = ?
```

So it counts draft outfits too. Even the information already being computed is wrong for its
documented purpose, and any UI built on it would inherit that. **Fix this first** — it is two lines
and it changes what the rest of the slice is built on.

#### Suggested shape, and the part that needs care

1. Filter `outfitsUsingItem` to approved groups, and return **slot ids and roles**, not just names —
   a replacement needs a slot to fill.
2. On exclude: clear those slots, set an honest `unmet_reason` ("you took it off the packing list"),
   and call the existing `refreshGroupStatus` so a required slot genuinely reports `incomplete`.
3. Offer **Replace it** in the undo bar, opening the existing `SwapSheet` for that group and slot.
   `swapCandidates` already separates suitable from unsuitable — offer **only** the suitable ones, and
   leave the slot honestly empty when there are none.
4. **The part to get right:** `restoreEntry` must put the cleared slots back. Exclude and restore are
   currently single flag flips (`checklist.ts:295-317`); once exclude mutates outfit slots, undo has to
   mutate them back or the packing list and the approved outfits desynchronise. That is the failure
   this whole requirement exists to prevent, so it is the first test to write, not the last.
5. A garment used in **no** outfit must produce no extra prompt at all.

Today's wrong behaviour is at least *stable* — the outfit silently claims to be complete. A partial
implementation of the above is not, which is why it wants a session with real headroom rather than
the tail end of one.

### Still open, and still judged low value

**Learning from repeated additions.** The weakest of the four learning inputs: adding something is a
one-tap action Alex has already chosen to take, so a proposal saves him almost nothing. Recorded
rather than built.

### Deliberately deferred

- **Offline mutation queue** — v1.1 per the milestone plan. A failed save fails visibly today, which
  is the safer half.
- **Post-trip review** — v1.1 by approved scope.
- **Itinerary from images or email** — needs OCR or mailbox access; out of scope.

---

## 5. Standing production-only checks

Not blockers. Collected here so they are run together at the next release rather than one at a time:

1. Past Trips shows a finished trip, and **Plan again** prefills everything but the dates.
2. A trip more than two weeks out says *"This is the usual weather, not a forecast."*
3. A real itinerary link, and one behind a login (the second must say it hit a sign-in page).
4. A real booking PDF, and a scanned one (the second must say it holds pictures, not text).
