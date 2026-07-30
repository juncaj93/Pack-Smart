# 08 — Pack Smart V2 product completion

**Canonical.** This is the standing answer to "what is left?". It supersedes every earlier summary of
remaining work, including the roadmap's "where this cycle stopped" section and the scope table in
[PR #15](https://github.com/juncaj93/Pack-Smart/pull/15).

Written against `4bbb647` — `main` at `9a3a915` plus the native-quality UX release. **Every row below
was checked against the repository, the seeded database, or a running build.** Where an earlier
document and the code disagree, the code wins and the document is corrected here.

---

## 0. How to read this

Eight states, and nothing is listed in more than one:

| State | Means |
|---|---|
| **Complete** | Built, tested, and behaving. Not work. |
| **Partial** | Some of the requirement is real; the rest is named. |
| **Correctness gap** | The product can give a wrong or missing answer. |
| **UX gap** | The answer is right and getting to it is worse than it should be. |
| **Production-only** | Built and untestable here — it needs the real internet or the real phone. |
| **Deferred (approved)** | Out of v1 by an approved decision, not by oversight. |
| **Idea** | Not approved. Recorded so it is not re-invented, and not scheduled. |
| **Withdrawn** | Considered and rejected, with the reason, so it is not proposed again. |

**Nothing already working is listed as new work.** That rule is why this document exists: the
previous two "remaining work" lists each contained at least one feature that had shipped months
earlier — `Download a backup` was reported missing when it had been in Settings since M10, and
PR #15's table listed six missing wardrobe items when one of them was already in the database.

---

## 1. Complete

Not work. Listed so no future audit proposes it again.

**Foundation.** Passphrase auth and the one-year server-set session · the app shell · compact top
navigation with document scrolling (Safari's toolbar collapses — confirmed on hardware) · offline
reads via the service worker · backup export · workbook import with duplicate detection.

**Wardrobe.** My Stuff list, add, edit, archive, restore · the header **+** · archived items stay
visible on historical trips.

**Trips and packing.** Trip creation and derived facts · the rules engine and generated checklist ·
Pack Now / Pack Later / Final Check / Not Bringing · quantity overrides with undo · usual amounts
that genuinely change the next list · trip emoji, with no two trips sharing one · One Last Look ·
Past Trips and **Plan again** without carrying stale dates, packed states or weather · itinerary
**text** import · per-day activity tagging.

**Outfits.** Planning with hard filters then lexicographic scoring — **all eight of doc 04 §5's
ranking criteria** · saved pairings learned from approvals, announced with Undo · During Trip using
only packed items · **replace or remove** (doc 04 §8) with the conflict derived on every read rather
than stored, so the two halves cannot disagree.

**Intelligence that prevents silent omission.** Essentials coverage at trip time, naming essentials
absent from inventory or present with no rule · learning from repeated removals · learning from
packed-and-never-worn, guarded so a trip where During Trip was never opened does not make the whole
wardrobe look unworn.

**Presentation.** The native-quality pass: one button family, the primitives layer, swipe to pack
with a tap and keyboard equivalent, the trip screen's list in the first viewport (measured at
**663px**, down from 934px), Settings grouped by intent, outfit context lines from recorded data
only, Home carrying the sections doc 02 §4 asks for, a loading skeleton and a real failure state with
**Try again**, and a Dark palette that has now actually been looked at.

---

## 2. Partial

| # | Capability | What is real | What is missing |
|---|---|---|---|
| ~~**P1**~~ | **Dark appearance** — **complete** | A full dark palette in `tokens.css`, reviewed at four widths across seven screens. `System / Light / Dark` is stored in `localStorage` and resolved to `data-theme` by an inline script **before first paint**, so a stored Light survives a Dark phone — a media query alone can never be overridden, which is why this was an architectural requirement rather than a toggle. Reachable two ways: the sun/moon in every header for the moment the room goes dark, and the three-state row in Settings, which is the only way back to `System`. | — |
| ~~**P2**~~ | **Pack day of** — **complete** | Settable per row and permanently per item, grouped into the Pack later section, and now filterable: `Pack day of` shows only those rows on the morning Alex leaves, which is the entire point of recording it. The filter reuses `sectionFor`, so it and the section can never disagree about which rows they mean — including the retired `last_minute` spelling still sitting in older rows. | — |
| **P3** | **`trip_event`** | `activity_tag` is read and drives outfit grouping. | `dressiness`, times and indoor/outdoor are stored and read by nothing. **Deliberate** — see §8 W1. Listed here only because the schema invites the question. |
| ~~**P4**~~ | ~~**Trip lifecycle**~~ | **Done** — archive (reversible, changes nothing inside the trip) and permanent deletion behind the product's one confirmation. Slice V2-4. | — |

---

## 3. Correctness gaps

The product gives a wrong or missing answer. Highest value first.

| # | Gap | Why it matters | State |
|---|---|---|---|
| **C1** | **Five items Alex owns are not in the database.** Bite Guard, Hairspray, Plane Seat Cushion, Black Shinola, White Shinola. | Doc 03's whole promise is that an essential cannot be silently omitted. An item that does not exist is omitted from every list, forever, with no warning — the exact failure §3 of the roadmap calls the one that matters most. A bite guard is not optional. | **done** — `0009_missing_items.sql` + `shared/missing-items.ts`. Found by querying the seeded database: all five `ABSENT` from 119 items. |
| **C2** | **PR #15 says six. It is five.** `Black Vuori Jacket` is already in the wardrobe. | Adding it again would create the duplicate `CLAUDE.md` requires be detected rather than silently imported. | **done** — not added, and a test asserts the migration never mentions Vuori. |
| **C3** | **No canonical long-flight threshold.** The seat cushion's rule needs one and none exists. | Without a written threshold the rule is a magic number, and any future rule needing "long flight" invents its own. | **done** — `LONG_FLIGHT_HOURS = 6`, read from a number Alex types and **never inferred from the destination**: a trip to Tokyo might be one leg or three short hops, and the app does not know. |
| **C4** | **Learning from repeated additions is absent.** | Something added by hand every trip is added by hand forever. | Open. Lowest value of the four learning inputs — adding is one tap Alex has already chosen to take — but it is the only one still missing. |

---

## 4. UX gaps

The answer is right; getting to it is worse than it should be. Verified by looking at the shipped
screens, not by reading the old brief.

| # | Gap | Detail |
|---|---|---|
| ~~**U1**~~ | ~~My Stuff has no sorting and no grouping.~~ **Shipped.** | Category-first grouping is now the default, with five sorts. `Most packed` counts **confirmed packing per trip** — `packedTripCounts` requires the packed quantity to have reached the required one, drops rows taken off the trip, and resolves the quantity override, so it measures what Alex took rather than what the engine proposed. |
| ~~**U2**~~ | ~~The packing list has no filters.~~ **Shipped.** | Five: `Everything`, `Still to pack`, `Packed`, `Pack day of`, `Essentials`. Every one except `Everything` drops Not Bringing rows, and none of them touch the progress count — a filtered list that also filtered "12 of 31 packed" would say Alex is further along than he is. |
| ~~**U3**~~ | ~~British spelling in an American product.~~ **Shipped.** | `Color`, `Favorite`, and the two reason strings behind them. Internal identifiers were left alone: renaming `favourites` in `last-look.ts` changes no word Alex reads. |
| ~~**U4**~~ | ~~Your Usual Amounts spends a tall card on a one-line fact.~~ **Shipped.** | One row each: the name with the whole fact (`1 per day, plus 2 spare`) beneath it, the stepper and a ✕ on the right. The first attempt put the fact and Remove on a second line and made rows **taller** — a 44px touch target sets the height of whatever line it is on. Five amounts and the Add button now fit without scrolling, where four filled the sheet. |
| ~~**U5**~~ | ~~Add / Edit Item does not fit the common task on one screen.~~ **Shipped, and partly overtaken.** | It already fitted by the time this was measured — what was missing was anything holding it that way. There is now an assertion that every control of the common task *and* Save are inside the viewport, and that the sheet is not scrolling to achieve it. The `Favorite` field label went: it repeated the word its own button said, for about 100px. **The keyboard half remains unverifiable** — a headless browser has no software keyboard, so Save's reachability with one raised stays on the manual checklist. |
| ~~**U6**~~ | ~~No guard against raw identifiers reaching the interface.~~ **Shipped.** | `tests/e2e/plain-words.spec.ts` reads the rendered text of every screen, every settings sheet, the item sheet with its optional half open, and a generated packing list, and fails on any `camelCase` / `snake_case` run. It checks its own matcher against the strings it exists to catch, and asserts there was text to scan — a text search over a blank page finds nothing and proves nothing. |

---

## 5. Production-only verification

Built, correct as far as anything here can tell, and **not verifiable in this environment**. These
are not work — they are checks that need the real internet or Alex's phone.

| Capability | Why it cannot be verified here |
|---|---|
| **Live forecast** | Open-Meteo is unreachable from CI. Parsers fail to *nothing*, so the worst case is no weather rather than wrong weather. |
| **Climate-normal labelling** | Same. **The one way weather can mislead is a normal presented as a forecast**, and no test has ever seen a real normal. |
| **Real itinerary link / booking PDF** | The build environment cannot fetch either. |
| **Offline reads on iOS** | Playwright cannot simulate a lost connection to a service worker in WebKit. `08_MANUAL_IPHONE_CHECKLIST.md` "Offline" is the only real evidence. |
| **Swipe feel, Safari toolbar collapse, the native date wheel, VoiceOver order** | Screenshots catch layout. They do not catch how something feels under a thumb. |
| **Session surviving eight days of disuse** | Cannot be verified in an afternoon by anyone. The mechanism is asserted in tests; the outcome is diarised. |

These accumulate on one consolidated list in `technical-docs/08_MANUAL_IPHONE_CHECKLIST.md` (now
Parts 1–3) and are requested as **one phone session**, not one interruption per check.

---

## 6. Deferred, by approved decision

Not oversights. Each has a recorded reason and stays out until Alex says otherwise.

| Item | Status |
|---|---|
| **Post-trip review** | v1.1 by approved scope (`06_ACCEPTANCE_CRITERIA_NON_GOALS_ROADMAP.md`). Still deferred. Verified: no implementation exists. |
| **Offline mutation queue** | v1.1 per the milestone plan. **The safer half already ships**: a failed save fails *visibly*, and the service worker deliberately never queues writes — "hotel wifi that drops mid-tap should never leave the packing list in a state Alex cannot see". A queue would need conflict resolution and a way to show pending state; it is not a small addition. |
| **Weather re-check before departure** | Not in any approved document. Recorded as an idea (§7 I1), not as deferred approved scope — the recovery brief listed it as a deferred item and that could not be confirmed. |
| **Itinerary from images or email** | Needs OCR or mailbox access. Out of scope. |
| **Dropping the three inert tables/columns** (`checklist_link`, `preference_change_suggestion`, `trip.status`) | A **destructive migration**, which needs Alex's explicit approval. They are inert and cost nothing where they are. The standing principle: **delete code, not data.** |

---

## 7. Ideas — recorded, not scheduled

Not approved. Here so they are not re-invented, and so nobody mistakes them for a plan.

- **I1 — Weather re-check before departure.** Re-fetch the forecast a day or two out and say if it
  changed materially. Genuinely useful; also the feature most able to *undermine* an already-approved
  packing plan, and doc 03's honesty rules would need extending to cover "the forecast changed after
  you packed". Needs a product decision before it is designed.
- **I2 — Per-day dressiness that differs from its activity's band.** The shape is known (split that
  day into its own group). Nothing needs it yet — see §8 W1.
