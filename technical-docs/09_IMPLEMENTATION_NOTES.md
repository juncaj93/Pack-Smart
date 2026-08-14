# Implementation notes

What was actually built, where the code lives, and every decision that departs from — or
resolves an ambiguity in — the approved documents. Read alongside `05_MILESTONE_PLAN.md`,
which remains the definition of scope.

---

## 1. Where things live

| Concern | File |
|---|---|
| Trip dates, facts, validation | `shared/trips.ts` |
| The rules engine | `shared/rules.ts` |
| Checklist grouping and progress | `shared/checklist.ts` |
| Outfit planning | `shared/outfits.ts` |
| During Trip | `shared/during-trip.ts` |
| One Last Look | `shared/last-look.ts` |
| Import parsing and dedup | `shared/import.ts`, `shared/xlsx.ts` |

Everything in `shared/` is pure and runs in both the Worker and the browser. That is
deliberate: `sectionFor`, `isPacked` and `needsFinalCheck` must give the same answer on both
sides, and two implementations of "is this packed?" is how a checklist starts disagreeing with
itself.

Persistence is in `worker/repos/`, HTTP in `worker/routes/`, screens in `src/routes/`.

---

## 2. Decisions taken during implementation

### 2.1 Checklist candidacy is "has a rule", not "is gear"

The engine considers any active item with at least one enabled rule. Filtering by
`kind = 'gear'` silently dropped underwear — a garment carrying the approved
2-per-inclusive-trip-day basis — so the acceptance criterion said 24 and the list showed none.

A garment with no rule is still left entirely to outfit planning, so the two paths cannot
produce conflicting clothing plans (product doc 04 §8).

### 2.2 The underwear basis is realised as a rule at import

`underwear_basis` is an approved preference, but preferences are not a second engine. The only
mechanism that produces a quantity is a rule, so the preference becomes a `per_day` rule on the
boxer-briefs item during import, and stays editable in one place afterwards.

Deliberately narrow: it matches boxer briefs and nothing else in the Underwear subcategory.
Socks and compression shorts are worn per outfit and the docs state no basis for them. Inventing
2-per-day for socks would be exactly the confident-but-unsupported quantity this engine must
never produce.

### 2.3 Dependencies are resolved to real item ids at import

`packing_rule.depends_on_item_id` is a foreign key, so the spreadsheet's dependency *name* cannot
be stored in it. Resolution happens in a second pass after every item exists.

This matters more than it looks: `dependency_include` **vetoes** its item when the target is not
packed, so an unresolved rule does not degrade to "include anyway" — it degrades to "never
include". Anything unresolvable is flagged `needs_review` and surfaced at the top of the rules
list rather than disappearing.

### 2.4 Outfit slots hold one garment each, with a wearing count

A group worn nine times is not nine identical t-shirts. Each slot row holds one garment plus how
many of the group's days it covers, and the planner keeps choosing until the days are covered —
spreading across the wardrobe before repeating anything. `migrations/0006` adds that column;
it is additive only.

Reuse capacity limits how many wearings one garment provides. It is **not** an eliminating
filter: when everything suitable is spoken for, the planner reports how many days it cannot
dress rather than quietly wearing a shirt past its capacity.

### 2.5 Ranking is lexicographic, never a weighted sum

`shared/outfits.ts` compares candidates criterion by criterion in the approved order. A weighted
sum lets three weak signals outvote a strong one, which is how a loungewear quarter-zip wins a
nice dinner on "favorite". Ties break on item id so the same trip always plans the same way.

### 2.6 During Trip shows one day, from one function

`packedCatalog` is the single source of During Trip candidates, so the absolute rule in product
doc 04 §10 cannot be forgotten at a call site. Tests assert that Not Bringing, unpacked, and
archived items — including an item archived *after* it was packed — are unreachable.

"Bring" lists only gear this trip triggered (`trip_triggered` / `dependency_triggered`): the
binoculars for the safari, the neck pillow for the flight. Routine gear that lives in the
suitcase is not something to carry out for the day, and listing the whole bag buried the useful
entries.

### 2.7 An outfit missing a required garment cannot be approved

Approval writes clothing to the checklist, and a half-dressed plan should not get there. The
refusal is returned to the client and shown, rather than silently reverted.

### 2.8 Offline reads, but not offline writes

Reads are non-negotiable (`01_ARCHITECTURE.md` §5). Writes are deliberately not queued: a failed
save fails visibly, because a checklist that silently disagrees with the bag beside you is worse
than one that admits it could not save. The mutation queue remains available as v1.1 work.

The session check is never served from cache — telling Alex he is signed in when he may not be is
worse than asking again. But a device that has unlocked before stays in when the check cannot be
*reached*, because locking him out of a cached packing list on a plane is the exact failure
offline reads exist to prevent. Any real 401 still drops back to Unlock.

### 2.9 Chips are full-size touch targets

Raised from 36px to 44px. The original justification — "not a primary action" — stopped holding
once chips carried activity selection, the yes/no answers that shape the list, and the mid-trip
swap options.

### 2.10 Taking a garment off the list marks the outfit; it never edits it

Doc 04 §8 asks for affected outfits to be "marked incomplete". That marking is **derived on every
read** — an approved outfit whose slot holds a garment with no un-excluded checklist row — and the
exclusion writes nothing to `outfit_group` or `outfit_slot`.

Two failures this avoids, both real:

- **Undo.** `excludeEntry`/`restoreEntry` are single flag flips. Had the removal cleared the slot, undo
  would have to restore the garment it had just erased, from state nothing keeps. Deriving means undo
  has nothing to miss, and the invariant is asserted rather than assumed
  (`tests/integration/replace-or-remove.test.ts`).
