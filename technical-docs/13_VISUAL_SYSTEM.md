# Pack Smart — the visual system, as shipped

**What this is.** The reusable decisions behind the V1.1 visual, spatial and fluidity pass, written
down after they were proven on screenshots rather than before. Everything here is in the code; there
is no aspirational half.

**What this is not.** A style guide to admire. `VISUAL_ACCEPTANCE.md` is still the gate — the list of
things that get a screen rejected. This is the vocabulary a screen is built from so that it passes.

The governing principle, and the one to reach for when two of the rules below disagree:

> **Persistent above-the-fold iPhone UI must earn its space.** Use hierarchy, spacing, typography and
> progressive disclosure before adding containers, borders, labels or permanent controls.

---

## 1. The viewport this is designed against

**390 × 664.** Not 390 × 844. 844 is the screen of an iPhone 14; 664 is what Safari gives a page once
its own toolbars are on it. Every measurement in this document and every capture in `.visual/` uses
664, because a density judgement made at 844 is optimistic by most of a sheet.

Guarded at **375** and **360** as well. Nothing may overlap or require precision tapping at 360.

---

## 2. Spacing

The scale was already right and is unchanged: **4, 8, 12, 16, 24, 32** (`--space-1` … `--space-6`,
plus `--space-7: 48` which almost nothing needs). What was wrong was the usage — unrelated surfaces
and tightly-related lines were receiving the same generous gap, so nothing looked related to
anything.

| Gap | What it separates |
|---|---|
| 1–2px | Two lines of one thought — an item name and its metadata |
| 4px (`--space-1`) | Tightly related content inside a block |
| 8–12px (`--space-2/3`) | Component internals; a control and the hint that explains it |
| 12–16px (`--space-3/4`) | One block from the next |
| 16–24px (`--space-4/5`) | A major section transition |

**Never use major-section spacing between every row.** That was the single most common defect this
pass fixed. A hint 16px under its own control is not a hint any more; it is a paragraph that happens
to be near one.

---

## 3. Surfaces

Three levels and two kinds of line, all in `tokens.css`:

```
--color-bg               the page
--color-surface          a list or a control sitting on the page
--color-surface-raised   a sheet — temporary, above everything
--color-border           OUTLINES a surface
--color-separator        divides rows that already share one
--color-accent-tint      the accent as a SURFACE — a selected thing, quietly
```