- **I3 — Bag or capacity awareness.** Never in any approved document.

---

## 8. Withdrawn — considered and rejected

| # | Proposal | Why it was rejected |
|---|---|---|
| **W1** | Wire `trip_event.dressiness`, times and indoor/outdoor | It would change **no recommendation**. Formality is already carried by the activity template's own band and capped trip-wide; the itinerary parser already maps `black tie` and `tasting menu` to the right activities; indoor/outdoor's practical consequence is handled per group from that group's dates; time of day has no consumer that would change a garment. Filling three columns so the schema looks tidy, with nothing on screen changing, is exactly the trade `CLAUDE.md` says to refuse. |
| **W2** | Data export as new work | **Already shipped** since M10. The finding was produced by a sweep that grepped for `fetch` calls, and `Download a backup` is a plain `<a download>`. Recorded because the *method* was flawed: a "no caller" result means nothing until it is re-checked across all of `src/`, including plain links and form actions. |
| **W3** | PR #15's replacement category vocabulary | It would have replaced the canonical model every stored item, rule and historical trip depends on. The brief itself deferred to the repository on this point. |
| **W4** | Permanent **item** deletion | `02_DATA_MODEL.md` makes "nothing is ever deleted" a structural rule for the catalog, and archived items must stay visible on historical trips. The requirement that deletion not be casual is met by there being no destructive path at all. |
| **W5** | Clearing an outfit slot when its garment is removed | Undo would have to restore what the removal destroyed, and it would cascade — a shirt removed on Tuesday quietly emptying the trousers on Thursday. The conflict is derived on every read instead. |
| **W6** | UX-14, moving the quantity breakdown off the checklist row | Tried; the e2e suite caught that it removes the derivation, and `12 days × 2 = 24` **is** the explanation for the number beside it. An even list is not worth trading a real answer for. |