- **Cascade.** Clearing a required slot makes the group `incomplete`, and
  `syncChecklistFromOutfits` rebuilds the clothing rows from **approved** groups only. The next
  unrelated approval would have taken that outfit's other garments off the list — one removal quietly
  emptying the rest of the outfit later.

The same reasoning as the derived preference proposals: a derived statement cannot go stale against
the state that produced it.

---

## 3. Not built, and why

| Item | Status |
|---|---|
| **Weather** (Open-Meteo) | **Built, and unverifiable here.** See §5 — the live call cannot be exercised from this sandbox, so it is delivered with that stated rather than claimed as done. |
| **Climate normals** | **Built** — see §9. Same verification gap as the forecast. |
| **Approved saved outfit relationship** | Doc 04 §5 criterion **3**. Was the one criterion absent from `CRITERIA`; **now implemented — see §13.** The claim here that it "needs a cross-trip `saved_outfit` table and a UI for saving and reusing combinations" was wrong, and §13 says why. |
| **M7 phrase detection** | Partly built, as itinerary import (§6). Trip facts still come only from structured input — an itinerary PROPOSES and Alex accepts, so no fact and no critical item is ever set by text alone, which is what §2.1 of `03_INTELLIGENCE_DESIGN.md` requires. Free-text trip notes are still not parsed. |
| **Itinerary from images or email** | Out of scope. Both need optical character recognition or mailbox access — different problems from reading text. |
| **Offline mutation queue** | Deferred per the M10 escape hatch. Offline reads shipped. |
| **Post-trip review** | v1.1 by the approved scope. |
| **Itinerary events** | Partly built. `trip_event` now carries one activity tag per date, written by the "Which days?" screen and read by both the outfit planner and During Trip. Times, indoor/outdoor and per-event dressiness are still unused. |

---

## 4. Testing

- **Unit** (`tests/unit/`) — pure logic with exact inputs.
- **Integration** (`tests/integration/`) — the real migrations applied to a real SQLite database
  via `node:sqlite`, with foreign keys on. D1 is SQLite, so these run the same statements
  production will. Built-in to Node 22, so no dependency.
- **End to end** (`tests/e2e/`) — a real browser against the production build behind the real
  Worker, including a network-cut offline test that a service worker cannot be unit-tested for.
- **`scripts/verify-import.mjs`** — drives a full import of the real 85 garments and 33 gear
  items through the HTTP endpoints and checks the M4 acceptance numbers. "The tests pass" and
  "the app gives Alex the right answer" are different claims.

WebKit could not be installed in this environment (the Playwright browser CDN is unreachable), so
the e2e suite ran locally under the documented `chromium-fallback` project. CI installs WebKit
only and runs the approved `iphone-webkit` target, so the WebKit results quoted here come from CI.

### 4.1 Offline reads are NOT verified on WebKit — read this before trusting them

Two tests are skipped under WebKit. This is the one gap in the suite that could matter to Alex,
so it is stated here rather than left in a code comment.

Playwright's WebKit driver does not put `context.setOffline` in front of the service worker. A
reload aborts inside the driver before the page is involved; an in-app navigation reaches the
worker without its `fetch` failing the way a genuinely lost connection makes it fail. Route
interception is not a substitute — `page.route` does not intercept service-worker-initiated
requests in WebKit, so the worker would reach the live server and the test would pass while
proving nothing. **A test that cannot fail is worse than no test**, which is why one was not
written.

What this means:

- **Verified in Chromium:** the caching logic, the cache-vs-network precedence, the offline
  banner, and the honest failure for a trip that was never loaded.
- **Not verified on the engine that ships:** that iOS Safari, in Airplane Mode, serves the cached
  trip. The mechanism is standard and there is no reason to expect it to differ, but that is a
  reasoned expectation, not evidence.
- **The acceptance test is therefore manual**, and it is the Airplane Mode section of
  `08_MANUAL_IPHONE_CHECKLIST.md`. Offline reads should not be treated as delivered until that
  passes on Alex's phone.

This is precisely the division risk R11 describes: CI cannot run iOS Safari, and passing CI is
explicitly not a completion criterion.

---

## 5. Weather — built here, verifiable only in production

Stated plainly, because it is the second thing in this project that CI cannot prove.

**What was built.** Open-Meteo, free and keyless, so it stays inside the no-paid-APIs rule.
Geocoding turns the destination name into coordinates once and stores them on
`trip_destination`; the daily forecast is fetched for the trip's own dates and cached in
`trip_weather` for twelve hours. Temperatures map to the 0-3 garment warmth scale and become the
**hard filter on jackets and mid-layers** that `03_INTELLIGENCE_DESIGN.md` §9 describes — per
outfit group, from that group's own days, because cold safari mornings and mild city afternoons
on the same trip are not the same conditions.

**What cannot be checked here.** This build environment's network policy blocks
`api.open-meteo.com` and `geocoding-api.open-meteo.com` outright — `curl` gets no connection at
all. A deployed Cloudflare Worker has no such restriction, so the code path is expected to work
in production and *only* in production. No test in this repository has ever seen a live
Open-Meteo response.

**How that shaped the design.** Every parser in `shared/weather.ts` returns nothing rather than a
guess when the payload is not what it expects, and `worker/weather.ts` never throws into a
request handler. The consequence is that the worst realistic failure is **no weather**, not
**wrong weather**:

- No forecast → no warmth band → the planner behaves exactly as it did before weather existed.
- A blocked refresh never deletes a forecast already stored (`replaceWeather` is a no-op on an
  empty list). A broken network cannot destroy usable information.
