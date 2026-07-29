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

---

## 3. Not built, and why

| Item | Status |
|---|---|
| **Weather** (Open-Meteo) | **Built, and unverifiable here.** See §5 — the live call cannot be exercised from this sandbox, so it is delivered with that stated rather than claimed as done. |
| **Climate normals** | **Built** — see §9. Same verification gap as the forecast. |
| **Approved saved outfit relationship** | Doc 04 §5 criterion **3**, and the one criterion still absent from `CRITERIA`. Doing it properly needs a cross-trip `saved_outfit` table and a UI for saving and reusing combinations; it is a feature, not a line in a ranking function. Deliberately out of scope. |
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