---

## 9. The order of work, and why

Ranked by what it costs Alex when it is missing — not by database tidiness, not by what is easy.

### Slice V2-1 — Five items, and the threshold that makes one of them a rule — **shipped**

**C1, C2, C3.** The only gap in this document where Pack Smart can fail Alex *badly while appearing
to work*: a bite guard that is not in the database is missing from every list forever, silently.
Everything else is friction.

Additive migration, every insert guarded by `WHERE NOT EXISTS (… lower(trim(display_name)) = …)`,
nothing updated and nothing deleted. A production row differing only in case or padding counts as
present; a *similar* name does not — a wrongly merged item is unrecoverable, a duplicate is one
archive tap away. `Black Vuori Jacket` is **not** re-added. One canonical list in
`shared/missing-items.ts`, read by the migration and the tests, so the workbook is never rewritten.

What each one does, and why:

| Item | Rule | Reasoning |
|---|---|---|
| **Bite Guard** | `conditional_include`, 1, when `nights >= 1`. Essential, final check. | Cannot be replaced on the road and is needed on the first night — which is also why it is final-check rather than packed days ahead. |
| **Hairspray** | `fixed_per_trip`, 1 | Like every other toiletry. |
| **Plane Seat Cushion** | `conditional_include`, 1, when `flight_hours > 6` | A trip with **no recorded flight time evaluates to unknown, not false**, so the cushion is left off *and* not silently ruled out. Packing something because a fact was missing is the confident-but-unsupported behaviour the engine must not have. |
| **Black / White Shinola** | none | A watch is not packed by the engine; it is chosen by an outfit or caught by One Last Look. Two rows — a shared brand is not a reason to merge two watches. No warmth, dressiness, weather tag or typical use is invented for either, and a test asserts those four columns stay null. |

