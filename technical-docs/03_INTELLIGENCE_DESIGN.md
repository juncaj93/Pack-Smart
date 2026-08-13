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

**Stage 2 — scoring among survivors**, in doc 04 §5 order: requested > activity and weather
suitability > approved saved outfit relationship > favorite > usage frequency > versatility across
the trip > reuse efficiency > variety.

Filtering before scoring makes "specialized suitability may override popularity" structurally true
instead of a weight-tuning accident. Ties break on stable item id so results are reproducible run to
run. Each selection records which criterion decided it — that becomes the explanation line.

### The saved-outfit relationship

Scored from **counted co-occurrence in approved outfits**, never inferred from style, colour, brand
or name. `outfit_pairing` holds one row per unordered garment pair with the number of approved
outfits containing both.

- Written when a group transitions **draft → approved**, and reversed on **approved → draft**, so
  the table cannot drift from what Alex currently stands behind. The transition is checked before
  writing; re-approving an already-approved group must not double-count.
- Ordered canonically (`item_a_id < item_b_id`) so a pair has exactly one row regardless of which
  garment is looked up first.
- A candidate's score is the **sum** of its pair counts against the garments already chosen for that
  outfit, so it grows with genuine evidence rather than being a boolean.
- It sits at position 3, **below weather suitability**: a habit may never override the conditions.
- **Empty index → every score is 0**, and the ranking is byte-for-byte what it was before. This is
  the property that makes the criterion safe to add to a system that already works.

Because a score alone is not an explanation, the winning criterion can supply a sentence naming the
partner garment — "You approved this with Olive Quilted Jacket before". Doc 04 §5 requires the
pairing be traceable to something Alex did.

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
filter** for outerwear and mid-layers and a **soft preference** for tops.

Everything below is computed **per outfit group, from that group's own dates**. Rain on the city
days does not make the safari mornings wet, and a trip-wide "it rains at some point" would put a
waterproof requirement on every outfit of the trip.

### Rain is a demand; wind is a preference

Rain above `RAIN_THRESHOLD` on any of a group's days makes that group's **outer slot required**,
and only a garment recorded as keeping rain out may fill it. Arriving somewhere wet with nothing
waterproof is a real problem.

Wind above `WIND_THRESHOLD_KPH` is a **ranking preference only** — doc 04 §5 criterion 2,
"activity and weather suitability", which sits above favourite. Being slightly cold in a breeze is
not a problem worth emptying the jacket slot over, and promoting wind to a requirement would do
exactly that on every trip where nothing happens to be tagged for it.

### Capability is recorded, never inferred

**A jacket is not a rain layer because it is a jacket.** Capability comes only from:

1. `item.weatherTags` — the explicit field, edited in My Stuff. Authoritative.
2. The words in the item's own name and notes, which came from Alex's spreadsheet. "Gore-Tex"
   written by him is evidence; "Outerwear" as a subcategory is not.

Nothing else. A garment with neither is treated as having no recorded capability, and the planner
leaves the slot empty saying *"Rain is likely and nothing in your wardrobe is recorded as keeping
it out"* rather than nominating the nearest jacket. The word lists match `coverageWarnings()` in
`import.ts`, which already warns at import that nothing is described as waterproof — that warning
is now consequential.

### Formality

`trip.max_dressiness` caps every template's dressiness ceiling. It **cannot lower a template's
floor**: saying "nothing formal" about a trip that includes a wedding must not put Alex in
loungewear at the wedding. Unanswered caps nothing — it is not the same as "casual".

### Saved preferences

`reuse_defaults` and `warmth_bias` are read from the `preference` table into the engine.
`reuse_defaults` overrides the per-category reuse capacity; `warmth_bias` shifts the warmth band,
clamped to the 0-3 scale. An item's own `reuse_capacity` still wins over both. A malformed
preference row is ignored rather than fatal — a corrupt preference must not cost Alex his outfits.

### Beyond the forecast horizon

Open-Meteo's **archive** endpoint, asked for the same calendar window in each of the previous five
years and averaged. Same family, same free terms, no key.

