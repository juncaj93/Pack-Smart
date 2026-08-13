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