- The trip screen shows a forecast line only when there is a real forecast behind it, and says
  "too far ahead for a forecast yet" rather than going quiet.

`tests/unit/worker/weather.test.ts` covers the parsers against the documented payload shapes
**including the malformed ones**, since a response that is not what we expect is the outcome this
environment guarantees at least once.

**What Alex has to check.** The Airplane-Mode section of `08_MANUAL_IPHONE_CHECKLIST.md` now has
a weather block. Until it passes, weather is **built but unverified** — the same status offline
reads carried before the device check, and it should be reported that way rather than as
delivered.

---

## 6. Itinerary import

Three ways in, one interpreter. Pasted text, a fetched link and an extracted PDF all become plain
text and go through the same `parseItinerary` (`shared/itinerary.ts`), so a phrase that works in a
pasted email works identically in a PDF. There is one set of detection rules to reason about, not
three.

### Reading is not applying

`POST /api/itinerary/parse` **writes nothing** — asserted directly in
`tests/integration/itinerary.test.ts` by counting rows in every trip table after a parse. The
proposal is applied only when Alex taps through the confirmation screen.

That separation is structural rather than a habit, and it earns its keep. An itinerary is somebody
else's document: a confirmation email carries booking dates, payment dates and cancellation
deadlines, every one of them a real date and none of them a day of the trip. A parser confident
enough to write straight to the trip would pack for the wrong week eventually.

Every proposed row quotes the line it came from. A proposal Alex cannot trace to his own itinerary
is not reviewable, and an unreviewable proposal is a guess wearing a confirmation dialog.

### Three decisions worth naming

**Ambiguous dates are asked about, never resolved.** `03/08` is the third of August in most of the
world and the eighth of March in the United States, and an itinerary almost never says which.
Both readings are kept; if only one falls inside the trip it wins, and if both do, the screen says
so and leaves the day to Alex. Picking silently would move an activity by five months.

**Destinations come from labelled lines only.** `Destination:`, `Hotel:`, `Flying to:` and the
like. Recognising place names in prose needs a gazetteer this app will not carry, and the
destination decides the weather — a guess produces a confident forecast for the wrong continent.

**Word boundaries throughout.** Without them "gym" fires on *Gymnasiumstrasse* and "ski" on
*Helsinki*: a workout outfit on a city break, and no way to explain it afterwards.

### Extraction, and its two silent failure modes

`shared/extract-text.ts` reads PDFs with no library — `DecompressionStream` is a platform
primitive, the same reason the spreadsheet reader needs no dependency. It walks every
`stream … endstream` block, inflates what inflates, and reads the four text-showing operators,
treating `Td`/`TD`/`T*` as line breaks so a date stays on the line as its activity.

Both formats can fail *without erroring*, which is what the checks below exist for:

- **A scanned PDF** holds images and no text. Reported as a scan, not as a blank itinerary.
- **A subset-encoded PDF** maps bytes to glyphs, so extraction "succeeds" and returns mojibake.
  Nothing throws. The output is measured for how much of it reads like language, and refused
  below 80%.
- **A link behind a login** returns the sign-in page with an ordinary 200. Detected and named,
  because "no itinerary found" would be a misleading way to describe it — and airline and hotel
  confirmation links are nearly all of this kind. **This is the limitation most likely to bite.**

One trap worth recording: the end-of-line before `endstream` is a delimiter, not stream data, and
feeding it to the inflater is trailing junk after a complete deflate stream. `DecompressionStream`
rejects the whole block for it — which looked exactly like "this PDF is not compressed" and
silently lost every compressed page. Both readings are now tried.

### What has not been seen working

The **link** path performs a real outbound fetch, and this build environment blocks the open
internet, so no test here has fetched a real page — the same gap as weather (§5). The
*failure* path is covered end to end, because an unreachable host is exactly what this
environment produces. The *success* path is verifiable only in production, and the manual
checklist now covers it.

---

## 7. Trip identity

One emoji per trip, stored in `trip.emoji` (migration 0007, `ADD COLUMN` with a default — additive
only). Suggested from the activities first, then the destination, then ✈️.

**Stored rather than derived.** A suggestion recomputed on read would change under Alex whenever he
edited the trip, and an icon he recognises a trip by has to hold still. `updateTrip` keeps the
existing value unless a valid emoji is sent — asserted in `tests/integration/trip-emoji.test.ts`
by adding an activity to a trip whose icon was overridden and checking it does not revert.

Two details that would otherwise bite:

- The tie-break between two activities is the **approved list order**, not the order Alex tapped
  the chips — otherwise the same trip gets a different icon depending on which button he pressed
  first.
- `isValidTripEmoji` counts **graphemes**, not code units. "🏖️" is three UTF-16 units — a base
  emoji, a variation selector and a surrogate pair — so a plain length check rejects most of the
  picker.

A weak match loses to ✈️ deliberately. A wrong-but-specific icon is a claim about the trip; the
neutral one claims nothing.

---

## 8. The My Stuff Add control

Moved into the screen header as a compact "+" (product doc 02 §10). It had been at the bottom of
the list, which with 118 rows meant Alex scrolled, did not find it, and reported adding an item as
missing.

An intermediate version floated a pill above the tab bar. It was always reachable but covered the
end of the list, and it is the "large persistent Add button lower on the page" the requirement
rules out. The header version costs no vertical space at all.

The drawn chip is 32pt inside a 44pt target — the requirement is that the **tap area** clears 44pt,
not that the button look like a 44pt slab beside the heading. `Screen` takes one optional action
and no more: a header that grows a second and third control is the desktop dashboard doc 02 rules
out.

