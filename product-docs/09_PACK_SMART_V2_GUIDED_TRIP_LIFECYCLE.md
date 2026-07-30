# Pack Smart V2 — Guided Trip Lifecycle

**Status:** approved, not started. Queued behind PR #24 (slice V2-5), which must merge and deploy
first.

**Numbering.** This is doc 09, not 08, because `08_PACK_SMART_V2_PRODUCT_COMPLETION.md` already
owns a different scope — the audit of what the *first* V2 pass left unfinished, now closed. That
document stays as the record of those gaps. This one owns the next cycle, and the two do not
overlap: 08 asks "what is missing from what we built", 09 asks "does the whole journey connect".

---

## 0. How to read this

Approved on 30 July 2026 while slice V2-5 was in flight. The instruction was explicit: **do not
interrupt, reset, broaden, or replace the work in progress** — finish it under its existing
specification, then begin this from the latest `origin/main`.

So this document is written before any of its implementation, which is unusual here and deliberate:
its whole purpose is to survive a context boundary. A fresh session should be able to read it and
continue without the conversation that produced it.

**§2 is the only part that is my own judgement rather than Alex's brief.** It is a first-pass
classification of what already exists, written from knowledge of the repository as of `3e8adc4`, and
it is explicitly marked as *needing verification against the code* before anything is built on it.
Everything else is the approved scope, restated so it cannot be lost.

---

## 1. The mission, in one paragraph

Pack Smart should feel intelligent because it uses trip facts, dates, destinations, itinerary
events, activity categories, weather, owned wardrobe, item capabilities, usual amounts, editable
rules, laundry access, luggage constraints, approved outfits, packing history, wear history and
explicit preferences — **not** because it has a paid AI API, a chatbot, generative branding,
unexplainable decisions, or hidden learning the user cannot reverse.

The journey it has to make cohesive:

1. enter or import the trip → 2. answer only the questions that matter → 3. generate necessities →
4. review only the outfits that need review → 5. finalize **one** synchronized list → 6. pack →
7. handle Day-of items → 8. see Today's outfit during the trip → 9. record minimal wear feedback →
10. a brief post-trip review → 11. improve future trips through explicit, reversible learning.

**This is not a collection of features.** Most of the parts exist. What is missing is the thread
between them.

---

## 2. First-pass state — **VERIFY BEFORE BUILDING**

Written from knowledge of the repository at `3e8adc4`, not from a fresh audit. The first task of the
first release is to check each line against the code and correct this table. Doc 08 §0 exists
because a green harness once described a product nobody had; the same rule applies to a document.

