# Pack Smart — UX audit

**Canonical.** One row per finding, with a stable id. Commits and PR comments reference the id, so a
session that has lost its context can reconstruct what is wrong, what was fixed, and what is left
from `git log --grep UX-` plus this file.

Audited against `9a3a915` from the **real product**: the production build, seeded with Alex's actual
85 garments and 33 gear items and five trips (`npm run seed:demo`), captured at 360 / 375 / 390 / 430
by `npm run qa:visual`. Every finding below was seen in a screenshot, not inferred from code.

**The mechanical gates all passed on the first run.** No horizontal scrolling, no target under 44px,
no input under 16px, no unnamed control, nothing pinned to the bottom edge, and the focus trap holds
in all four sheets. The product's problems are **hierarchy, density and information architecture** —
it behaves correctly and reads like an admin tool.

Severity: **1** critical usability defect · **2** high-friction · **3** weak hierarchy or wasted
space · **4** polish.

---

## Measured, at 390×844, on the real production build

Both columns are measurements of a running app, not estimates: `main` at `9a3a915` and this head,
each seeded through `npm run seed:demo` into its own database.

| | `main` 9a3a915 | this head | |
|---|---|---|---|
| Trip screen — top of the first packing row | **934px** (below the fold) | **663px** (on screen) | −271px |
| Trip screen — total page height | 3844px | 3547px | −297px |
| Trip screen — navigation to settled | 896ms | 899ms | +3ms |
| Home — where content ends | 478px (57% of the viewport) | 1053px (fills it) | doc 02 §4's three missing sections |
| My Stuff — garment rows in the first viewport | 4 | 8 | ×2 |
| Client JavaScript (gzip) | 85.90 kB | 88.98 kB | +3.08 kB |
| Client CSS (gzip) | 5.64 kB | 6.48 kB | +0.84 kB |
| Worker (gzip) | 79.32 kB | 79.15 kB | −0.17 kB |

The trip screen's first row moving 271px is the release: it is the difference between opening a trip
and seeing the packing list, and opening a trip and scrolling to find it. The 3.9 kB gzip the whole
pass costs is a design system, a swipe gesture, a loading skeleton and three new Home sections.

## The finding that matters most

**The two screens Alex uses most spend their first viewport on administration.**

On the trip screen, the packing list — the entire point of the screen — starts *below* the first
viewport, under a progress bar, two warning panels, three text links, three full-width secondary
actions each carrying its own explanatory paragraph, and a disclosure. On Home, more than half the
first viewport is empty and there is no primary action at all.

Everything else in this audit is smaller than that.

---

## Findings