Every row is marked `climate_normal` and every surface that shows it says so. This is the specific
way the feature could mislead: **"18 °C" reads identically whether it is Tuesday's forecast or an
average of five Augusts.** `01_ARCHITECTURE.md` §6 names that confusion; the label is the whole
safety property, so it survives every hop from parse to screen.

A normal carries **no rain probability**. The archive returns millimetres of rainfall, not a
chance of rain, and converting one into the other would be inventing a probability — so a normal
drives no rain demand. Pack Smart does not claim to know whether it will rain in three months.

A month-day with no usable readings is dropped rather than interpolated: half an average is not a
weaker answer, it is a different one.

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

---

## 14. Change-aware replanning

`Plan again` used to run the planner. The planner is deterministic, so against
unchanged inputs it produced the same answer — which made the control either a
no-op or, where a tie fell differently, a shuffle. Neither is what is being
asked for by somebody pressing it a week before departure with a colder
forecast on their phone.

The question it answers now is **"what is different from when this plan was
made"**, which needs a record of the inputs and a comparison that only fires on
differences the planner could act on. Both live in `shared/replan.ts`.

### The threshold rule

A forecast moving 67°F → 65°F must create no work. One moving 57–67°F → 41–49°F
must. The line between them is not a number invented for this module: it is
`warmthBandForDays`, the **hard filter the planner applies to jackets and
mid-layers**. Two forecasts that produce the same band are the same forecast as
far as any packing decision is concerned, however different the numbers look.

Comparing bands rather than degrees means this cannot drift from the planner,
because it is asking the planner's own question. Rain is compared the same way,
at `rainOutlook().likely` rather than at a raw percentage. The degrees ARE
carried in the snapshot — for the sentence "about 18°F colder than when you
planned" — and nothing is ever decided from them.

`planSignals` also records the activities, the named days, the dates, the
destinations, the dressiness ceiling and the laundry answer. Anything in that
list the planner does not read would be a source of false alarms; anything it
reads that were missing would be a change Alex is never told about. So the
contents are exactly `generateOutfits`' arguments.

### The four outcomes

| Case | What it is | What happens |
|---|---|---|
| A | Approved and still eligible | Untouched. Silent. |
| B | Approved and merely out-ranked now | Untouched. Silent. |
| C | Approved and now **ineligible** | Flagged for review. Never rewritten. |
| D | Draft | Replanned from current truth. |

B is the one that is easy to get wrong. "The planner now prefers something
else" is inference, and CLAUDE.md and doc 04 §5 both put Alex's explicit choice
above inference. Only an outfit that has become *ineligible* is surfaced, which
is the difference between a fact and an opinion.

### How C is detected

By **re-running `passesFilters`**, not by a table of "colder weather affects
layers". That table would be a second model of the planner kept in step by
hand, and the day it drifted the product would either nag about outfits that
are fine or stay silent about one that is not.

`passesFilters` already knows which garments a set of conditions admits — it is
what admitted these ones. Running it again under current conditions asks the
only question that matters, in the planner's own terms: *would this outfit
still be allowed to exist?* The reason it gives is the reason it would have
given at planning time.

An empty slot is not a conflict. `outfitMarkers` already reports a missing
garment, and saying it twice in two vocabularies is how one screen ends up
contradicting the other.

### Determinism

`rank` breaks ties on `item.id` (`compare`, `shared/outfits.ts`), so the same
inputs produce the same order. `planSignals` sorts its lists so the same trip
cannot produce two different snapshots. `tests/integration/smart-replan.test.ts`
asserts that replanning twice over unchanged inputs changes nothing.

---

## 15. Recommendations in the swap sheet

`Recommended` used to mean *eligible*, ordered alphabetically — so the garment
Pack Smart would actually have chosen sat wherever the alphabet put it, and the
label was a claim the list did not support.

The suitable candidates are ordered by `rank` now: the planner's stage two,
with the same lexicographic criteria order, the same silence where a criterion
had nothing to say, and the same deterministic tie-break.