**The trade-off, stated:** the header scrolls away with the content, so adding an item from deep in
the wardrobe means scrolling back to the top. That is standard iOS large-title behaviour and it is
the cost of not covering the list; the failure being fixed was "cannot find it at all", which this
resolves.

---

## 9. The outfit planner, connected end to end

An audit of what the planner actually consulted found several things stored and read by nothing.
Recorded here because "it uses the weather" was true only of temperature.

### Was already wired

Per-day itinerary activities → group occurrences and During Trip; the activity template's slots,
uses and dressiness band; temperature → a warmth band per group from that group's own dates;
`warmth`, `dressiness`, `typicalUses`, `favorite`, `usageFrequency`, `reuseCapacity`; and reuse
capacity shared across all groups in one pass.

### Was stored and consulted by nothing

| | Now |
|---|---|
| **Rain** | `rainOutlook` fed only `describeWeather` — the sentence. A wet trip read "rain likely on 2 days" and packed identically. Rain now makes the group's outer slot **required**. |
| **Wind** | Parsed, stored, unused. Now a ranking preference — doc 04 §5 criterion 2, which had no representation at all. |
| **`item.weatherTags`** | Written by the item editor, read by nothing. Now the primary source of rain and wind capability. |
| **`preference.reuse_defaults` / `warmth_bias`** | Seeded in migration 0005, read by nothing since. Now in `EngineContext`. |
| **`trip.max_dressiness`** | In the schema and the model since M3, **never written** — the INSERT passed NULL. Now captured on the trip sheet and applied as a cap. |
| **`trip_destination` dates + coordinates** | Columns existed, always NULL. Now written; multi-city needed no migration. |
| **`trip_weather.destination_id`** | Always NULL, so two stops on one date were indistinguishable. Now populated. |

### Capability is recorded, never inferred

The rule worth restating: **a jacket is not a rain layer because it is a jacket.** Only
`weatherTags`, or the words Alex wrote in an item's name or notes, count. This matters more than it
looks — **none of the 118 imported items has a weather tag**, so tags alone would have told him he
owns nothing waterproof. Reading his own words is what keeps the claim true, and the word lists
match `coverageWarnings()` in `import.ts` so the two cannot disagree.

When nothing qualifies the slot stays empty saying so. Nominating the nearest jacket would be a
confident wrong answer discovered in the rain.

### Three refusals, stated

- `destinationForDate` returns **nothing** for a multi-stop trip with no dates, and for a gap
  between two stays. Falling back to the first stop would plan a Reykjavik day against Cape Town.
- A climate normal carries **no rain probability**. The archive gives millimetres, not a chance, and
  converting one to the other would invent a probability.
- The dressiness cap **cannot lower a template's floor**. "Nothing formal" about a trip that
  includes a wedding must not put Alex in loungewear at the wedding.

### Still unverifiable here

The archive endpoint is blocked from this sandbox exactly as the forecast is, so **neither live
call has ever run in a test**. Both fail to nothing by design; the tests that carry weight are the
parsers, the labelling, and the refusals.

---

## 10. Trip history and Plan again

**Status is derived, not stored.** `setTripStatus` has existed since M3 and is called from nowhere,
so every trip sat at `planning` — a trip that ended last month wore a "Planning" chip under "Past
trips". Deriving it from the dates needs no scheduled job and cannot drift. An explicit status Alex
sets still wins while the trip is current.

**Duplicating writes nothing.** `GET /:id/duplicate` returns a template; the trip sheet opens
prefilled and saving is what creates the trip — the same shape as the itinerary importer.

The day plan crosses as **offsets**, so a safari on day three stays on day three. Stop dates are
re-derived. Offsets past the end of a shorter trip are dropped, not clamped.

Packed state, wear history, daily plans, outfits and the old forecast are **not carried**, asserted
by serialising the template and checking those fields are absent rather than by trusting the
mapping. A trip is a plan and a record at once, and copying the record produces a new trip claiming
to be half packed for a week that is over.

---

## 11. The tab bar, measured

Alex reported a band of empty space under the tab labels. Measured at 390×844 with the inset forced
to 34px:

| | before | after |
|---|---|---|
| bar height | 96px | 83px |
| `padding-top` | 8.5px | 0 |
| item height | 52px | 48px |
| **band below the labels** | **40px** | **38px** |

The `padding-top` was added in the previous pass meaning to stop the icons reading as "shoved up";
it made the bar taller and left the band unchanged. Removed. The item row was 52px around ~37px of
content.

**34px of the remaining 38px is `env(safe-area-inset-bottom)`, and it stays at full size** on
Alex's instruction. Capping it would be deciding from arithmetic what only a device can settle,
across devices that cannot be tested here, and the failure it prevents is tap targets under the
home indicator. So the bar is 13px shorter and the band is 2px smaller — nearly all of what he is
seeing is the inset doing its job.

`--tab-bar-height` was also lying: 52px, described as the bar, actually the item, so every
`calc(--tab-bar-height + --safe-bottom + …)` reservation came up short once the bar grew padding.
`--tab-item-height` is now the row and `--tab-bar-height` is derived. An assertion holds them
together, and caught a 4px residual on the first attempt.

### 11.1 Why it looked taller on the Home Screen than in Safari

Deployed, Alex reported the bar still read as too tall, and supplied the correct diagnosis himself:
it is the Home Screen app, not the browser.

He was right, and it is worth writing down because it explains the whole disagreement:

| | `env(safe-area-inset-bottom)` | bar |
|---|---|---|
| Safari tab | **0** — Safari's own toolbar occupies that region | ~57px |
| Home Screen (`display: standalone`) | **34px** — the app owns the screen to the glass | 83px |