| id | Screen · state | Severity | What is wrong, and what Alex suffers | Correction | Behaviour? | Status |
|---|---|---|---|---|---|---|
| UX-01 | Trip · populated | 1 | The checklist begins below the fold. Above it: progress, a red panel listing 11 essentials, a coverage panel, `Outfits / Today / Edit` as bare text, then **three** full-width links each with a two-line paragraph, then a disclosure. Beside an open suitcase Alex scrolls past all of it every single time. | Give the screen a compact header block (progress + one status line), move planning actions into one grouped, collapsed row, and start the list in the first viewport. Hint prose becomes one line or goes. | Presentation | **done** |
| UX-02 | Checklist · scrolled | 1 | The sticky navigation covers section headings — "Final check" is half hidden behind it while scrolling. Alex loses his place in the one screen he scrolls constantly. | `scroll-margin-top` on section headings, sized from the nav. | Presentation | **done** |
| UX-03 | Checklist · any | 2 | Packing needs a precise tap on a row after finding it. Doc 02 §2 wants one-handed use beside a suitcase; there is no accelerator. | Swipe right to pack, per `INTERACTION_PATTERNS.md` §2, with the tap kept as the accessible path. | Behaviour | **done** |
| UX-04 | Checklist · Final check | 3 | Every row in the section is tagged `· Essential`, so the marker means nothing where it appears most. Alarm fatigue, exactly what doc 06 §3 forbids. | Show the marker only where it distinguishes — never on a section that is entirely essentials. | Presentation | **done** |
| UX-05 | Home · populated | 1 | More than half the first viewport is empty, there is no primary action, and the red panel lists every unpacked essential on a trip where nothing is packed yet — noise on day one. | Make the card the primary action, add one honest next action, and make the essentials line proportionate (a count with the first names, not all eleven). | Presentation | **done** |
| UX-06 | Trip, Outfits, Settings · any | 2 | `button-secondary` renders as bare green text with no border or background, so *Add an itinerary*, *One last look*, *Undo approval* and *Sign out* read as headings rather than controls. Destructive and ordinary actions look identical. | One button system: filled primary, outlined secondary, quiet tertiary, and a destructive variant that looks destructive. | Presentation | **done** |
| UX-07 | My Stuff · populated | 3 | Thirteen category chips wrap over six rows and fill 60% of the first viewport before one garment appears. | One row that scrolls sideways inside its own strip, the native pattern, instead of six that wrap. Nine garments now sit in the first viewport where four did. | Presentation | **done** |
| UX-08 | My Stuff, checklist · any | 4 | Categories with no emoji fall back to a bare `•`, so "Medication Storage" and "Medicine Wheel" look broken. | Give every category an icon, or drop the glyph for the ones without one rather than printing a bullet. | Presentation | **done** |
| UX-09 | Outfits · any | 2 | A card states only "Once · On your packing list". Doc 04 requires the dates or occasions, the activity, the place, the conditions used and the formality — none are shown, so the recommendation cannot be checked. | A context line per card from what is recorded: the dates from the days Alex named (through the same `assignDays` During Trip uses, so they cannot disagree), the place from the destination those dates belong to, the formality from the activity's own band. Nothing recorded, nothing said — there is no invented weather. | Presentation | **done** |
| UX-10 | Outfits · approved | 3 | Approval is a thin border plus five words; *Undo approval* is styled exactly like every other link. | Approval now reads as its own accent line rather than five grey words, and *Undo approval* dropped to the quiet tier. | Presentation | **done** |
| UX-11 | Trips · populated | 3 | Every trip shows the same "Planning" pill, so the badge carries no information, and no row shows packing progress. The primary action sits below the whole list. | The pill carries days-to-departure, which differs per trip, instead of "Planning" on all of them; **Plan a Trip** moved into the header beside the title, so it is reachable without scrolling past every trip. | Presentation | **done** |
| UX-12 | Trips · any | 4 | Two of five seeded trips got the same suggested emoji, weakening the identity the emoji exists to provide. | The suggestion now skips an icon another trip already wears and takes the next **true** signal instead. A duplicate is still preferred over a false icon: sharing 🍷 is a smaller lie than claiming a lion. | Behaviour | **done** |
| UX-13 | Settings · any | 3 | Seven flat rows with no grouping and no chevrons; nothing indicates a row opens a sheet. Doc asks for grouping by intent. | Five intent groups — How packing works · What Pack Smart has learned · My wardrobe · Data and backup · This app — and every row carries a chevron so it looks like it opens something. | Presentation | **done** |
| UX-14 | Checklist · quantity rows | 4 | A row carrying a quantity breakdown is half again as tall as its neighbours, so the list scans unevenly. | **Not doing it.** Tried moving the breakdown behind *Why this*; the e2e suite caught that this removes the derivation from the row, and "12 days × 2 = 24" IS the explanation for the number beside it (doc 03 §8). An even list is not worth trading a real answer for. | — | **won't do** |
| UX-15 | Whole product | 3 | No shared button, row, card, banner, chip or sheet primitives — every screen re-implements them in its own CSS file, which is how the inconsistencies above arrived. | One primitives layer; screens stop declaring their own control styles. | Presentation | **done** |
| UX-16 | Outfits · unplanned | 4 | The assumption line uses body line-height at small size, making a two-line note look loose and unfinished. | Tighten with the shared banner primitive. | Presentation | **done** |
| UX-17 | Home · populated | 2 | Home answers its question in the top third and leaves the rest of a 390×844 viewport empty — content ended at **478px**. It is not restraint: doc 02 §4 asks for the featured trip **and** upcoming trips, New Trip, and recent trips beneath it, and all three had collapsed into one text link reading `All trips · 4 more`. A count is not a list, and a signpost is not an action. | The other upcoming trips and the two most recent as rows — the same `TripRow` the Trips screen uses, not a second one — with the trip sheet opening on Home itself. Content now runs to 1053px. | Presentation | **done** |
| UX-18 | Home · during a trip | 3 | The card ended with the words *See what to wear today* and the primary button 200px below said the same seven words and went to the same screen. Two controls, one destination, identical labels — `VISUAL_ACCEPTANCE.md` §2's competing actions, in the state Alex is in while actually travelling. | The card carries the trip; the button carries the action. An end-to-end test now fails if any two controls on Home share a label. | Presentation | **done** |
| UX-19 | Trip · loading and failed | 2 | The screen Alex opens most rendered **nothing at all** while loading — a heading and blank page, indistinguishable from a crash on a hotel connection. When the load failed it offered a red sentence and one button that navigated *away*, so a dropped request meant leaving the screen and coming back to retry. The `.skeleton` primitive written for exactly this had no callers. | A skeleton in the shape of the trip header, alert and first rows; and a real failure state — what happened, that nothing was lost, **Try again** in place, *Back to trips* demoted to quiet. | Presentation | **done** |
| UX-20 | Whole product · Dark | 2 | `tokens.css` has carried a full dark palette since the design system landed and **nothing had ever looked at it**. In Dark the essentials alert — the one genuinely urgent thing on the trip screen — was indistinguishable from the neutral note beneath it: `--color-danger` is a saturated red in Light but a pale pink in Dark, and 8% of a pale pink over `#171719` is nothing. One token doing two jobs, and the second failed silently. | The tint is a proportion (`--danger-tint`) that each theme sets, so Light is byte-identical and Dark registers. The visual harness now captures seven screens in Dark at all four widths and runs every mechanical gate against them. | Presentation | **done** |

