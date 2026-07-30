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
| Every route vs. every client call path | server features with no way to reach them |
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
| **`trip_event`** | Only `activity_tag` is read. `dressiness`, times, and indoor/outdoor are stored and consulted by nothing — so "morning vs afternoon vs evening" and "indoor vs outdoor" from doc 04 §3 have no effect. |
| **`trip.status`** | Display status is *derived* from dates (correct). The stored column's `packing` and `active` values are **never written**. `/api/trips/:id/status` and `setTripStatus()` in `src/lib/trips.ts` are reachable but called by nothing. |

### Absent

| Capability | Evidence |
|---|---|
| **Essentials-coverage check at trip time** | **The most valuable gap.** `coverageWarnings()` (`shared/import.ts:570`) runs only at *import* and checks only for a rain layer. Nothing ever asks "does Alex own a charger at all?" |
| **Learning from removals** | `excluded_at` is respected *within* a trip (`checklist.ts:208`) and read by nothing across trips. Removing the same item from five trips teaches nothing. |
| **Learning from additions** | Trip-only additions are never counted, so a thing added by hand every time is added by hand forever. |
| **Learning from wear** | `wear_log` is written and read only inside During Trip. "Packed but never worn" and "repeatedly worn" influence nothing. |
| **Explicit preference-change proposals** | `preference_change_suggestion` exists in the schema and **no code references it at all** — not one read, not one write. Doc 04 §7's "Update permanent preference when explicitly chosen" has no mechanism. |
| **Data export / backup** | `/api/settings/export` exists and **no client code calls it.** Alex has no way to get his wardrobe and trip history out of the app. |
| **`checklist_link`** | Table created by migration 0004; **never written, never read.** `09_IMPLEMENTATION_NOTES.md` claims it "is what keeps that true in both directions" — that claim is false. Sync works via `checklist_entry.source` instead. |

### Dead / unreachable

`/api/trips/:id/history` · `/api/trips/:id/checklist/generate` · `/api/trips/:id/status` ·
`setTripStatus()` · `item.source_row_json` (write-only, defensible as import provenance).

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
| 1 | **Essentials coverage** — a trip-time check naming essentials that are absent from inventory, or present with no rule. Honest and specific, never inventing an item. | 1 | in progress |
| 2 | **Learn from repeated removals and additions** — count them across trips, propose a permanent change explicitly, reversibly. Gives `preference_change_suggestion` its purpose. | 5 | planned |
| 3 | **Learn from wear** — surface "packed and never worn" after a trip; feed it into quantities and outfit ranking. | 5 | planned |
| 4 | **Connect per-event formality and time of day** — `trip_event.dressiness` and times into the planner. | 4 | planned |
| 5 | **Data export** — reach the existing endpoint from Settings. Alex's data should not be trapped. | 10 | planned |
| 6 | **Remove dead code** — `checklist_link`, the unreachable routes, `setTripStatus`, and correct §3 of the implementation notes. | 12 | planned |

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