The manifest sets `display: standalone` and `index.html` sets `viewport-fit=cover`, so the Home
Screen app is handed a job Safari had been doing for it. The 26px difference is correct behaviour,
and 83px is precisely the native iOS tab bar — a 49pt row over the same 34pt inset.

This also bounds what was available. Everything that could be trimmed *without* touching the inset
came to 4px, which is not visible. **The inset was the only lever that produced a change Alex could
see**, which made it a product decision rather than an implementation one.

### 11.2 The 61px bar — what was chosen, and what it costs

Four options were put to Alex with the cost of each stated first: keep 83px (recommended, and the
native dimension), 79px (row only — free but invisible), 69px (row + a 24px inset), and 61px (row +
a 16px inset). **He chose 61px.**

Measured at 390×844 with the inset forced to 34px, before and after — real numbers from the page,
not arithmetic:

| | before | after |
|---|---|---|
| bar height | 83px | **61px** |
| item height | 48px | **44px** |
| applied bottom inset | 34px | **16px** |
| **band below the labels** | **38.3px** | **18.3px** |

The band is more than halved, which is the first change in this area Alex is likely to actually
notice — the previous pass moved it by 2px.

**The cost, stated plainly and not softened:** at a 16px inset the tab targets end roughly 3px above
the drawn home indicator and sit inside the system's swipe-up gesture region. A tap at the very
bottom edge of a tab may be taken as a swipe. This is the accepted trade-off, not an oversight, and
it is the acceptance test on the device checklist.

Where the height came from matters as much as the total. **All 22px was bought from the inset; none
from the tap target.** `--tab-item-height` went 48 → 44px, which is the iOS minimum exactly, and it
now has nothing left to give — any future tightening must come from `--tab-safe-bottom`. Two tests
pin this: the bar is asserted at exactly 61px (pinned, not bounded, so drift in either direction
fails), and the row is separately asserted at ≥44px so it cannot be quietly shaved to buy pixels.

The earlier assertion here was `barHeight >= 34 + 44`, written specifically to stop the inset being
shrunk quietly. It worked — changing this required editing that test deliberately, which is the
point of writing guards that way.

---

## 12. The bottom bar was the wrong idea, and §11 was solving the wrong problem

**§11 and §11.1–11.2 above are retained as a record, not as current design.** The bar they describe
no longer exists. Reading them is still worth it: they are two rounds of careful measurement spent
optimising a component that should not have been there.

### What was actually wrong

In Safari, a fixed bottom tab bar sits **directly on top of Safari's own bottom toolbar**. Two
navigation bars, stacked, competing for one edge of the screen. Alex's word for it was that it
"does not resemble a normal polished website", which is exact.

Every earlier attempt read this as *the bar is too tall* and went looking for pixels — 96 → 83 → 61.
The last of those bought 22px by capping `env(safe-area-inset-bottom)` at 16px, accepting tab
targets inside the system's swipe-up gesture region. **That trade-off is now gone, because the bar
is gone.** It was never verified on the device, which in hindsight is fortunate.

The lesson worth keeping: a measurement can be correct and still be aimed at the wrong thing. Three
rounds of honest arithmetic never asked whether the component should exist.

### What replaced it

`PrimaryNav` — a compact row beneath the page title, sticky, on every screen, identical in Safari
and standalone. Product doc 02 §3 carries the requirement and the reason.

- Reuses the tab bar's `NavLink` + `aria-current="page"` pattern and keeps `aria-label="Primary"`,
  so the nine e2e specs selecting `getByRole('navigation', { name: 'Primary' })` kept working.
- 44px row, no extra vertical padding. The rule that stopped the old bar being trimmed further —
  the target is the floor — is the same rule that keeps this from growing into a second header.

### The half that was not about navigation at all

`html, body, #root` were `height: 100dvh`, and `.screen` was a `.scroll-region` inside it. So the
**document never scrolled** — an inner box did.

Safari only collapses its toolbar when the page scrolls. Under a fixed-height shell it cannot, so
the toolbar stayed at full height permanently, and the app kept ~50px of browser chrome on screen at
all times regardless of what Pack Smart did with its own bar. Removing the bottom bar alone would
have left that untouched.

The fix is one word: `height: 100dvh` → `min-height: 100dvh`. The `dvh`-not-`vh` reasoning in the
original comment is still right and is kept.

One thing this made honest rather than broke: `BottomSheet` already captured `window.scrollY`, set
`body.style.top = -scrollY`, and restored on close. Under the old shell `scrollY` was always 0, so
that lock had been dead code doing nothing. It works now without being touched.

### What the tests can and cannot show

New guards: nothing is fixed to the bottom of the viewport, the gap below the last content is
ordinary page padding, and `window.scrollY` actually becomes non-zero on a long page — the last of
which would have failed on every build before this one.

**WebKit at 390×844 has no Safari toolbar**, so CI can prove the document scrolls but cannot prove
the toolbar collapses. That stays a device check (doc 08), as R11 has always said.

---

## 13. The saved-outfit relationship — and why §9 was wrong about it

Doc 04 §5 criterion 3, the last of the eight to be implemented.

### The claim that turned out to be wrong

§9 above recorded this as needing "a cross-trip `saved_outfit` table and a UI for saving and reusing
combinations". Re-reading the approved documents before building it showed that was an invention:

- Doc 04 §5 names the criterion **"*Approved* saved outfit relationship"**. Approving *is* the save.
- Doc 04 §7 lists the outfit controls and opens with "keep controls minimal": Swap, Add, Remove,
  **Approve**, Mark for reuse. There is no save action, and adding one would have been new scope.