---

## V1.1 — the visual, spatial and fluidity pass

Audited against `b7eb2a5` from the real product, seeded with Alex's own wardrobe and five trips, at
**390 × 664** — the height Safari actually gives a page on an iPhone 14, not the 844 of the screen.
The measurements below are from `npm run qa:visual`'s `measurements.txt`, which is part of the
harness now rather than a number typed into a document.

| | `main` b7eb2a5 | this head | |
|---|---|---|---|
| **Trip — top of the first packing row** | **767px** | **535px** | **−232px** |
| Trip — the summary block | 70px | 46px | −24px |
| Trip — a packing row | 56px | 47px | −9px each |
| My Stuff — top of the first wardrobe row | 437px | 342px | −95px |
| My Stuff — the Review closet entry | 92px | 59px | −33px |
| Home — top of the active trip | 126px | 100px | −26px |
| Home — the active trip module | 189px | 131px | −58px |
| Trips — a trip row | 82px | 60px | −22px each |
| Settings — a settings row | 69px | 57px | −12px each |
| Page chrome — title + nav | 110px | 88px | −20% |
| Page chrome — title + subtitle + nav | 157px | 118px | −25% |

| id | Screen · state | Severity | What is wrong, and what Alex suffers | Correction | Behaviour? | Status |
|---|---|---|---|---|---|---|
| UX-21 | Whole product · chrome | 2 | Every screen spends 110px — 157px where there is a subtitle — before its own content begins, on a 664px viewport. A 28px title on a 1.45 line height, a 16px subtitle with 24px under it, and a permanent sun/moon appearance toggle occupying the most expensive 44 points in the layout on every screen in the product, as a shortcut to a control Settings already carried in full. | Title 22px on tight leading, subtitle to 14px secondary metadata, each gap down a step, and the appearance toggle removed in favour of the three-state control that was already in Settings. The 44px navigation row is the floor and is not traded. | Presentation | **done** |
| UX-22 | Trip · populated | 1 | The packing list — the point of the screen — starts at **767px** on a 664px viewport. Above it: a three-row summary, a readiness list of 60px lines, a 24-hour-backup disclosure, a coverage panel, two 48px destination buttons, a 44px setup disclosure, a search row, a heading and a hint. UX-01 fixed this once at 844; at Safari's real height it had come back. | The countdown and the count share one line above the bar; readiness issues become rows on a shared surface; Outfits, Today and Trip setup share one 44px row; the 24-hour backup moves below the list it describes; the weather becomes a metadata line with the climate-normal caveat behind an ⓘ. First row now at **535px**, with roughly three rows of list in the first viewport. | Presentation | **done** |
| UX-23 | Checklist · any row | 2 | `14 needed · 12 days × 1 + spare for 2 extra days = 14` wrapped to two lines and made that row **88px** beside 49px neighbours. Forty rows of uneven height is a document, not a list — and doc 03 §8 asks for the derivation to be *answerable*, not printed on every row for ever. | The row says `24 needed`. `rowExplanationParts` splits the same rule between the list and the sheet, where `Why this many` has always shown it. Asserted end-to-end: the row does not contain the arithmetic, and the sheet does. | Presentation | **done** |
| UX-24 | Trips · Home · any list | 3 | Every trip was its own bordered, rounded card with a 12px gutter under it, so three upcoming trips read as three objects floating on a page. Repetition is a list, and this was a card mosaic — 94px per trip for two lines of type. | One surface, one outline, `--color-separator` hairlines between the rows. 60px per trip, and Home now shows three upcoming trips plus the start of the recent ones in its first viewport. | Presentation | **done** |
| UX-25 | My Stuff · populated | 2 | The wardrobe — 119 rows of it — starts at **437px**. A Review-closet entry whose subtitle wrapped to two lines stood 92px tall, taller than any garment row beneath it, for a door rather than a thing Alex owns. | `Improve recommendations` instead of `Help Pack Smart improve your recommendations.`, 52px minimum, and a tighter search/filter block. First wardrobe row at **342px**, five rows in the first viewport. | Presentation | **done** |
| UX-26 | Whole product · surfaces | 3 | One line weight did two jobs: outlining a surface and dividing rows inside one. Twenty rows drawn with twenty outline-strength hairlines read as twenty boxes. In Dark, `#0b0b0c` under a `#171719` card is a step you have to look for — the page read as a hole with panels in it. | `--color-separator` for dividers, `--color-border` for outlines, and Dark lifted off pure black (`#0f0f11` / `#1a1a1d` / `#242428`). `.banner-quiet` gained a real surface instead of being a border drawn around some text on the page colour. | Presentation | **done** |
| UX-27 | Whole product · type | 3 | Page title 28px and section heading 18px is not a step, it is two headings arguing; every heading in the product inherited `body`'s 1.45 line height, which on a 22px title is ten pixels of nothing on the first line of every screen. `.trip-readiness-summary` asked for `--text-md`, a token that has never existed. | Five type roles, three line-height tokens, and the phantom token replaced by the size it had silently been rendering at. | Presentation | **done** |
| UX-28 | Trip · Undo · disclosures | 4 | A disclosure opened as a hard cut and the Undo bar was painted in one frame at full opacity over whatever Alex was looking at — which reads as a glitch rather than as a consequence of the tap. | A 120ms 4px reveal on disclosure bodies and a 160ms 12px entrance on the Undo bar. Entrances only: everything hidden is conditionally rendered, and animating a collapse would give a collapsed disclosure focusable children again. Both removed by `prefers-reduced-motion`. | Presentation | **done** |
| UX-29 | Every search field | 3 | Eight search fields across the product, and no way out of a search but selecting the text and deleting it — one-handed, beside an open suitcase, on the two screens (the wardrobe and the packing list) whose search is used most. WebKit's own cancel button is not an answer: iOS Safari draws none at all, and desktop WebKit draws an unstyleable one, so the affordance would have been present in every screenshot taken here and absent on the phone. | One shared `SearchInput`: a `×` at the right-hand end when the field holds text and nothing when it does not, in a 44px target positioned over padding reserved for it, so a field is exactly as tall as it was. `pointerdown` is prevented so focus never leaves the input — on an iPhone that is the keyboard staying up rather than dismissing and reopening. Asserted end-to-end, including by mutation. | Presentation | **done** |

