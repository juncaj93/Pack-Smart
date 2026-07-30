# 07 — UX Streamlining and Data Completeness

Canonical specification for the product-polish release that follows M7.

This document outranks earlier documents wherever they disagree about layout,
density, filtering, sorting, appearance, trip lifecycle, or the completeness of
Alex's inventory. It does not change the product's purpose, its non-goals, or
any approved intelligence rule.

Numbering note: `07_TECHNICAL_LEAD_HANDOFF.md` already exists and is unchanged.
Both files carry the `07` prefix because this one was commissioned under that
name; the handoff remains the technical-lead document and this one is the
product specification for this release.

---

## 1. Why this release exists

Pack Smart works. It does not yet *feel* finished. The recurring complaints are
all about presentation rather than capability:

* filters and controls eat the first screenful of My Stuff;
* the packing list sits below a column of identical full-width buttons;
* Your Usual Amounts spends a tall card on a one-line fact;
* the interface has no appearance setting, so a dark-mode phone gets whatever
  the media query happens to produce;
* one Home string leaked an internal identifier;
* six items Alex owns were never in the database;
* a finished trip can be neither archived nor deleted;
* a "still not packed" line shouts on day one of planning.

Every requirement below is a presentation, lifecycle, or completeness fix. None
of them changes what the packing engine computes, except where a screen was
editing something the engine never read.

## 2. Product decisions taken in this release

These are recorded here so they are not re-litigated later.

**D1 — Appearance vocabulary is System, Light, Dark.** No other words. "Night
mode" is not used anywhere in copy, tests, docs, or accessibility labels.

**D2 — The resolved theme is an attribute, not a media query.** The document
element carries `data-theme="light"` or `data-theme="dark"`, decided before
first paint by a small inline script. `prefers-color-scheme` is consulted only
to resolve `System`. This is what makes "no bright flash in Dark" true rather
than hoped for.

**D3 — Packing frequency means confirmed packing, per trip.** `Most packed` and
`Least packed` count the number of distinct trips on which an item's checklist
row reached fully packed (`packed_qty >= required_qty`). Mere inclusion on a
generated list is not packing: the engine puts things on lists Alex then removes,
and counting that would rank by what the engine suggests rather than by what he
takes. An item with no such history has **no** frequency — it is not zero — and
sorts after every item that has one, in both directions, alphabetically among
its peers.

**D4 — "Fixed amount" and "per trip" are the same rule.** The approved rule
vocabulary has one fixed-quantity type (`fixed_per_trip`). Offering two controls
that produce identical rules would be a fake choice, so Your Usual Amounts
offers three bases — **Per day**, **Per night**, **Per trip** — and "per trip"
is the fixed amount. Recorded rather than silently narrowed.

**D5 — Pack day of is the existing `day_of` packing timing, promoted.** The
schema already distinguishes `anytime`, `night_before`, `day_of`, and
`last_minute`. `Pack day of` is `day_of` given a first-class row action, a
filter, and a visible indicator. No new column, no second source of truth for
"when does this get packed".

**D6 — The trip screen is the packing list.** There is no separate Packing List
route to link to, and inventing one would add a tap to the most common action in
the app. "The Packing List entry point is too far down" is therefore satisfied
by moving the *list itself* up: a condensed command centre occupies the first
screenful and the checklist begins immediately beneath it, with every
administrative action moved into a Trip tools disclosure. A `Packing list`
anchor is present in the command centre for parity with `Outfits`.

**D7 — Archive is a trip state, deletion is a trip's end.** Archiving is
reversible, preserves everything, and is separate from the date-derived
upcoming/past split. Deletion is permanent, removes only trip-scoped rows, and
is reachable only from Trip tools behind a deliberate confirmation.

**D8 — The workbook is frozen.** `seed-data/Master_Packing_Database_Complete.xlsx`
is the historical first-run seed and is not rewritten. Post-launch canonical
additions live in `shared/missing-items.ts`, which is the single source read by
the reconciliation migration, the import path, the verification script, and the
tests. CLAUDE.md already says the website becomes the source of truth after
launch; this makes that concrete instead of editing a binary.

---

## 3. Appearance: System, Light, Dark

### Requirements

* A `Appearance` row in Settings opens a sheet with exactly three options:
  `System`, `Light`, `Dark`.
* Default is `System`.
* The choice persists across reloads and app restarts.
* Changing it applies immediately, with no refresh.
* `System` follows the device and reacts to the device changing while the app is
  open.