- Doc 04 §3's "Saved favorites" is `item.favorite`, already implemented — not saved outfits.

So the feature is not a library Alex curates. It is Pack Smart noticing what he already told it.

### What blocked doing it silently

`CLAUDE.md`: *"Trip edits should default to affecting only the current trip. Permanent preference
changes must be explicit."* Approving is a per-trip act; a pairing outlives the trip. Deriving one
from the other silently would break that rule, and no reading of the docs resolves it — so it went
to Alex as a product decision. He chose: **learn from approvals, say so, and offer Undo.**

Undo rather than a confirmation dialog is doc 02 §2's house style, and it means the announcement
costs nothing when the answer is yes — which it usually is.

### How it works

`outfit_pairing` counts co-occurrence in approved outfits: one row per unordered garment pair,
canonically ordered, written on **draft → approved** and reversed on **approved → draft**. The
transition is read before writing, so re-approving cannot inflate a count and un-approving cannot
leave one behind. `MAX(0, …)` means a repeated Undo cannot drive a pair negative and invert its
meaning into a garment that quietly repels another.

Ranking sums a candidate's pair counts against the garments already chosen for that outfit — a sum,
so two approvals outrank one. It sits at position 3: **below** weather suitability, so a habit can
never dress Alex wrongly for the conditions, and **above** favourite, because what he actually wore
together is better evidence than what he once starred.

`rank()` gained an optional `explain()` per criterion. A score is not an explanation for a
*relationship*: "A favourite" describes the garment, but the useful sentence here names the other
garment — "You approved this with Olive Quilted Jacket before".

### Anchor first, then coordinate

Slots fill in order, and `top` is first — so **a pairing never decides the top.** The anchor is
chosen on its own merits and everything after it is chosen to go with it.

This was found by a test, not by reading. A first version asserted that a pairing could change which
tee a later trip picked; it failed, because by the time the tee is chosen `chosenInGroup` is still
empty. The engine was right and the test was wrong. Rather than re-ranking every slot against every
other until the outfit settles — more code, more CPU, and "why this shirt" becomes much harder to
answer — the behaviour is now stated in doc 04 §5 and the test targets the `bottom` slot, where the
criterion genuinely applies.

### What the tests actually pin

- **The safety property:** with an empty index the ranking is identical to before this existed,
  asserted by ranking the same wardrobe both ways and comparing. A first trip is unaffected.
- **Causation, not correlation:** the cross-trip test makes a *rival* garment a favourite in
  between, runs a control trip with the pairing deleted to confirm the favourite wins, then restores
  the pairing and confirms it loses. Without that control the test would have passed on determinism
  alone and proved nothing.
- **The ledger:** double-approve, un-approve, double-undo, and that Undo leaves the approval intact.

### Two incidental corrections

**The test harness lacked `D1Database.batch`.** Nothing in the Worker had used it, so the first repo
to reach for it failed with `db.batch is not a function`. That is a harness gap, not a reason to
write fifteen sequential round trips on a 10ms CPU budget — `batch` was added to
`tests/integration/d1.ts`, wrapped in a transaction as D1 does, so a half-applied batch cannot leave
the pairing ledger disagreeing with the approvals that produced it.

**Two literal NUL bytes** were written into `worker/repos/pairings.ts` as map-key separators. They
worked, and made the file binary to `grep` and diff. Replaced with a U+0000 escape sequence, which
keeps the collision-proof property — an id cannot contain a NUL, so unlike a space the two halves
can never run together into a key meaning something else — while leaving the source plain text.

---

## 14. The swipe row, rebuilt on touch events