### Decided against, with the evidence

- **A compact sticky trip header.** Genuinely useful — name and progress following you into the list
  — and rejected on the arithmetic. The navigation is already 44px of a 664px viewport; a second
  strip takes standing chrome to ~80px, or 12%, permanently, on the one screen this pass spent its
  whole budget clearing. That is the "sticky header that simply moves the problem" case.
- **Dropping the page title from the four tab screens.** It would have bought ~30px each, and the
  navigation's active tab already names the screen. Eight end-to-end tests assert that each screen
  displays its own name, and that contract is worth more than 30px.
- **A single filter control on My Stuff.** Folding category and sort behind one sheet saves 44px and
  turns a one-tap native wheel showing thirteen categories into two taps. Not worth it.
- **Compressing wardrobe rows to the 72–84px target.** They were already 67px. Line height took them
  to 65. Nothing was compressed to reach a number that had already been beaten.

---

## Packing list compression and outfit authoring

Two high-frequency areas made more direct, against `9d1b1aa`. The packing list stops being a stack
of two-line cards, and Outfits stops being read-only.

| id | Screen · state | Severity | What is wrong, and what Alex suffers | Correction | Behaviour? | Status |
|---|---|---|---|---|---|---|
| UX-30 | Checklist · counted rows | 2 | UX-23 took the arithmetic off the row and P4f put it back on the rows whose count is *surprising*. Those are the counted ones — most of the clothing on a long trip — so the list went back to being unevenly tall exactly where it is longest, for a sentence nobody reads while packing. | The row says `24 needed`; where the 24 came from is in the row's sheet under *Why this many*, which is where it has always also said it. `quantityIsSurprising` survives as the written definition of which numbers deserve a word; nothing on the list asks it. | Presentation | **done** |
| UX-31 | Checklist · garment rows | 2 | `Vuori · Dark Green` under the name was the commonest reason a packing row was two lines, on a list of forty. A colour word is also something Alex has to *decode* — the wardrobe has no photographs, and the one thing a list of clothes should give at a glance is the palette. | Brand as secondary text on the right of the row, capped at 30% so it truncates before the garment name does; colour as the same swatch Outfits already uses, in one column down the right edge. The colour NAME is in the row's accessible description, so nothing is available to the eye and withheld from a listener. Every row on a real list is now one line, asserted by measurement. | Presentation | **done** |
| UX-32 | Trip · any | 1 | Adding something Alex OWNS was not offered on this screen at all — the only route was `One last look`, three taps inside `Trip setup`, which is a pre-packing wardrobe review rather than an add flow. The one-off route was the last control on the page, below forty rows. Meanwhile the header's single action slot held a *lens* over the list. | The header action is Add, and both answers to *add what* live in it: My Stuff by default, and a unique item one tap away. The bag lens moved to the row of destinations beside Outfits and Today, where the other two ways of looking at the trip already were. | Presentation | **done** |
| UX-33 | Outfits · any card | 1 | An outfit could only be *changed*, never *added to*. Wanting a hoodie over a t-shirt, shorts and shoes meant sacrificing one of the three. | `+ Add item` as a quiet row under the garments — a slot is added rather than a slot replaced. The role comes from the garment's own subcategory, so there is no redundant category question, and what it costs the packing list is reported through the same plan-delta engine a swap uses. | Behaviour | **done** |
| UX-34 | Outfits · plan | 1 | Every outfit in the product was the planner's. `Lounging at the hotel` — an occasion the planner has no template for — could not be expressed at all, so the packing list could not know about it either. | `+ Add outfit`, asking one question: what it is for. Manual outfits live in the same table, sync to the same checklist, and are recorded as user-authored so the replan cannot delete them, regenerate them, rename them, or merge them into a template's group that happens to share their name. They may be two pieces; no template shape is imposed. | Behaviour | **done** |
| UX-35 | Outfits · approved | 3 | UX-10 gave approval a tint at 7% of the accent. Two cards side by side it reads; scrolling past one it does not — which is the moment it exists for. | The tint up to 10% Light / 14% Dark, plus a restrained 1px green outline replacing the neutral border. Deliberately both, each at the smaller half of what it could be: either one doing the whole job produces the loud success card the brief rules out. `border-box` means an approved card is exactly the size of a draft. | Presentation | **done** |