`--color-accent-tint` is `color-mix(in srgb, var(--color-accent) 12%, transparent)` rather than two
hex values, so it lands correctly in both themes without a pair of literals to keep in step. It
exists because a selected thing needs a fill and the only two available were the solid accent (which
is the primary action's, and far too loud for a navigation tab) and `--color-surface` — which on a
light page is a white card with an elevation, i.e. the "everything is inside a rounded box" problem
in the one place that is supposed to be chrome.

`--color-separator` is new and deliberately quieter than `--color-border`. Twenty rows drawn with
twenty outline-strength hairlines read as twenty boxes, which was most of what made the product feel
like a stack of cards.

Dark was lifted off pure black at the same time (`#0b0b0c` → `#0f0f11`, surface `#171719` → `#1a1a1d`).
Both are still dark by any measure; the page no longer reads as a hole with panels floating in it.

### Card vs list vs section — the rule

| Use | When | Example |
|---|---|---|
| **Card** | The whole thing is one object you act on as a unit | The active trip on Home; a temporary alert |
| **List** (`.row-list`) | Repetition — one surface, separators, no card each | Trips, the checklist, My Stuff, Settings, readiness issues |
| **Section** | A heading and the space under it, and nothing else | Every group of rows on every screen |

**Do not put a border around content to show that it belongs together.** That is what the heading and
the space are for. A bordered row inside a bordered card is rejected on sight.

**A single control is not a list, so it does not get a card.** Settings' appearance choice was an
outlined card holding an outlined segmented track holding a selected segment with its own surface and
shadow — three nested frames around a choice between three words, and the tallest block on the
screen. Every other group there is a card because it is a *list of rows that need dividing from each
other*; this is one control and a caption, and the control already draws its own frame. When a card
comes off, the frame inside it usually has to go **up** a weight: on the page the track is the same
colour as its surroundings and its outline is now the only thing saying where the control begins.

---

## 4. Typography

Type does the work borders used to do. The roles, and the one number that matters for each:

| Role | Size | Weight | Colour |
|---|---|---|---|
| Page title (`.screen-title`) | 22 | 600 | text |
| Section heading (`.section-heading`) | 17 | 600 | text |
| Primary row text | 16 | 400–500 | text |
| Secondary metadata | 14 | 400 | text-secondary |
| Tertiary / marker | 12–14 | 400 | text-tertiary |

The title was 28 and the section heading 18, which is not a step — it is two headings arguing. 22
against 17 is unmistakable, and nothing else on a screen is above 17.

**Line height is a token now.** `--leading-tight: 1.2` for headings and single-line rows,
`--leading-snug: 1.32` for two-line rows and captions, `--leading-body: 1.45` for anything that wraps
into a paragraph. Every heading in the product used to inherit 1.45 — on a 22px title that is ten
pixels of nothing on the first line of every screen.

**16px is the floor on every text input**, permanently and without exception. Below it iOS Safari
zooms the viewport on focus and never zooms back.

---

## 5. Row density

Repetition is where small inefficiencies multiply, so rows are measured rather than eyeballed.

| Row | Height | Contents |
|---|---|---|
| Packing row | ~47px | Checkbox, name, and a secondary line when there is one |
| Trip row | 60px | Emoji, name, dates, a departure chip |
| Wardrobe row | 65px | Name, brand and colour |
| Settings row | 57px | Label, value, chevron |
| Review-closet entry | 59px | Label, one-line value, chevron |

Density is not smallness. **Every one of these is above the 44px touch minimum, and the whole row is
the target.** What came down is padding and line height, not type size and not tap area.

---

## 6. Progressive disclosure

The rule: **the answer is on the row; the derivation is one tap away.**

A packing row says `24 needed`. Where the 24 came from — `12 days × 2 = 24` — is in the row's sheet,
under `Why this many`, which is where it already was. Printing it on the row made a counted row wrap
to two lines and stand 88px tall beside 49px neighbours, and forty of those turned the packing list
into a document.

Nothing deterministic is ever deleted by this. `rowSecondaryParts` and `rowExplanationParts` split
one rule between the list and the sheet, so the two cannot come to disagree about which fact applies.
The same shape governs the weather line (`weatherHeadline` → `short` + `note`) and Trip setup.

**What must never go behind a disclosure:** anything Alex has to decide, anything that is wrong right
now, and anything that changes what goes in the bag. The weather line keeps the temperature range and
the rain on the surface for exactly that reason, and hides only the sentence about where the numbers
came from.

### Controls that appear with their subject

The same rule read from the other end: a control that can only act on something present should not
be on screen when that thing is absent. `SearchInput`'s clear button exists only while the field
holds text — a permanently visible `×` on an empty field is a control that does nothing, sitting in
the part of the field that is always on screen, and it would make an empty search field look busier
than it did before the feature existed.

Not `disabled`, either. A disabled control still occupies its space and still has to be read past.

---

## 6a. Search fields

One component, eight fields: the wardrobe, the packing list, the swap sheet, One last look, the
review picker, and three inside Settings. `type="search"` is the boundary — it is what separates a
filter over a list from an ordinary text field, and ordinary text fields get none of this.

The full pattern is in `INTERACTION_PATTERNS.md` §8. The two things that belong here:

- **It costs no vertical space.** The button is absolutely positioned inside the field, over
  `padding-right: var(--touch-target-min)` reserved for it. A field is exactly as tall as it was.
- **The platform's own control is removed rather than used.** iOS Safari draws no cancel button for
  `type="search"`; desktop WebKit draws one that cannot be styled. Relying on it would mean the
  affordance appeared in every screenshot taken here and on none of the phones the app runs on —
  the same class of failure as the harness defects in `UX_AUDIT.md`, where the evidence was wrong
  before the product was.

---

## 7. Chrome

The page header is a title row and a sticky navigation row, in that order, and it costs:

| | Before | After |
|---|---|---|
| Title + nav | 110px | 88px |
| Title + subtitle + nav | 157px | 118px |

**44px is the floor and it is not ours to trade.** The four navigation destinations are links, and a
link under 44px fails the mechanical gate in `VISUAL_ACCEPTANCE.md` §1. So a screen's chrome can
never be cheaper than 12 (padding) + 45 (nav) + 12 (gap) = 69px, and the savings came from everything
else: the title dropped 28 → 22 with tight leading, the subtitle became 14px secondary metadata, each
gap came down a step, and the permanent appearance toggle left the header entirely.

**Bottom navigation is not an option, and this has been tested.** A fixed bottom tab bar shipped once
and was removed: in Safari it sat directly on top of Safari's own toolbar — two navigation bars
stacked on one edge (`09_IMPLEMENTATION_NOTES.md` §12). The mechanical gate now enforces the outcome:
nothing of ours may be fixed to the bottom of the viewport.

**One action in the header, and it is the screen's own.** Home and Trips carry `+` to plan a trip; My
Stuff carries `+` to add an item. A second permanent control there is how the header becomes a
toolbar — which is what the appearance toggle had quietly become, so it went to Settings, where the
full three-state version of the same preference already lived.

---

## 8. Accent

Teal is the identity. It is used for **the primary action, the active navigation item, a selected
state, and a meaningful positive emphasis** — the trip countdown is the one place it carries a fact
rather than a control.

It is not used for section headings, not for ordinary metadata, and not for decoration. Scarcity is
the whole value.

Colour is never the only signal. A selected chip is teal **and** bordered **and** medium weight; an
essential row says the word `Essential`; a queued write says `Saved on this phone`.

**Two ways of spending it, and they are not interchangeable.** Solid accent is the primary action —
one per screen. `--color-accent-tint` behind accent text is *selection*: the active navigation item
and the chosen appearance segment, and nothing else. A tint does not read as "press me", which is
exactly why the navigation may have it and a button may not.

**`.button-quiet` is accent-coloured, so it is not a free "make this quiet" class.** Sign out wore it
and was the only coloured word on a screen of neutral rows — the least-used control on Settings
rendered in the same green as `Pack the essentials`. It is secondary ink now. Reach for
`--color-text-secondary` when the intent is "this recedes"; `.button-quiet` means "this is a small
action of the accent kind".

---

## 9. Sticky controls

**One sticky element per screen, and it is the navigation.**

The trip screen was the case that decided this. A compact sticky trip header — name and progress,
following you into the list — is genuinely useful and was rejected on the arithmetic: the navigation
is already 44px of a 664px viewport, and a second strip takes standing chrome to ~80px, or 12% of the
screen, permanently, on the one screen this pass spent its whole budget clearing. §11 of the brief
warns against a sticky header that "simply moves the problem"; at 664 that is what it would be.

If a sticky utility bar is ever proposed again, the test is the same one: measure what it costs while
scrolling, not what it looks like at the top.

---

## 10. Motion

Motion is an accelerator, never a gate. Nothing in Pack Smart is waited on.

| What | Duration | Why |
|---|---|---|
| Press (scale to 0.97) | 90ms | Feedback has to start when the finger lands |
| Colour / border change | 120ms | `--duration-fast` |
| Sheet entrance | 240ms | It travels the height of the screen |
| Disclosure reveal | 120ms, 4px | Content settling, not an effect |
| Undo bar entrance | 160ms, 12px | It arrives from the edge it lives on |
| Swipe release | `--ease-snap` | A row arrives and stops; it does not drift |

**Entrances only, never exits.** Everything progressive disclosure hides is conditionally rendered,
which is right for focus order and VoiceOver — a collapsed disclosure has nothing tabbable in it
because it has nothing in it. Animating a collapse would mean keeping the element mounted while it
closed, which is exactly how a collapsed disclosure grows focusable children again.

`prefers-reduced-motion: reduce` zeroes every animation and transition in the product, globally, in
`global.css`. Nothing may depend on motion to be understood.

**Never animate:** ordinary navigation, a checkbox, or list loading. An elaborate skeleton is a
decorative delay.

---

## 10a. Context is preserved, not rebuilt

**Leaving a screen and coming back is coming back**, not starting again. The
wardrobe's search, category and sort, and a packing list's search and filter,
all survive a tab switch — as does how far down either was scrolled.

`src/lib/viewState.ts` holds them, and the important part is what it is not:

- **Not `sessionCache`.** That holds DATA and `apiFetch` empties it on every
  write, which is right for data and exactly wrong here — packing one item would
  wipe the search that found it.
- **Not a second state authority.** Every screen still owns its own `useState`;
  this is a place to leave a copy on the way out. Nothing reads it during a
  render and it never holds anything the server knows.
- **Not a scroll listener that re-renders.** The listener writes a number into a
  module `Map` and does nothing else. A handler that re-rendered a 119-row list
  is how a polish pass makes an app slower than it found it.

**Scoped to what it describes.** Packing state is keyed by trip: two trips are
two packing problems, and carrying "still to pack" from one onto the other is
restoring the wrong context rather than restoring context. It clears on
sign-out, beside `forgetSessionCache`.

## 10b. Controls that exist only when they apply

Three shipped examples of one rule — **a control that cannot act on anything
should not be on screen**:

| Control | Appears when |
|---|---|
| The search field's `×` | The field holds text |
| `Clear filters` | A **filter** is set — never for a search alone, which the `×` already clears |
| `All trips` on Home | Trips exist that Home is not showing |

Never `disabled` instead: a disabled control still occupies its space and still
has to be read past. And never two controls for one state — the reason
`Clear filters` ignores a lone search is that the field already has an `×`.

## 10c. Sheets

**One completion action.** A sheet whose footer holds an authoritative primary —
`Save changes`, `Add to My Stuff` — labels its top-right control `Cancel`.
`Done` beside `Save changes` is two controls that both read as finishing, one of
which discards the edit, and the wrong guess loses what Alex just typed. Sheets
whose edits apply as they are made keep `Done`, because leaving genuinely is the
only thing left to do.

**A casual dismissal cannot take a draft.** While a sheet holds unsaved edits, a
downward drag snaps back and a backdrop tap does nothing; `Cancel` and Escape
are untouched. A drag is something a thumb does by accident and a keypress is
not. Deliberately not a confirmation dialogue: doc 02 §2 prefers undo to "are
you sure?", and there is nothing to undo once a draft is gone.

Dirtiness is a **comparison against what the sheet opened with**, not a flag set
by every edit — a flag stays true after a change that was typed and undone by
hand, and after a save.

---

## 10d. Utility rows: search dominates, the filter is as wide as its word

Two screens put a search field and one or two `<select>`s on a row above a long list. The rule both
follow:

- **Search takes the leftover width** (`flex: 1 1 auto`, `min-width: 0`).
- **A select is as wide as its longest option and no wider** (`flex: 0 0 auto`).

Equal halves is the shape to avoid. It says the two controls are peers to be compared, when one holds
typed text and is the control actually being used and the other holds one of five short labels. On My
Stuff the same reasoning separates the *filter* (which changes what is in the list, and grows) from
the *sort* (which changes only the order, and does not).

**`flex-shrink` is `0` on the select deliberately.** `0 1 auto` was tried and truncated `Everything`
to `Everythi…`: a search field's basis collapses to almost nothing because its input is `width: 100%`,
so flex had free space to hand out and shrank *both* items in proportion rather than only the one
that could afford it. A filter whose current value cannot be read is worse than a filter that costs a
few pixels — the same finding that keeps My Stuff's controls on two rows instead of one.

---

## 10e. Repeated metadata belongs in a column, not after the name

The `Essential` marker sorts to the top of `Pack now`, so where it appears at all it appears on a
**run** of consecutive rows. Sitting immediately after the name it landed in a different place on
every row depending on how long the item happened to be, and the list read as
`Synthroid Essential` / `Glasses Essential` / `iPhone Charger Essential` — five more words to skip
before the eye reached the thing being scanned for.

Pushed to the end of the line it becomes a column: names start in one place, markers end in another,
and the repetition turns into a texture the eye passes over. The name is the only part allowed to
truncate; the marker never wraps.

**A tinted pill was tried and read backwards.** The marker's problem is that it *repeats*, so giving
each one a filled shape made the column louder — five badges where there had been five words.
Right-alignment was the entire fix; the size and the colour were already right. Generalising: when
repeated metadata is too loud, move it before you decorate it.

Mechanically, the whole thing is `margin-left: auto` on the marker — which does nothing unless the
text column it sits in is `flex: 1`. See §12.

---

## 10f. A card is for the things in it, not for the reasoning behind them

The outfit card was the clearest case of a screen spending its space on the UI
around the task rather than on the task. One outfit was: a header of four
stacked lines, an explanation paragraph, four garment rows each carrying a
second line of planner prose, and a full-width 60px approval button — 703px,
most of a 664px Safari viewport, so a plan of five outfits was five screens of
scrolling to answer "what am I wearing".

| | Before | After |
|---|---|---|
| Top of the first outfit | 357px | 238px |
| A card | 703px | 437px |
| A garment row | 80px | 51px |
| **Top of the second outfit** | **859px** | **573px** |

The last row is the one that matters, and it is now a gate in
`measure.spec.ts`: at 664px the second card used to begin below the fold, so
nothing on screen said the plan had more than one outfit in it.

**Nothing was made smaller.** Every type size and every touch target is what it
was. The height came off the parts that were not clothes:

- four stacked metadata lines became one (`Cape Town · 57–67°F · Smart casual+`)
- `On your packing list` went, because the footer already states the state
- the reason line came off every garment row
- the explanation moved behind `Why?`
- the 60px approval became a 44px footer row: state left, action right

### The rule this generalises to

**Explain the surprising parts, not every correct decision.** A row reading
`Works for several days` or `You approved this with the T-Shirt before` is
true, and repeated four times per card and five cards down a page it makes the
garment names — the only thing anyone is scanning for — the minority of the
text. The reasons are not deleted: `explainOutfit` still aggregates them behind
one tap, and the swap sheet still shows the one that decided each candidate.

### Approved is settled, not highlighted

An approved card used to take an accent border, which made the finished outfits
the loudest things on the screen — a plan where everything was approved was a
page of green boxes, and the one outfit that still needed attention was the only
one not shouting. State goes in the footer, in words. The stronger border is
kept for the two states that have earned it: an approved outfit the trip has
moved out from under, and one built on a garment that is not being brought.

---

## 10g. A replacement is a relational question

Changing one garment is not "which of my tops are good". It is "which top works
with THESE trousers, THESE shoes and THIS layer, for this occasion" — and the
sheet used to answer the first while spending its first third restating the
trip's dates, place and formality, which Alex had just read on the screen he
came from.

So the sheet leads with **the rest of the outfit** and demotes the occasion to
one line beneath it. The garment being replaced is excluded: it is on its way
out, and listing it among the things the replacement must suit would be the
sheet arguing with itself.

This costs about 85px before the first candidate, and it is worth it. The
alternative is not a shorter sheet; it is the same sheet with the constraint
held in the reader's memory instead of on the screen.

---

## 11. What this pass deliberately did not change

Recorded so it is not mistaken for an oversight:

- **Every screen still shows its own name.** Removing the page title from the four tab screens would
  have bought ~30px each and is what the arithmetic wanted; the title is a contract eight e2e tests
  assert, and "the screen says what it is" is worth more than 30px.
- **Wardrobe rows were already denser than the target.** The brief asked for 72–84px; they were 67.
  They came to 65 through line height alone. Nothing was compressed to hit a number that had already
  been beaten.
- **The `Essential` marker stayed a word.** It is already suppressed where every row in a section
  carries it, it is the only signal on the list that does not depend on seeing a colour, and an icon
  would have to be learned. What changed is only *where it sits* — see §10e.
- **Home's second action stayed a second action.** It has now been all three button tiers, and the
  screenshots settled it: full-width secondary competed with the recommendation, bare accent text
  read as a stray link with air on every side. It is the unmodified secondary tier at ~40% width.
  Turning its border or its ink down as well was tried and rejected — a faint outline around grey
  text does not read as subordinate, it reads as *disabled*.
- **The garment name never truncates.** Three arrangements were tried on the
  outfit row. Stacking the name and its brand unconditionally cost a line of
  height on every row; truncating both produced `White Sneak…` beside
  `New Balanc…` at 360px, four rows of half-words. `flex-wrap` is right at both
  widths: one line at 390, and at 360 the brand drops to a second line whole.
  A garment name you cannot read is a row that has stopped doing its job.
- **The Trips rows were already right.** §12 of the brief asked for full-row tappability and a press
  state; the whole row is a `<button>` and tints on press, and it deliberately does not press-scale —
  scaling one row of a continuous surface pulls its edges away from the hairlines above and below it,
  which reads as the list tearing.
- **The Trips screen stayed sparse.** A packed count or progress bar on each
  trip row was evaluated and rejected: it duplicates what Home already says
  about the featured trip, and on the rows where it would help — several
  upcoming trips at once — it is the row that would have to grow to carry it.
  Empty space that is the honest answer is not a problem to solve.
- **Add Item does not autofocus its name field.** `BottomSheet` focuses the
  sheet rather than its first control, for a recorded reason: on iOS, focusing
  an input immediately raises the keyboard over the sheet the reader has not
  read yet. Overriding that needs a real phone to judge, which this environment
  is not, so the existing decision stands until it can be tested on one.
- **Packing intelligence was not touched.** Activity fit, outfit eligibility, ranking, `decidedBy`,
  swimwear quantities, aviation gating, bag planning and readiness semantics are all as they were.
  The only shared-code changes were presentational: where a row's explanation is rendered, and a
  compact form of the weather sentence.

---

## 12. The equal-specificity trap

**Four defects in this codebase have had the same cause**, and it is worth recognising on sight:

> A rule in a route's stylesheet, written against a rule of **equal specificity** in
> `primitives.css`. Which one wins is decided by the order Vite happens to concatenate the bundle in.

Nothing about it is visible in a diff, in `tsc`, or in `eslint`. The CSS is valid, the class is
applied, and the property simply never lands. The four:

| Where | Lost to | Symptom |
|---|---|---|
| `.settings-group` (font/weight/colour) | `.section-heading` | A group label that contradicted every other heading |
| `.settings-group { margin }` | `.section-heading { margin: 0 }` | Four Settings headings sat hard against the list above them, for two passes, while the comment beside the rule described 24px |
| `.home-alternate` | `.button-secondary` | Home's second action was the wrong tier |
| a local select override | `.select-field select` | The filter kept the primitive's weight |

**The rule going forward.** When a route needs to change a primitive on one screen, write the
selector as a **compound**: `.section-heading.settings-group`, `.button-secondary.home-alternate`,
`.button-quiet.settings-signout`. `(0,2,0)` cannot lose to a single class in any bundle order. The
alternative — asking for the right primitive by name instead of overriding the wrong one — is better
still where a primitive already exists that *is* the control.

**And assert the result, not the rule.** `tests/e2e/finishing.spec.ts` reads computed styles and
geometry on the real engine: the margin a group heading actually gets, whether the filter can show
its own current value, whether the essential markers actually line up. Three of the four defects
above were caught by a human looking at a screenshot, which is not a process.

---