* The correct theme is applied **before** the interface is visible.
* Both themes keep the same hierarchy; Dark is a designed palette, not an
  inversion.
* Trip emoji and item colour glyphs stay legible in both.
* Sheets, dialogs, fields, cards, navigation, warnings, disabled controls,
  checklist rows, archived states, and destructive actions are all specified in
  both themes.
* Text and essential non-text contrast meets WCAG AA.

### Where it lives

| Concern | Location |
|---|---|
| Stored preference | `localStorage['pack-smart.appearance']`, one of `system` / `light` / `dark` |
| Applied before render | inline script in `index.html`, before the module bundle |
| Resolved value | `document.documentElement.dataset.theme` = `light` \| `dark` |
| Palette | `src/styles/tokens.css`, `:root[data-theme='dark']` |
| Runtime API | `src/lib/appearance.ts` |
| Native form controls | `color-scheme` on the root, so date pickers and scrollbars match |

`System` subscribes to `matchMedia('(prefers-color-scheme: dark)')` and updates
the attribute on change. Light and Dark ignore the device entirely.

## 4. Home: no internal identifiers

The reported defect was the string `listAll` appearing on Home.

That string does not exist anywhere in the repository at the commit this release
starts from, and has never existed in its history — so it was either already
removed or came from an older deployment. The fix is therefore not a string
patch but a guard:

* Home's secondary action has one explicit label, `All trips`, defined as a
  named constant rather than derived from a route or a handler name.
* A regression test renders Home in every state it can be in — loading, empty,
  a trip in the future, a trip underway — and asserts that no visible text
  matches an identifier shape (`camelCase`, `snake_case`, `PascalCase` runs with
  no spaces).
* The same guard runs across the four static screens in the end-to-end suite.

No raw implementation identifier may appear in the interface.

## 5. My Stuff

### Top of page, in order

1. `My Stuff` heading
2. compact `+` action, on the heading's line, tap area ≥ 44px, accessible name
   `Add item`
3. search
4. one compact filter-and-sort row
5. wardrobe content

There is no permanent filter panel. The wardrobe must begin within the first
screenful at 390×844 with the full production wardrobe loaded.

### Grouping

The default view groups by category, using the repository's canonical category
model (`shared/items.ts`): Tops & Outerwear, Bottoms & Swimwear, Footwear,
Accessories & Undergarments, Toiletries, Electronics, Medication, Documents,
Travel Gear, Vision, Grooming.

The task brief listed a different vocabulary (Outerwear, Mid-layers, Tops, …).
That vocabulary is **not** adopted: the brief itself defers to the repository's
canonical model, and introducing a second category set would break every stored
item, every rule, and every historical trip.

Only categories that currently contain visible items get a heading. The full
list is still offered when adding or editing an item. Headings are a single
compact line — no card, no oversized type.

### Filtering

Available filters: `Active`, `Archived`, `Favorites`, `Essential`, `Clothing`,
`Gear`.

Presentation: a single horizontal chip row holding the active state plus a
`Filter` chip that opens a focused sheet for the rest. Advanced filters are
never permanently expanded. Active filters are visible, clearable in one tap,
combine with search and sorting, and survive navigating away and back.

Filter controls may not exceed roughly one eighth of the viewport height.

### Sorting

Default: `Category`. Options: `Category`, `Alphabetical`, `Most packed`,
`Least packed`, `Recently added`.

Frequency semantics are decision **D3** above. Tie-breaking is alphabetical, so
the order is stable between loads. Sorting persists. Filtering and sorting are
separate controls. No internal score is shown; `Most packed` rows show a plain
`Packed on N trips` line, and rows with no history show nothing rather than
`0`.

Sorting, filtering, grouping, and search all run on the server against indexed
columns, so the full wardrobe stays responsive.

## 6. Add Item and Edit Item

One sheet, no stacking. The common task fits one iPhone screen.

Immediately visible: `Item name`, `Clothing`/`Gear`, `Category`, `Color`,
`Favorite`, `Essential`, `Save`.

Behind `More details`: brand, how often used, warmth, formality, weather
capability, activity suitability, rewear capacity, how many owned, notes,
packing timing.

Controls are compact — segmented control for kind, menu for category, chips for
scales, inline toggle rows for the two flags. No tall stack of full-width
fields for values that fit on one line.

Keyboard behaviour:

* `Save` stays reachable while the keyboard is open (the sheet's action row is
  sticky within the sheet, not fixed to the viewport).