### Decided against, with the evidence

- **A `Unique item` control below the search results**, which is where §10 of the brief sketches it.
  On a phone that is the bottom of a scrolling list of fifty garments — the same
  bottom-of-a-long-list placement §8 asks for it to be moved *out* of. It sits between the search
  field and the results instead: one quiet row, always reachable, and the only thing between the
  search and the clothes.
- **Wrapping a long item name to a second line.** §15 permits a rare two-line fallback; the
  repository already decided this in V1.1 and holds it with a mechanical evenness gate, and §17's
  uniform row rhythm is the stronger requirement. The name still gets the majority of the row by
  construction, because the metadata beside it is capped rather than merely shrinkable.
- **Flagging a manual outfit for review when the trip changes.** `flagApprovedForReview` works by
  re-running the planner's eligibility filter against a group's TEMPLATE, and a manual outfit has
  none — it would be judged against `EVERYDAY_TEMPLATE`, a formality band and a slot shape Alex
  never chose. Marking the planner's own missing template as his mistake is the opposite of §22.
- **A third `filled_by` value for a manually added slot.** The column carries a CHECK, and widening
  one in SQLite means rebuilding the table — a destructive migration, which needs Alex — for a
  distinction nothing reads. What tells a manually added slot from a swapped one is the group it is
  in.