The gesture had been repaired four times (#18, #20, #21, #30) and was still
unusable on the phone. #30 is the one that matters, because it is the one that
passed everything: typecheck, lint, 756 unit and integration tests, 128 WebKit
end-to-end tests including a spec written for this exact defect, the visual
gate, and a production deploy. Alex picked up his iPhone and the row jittered,
neither direction completed, and the feature was no better than before.

That result is the reason this section exists. **A green suite was not evidence,
and the fix was not "one more test".**

### The cause was a split between two event streams

#30 decided the gesture's axis in a **Pointer Event** handler and vetoed the
browser's pan from a **Touch Event** handler. `preventDefault()` on a pointer
event cannot stop a scroll, and React registers `onTouchMove` at the root as
passive, so a native listener was genuinely required — that part was right. The
error was leaving the decision in the other stream.

1. **The veto could only ever be late.** The axis was claimed after 8px. WebKit
   decides whether a touch is a scroll from the first move past its own,
   smaller slop. For the first two or three `touchmove`s the row was still
   `undecided` and vetoed nothing — and once a pan starts, every later
   `touchmove` arrives with `cancelable === false`, which the veto explicitly
   skipped. It ran only after it could no longer do anything.
2. **It relied on an ordering nothing guarantees** — `pointermove` before the
   matching `touchmove` of the same frame, across a root-delegated React
   listener and a native element listener.
3. **Losing the axis lost the gesture.** `pointercancel` reset the row, zeroed
   its measured width and released the pointer, so the row then ignored a
   finger that was still down and still moving. Twitch, snap back, go dead —
   all three reported symptoms from one cause.

### `touch-action: pan-y` is necessary and never sufficient

`pan-y` stops the browser panning *horizontally*. It does nothing about the
browser deciding a mostly-sideways thumb carrying five to fifteen pixels of
vertical drift is a *vertical* pan — and a real thumb always carries that drift.
Reading `pan-y` as "the horizontal axis is ours" is the assumption underneath
all four attempts.

### The replacement

**Touch Events only on a touch screen. No Pointer Events at all.**

- Touch events have **implicit capture**: `touchmove` and `touchend` are
  dispatched to the element that received `touchstart`, whatever the finger is
  over now. `setPointerCapture`, `pointercancel` and `lostpointercapture` are
  gone rather than handled — the arbitration surface is removed instead of
  negotiated with.
- The axis is claimed and the pan vetoed **in one handler, from one event, in
  one tick**, at a **5px** lock rather than 8, so the claim lands inside
  WebKit's decision window rather than after it.
- If the browser wins anyway, `touchcancel` ends the gesture cleanly. It does
  not reset under a moving finger and restart the arbitration.
- **A mouse is a separate path** — `mousedown` on the row, `mousemove`/`mouseup`
  on the window. A mouse never competes for a scroll axis, and keeping the two
  apart is what stops a `page.mouse` spec from appearing to describe the touch
  path it cannot exercise.

**React does not render during a gesture.** The transform and the state classes
are written to the elements; the only React state the row holds is whether the
tray is latched open, which changes after the gesture rather than during it. The
tray is rendered at rest and hidden with `visibility: hidden` — which is both a
stronger fix for the red-✕-flash than the conditional mount it replaces (an
invisible element cannot paint in any frame) and the thing that removes the last
mid-gesture render.

**The row settles before the list resorts.** `onComplete` moves the item into
another section, which remounts the row; it is deferred by exactly the settle
duration, and flushed if the row unmounts first so a commit can never be lost.

### `@use-gesture` was evaluated and rejected on its source

Not on taste. `@use-gesture/react` v10.3.1 was installed and its `DragEngine`
read. `pointerDown` calls `setPointerCapture` and drives from Pointer Events by
default; its scroll coexistence is `setupScrollPrevention`, which waits
`DEFAULT_PREVENT_SCROLL_DELAY` — **250ms** — before the drag may begin and
cancels the gesture outright if the user moves on the prevented axis first.
Configured for a fast swipe instead, it warns that the target wants
`touch-action: none`, which removes vertical scrolling from the row.

It is the architecture that failed, plus a quarter-second of dead row, for
~12kB. Recorded so the evaluation is not repeated.

### Two defects found on the way, neither of them the reported one

- **`lastTouchAt` was initialised to `0`.** Event timestamps are milliseconds
  since the page's time origin, so they start near zero too — meaning every
  mouse gesture in the first half-second after a load looked like the emulated
  mouse event that follows a touch, and was suppressed. Caught by a Chromium run
  where the row simply refused the first swipe. `-Infinity` now.
- **The trailing-click swallow was a latch.** On a phone a vetoed `touchmove`
  suppresses the emulated click entirely, so the flag stayed armed after every
  swipe and would eat the next genuine tap on that row — a control that goes
  dead only after a gesture, which is close to un-attributable. It is a 400ms
  window now.

### What the tests are worth

`swipe/recognizer.ts` holds the decisions as pure functions, so direction
locking, thresholds, the flick guard, cancellation and multi-touch rejection are
finally testable without a browser. `SwipeRow.test.tsx` asserts the wiring —
including **zero renders between the finger landing and the release**, which is
a property no screenshot and no locator could ever have caught.

The browser specs say in their own headers what they cannot prove: Playwright
has no multi-step touch drag, so the moves are dispatched, and a dispatched
event does not run WebKit's scroll arbitration — the exact mechanism that broke
#30. **The gate is one three-action check on the phone**, and the temporary
Preview-only *Gesture check* panel exists so that if it fails, the answer is
read off the screen rather than guessed at again.

---

## 15. Why every packing-list row now says something

C1's audit counted 32 generated rows on the approved worked example and **19
with no explanation at all** — Toothbrush, Wallet, Phone, ID, Deodorant, both
chargers, Glasses and the rest. Not wrong, just silent.

### The gap was one line, and it was structural

`reason` was set in exactly one place: `computeQuantity` returned
`gates.reasons` joined, and `evaluateGates` only ever pushed a reason for a
`conditional_include` rule. A row whose quantity came from `fixed_per_trip` or
`per_day` with no conditional gate therefore had `reason: null` **by
construction**. It was not a missing case; there was no code path that could
have produced one.

### `originalText` was not the answer the brief expected

The slice was scoped on the premise that `PackingRule.originalText` already held
useful language and simply was not surfaced. It holds the workbook's
`Default Priority / Quantity Rule` column, which reads `Critical (Always)`,
`Always`, `Usually`, `Almost always`, and
`Explicit Item: Packed if Apple Watch is brought`.

`Usually` is the tier that produced the rule. `Explicit Item:` is importer
vocabulary. Piping those onto rows would have satisfied "every row has a reason"
and delivered precisely the filler the slice existed to avoid — which is the
kind of success worth noticing before shipping it.

So `usableRuleText` gates that level: it strips importer prefixes, rejects
priority tiers, formulas, identifiers, JSON-ish text and anything over 72
characters, and returns null for the rest. The seeded catalog falls through it
almost entirely and lands on the rule kind stated plainly — `One per trip` —
which is the better sentence anyway. The level is kept, above the fallback,
because a rule **Alex** writes comes with his own reason attached.

### The precedence is "most specific honest fact wins"

Calculation, then trip condition, then his words, then a system rule's words if
they pass the gate, then the rule kind. The ordering matters most where several
rules apply: `2 per day` over ten days is 20 and `always pack 3` is a floor of
3, so the row says `10 days × 2`. Crediting the floor would be true of one rule
and misleading about the number beside it. `decidingContribution` picks the
contribution whose own value reached the base, and the contributions arrive in
the engine's existing fold order, so the sentence inherits the quantity's
order-independence rather than needing its own.

### Two defects found on the way, neither in the brief

**An overridden row was never re-explained.** The generator skips a row with a
hand-set quantity outright — correctly, for the quantity — so `reason_text`
stayed null on it forever. A row Alex has bothered to adjust is the last one
that should be silent. It now refreshes the reason while still never touching
his number.

**And the explanation would have argued with that number.** `11 nights × 2`
beside a 7 he typed invites the multiplication and leaves him wondering which
figure is wrong. An overridden row states the rule as a *rate* — `2 per night` —
which sits honestly next to a total he chose. That meant skipping levels 1, 3
**and** 4 together, because the rule's own words can hide a formula too: the
real Contacts rule is stored as `Quantity Rule: Nights × 2`, which would have
sailed past a check that only looked at the calculated label. The stored
breakdown is suppressed on the row and in the sheet for the same reason.

### Existing trips repair themselves, once

The checklist regenerates when a trip changes, not when it is read, so every row
written before C1 would have kept its blank reason indefinitely. `GET
/:id/checklist` now regenerates when it finds an engine-owned row with no
reason. That is the only GET in the product that writes, and it is deliberate
and bounded: `generateChecklist` preserves a hand-set quantity, an exclusion and
an added item by contract, the condition stops being true after the first open,
and the test sets up both kinds of edit before the repair runs.

### Not every row prints its reason, and that is also a decision

`rowSecondaryLine` is in `shared/` with a test that argues for it. A single
always-packed item would read `One per trip` — restating the row's own quantity,
nineteen times consecutively on the seeded catalog. Nineteen identical lines is
wallpaper, and it is the filler failure wearing a true sentence. Trip-specific
reasons do earn the row. Everything is one tap away under *Why it is here*, and
the row's line lives inside the row's own button so a screen reader announces it
with the control rather than as loose text beside it.

### `conditions.ts`

`Condition`, `evaluate` and `describeCondition` moved out of `rules.ts` so
`explain.ts` could reuse the vocabulary without the two importing each other. A
cycle would have worked today and broken the first time either was loaded in a
different order. `rules.ts` re-exports all of it, so nothing outside changed.

---

## 16. Pack by bag — a lens, and the one exception to "every row once"

`/trips/:id/bags` groups the packing list by the bag Alex is standing over. The
whole design constraint is that it is a **lens**, not a list:

- every row it shows is a row on `/trips/:id`, keyed by the same `entry.id`;
- ticking one is `patchEntryOrQueue({ packedQty })` on that row, the same write
  the packing list and `Before you go` make — so there is no per-bag state, no
  per-bag persistence, and nothing that can drift;
- the grouping is `packByBag(plan, entries)` in `shared/pack-by-bag.ts`, and
  `plan` is the trip's one `planBags` result. There is no second bag planner,
  which is why the screen cannot reach a different answer about a garment than
  the entry sheet or the crowding warning beside it.

### Every row lands somewhere, and `Anywhere` is why

`recommendBag` is deliberately quiet and returns `null` for most clothing. A
view that showed only placed rows would hide the bulk of the list behind a lens
claiming to show the bag — "I packed by bag and three t-shirts are still in the
wardrobe". So unplaced rows get a group of their own, labelled `Anywhere`.

It is **not** a default placement. Guessing that a t-shirt goes in the hold
would be exactly the second planner this avoids, and Pack Smart genuinely has no
opinion about a t-shirt. The group says so, and the row's own sheet is where
Alex records an answer if he wants one — which writes `bag` / `bag_source =
'user'` and moves the row, through the existing column.

### The one row that appears twice

A row set to `either` appears under **both** cabin bags and neither hold,
because that is what "the personal bag or the carry-on, whichever has room"
means — and because `filterChecklist` has always done this. Two lenses
disagreeing about one garment would be worse than the duplication. Nothing else
may appear in two groups, and nothing at all may appear in none;
`tests/integration/pack-by-bag.test.ts` asserts both, and both assertions were
mutation-checked.

The trip's total on the screen comes from `checklistProgress` over every row
rather than by summing the groups, for exactly this reason.

### Aviation words, and why this is not a second vocabulary

`BAG_MEANING` settled that the bags are not renamed per trip: one name for the
column, and a sentence saying what each means. Nothing here reopens that —
`BAG_LABELS` is still the only wording on the chips that *choose* a bag.

A heading on this screen is a different job: it names the physical thing on the
bed, and `Checked bag` names something that does not exist on a drive to the
coast. `bagGroupLabel` softens the three headings to `Small bag` / `Main bag` /
`Large bag`, in the wording `BAG_MEANING`'s own glosses already use, and only
when `airTravel(trip) === 'no'` — the same explicit answer that already silences
the liquid rules. Never on a guess.

### The chooser is stacked headings, and a segmented control was tried first

Four bags with a count each measured **366px inside a 360px viewport** and the
mechanical gate rejected it: `.chip` is `white-space: nowrap` and
`chips-compact` gives every segment an equal share, so there was nowhere for the
overflow to go. Headings stack, so the width problem cannot recur — and they
answer a better question anyway. Collapsed, the screen is every bag and how far
along each one is, which is a thing Alex actually asks ("is the carry-on
done?") and a row of chips could only have answered in six characters.

One bag is open at a time; tapping the open one closes it and leaves the
overview. `nextBagWithWork` offers the next bag with something left in it once
the open one is finished — an offer, not a step, because the wizard version is
wrong the first time he does the carry-on before the hold.