* the focused field is never covered;
* no viewport jump on focus (every input is ≥ 16px);
* correct `inputMode` and `enterKeyHint` per field;
* validation appears next to the field it concerns;
* unsaved work survives an accidental backdrop tap on a dirty form — the sheet
  asks once rather than discarding silently.

Archive stays reversible and offers Undo. There is no permanent item deletion;
`02_DATA_MODEL.md` makes "nothing is ever deleted" a structural rule for the
catalog, and archived items must remain visible on historical trips. Requirement
§8 of the brief is satisfied by there being no casual destructive path at all.

## 7. American English

`Favourite` → `Favorite`, `Colour` → `Color`, everywhere a user can read it:
interface copy, labels, accessibility text, empty states, errors, documentation,
tests.

Database columns and JSON field names are **not** renamed for spelling. The
`favorite` column was already American; `LastLookResult.favourites` is an
internal transport field and renaming it would be churn with a migration-shaped
risk for no user-visible gain.

## 8. Your Usual Amounts

Compact one-line rows:

```
Underwear          2 per day          Edit
```

Each row shows the item name, the quantity, the basis, a compact edit control,
and — for rules Alex created here — a remove action. On the narrowest supported
width the basis wraps under the name rather than the row becoming a card.

Actions: add an amount, change the quantity, change the basis, remove a rule,
pick the item it applies to, and see when it applies.

Bases: `Per day`, `Per night`, `Per trip` (decision **D4**).

Editing opens a compact focused editor for one row; every control is not
permanently expanded.

### Engine integration

The row is a `packing_rule`, which is the only thing the engine reads. There is
no display-only preference path, and none may be introduced. An end-to-end test
changes an amount and then proves a newly generated packing list carries the new
quantity.

## 9. Trip archiving

* Archiving removes a trip from the normal `Coming up` and `Past trips` lists.
* The trip and every related row are preserved.
* Archived trips appear in an `Archived trips` view, reachable from the Trips
  screen without dominating it.
* Restoring returns the trip to whichever date-derived section it belongs in.
* Archiving affects nothing else: no wardrobe item, no global rule, no global
  setting, no learning history, and no trip duplicated from it.
* The action lives in Trip tools, and offers Undo.

Schema: one additive nullable column, `trip.archived_at`.

## 10. Permanent trip deletion

Reachable only from Trip tools, behind a deliberate confirmation that names the
trip, lists what will be removed, distinguishes deletion from archiving, and
never suggests it can be undone. No swipe, no single tap.

### What deletion does

Deleted, because it describes only this trip:

| Table | Why |
|---|---|
| `wear_log` | what was worn on this trip |
| `daily_plan` | this trip's accepted day plans |
| `checklist_link` | links between this trip's rows and this trip's slots |
| `checklist_entry` | this trip's packing list |
| `outfit_slot` | slots of this trip's outfit groups |
| `outfit_group` | this trip's outfits |
| `trip_event` | this trip's days and itinerary events |
| `trip_weather` | this trip's forecast rows |
| `trip_destination` | where this trip went |
| `trip_fact` | what Pack Smart understood about this trip |
| `preference_change_suggestion` | pending suggestions raised by this trip |
| `trip` | the trip |

Retained, because it is not this trip's to delete:

| Table | Why |
|---|---|
| `item` | the wardrobe. Archived items included. |
| `packing_rule` | global rules, including usual amounts |
| `preference` | global preferences |
| `outfit_pairing` | catalog-level learning about garments that go together, explicitly designed to outlive the trip that taught it (doc 04 §5) |
| `import_run`, `import_row` | import history |
| every other `trip` and its rows | untouched |

Not recalculated: nothing. Deletion removes rows; no quantity, list, or
suggestion elsewhere derives from the deleted trip.

Detached: nothing. There are no cross-trip foreign keys into trip-scoped tables,
so deletion in the order above leaves no orphan and violates no constraint.

`outfit_pairing` counts are deliberately **kept**. They record that Alex
approved two garments together — a fact about his taste, not about the trip. A
deletion that unlearned them would make "delete this trip" quietly degrade
future recommendations.

### Safety

The whole deletion runs as one batch, so a partial delete cannot leave a trip
half-removed. Integration tests prove that deleting one trip of two removes
exactly the first trip's rows and leaves the second trip, the wardrobe, the
rules, the preferences, and the pairings intact.

## 11. The six missing items