- **A standing `Remove` on every garment row.** Adding one is reversible in the moment, through the
  undo bar, and a manual outfit can be removed whole. What is *not* offered is taking a garment out
  of a planner-generated outfit some time later — that row can be swapped for another, which is the
  capability that already existed. A per-garment Remove would need a way to tell a manually added
  slot from a template one, and the only honest way to do that is the third `filled_by` value ruled
  out above. Recorded as a known limit rather than left to be discovered.

### What mutation testing found

Twenty-four deliberate breaks, each aimed at one load-bearing behaviour. Nineteen were caught by the
suite as written. The five that were not are recorded because a guard that stays green under its own
mutation is not a guard, and none of the five looked wrong:

| The break that survived | Why the test could not see it |
|---|---|
| A manual outfit merged into a planner one of the same name | The replan's name map holds *approved* groups, and the test never approved the manual outfit — so the code path it was written against was unreachable |
| A manual outfit's garment injected into the planner's group | The test asserted the planner still had *a* garment, not that it had not gained Alex's |
| A manual outfit assigned a day of the trip | On a five-day trip the plan consumes every free date, so a manual outfit left in the spread found nothing to take |
| The rules path stopped snapshotting brand and colour | `generateChecklist` and `syncChecklistFromOutfits` write a row through two different `INSERT` statements, and only one was covered |
| The approved tint pushed to 70% of the accent — a filled green panel | `--color-approved-surface` is declared **four times**, and the mutation hit the `:root` copy. The app stamps `data-theme`, so the value the browser actually used was three blocks further down |

The last one is the most useful, because it is a hazard rather than a test gap: a token changed in
one theme block and not the others silently does nothing, which is `13_VISUAL_SYSTEM.md` §12's
equal-specificity trap wearing a custom property. It is now guarded in `contrast.test.ts` — every
theme block must declare both approved tokens, the tint must stay a tint, and the outline must stay
below the review state — which is a cheaper and stricter check than the browser test that missed it.


---

---

## The evidence was wrong before the product was

Three of the findings above (UX-17, UX-19, UX-20) were invisible to the first pass because the
harness that produced its evidence was lying, in three separate ways. Recorded here because "the
gates were green" is exactly what it looked like each time.

| Defect | What the reviewer was shown | Why |
|---|---|---|
| The visual run shared one database with the end-to-end suite | A wardrobe holding `Archivable Tee 16857`, a featured trip called `E2E Today Empty 59159`, and `All trips · 45 more` | `playwright.visual.config.ts` said "its own database too". It was a claim, not a fact: both suites wrote to the default `.wrangler/state`. Fixed with `PACK_SMART_PERSIST_TO`, which the migration step and the Worker now both read. |
| `home-empty` and `trips-empty` | The **populated** screen, twice, under a file name saying otherwise | `page.route` does not intercept requests a *service worker* makes, and ours is network-first for `GET /api/*`. The empty state of the two screens Alex opens most had never actually been reviewed. (Both turned out to be good.) |
| `trip-load-failed` | Whichever of the failure or a perfectly loaded trip won a race | Same cause, plus timing: it depended on whether the worker had finished activating. The capture now removes the worker first and asserts the failure is on screen before photographing it. |

