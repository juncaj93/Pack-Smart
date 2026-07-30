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
