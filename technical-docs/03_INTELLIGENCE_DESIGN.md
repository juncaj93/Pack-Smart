# Pack Smart — Deterministic Intelligence Design

Status: **Approved.**

> This is a curated travel interpreter built from structured rules. It is **not** AI, is never
> described as AI internally or externally (doc 03 §1), and uses no paid API.

## 1. Pipeline

Pure functions over structured input, which is what makes it both explainable and testable:

```
structured inputs + raw notes
  → normalize → match → facts (certainty + evidence) → conflict resolution
  → confirmed facts → rule evaluation → item demand → outfit generation
  → consolidated checklist
```

## 2. Keyword and phrase detection

A curated lexicon of `{patterns[], fact, value, certainty, category}` entries, seeded from doc 03 §2.

**In v1 the lexicon ships as a versioned, unit-tested TypeScript file**, not database rows. An
editing UI is v1.1. This keeps it diffable and testable and avoids a settings screen nobody needs yet.

Matching runs on a normalized string (lowercased, whitespace collapsed, contractions expanded,
punctuation retained for clause boundaries) using longest-match-first with word-boundary anchors.
**Every match records its character span** so the UI can quote Alex's own words back verbatim as
evidence.

## 3. Negation

Notes are split into clauses on sentence terminators, semicolons, and coordinating conjunctions
(notably `but`). Within a clause, a bounded window before and after the match is scanned for
negation cues: *no, not, won't, will not, don't, doesn't, never, without, skip, avoid, no need for*.

A negation **flips the fact's polarity** rather than dropping the match, so "no laundry" yields
`laundry_available = false` — a positive, actionable fact — rather than silence.

Every cue gets its own test fixture.

## 4. Certainty levels

Hedge cues (*probably, maybe, might, likely, possibly, I think, may*) downgrade `certain` → `likely`.
Weak or highly ambiguous single-token matches start at `possible`.

The three levels have distinct, non-overlapping behavior:

| Level | Behavior |
|---|---|
| `certain` | Applied automatically, listed under **Understood** |
| `likely` | Applied, but listed under **Please confirm** with the quoted evidence |
| `possible` | **Not applied.** Offered as a suggestion chip only |

No numeric confidence is ever computed or displayed (doc 02 §4, doc 06 §3).

## 5. Follow-up-question triggers

A fixed catalogue of questions, each with a `required_fact` and an `asked_when` predicate (fact
absent, certainty below `certain`, or two facts in conflict).

A question is only asked if it is **also material** — and materiality is computed honestly rather
than assumed: **the rule engine is run once per candidate answer and the resulting item sets are
diffed.** If the answer changes nothing, the question is never asked. At ~120 items this costs
microseconds.

Questions are capped at 4 and ordered by the size of the diff. This directly implements doc 02 §5's
"only unresolved questions that materially affect recommendations."

## 6. Personal quantity calculations

`computeQty(rules, facts, prefs) → { qty, breakdown[] }`, where each breakdown entry is a
human-readable line ("12 trip days × 2 = 24").

**Trip days are calendar days, counted inclusively** (`(end − start) + 1`). Nights are the exclusive
count. 31 July → 11 August = **12 trip days, 11 nights**.

Seeded per-day preferences: **contacts = 2 × trip days**, **underwear = 2 × trip days**.

> The source workbook says `Nights × 2` for contacts. The approved product decision outranks it.
> The original string is preserved in import history for traceability, never overwritten.
> Doc 03 §9's own worked examples corroborate the calendar-day reading — both "Underwear: 14 of
> **24** packed" and "Contacts: 20 of **24** packed" are 12 days × 2; nights × 2 would give 22.

Composition precedence is in `02_DATA_MODEL.md` §6.

## 7. Outfit ranking — two stages, never one score

A single weighted score produces plausible-looking nonsense (a loungewear quarter-zip picked for a
nice dinner because it scored well on "favorite"). So:

**Stage 1 — hard filters (eliminating):** required/requested items, activity-tag match, weather-band
overlap, dressiness within the group's range, not archived, in inventory — and for During Trip,
**confirmed packed**.

**Stage 2 — scoring among survivors**, in doc 04 §5 order: approved saved outfit relationship >
favorite > usage frequency > versatility across the trip > reuse efficiency > variety.

Filtering before scoring makes "specialized suitability may override popularity" structurally true
instead of a weight-tuning accident. Ties break on stable item id so results are reproducible run to
run. Each selection records which criterion decided it — that becomes the explanation line.

## 8. Clothing reuse

Per-category default `reuse_capacity`: jackets/shoes/belts effectively unlimited, pants ~3, shirts
and tees 1, performance shirts 1 after a hot activity, underwear and socks 1. Overridable per item
and by preference ("do not rewear shirts" pins shirts to 1; "pack light" raises pants and shirts
by 1).

Assignment is **greedy over outfit groups ordered most-constrained-first** (specialized activities
before generic ones), consuming capacity as it goes, with a bounded repair pass that backtracks the
least-constrained prior assignment when a group cannot be filled. A full search is unnecessary at
this scale.

If a slot still cannot be filled it is left empty with an `unmet_reason`. **Never filled with an
approximation.**

## 9. Weather adjustments

Daily min/max/precipitation per destination-date map to warmth bands. Band overlap is a **hard
filter** for outerwear and mid-layers and a **soft preference** for tops. Rain probability above a
threshold on an outdoor event creates a rain-layer demand.

Beyond the 16-day forecast horizon the system uses climate normals **and says so**.

## 10. Explanations

Every generated row carries structured causes; the UI renders them through a template function,
never free text.

Suppressed for obvious `always_packed` items. Shown for exactly the six cases in doc 03 §12: an
unusual pick, a favorite beaten by conditions, a dependency, a critical requirement, a calculated
quantity, a notable exclusion. One concise line.

## 11. Conflict resolution

One precedence order, applied uniformly:

```
explicit user answer (this trip)
  > structured trip data (dates, destination country, entered flight duration)
  > certain detection
  > saved preference
  > likely detection
  > category default
```

Structured data outranks text so that, for example, international status is derived from the
destination country rather than from a phrase.

Two conflicting detections at the **same tier** are never silently resolved — they become a confirm
question showing both quoted snippets. Every resolution is recorded in `trip_fact.superseded_by`.

## 12. The no-false-intelligence invariant

> **Critical items may only be triggered by structured facts** — dates, destination country, entered
> flight duration — **never by a `possible`-certainty text match.**

Encoded in the type system, not left to discipline. Passport, ID, medication, and adapter are all
structured-fact-driven. This is doc 03 §5's hard line: critical packing must never depend solely on
fuzzy text interpretation.

Corollaries enforced by tests:

- No garment is tagged rain-capable unless its own data says so. Brand reputation is not evidence —
  the Arc'teryx jacket's note reads "Versatile lightweight black jacket," so it is **not** a rain
  shell.
- The system never invents clothing Alex does not own (doc 04 §15).
- During Trip recommends only confirmed-packed items, enforced at a single candidate-selection
  function that the During Trip code path cannot bypass.

## 13. Current-trip vs permanent changes

Guaranteed structurally by the catalog/trip split (`02_DATA_MODEL.md` §1), not by convention.
Checklist and outfit endpoints have no write access to `item`, `preference`, or `packing_rule`.

After a qualifying edit (doc 03 §7's triggers — quantity changed, favorite repeatedly replaced,
timing changed, item removed across similar trips) the system writes a
`preference_change_suggestion` and surfaces a lightweight "Update your usual preference?"
affordance. Promotion is a separate explicit endpoint. **Nothing permanent ever changes as a side
effect.**