The rule this leaves behind: **a capture that cannot fail is not evidence.** Every state simulated by
intercepting the network now asserts that the interception actually took effect before the shutter
opens.

## UX-21 — a sheet that moved under the thumb reaching for it

**The only finding on this page that came from Alex rather than from a review**, and the only one no
gate could have caught. He tapped `Add a rule` on the packing-rules sheet and a rule 278px lower down
turned off instead.

A sheet is `position: fixed; bottom: 0` and sizes to its content, so it grows **upward**. Opened
before its list has arrived it is short, and when the reply lands the whole frame leaps up carrying
every control in it — measured at −319, −297, −278, −86 and −37px across the five sheets that fetch.
`13_VISUAL_SYSTEM.md` §13 has the mechanism, the fix and the gate.

Two things are worth keeping from it beyond the fix itself.

**The gates were each looking at one moment.** `touch-target` measures a control's size, and this
control was a comfortable 44×44 throughout. A screenshot shows the settled sheet, in which nothing is
wrong. The defect lived in the gap between the two, and it took a report from the device to find it.
The new gate measures a control at *two* moments and compares them.

**Fixing the frame was half the job, and the gate said so.** With the sheet's own height held still,
three controls were still moving inside it — each sitting below a list that had not arrived:
`Add an amount` (+297px), `Leave this empty` on the swap sheet (+1350px, and a mis-tap there silently
swaps a garment), and the rules sheet's `N rules need a look` banner, inserted *above* the search
field and Add. Had the gate only measured the sheet's frame, all three would have shipped.

**Accepted cost.** A reserved sheet is the height it is allowed rather than the height of its
contents, so a short list leaves slack; an empty state is centred (`.sheet-empty`) so the space reads
as deliberate rather than as a sheet still loading. Judging that on the real screen is on the phone
checklist.

## UX-22 — the maneuverability pass

Gestures, sheet behaviour and keyboard ergonomics only. No planner logic, no data semantics, no route
or capability changed; the diff is `BottomSheet`, three lines elsewhere, and tests. Every sheet in
the product is the one primitive, so all of this is set centrally and none of it is patched per
screen. The contract now lives in `INTERACTION_PATTERNS.md` §3a–3b.

**The keyboard was covering the primary action, on every sheet with a form in it.** `BottomSheet.css`
already recorded that the pinned footer was reachable "with the software keyboard raised" and that it
was "the one thing about this screen that no test in this repository can check". It was not
reachable. `position: fixed` resolves against the layout viewport, which the iOS keyboard does not
change, and neither does `dvh` — so `Add to My Stuff`, `Save changes`, `Create trip` and the result
lists of all three Settings search sheets sat underneath roughly 300px of keyboard.
`visualViewport` is the only thing that reports it. The sheet now rises by the shortfall and shrinks
by the same amount, so its top edge does not move.

**A flick needed no distance.** Velocity is distance over time, so a 15px slip in 10ms cleared the
0.5px/ms threshold and dismissed the sheet — on the one strip of every sheet a thumb reaches for
first. §2 already had the right shape for swipe rows (fast *and* far); sheets now use it too.

**The drag surface was 32px.** It is now the grabber and the header as one region, ~76px, which is
where a thumb already is. `Done` lives inside it, so nothing is captured and nothing moves until the
finger has travelled 6px, and a completed drag swallows the click it would otherwise fire.

**A held sheet said nothing.** Dragging a form with unsaved edits tracked the finger 300px down and
snapped back with no explanation, which reads as a gesture that failed rather than one that was
refused. It is now damped to 44px. Still no confirmation dialogue — §4.

**The trip form was not holding its draft.** The longest form in the product was the one sheet that
passed no `dirty`: a name, an emoji, every destination, both dates and the activities could be thrown
away by a thumb, with nothing to undo because nothing had been written. Its top-right also said
`Done` directly above `Create trip`, which is the §9a defect that `ItemSheet` had already fixed.