| Area | Believed state | Note |
|---|---|---|
| Trip creation, dates, destinations | complete | `TripSheet`, `tripDays`, multi-city destinations |
| Itinerary import and parsing | complete | Reviewed before applying; two silent failure modes documented in `09_IMPLEMENTATION_NOTES.md` §6 |
| Unresolved trip questions | partial | Exists as facts and questions; **not** wired to a readiness model or a next action |
| Necessities generation | complete | `generateChecklist`, `computeQuantity`, explanations on every row |
| Weather fetch and storage | complete but **unverifiable here** | Open-Meteo unreachable from CI. **No refresh policy** — fetched when outfits are planned, never rechecked |
| Climate-normal labelling | complete, unverified | `Usually` prefix requires every day to be a normal |
| Outfit generation | complete | Grouped by occasion; capability recorded, never inferred |
| Outfit approval → packing list | complete | Synchronised, with the replace-or-remove flow |
| `outfit_pairing` learning | complete | Cross-trip, survives trip deletion |
| Guided outfit *review* (one at a time) | **missing** | Outfits are a list, not a walkthrough |
| Readiness model | **missing** | The central gap. Nothing derives one next action |
| Packing-list filters | complete | `Everything / Still to pack / Packed / Pack day of / Essentials` (PR #22) |
| Bag assignment | **missing** | No `Wear / Personal item / Carry-on / Checked` anywhere |
| Day-of departure view | **missing** | The `day_of` timing exists per item and per row; there is no departure screen |
| During Trip / Today | partial | A Today screen exists; no weather adjustment, no tomorrow preview, no carry list |
| Post-trip review | deferred to v1.1 by prior approval | `CLAUDE.md` says it must not block v1. **This brief re-approves it** |
| Usual amounts | **correctness gap, but not the stated one** | See §2.1. The cap is **10**, not 2; the minimum is 1, not 0; and 2 is the *default* for a newly added amount. The requirement stands unchanged |
| Packing rules | **partial → gap** | Viewable and toggleable; **not creatable, editable or deletable** |
| Rule precedence | **undocumented** | Must be specified before user rules exist |
| Settings | UX gap | Contains My Stuff navigation and About; §20 removes both |
| Offline reads | complete | Network-first `GET /api/*`; **not testable in WebKit** |
| Offline writes | **missing / deferred** | No queue. §23 permits documenting the limitation instead |
| Appearance | complete | System/Light/Dark, resolved pre-paint (PR #23) |
| Identifier guard | complete | `tests/e2e/plain-words.spec.ts` (PR #23) |

### 2.0 Every viewport measurement before 30 July 2026 was 180px too generous

Found by CI rejecting a density assertion that passed locally.

Both Playwright projects here used **390×844**. That is the iPhone 14's *screen*. What Safari gives
a page, once its own toolbars are on screen, is **390×664** — which is what `devices['iPhone 14']`
uses, and therefore what `iphone-webkit` on CI has always used.

180px is most of a sheet. The consequences, stated because they reach backwards:

- **Every screenshot reviewed in this repository showed more of the product than the phone does.**
  Any "this fits on one screen" judgement made from one of them was optimistic.
- The Add Item sheet does **not** fit the common task at 664 — `When to pack it` is clipped and
  `More details` is below the fold. Doc 08 U5 was right all along.
- Local e2e runs could pass a viewport-sensitive assertion that CI would fail, which is exactly
  what happened.

Both configs and the visual capture height are now 664. **Any density conclusion recorded before
this should be treated as unverified**, in the same way doc 08 §0 treats a claim from a green
harness.

### 2.1 One premise in the brief is wrong, and the work is still right

The brief opens §17 with *"The current quantity editor only permits a maximum value of 2."*

It does not. Verified at `3df204e`:

- `MAX_PER_DAY = 10` in **`src/routes/Settings.tsx`** and again in **`worker/routes/settings.ts`**;
- `readMultiplier` rejects anything outside **1–10** with *"Pick a whole number between 1 and 10."*;
- `AmountPicker` opens at `useState(2)` — **2 is the default for a newly added amount**, which is
  almost certainly what was seen.

Recorded rather than quietly corrected, because the difference changes the work:

- **The floor is 1, not 0.** For a `per_day` rule, zero means "never pack this", which is what
  disabling the rule already does. The brief anticipates this — *"use the minimum that matches
  existing semantics if zero is not valid"* — so `per_day` keeps a floor of 1, and 0 is only
  meaningful if a basis is added where it means something.
- **Two bounds, not one.** The client cap and the server cap are separate constants that happen to
  agree. Raising one and not the other turns a stepper limit into a 400 from the API. Both move, and
  a test asserts they agree.
- **The real complaint is probably not the ceiling.** Reaching 10 takes eight taps of a `+`. Direct
  numeric entry is the part that matters at any cap, which is what §17 asks for first.

The requested range of **0–99 with direct entry** is unchanged and still worth building. Only the
starting point was misdescribed.

---

## 3. Approved scope, by section of the brief

Restated tersely. The brief itself is the authority; this is the index so nothing is dropped.

- **§4 Readiness model** — one derived state driving Home, Trips, Trip, Packing List, Outfits,
  During Trip. Derived from real trip data, not a stale stored label unless persistence is
  technically necessary. Produces **one** recommended next action.
- **§5 Trip input** — minimum entry; derive duration, nights, cities, travel days, long flights,
  weather locations, activity categories. One concise question at a time, only when it materially
  changes recommendations. Deferrable without blocking.
- **§6 Necessities** — every generated item traceable to a plain reason. Internal priority may be
  four-valued; the screen must not be four permanent sections. Essentials never silently omitted;
  optional items never alarm-level.
- **§7 Guided outfit review** — one unresolved outfit or group at a time. Approve / Change
  something / Decide later. Group compatible needs, mark multi-day and travel-day outfits, respect
  rewear and laundry, never invent capability, never silently approve incomplete. Ends with
  `10 outfit needs covered by 7 approved outfits`.
- **§8 One source of truth** — the full synchronisation list. Mostly already true; verify each.
- **§9 Final packing list** — filters incl. bag filters *only if bag assignment ships*; item
  actions; neutral progress early (`18 of 42 packed`), urgent language only when useful.
- **§10 Pack day of** — a distinct state, not packed/unpacked/removed. Subtle indicator, own filter,
  no premature warnings, reversible.
- **§11 Bag assignment** — `Wear / Personal item / Carry-on / Checked bag / Either`, with
  deterministic protection for medication, documents, wallet, phone, chargers, valuables, and the
  emergency outfit. Distinguish recommendation / hard restriction / user override.
- **§12 Day-of departure view** — what remains, what is intentionally Day-of, what goes in the
  personal item, documents, what to wear, flight time. Grouping from user-set or deterministic
  defaults, never fabricated.
- **§13 Today** — default to one day. Date, city, activity, outfit, weather, adjustment, outer
  layer, carry items, later changes, tomorrow preview. Actions: *Wore this / Change item / Not
  wearing this*. Material weather change **proposes**, never silently rebuilds.
- **§14 Weather refresh** — deterministic triggers, caching, rate limits, no polling. Live vs
  cached vs seasonal vs unavailable always distinguished.
- **§15 Itinerary→outfit mapping** — every event classified; local dates and times preserved; the
  itinerary fact that created a need is shown.
- **§16 Post-trip review** — short, prioritised, explicit, reversible, evidence-gated, and blocked
  for trips where During Trip was never used.
- **§17 Usual amounts 0–99** — direct numeric entry, validation, safe paste, compact one-line rows,
  and **tests proving 3 / 12 / 99 flow through the real engine** and 100 is rejected.
- **§18–19 Editable packing rules** — create, edit, disable, delete, duplicate, restore defaults;
  understandable condition categories only where a real trip fact can evaluate them; documented
  precedence; a clean rules screen of compact rows.
- **§20 Settings** — remove My Stuff navigation and About. Audit every control; remove or repair
  dead ones.
- **§21–22 Home, Trip, navigation** — readiness-driven; one obvious next action; guided transitions;
  Safari back preserved.
- **§23 Offline** — reads for active trip, list, outfits, Today, itinerary, Day-of. Writes queued
  **or the limitation documented honestly**; never claim a save that did not happen.
- **§24 Performance**, **§25 truth and safety**, **§26 UX and accessibility**, **§29 testing**,
  **§30 visual QA** — standing requirements, unchanged in kind from the existing rules.

### Explicit non-goals

No paid AI API. No chatbot. No fake generative intelligence. No vague AI branding. No decision that
cannot be explained. No learning the user cannot reverse.

---

## 4. Refinement note — approved, queue at the next safe boundary

Delivered with the brief and separate from it. **Small, and worth doing early** — most of it lands
naturally in Release A or D.

### 4.1 Essentials warnings off Home and Trips

The `Essentials still to pack` banner is too prominent on the summary screens. Home and Trips stay
calm: readiness, progress, next action, departure timing.

Essentials stay protected and visible **where they are actionable** — in the packing list, the
Essentials filter, the Day-of view, near departure, when few items remain, or when an omission is a
genuine readiness problem.

**A presentation and timing change, not a reduction in safety.** No essentials logic or validation
is removed. Neutral progress early; escalate only when timely and actionable; never repeat the same
warning on several screens.

### 4.2 Completed items move to the bottom

Within a visible section: unpacked essentials → other unpacked → Pack day of where appropriate →
packed. Packed items quieter but still reachable.

Requirements worth keeping in one place, because this is where it will go wrong:

- update immediately on completion, but **do not move a row while a swipe or inline edit is live**;
- no disorienting animation; preserve scroll position as far as practical;
- **avoid row-jumping when several adjacent items are checked quickly** — a short restrained
  transition, or a reorder deferred until the completion settles, is preferred if it is steadier;
- correct under All / Unpacked / Packed / Essentials / Pack day of;
- Undo returns the row to the correct unpacked position.

Tests: one item, rapid completion of several, Undo, section ordering, filter behaviour, Pack day of
interaction, keyboard and VoiceOver.

### 4.3 Rename `Something for this trip` → `Unique item for this trip`

Consistently in forms, sheets, buttons, labels, helper text, accessibility labels, tests and docs.
Audit surrounding copy so it still reads naturally. **Do not rename database fields or APIs** for
this unless technically necessary.

---

## 5. Release sequencing

From the brief's §28, to be re-ordered only if repository facts show a better dependency order.

| | Release | Contents |
|---|---|---|
| **A1** | Quantities — **shipped** | One `@shared/quantities` decides the range for the screen, the Worker and the rules endpoint, which held three different numbers for one column. 1–99, typed as well as stepped, strict parsing so `77kg` and `''` are refused rather than coerced. |
| **A2** | Settings and copy — **shipped** | `My wardrobe` (a second door to a primary tab) and `About` (true, and not a control) removed; a test that every remaining row goes somewhere; `Unique item for this trip`, with a name as well as a placeholder. |
| **A3** | The editable threshold — **shipped** | The number in a rule is editable where there is **exactly one** — `readThreshold`/`writeThreshold` in `@shared/rule-threshold` rebuild the condition from its parsed tree and decline a rule with two comparisons rather than guessing which was meant. The Neck Pillow case from the brief works end to end: change 5 to 6, and a 5½-hour flight stops packing it. |
| **A4a** | Precedence — **shipped** | `technical-docs/11_RULE_PRECEDENCE.md`, written from the engine rather than from intent, and pinned by `rule-precedence.test.ts`. It found a real gap: `fixed_per_trip` **assigns** the base where every other quantity rule takes a maximum, so "always pack 3" plus "2 per day" gives 3 or 20 depending on row order. Nothing seeded pairs them; a user rule can, on day one. |
| **A4b** | Creating and deleting rules — **next** | Create a rule for an item Alex owns; delete a custom one; restore defaults. **Two decisions must be made first**, both written up in doc 11: whether `packing_rule` gains a `source` column so a user rule can beat a default, and how §1.1's ordering gap is settled. Neither is a cleanup — both change generated quantities. |
| **B** | Guided trip readiness | The canonical readiness model; recommended next action; Home and Trip integration; unresolved-question flow. Take **§4.1 essentials calming** here — it is the same surfaces. |
| **C** | Necessities and outfit walkthrough | Necessity explanations; itinerary→outfit mapping; guided review; grouping; coverage summary. |
| **D** | Final packing and Day-of | Synchronised final list; bag assignment; Day-of screen; filters; remaining-item logic. Take **§4.2 completed-to-bottom** here — same list, same tests. |
| **E** | Today and weather refresh | Today view; weather recheck; material-change warnings; tomorrow preview; wear recording. |
| **F** | Post-trip learning and offline | Lightweight review; reversible suggestions; offline queue **or** the documented approved subset; conflict handling. |

**Release A first, and not only because the brief lists it first.** The usual-amounts cap at 2 is a
correctness gap — a stated setting the engine cannot express — and editable rules are the largest
single "settings that do nothing" risk in the product. Both are self-contained, both are provable by
test, and neither depends on the readiness model.

---

## 6. Where this picks up

**Not until PR #24 has merged and deployed.** Then, from the latest `origin/main`:

1. Verify §2 against the code and correct it. It is a first pass, not a finding.
2. Open one branch and PR for **Release A**.
3. Implement, document, test, visual-QA, green CI on the exact head, merge and deploy under the
   standing delegation, record the version and data impact.
4. Continue to Release B from the new main.

Standing rules unchanged: one active PR per coherent release; no paid services; no destructive
migration; no data reset; every recommendation explainable; every learned preference reversible;
green CI necessary but not sufficient.

Phone checks accumulate on `technical-docs/08_MANUAL_IPHONE_CHECKLIST.md` and are requested as **one
session**, not one per release.