`conditional_include` rather than a conditioned `fixed_per_trip`: `computeQuantity` applies conditions
only to the conditional types, so a condition on a fixed rule would be decoration and the item would
be packed on every trip.

### Slice V2-2 — Finding things: My Stuff sorting and grouping, packing-list filters — **shipped**

**U1, U2, P2, U3.** The largest daily friction in the product: 119 items in one flat list, and no
way to see only what is unpacked while standing over a suitcase.

**My Stuff** opens grouped by category. The other four sorts exist to cut *across* categories, so
they render one flat list with no headings — "Most packed" split into thirteen separate rankings
answers a question nobody asked.

**`Most packed`** is the one with a decision in it. Counting the checklist rows an item appears on
would measure what the rules *suggest*, and Alex already knows what Pack Smart suggests. The query
counts distinct trips where the packed quantity reached the required one, and it reads
`COALESCE(qty_override, required_qty)` rather than the raw column — because a row where Alex said
"two is enough" and packed two shows a full tick everywhere else, and one query quietly disagreeing
with the tick on the screen is how a number stops being trusted.

**The packing list** takes five filters. The rule holding them together is that *filtering changes
what is shown and never what is counted*: progress and the essentials warning stay about the whole
trip. `Still to pack` emptying is the best news of the evening, so it says so rather than reading as
a failure, and every other empty result names the control that emptied it and offers the way back
inside the sentence.

Three shared classes moved to `primitives.css` on the way through — `.link-button`, `.select-field`,
and the `.chip` set before them. Each was declared in one screen's stylesheet and then needed by a
second; the third time is enough to stop treating that as a coincidence.

### Slice V2-3 — Appearance, and the identifier guard — **shipped**

**P1, U6.**

**The third state.** The sun/moon in the header is a two-state toggle over a three-state preference:
tapping it picks the theme that is not showing and stores it explicitly, so the first tap leaves
`System` behind for good. That is deliberate — a choice that silently reverted the next time the
phone changed would be worse than no control at all — but it makes the header button a one-way door,
so Settings offers all three. Both controls read one module-level choice with subscribers rather
than each reading storage on mount, because they are on screen together and used to disagree: the
moon still offered "switch to dark" after Settings had already switched to dark.

**The identifier guard** is a text scan rather than a string patch, because the reported `listAll`
does not exist anywhere in this repository or its history — patching a string nobody can find would
have fixed nothing. The rule is deliberately narrow: `camelCase` and `snake_case` inside a single
word, with a short allow-list for `iPhone` and friends. It is not "any unusual word", because
garment names are Alex's own free text and a guard that flagged `Zip-Up` would be switched off
within a week.