**The drag was re-rendering the whole sheet on every move**, against this repository's own rule for
swipe rows. It writes the transform to the element on an animation frame instead.

### What the mutation testing found

Two of the ten safeguards were being watched by tests that could not fail:

- The **no-re-render** test counted renders of a child. `children` is the same element on every
  render, so React skips it — the count stayed flat while the sheet re-rendered twenty times. It uses
  `Profiler` now, and catches the mutation.
- The **reduced-motion** test matched `transitionDuration` against `/^0(\.\d+)?m?s$/`, which also
  matches `0.24s`. It passed with the global reduced-motion rule deleted. It parses milliseconds now.
  Writing it also turned up that Playwright's `reducedMotion` fixture does not reach the page in this
  environment — `matchMedia` still reported `no-preference` — so the test asserts the emulation took
  effect before it asserts anything else.

Both are the same failure as the capture-that-cannot-fail finding above, in a different medium.

### What a new test found in the product

**Closing a sheet did not put the page back**, and nothing had ever checked. The body scroll lock is
`position: fixed` — the only lock that reliably stops iOS scrolling the page behind a sheet — and it
resets the page to the top as a side effect, so the offset is captured and restored on close. jsdom
has no layout, so the unit suite stubs `scrollTo` to a no-op and could not tell a working restore
from a missing one; no e2e asserted it either. It works, and is now asserted on a real engine.

The first version of that test was itself wrong in a way worth recording: it opened the sheet from
the `+` in the page header, and **Playwright scrolls a target into view before clicking it** — so the
page was scrolled to the top before the sheet ever mounted, and the test was measuring its own setup.
It opens from a row already on screen. The same class of mistake sat in the visual captures: `capture`
resizes the window at each width, the app answers that resize by recomputing the keyboard inset to
zero, and four images named `sheet-keyboard-up` showed a sheet with no keyboard up. `capture` now
takes an optional restage callback, and the drag captures assert the drag survived rather than
assuming it.

## The e2e suite was only sound at one worker

Chasing this turned up three pre-existing races in the end-to-end suite, all of the same shape and
none of them a product defect: **a spec asserting on an entity the app chooses globally, which no
spec can own.** Home features the soonest live trip on the database; the closet-review queue picks a
flying trip the same way. Locally the suite runs several workers over one database, so another
worker's trip wins the slot and is then deleted mid-test — producing `Could not load this trip`, or a
`.home-countdown` that stays empty for good because the readiness call 404ed.

CI never saw any of it: `playwright.config.ts` sets `workers: process.env.CI ? 1 : undefined`. So the
suite was reliable exactly where it was a gate and unreliable exactly where it was a working tool,
which is the wrong way round.

`readiness.spec.ts` is fixed — serial, so it stops racing against itself, plus a bounded retry for
the cross-file case. `bag-questions.spec.ts` has the same shape against whichever spec created a
flying trip and is **not** fixed; it is recorded here rather than patched, because the answer is the
general one: a spec that asserts on a globally-chosen entity needs either exclusivity or a way to
pin the choice, and that is a decision about the fixtures rather than about one file.

## Deliberately not changed

- **The compact top navigation stays.** It is the fix for the double-toolbar defect
  (`09_IMPLEMENTATION_NOTES.md` §12) and nothing here reintroduces a bottom bar.
- **The colour palette, the accent, and trip emoji** are the accepted visual direction. This pass
  changes hierarchy and density, not the product's personality.
- **The packing intelligence.** No ranking, rule, or quantity logic is touched by a UX pass.
- **Weather could not be exercised.** Open-Meteo is unreachable from this environment, so the weather
  line and the climate-normal labelling are reviewed as code and stay on the phone checklist.

## What automation could not judge

Momentum and rubber-banding of the swipe under a real thumb; whether the 45% commit threshold feels
right on hardware; Safari's toolbar collapse; the native date wheel; VoiceOver's actual announcement
order. These go to `technical-docs/08_MANUAL_IPHONE_CHECKLIST.md` as one consolidated session.