| Visible name | Kind | Category | Behaviour |
|---|---|---|---|
| Bite guard | gear | Medication | 1 per trip, only when the trip has at least one night. Essential, final check. |
| Hairspray | gear | Toiletries | 1 per trip, unconditional, like every other toiletry |
| Plane seat cushion | gear | Travel Gear | 1 per trip, only when `flight_hours > 6` |
| Black Vuori jacket | clothing | Tops & Outerwear | no rule; reachable by outfits and by One Last Look |
| Black Shinola | clothing | Accessories & Undergarments | watch. No rule. Distinct item. |
| White Shinola | clothing | Accessories & Undergarments | watch. No rule. Distinct item. |

No weather, warmth, formality, or activity attribute is invented for the jacket
or the watches. They carry name, kind, category, colour, and nothing else the
data does not support.

The two Shinolas are separate rows. A shared brand is not a reason to merge two
watches.

### Long-flight threshold

No canonical long-flight threshold existed. This release defines one:

> **Long flight** means a recorded `flight_hours` fact **greater than 6**.

Deterministic, derived from a fact Alex types into the trip sheet, and never
inferred from the destination. Six hours is the point at which a single leg is
generally overnight or transatlantic. Recorded here so the seat cushion's rule
is auditable, and reusable by any future rule that needs the same idea.

### Reconciliation with production

`migrations/0010_missing_items.sql` adds only what is missing:

* every insert is guarded by `WHERE NOT EXISTS (… lower(display_name) = …)`;
* nothing is updated, so a user edit cannot be overwritten;
* rules are inserted only when the item was inserted by the same migration and
  has no rule of that type, so re-running adds nothing;
* the full workbook import is **not** re-run;
* the migration is safe to apply repeatedly, which is exactly what D1's
  forward-only migration runner guarantees anyway.

Matching is on the trimmed, lower-cased visible name. A production row whose
name differs only in case or surrounding whitespace counts as present and is
left alone. A production row with a *similar* name — say `Shinola` alone — does
**not** count as a match; the specific item is added and both rows survive, on
the principle that a wrongly-merged item is unrecoverable and a duplicate is one
archive tap away.

`shared/missing-items.ts` holds the same six rows as data, so the import path,
`scripts/verify-import.mjs`, the data-completeness check, and the tests all read
one list.

## 12. Packing list filters

Filters: `All`, `Unpacked`, `Packed`, `Pack day of`, `Essentials`.

* the selected filter is visibly selected, by shape and text, not colour alone;
* filters combine with search;
* controls stay compact and within thumb reach while packing;
* counts and progress always describe the whole trip, never the filtered view.

### Default

Chosen from the trip's packing state, and always stated on screen:

| State | Default |
|---|---|
| nothing packed yet | `All` |
| packing under way, more than 4 remaining | `Unpacked` |
| 4 or fewer remaining | `Unpacked` |
| everything packed | `All` |

Packed rows are never hidden without the active filter being obvious.

## 13. Pack day of

A state on any checklist row, separate from packed, unpacked, removed, and
excluded. It is the `day_of` packing timing (decision **D5**).

A `Pack day of` row:

* stays visible;
* stays incomplete until it is packed;
* carries a subtle `Day of` indicator;
* appears under the `Pack day of` filter;
* returns to normal in one tap;
* is excluded from early remaining-item pressure;
* works with search, sections, and quantity edits;
* follows the app's honest offline-write policy — a failed write says so and
  reverts the row.

Nothing is marked `Day of` automatically. The importer already assigns
`day_of`/`last_minute` timings from the spreadsheet's own words, and that stays;
no new inference is added.

Interaction: an explicit action on the row (`Day of` toggle in the row's
overflow sheet) plus a swipe-right shortcut on the row for marking packed. The
gesture is never the only route to anything.

## 14. Completion interactions

Retained and unchanged in meaning:

* swipe right marks packed, with a tap alternative on the same row;
* feedback is immediate and optimistic;
* Undo rather than confirmation;
* a vertical scroll never completes a row;
* an accessible non-gesture alternative always exists;
* an offline write failure is stated plainly and the row reverts;
* no full-screen loading for a single row action.

Removing a garment that an approved outfit uses still names the outfit and
offers the replacement flow.

## 15. Delayed remaining-item messaging

Early planning gets neutral progress:

```
18 of 42 packed
```

A prominent remaining-items line appears only when it is useful:

```
4 left to pack
```

### Deterministic threshold

Given `total`, `packed`, `remaining = total - packed`, `essentialsOutstanding`,
`dayOfOutstanding`, and `daysUntilDeparture`:

The prominent line appears when **any** of these holds:

1. `remaining <= 4` and `packed > 0`;
2. `packed / total >= 0.8` and `packed > 0`;
3. `daysUntilDeparture <= 1`;
4. `remaining > 0` and every remaining row is either essential or `Day of`, and
   `packed > 0`.