**Eligibility still happens first and separately.** `rank` only ever sees the
survivors of `passesFilters`, so nothing it scores can promote a garment that
failed a filter. A hard exclusion cannot be out-ranked, which is the ordering
doc 04 §5 requires.

The ranking context includes **the rest of the outfit** (`chosenInGroup`), which
is not an optimisation: the "you wear these together" criterion had nothing to
compare against on the one screen whose whole question is what goes with what,
so it could never fire there.

Each candidate carries at most one reason — `rank`'s `decidedBy`, which is null
unless a criterion actually separated the winner from the runner-up. A list
where every row is annotated is a list where the annotations are wallpaper.

---

## 16. Colour

Pack Smart has no garment photos and is not getting any. What it has is a
colour word on nearly every item — and a word is something you decode rather
than see. `Navy · Grey · White · Dark Green` is four things to read before the
palette arrives; four dots is the palette.

`shared/colors.ts` holds all of it. It is **presentation plus one soft ranking
signal**, no schema change, no dependency, no network.

### Reading a colour out of what was typed

The `color` column is free text from a spreadsheet. The real wardrobe holds
**thirty-one distinct strings and eleven of them are not colours** —
`Custom Printed`, `Various Colors`, `Suede`, `Plaid`, `Brooklyn Design`,
`Neutral Tones`. Others are half-finished (`Navy w`) or compound
(`Gray, Navy, Short Gray`, `Heather Gray`).

So the module matches colour **words inside the string** rather than looking the
string up in a table. An exact-match table renders nothing for any of the three
awkward shapes above, and a table big enough to hold every phrasing is the
taxonomy project this deliberately is not.

Three rules make that safe:

- **Longest word first.** `dark green` is tried before `green`, or every dark
  green garment renders mid-green. Sorted at module load rather than by hand.
- **Word-anchored.** `Brooklyn Design` matches nothing; `Greyhound` is not grey.
- **At most two, one per family.** `Gray, Navy, Short Gray` is two colours; the
  second grey is the same fact again.

Anything unrecognised produces **no swatch at all**. A placeholder would be the
interface claiming knowledge nobody has, and a "please classify this" prompt
would be a maintenance chore invented by a display feature.

### The compatibility signal

`colorFit(candidate, outfit)` returns `-1`, `0`, `1` or **`null`**, and the null
is the important one: `rank` skips a criterion that is null on either side, so a
garment whose colour reads `Suede` is not penalised for it. Missing data is an
absence, not a judgement (doc 05 §4).

| Result | When |
|---|---|
| `-1` | the outfit is already one single family and this is it too |
| `1` | the candidate is a neutral, or shares a family with something in the outfit |
| `0` | no opinion |
| `null` | either side has no recognised colour |

The `-1` is checked first, so it applies to neutrals too — head-to-toe grey is
the same observation as head-to-toe green.

**A neutral outfit allows a colour; it does not make one good.** An earlier
version read §16's "an outfit containing strong neutrals should allow more
candidate colours" as a reward and scored *any* colour 1 against grey trousers
and white shoes — which meant it could not separate a turquoise shirt from a
navy one in the single commonest case on the screen. The permission is expressed
by the absence of a negative instead.

There is no score, no percentage, no hue arithmetic and no colour wheel.

### Where it sits, and what it may never do

**Last in `CRITERIA`**, below every single thing Alex has actually told the app:
what he asked for, activity fit, formality, the forecast, what he has approved
together before, how often he reaches for it, how comfortable he called it.
`CRITERIA` is compared lexicographically, so position *is* authority — colour
can only separate garments that are already equal on all of the above.

It cannot promote an ineligible garment **at all**, because `rank` only ever
sees what survived `passesFilters`. The whole of eligibility happens before this
criterion is reachable.

It has no `clause`, so it never appears in an outfit card's one-sentence
explanation: *Chosen because it goes with the grey trousers* is a claim about
taste dressed as a fact. A colour reason appears only on the swap sheet, beside
the alternatives it is distinguishing, and it names them —
`Works with the everyday pants and white sneakers` is checkable in a way the
criterion's own name is not.