Two things stop it being a check that cannot fail. It tests its own matcher against
`conditional_include`, `listAll`, `qtyPerDay` — and against `T-Shirt`, `Day of Departure`,
`12 days × 2 = 24`. And it asserts there was text to read: the first version waited only for the
navigation, which renders instantly, so on Home and Trips it scanned 42 characters of chrome and
found nothing wrong with content that had not arrived.

### Slice V2-4 — Trip lifecycle — **shipped**

**P4.** Archive is reversible, changes nothing inside the trip, and is subtracted from the
upcoming/past split before either is derived — so a trip Alex has put away cannot reappear as Home's
featured trip.

Deletion is the **only** thing in Pack Smart that destroys anything, and therefore the only place the
product asks "are you sure?" — doc 02 §2 prefers undo to a confirmation, and this is the single case
where undo cannot exist. The confirmation names the trip and says what survives, because "this cannot
be undone" tells Alex nothing about what he is actually losing.

What a deletion takes: every row scoped to that trip, written out explicitly in `deleteTrip` rather
than left to a cascade, in one `batch` so a half-deleted trip cannot exist.

What it must not take, each with its own test:

- **the wardrobe** — not one `item` or `packing_rule` row;
- **`outfit_pairing`**, what Pack Smart has learned about which garments go together. It references
  `item` and never `trip`, deliberately: the habit outlives the trip that taught it, and losing a
  year of it because one trip was tidied away would be invisible until recommendations quietly got
  worse;
- **every other trip.**

What is genuinely lost, stated rather than glossed: that trip's own contribution to the learning
counted *per trip* — repeated removals and packed-but-never-worn. Those proposals are derived by
counting trips, so a deleted trip stops counting. Correct, but real, and the reason deletion asks
first while archiving does not.

### Slice V2-5 — Density on the remaining screens — **shipped**

**U4, U5.**

**Your usual amounts** is one row per amount: the name with the derived sentence beneath it, the
stepper, and a ✕. Worth recording because the first attempt made it worse — putting the fact and a
`Remove` button on a second line produced rows *taller* than the four-line version, since a 44px
touch target sets the height of whatever line it is on. The unit moved off the stepper into the
sentence: `2 per day` inside the control restated the paragraph at the top of the sheet on every row
and made the stepper the widest thing in it.

**Add / Edit Item** turned out to fit already. What was missing was anything holding it that way, so
there is now an assertion that every control of the common task and `Add to My Stuff` are inside the
viewport — *and* that the sheet is not scrolling to achieve it, since a scrollable sheet satisfies
the first half after one flick. The `Favorite` label went, having repeated the word its own button
said.

The **keyboard half of U5 cannot be closed here**, and no assertion written in this repository will
close it: a headless browser has no software keyboard to raise. It stays on
`08_MANUAL_IPHONE_CHECKLIST.md` with the rest of §5.

`.stepper` moved to `primitives.css` — the fourth class to leak out of one screen's stylesheet,
after `.chip`, `.link-button` and `.select-field`.

### Then — where this stands

Every gap in §3 and §4 is closed. What is left is genuinely two things, and neither is code that can
be written blind:

1. **One phone session.** Everything in §5 has accumulated on
   `technical-docs/08_MANUAL_IPHONE_CHECKLIST.md`, now Parts 1–4, and is requested as a single
   sitting rather than one interruption per release. The items that matter most are the ones that
   have been *adjusted twice by description and never felt*: the swipe settle, the press scale, and
   whether Save is reachable with the keyboard up. If the settle now reads as abrupt rather than
   crisp, that is a taste correction, and the three numbers are named in `SwipeRow.tsx`.

2. **C4** (learning from repeated additions), if it still looks worth it after that session. It is
   the only remaining item that adds behaviour rather than confirming it, and it is deliberately
   last: the product should be known to feel right before it is taught to guess more.

---

## 10. What V2 must not do

From `CLAUDE.md` and doc 03, restated because these are the failure modes that matter more than any
feature above:

- invent clothing capabilities, or claim an attribute the data does not support;
- present seasonal guidance as a forecast;
- guess ambiguous dates;
- silently omit an essential Alex owns;
- silently break an approved outfit;
- duplicate a wardrobe record;
- learn a preference without confirming it;
- carry stale packed states or weather into a duplicated trip;
- expose internal implementation language;
- describe any of this as artificial intelligence.