Otherwise the screen shows `N of M packed` and nothing else.

Essential omissions keep their own line and are allowed to appear earlier,
because a forgotten passport is worth interrupting for. That line is only shown
once packing has actually begun (`packed > 0`) **or** departure is within two
days — which is what stops it shouting on the day a trip is created.

The words change with the state, and never accuse:

| State | Line |
|---|---|
| nothing packed | `Nothing packed yet · 42 to go` |
| under way, above threshold | `18 of 42 packed` |
| at threshold | `4 left to pack` |
| only Day of left | `Just your day-of items left` |
| complete | `All packed` |

## 16. Trip command centre

First screenful, in priority order:

1. trip identity — emoji and name
2. destination and dates
3. weather, or clearly labelled seasonal guidance
4. readiness / packing progress
5. unresolved essentials
6. the primary next action
7. quick access to `Packing list` and `Outfits`

Then the checklist itself.

Everything else — itinerary, which days are what, One last look, what Pack Smart
understood, add a trip-only item, edit, refresh weather, archive, delete — lives
in a `Trip tools` disclosure below the list or inside the trip sheet. The trip
screen no longer opens with a column of equal-weight full-width buttons and
explanatory paragraphs.

Hierarchy: exactly one accent-filled primary action, chosen from the trip's
state (plan outfits → start packing → what to wear today). Secondary actions are
neutral. Status is carried by chips with both an icon and a word. Completed
sections get quieter; incomplete ones stay findable. No rainbow, and no meaning
carried by colour alone.

The checklist's first row must be visible within one screenful of scrolling at
390×844.

## 17. Responsiveness

* optimistic updates for row toggles, filter changes, and sort changes;
* pressed and selected feedback on every control;
* no full-page reload and no full-screen spinner for a single action;
* skeletons for genuine first loads, sized to the content so nothing shifts;
* no repeated request for unchanged data — the wardrobe list is not refetched
  when only the sort changes if the server already returned that order;
* short, functional transitions, all removable by `prefers-reduced-motion`;
* one changed row re-renders one row, in both the wardrobe and the checklist;
* search, filter, grouping, and sort stay responsive at production size;
* sheets stay smooth with the keyboard open;
* Safari's own scrolling is never replaced;
* the service worker's cache version is bumped so a deploy evicts what it
  replaced.

Measurements are recorded on the pull request with the method used, and no
figure is quoted more precisely than the method supports. Native haptics are not
claimed.

## 18. Shared standards

Applied to Home, Trips, trip detail, the checklist, Outfits, During Trip, My
Stuff, Add/Edit Item, Settings, Your Usual Amounts, Packing Rules, What Pack
Smart has noticed, Past Trips, Archived Trips, trip deletion, and every empty,
offline, loading, and error state:

Safari-first iPhone layout; natural page scrolling; compact top navigation; no
fixed bottom bar; 44px minimum targets; no horizontal scrolling; nothing hidden
by Safari chrome; consistent rows, sheets, popovers, button hierarchy and
spacing; explicit loading, disabled, selected, error and success states;
accessible labels; logical VoiceOver order; dynamic-text resilience;
keyboard-safe forms; Light and Dark; visible focus; reduced motion; no
colour-only meaning; no card inside a card; no large empty surface used to look
calm.

## 19. Acceptance

This release is complete when every item below is true, and not before.

* Appearance works as System, Light, and Dark, applied before first paint, with
  no incorrect-theme flash.
* No raw identifier appears anywhere in the interface, and a test proves it for
  Home.
* My Stuff shows wardrobe content within the first screenful, grouped by
  category, with compact filters and five sorts.
* Add and Edit Item fit the common task on one screen, with Save reachable while
  the keyboard is open.
* `Favorite` and `Color` are spelled American everywhere a user can read them.
* Your Usual Amounts is one line per rule, and editing one changes a newly
  generated packing list.
* A trip can be archived, found in Archived trips, and restored.
* A trip can be permanently deleted, with proof that only its own rows go.
* The six missing items exist, with no duplicate created in production.
* The packing list has the five filters, `Pack day of` works, and the remaining
  message is delayed to the documented threshold.
* The trip screen's first screenful is the command centre, and the checklist
  starts immediately after it.
* Responsiveness improvements are measured and recorded.
* Visual, interaction, and accessibility QA pass at 390, 375, and 360 wide, in
  both themes.
* Remote CI is fully green on the merged head, and the deployment is confirmed.
