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

| | Original | Compression pass | Streamlining pass |
|---|---|---|---|
| Top of the first outfit | 357px | 238px | **230px** |
| A card | 703px | 437px | **423px** |
| A garment row | 80px | 51px | **49px** |
| **Top of the second outfit** | **859px** | **573px** | **560px** |

The second column removed what was not clothes. The third inverted what was
left — see §10h — and the row got *smaller* while gaining a whole line of
information, which is the only kind of density worth having.

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

An approved card used to take a full **accent** border, which made the finished
outfits the loudest things on the screen — a plan where everything was approved
was a page of green boxes, and the one outfit that still needed attention was the
only one not shouting.

It now takes a **restrained** one: `--color-approved-border`, 30% of the accent
in Light and 40% in Dark, replacing the neutral border rather than adding to it.
The distinction is the whole point. `.is-review` sits at 45% and the primary
action at 100%, so a settled outfit stays visibly below both — it reads as
*done*, not as *selected* or *warning*, and the two states that have earned real
emphasis still outrank it. Those two rules are also stated AFTER `.is-approved`
in `Outfits.css`: equal specificity is settled by source order, and an outfit
can be approved and under review at once.

`border-box` means an approved card is exactly the size of a draft, so nothing
reflows when Alex approves one. State is still in the footer, in words, for a
reader who cannot see either signal.

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

## 10h. The label goes on the metadata line, not in a column

A list of typed things invites a column of types: `Top`, `Bottoms`, `Shoes`,
`Layer` down the left, garment names to their right. It reads well in a mockup
and badly on a phone.

A fixed 56px column costs a seventh of a 390px screen and a fifth of a 360px
one, permanently, to repeat four words whose shape the reader already knows —
and it takes that width from the one thing they are scanning for. `Deconstructed
Sneakers` wrapped at 390px with 90px of empty column beside it.

The type is not deleted; it moves to where the other descriptive facts already
live:

```
Deconstructed Sneakers
Shoes · New Balance · White
```

The name starts at the card's own content edge, has the full width, and is the
first thing on the line. The type leads the metadata because that is the job
the column was doing — saying what kind of thing this row is — and it costs
nothing there. The accessible name improves in the same move: a listener hears
the garment before its category, which is the same reordering the eye gets.

**Two lines is not more height than one.** The row went from 51px to 49px,
because a 44px row already had space for two tight lines and what was actually
consuming the height was `--leading-snug` on single lines and 8px of padding
that was no longer buying a comfortable target.

---

## 10i. A footer is one box, not three controls that share a row

The outfit card's footer was a text state, a text action and a 44px outlined
button under a separator. The three sat at three different centres and the
button's box crossed the line above it. It read as three unrelated elements
that happened to be adjacent, which is what it was.

Three rules fix that class of defect, and they generalise:

1. **The separator is the row's own `border-top`**, never a sibling. A line and
   the row it divides cannot get out of step when they are the same box.
2. **The height is declared on the row, not on its children.** If any control
   can be the tallest thing, the row's height is whatever that control happens
   to be, and changing one label changes the geometry.
3. **`align-items: center`,** so everything shares a centre line whatever its
   own height is.

The 44px target then comes from the row, which the children stretch to fill —
so a compact label is still a comfortable tap and no control needs a minimum of
its own. (`box-sizing: border-box` takes the separator out of the content box,
so the declared height is `calc(44px + 1px)`; the hairline is chrome and the
target is the 44 underneath it.)

**A filled tint beats an outline for a card-local primary.** Five outlined
boxes down a page each claim to be the screen's primary action. `--color-accent-tint`
says "the obvious thing to do here" without competing with the one control that
acts on the whole page.

---

## 10j. A swatch is a mark, not a control

Colour dots are 12px on a screen where every real target is 44. That is not an
exception to the touch rule — they are display-only and nothing is ever aimed
at them, so there is nothing to size for a thumb.

**They cost zero height, and that is the constraint the design is built
around.** A dot placed after the metadata *text* would push a long line into a
wrap and buy a whole row of height for a 12px mark. Every placement below keeps
the dot out of the text's own flow, and none of them changes a row's height.

**Which side, and why it is not one answer.** The side says what the colour IS
on that screen, so it differs on purpose and must not be normalised:

| Surface | Side | Because |
|---|---|---|
| Outfit card | **Leads** the garment | The garment is part of a composed outfit and the colour belongs to its identity: `● Button-Up Shirt` reads as one thing. It was on the right and read as a trailing ornament |
| Swap sheet, paired rows | **Leads** | Those rows are ragged-right by nature; the left edge is the only column they share |
| My Stuff | **Trails** the row | The wardrobe is a browsable list and the colour is one more thing known about the row, so it sits where the trip count already does |
| Packing list | **Trails** | Same reason: a checklist row is scanned for its name and its state, not composed |

**A leading dot needs a reserved column; a trailing one does not.** `ColorDots`
renders nothing for the eleven wardrobe strings that are not colours, so a
leading dot that only sometimes exists would start those rows 20px left of their
neighbours and make every card with one honest gap read as ragged. On the outfit
card the wrapper (`.slot-swatch`) is always rendered at a fixed 20px — two
overlapped dots, the widest it can be — and the dots inside it are not. That is
spacing, not a placeholder: nothing is drawn and nothing is claimed. A missing
dot at the END of a row costs nothing, because the text still starts in the same
place, so My Stuff reserves nothing.

**A ring, never a darkened fill.** `White` vanishes into a light card and
`Black` into a dark one, and the fix that suggests itself — nudge the fill until
it shows — makes the swatch misrepresent the garment, which is the one thing it
may not do. The ring is the surrounding text colour at low alpha, so it
strengthens where the background is close and all but vanishes where it is not,
in either theme, from one declaration.

**`aria-hidden`, always.** Every place these appear, the colour name is already
in the row's text. Announcing it again would read the same word twice on every
row of a list, which is how a screen reader becomes unusable on a screen that is
fine to look at. The text is the information; the dot is the accelerator, and
nothing depends on distinguishing the fills.

**No separate palette module.** The swap sheet's `Wearing it with` rows *are*
the outfit's palette. A `Current outfit colors` card above them would be the
same information a second time, in a block that costs height.

---

## 10k. State as a surface, not as a counter

The Outfits page carried `5 outfits · 0 of 6 needs covered` and a `Review 5`
control above the cards. Both are gone, and nothing replaced them — no progress
bar, no `0/5 approved`, no completion chip.

They were the screen telling Alex to do something the cards below already make
obvious: every draft carries its own `Approve`. A counter above them was a
second, worse copy of a workflow that was already on screen, and it cost 44px
of the first viewport to say it.

What answers *which of these still needs me?* now is the card itself. An
approved outfit takes `--color-approved-surface` — 10% of the accent over the
card in Light, 14% in Dark — and a draft stays plain. The question is answered
while scrolling, without reading anything.

**The number was chosen against the PAGE, not against the card.** 4% was tried
first and computed to `#f7f9f9`, within one step of the `#f7f7f8` background —
so an approved card lost its own surface and read as a hole rather than as
something finished. At 7% what distinguished it was a green *cast* rather than a
difference in lightness, which survives sitting on a grey page.

**7% was still too quiet in use, and 10% is the correction.** Two cards side by
side it read; scrolling past one it did not, which is the moment it exists for.
Three more points is about a third more colour in the mix and lands on `#eaf1ef`
— still almost-white, still calmer than the white draft beside it.

**Two signals now, and each is the smaller half of what it could be.** The tint
went up by three points rather than by six, and the border it gained is 30% of
the accent rather than the 100% it used to carry. Either one doing the whole job
produces the success card this section was written to prevent; together they
answer the scrolling question without either being loud on its own. There is
still no badge, no checkmark, no green rail and no glow — a mark on top of the
two would be the same statement three times.

The footer still says `Approved` in words, quietly, because a reader who cannot
see either signal needs it.

### What the counter was also holding up

Removing `Review 5` removed the **only** route in the app to the guided outfit
review walkthrough. Nothing else navigates to `/trips/:id/outfits/review` —
Home's readiness CTA looks like it does, but `routeFor` maps `'review'` to
`/trips/:id/review`, which is the trip review and a different screen. An
approved, deployed feature (doc 09, C2 and §7) was left reachable only by typing
the URL.

Eleven e2e tests failed on CI, all of them in `outfit-review.spec.ts` and all at
their first click. That is a loud signal read quietly: each failure *reads* as a
problem with the review screen, and the review screen was untouched. The thing
that had changed was the door.

So the walkthrough's entry came back as what it always was — **navigation, below
the cards, with no number on it**:

* **Below**, because a walkthrough offered above the list competes with the
  cards; offered after them it is the alternative it should have been.
* **No count**, because the count was the part that was noise. `Review one at a
  time` describes the path rather than nagging about the backlog.
* **Quiet tier**, matching `Back to packing list` beneath it. It must not look
  like `Approve` — a green control below the cards would read as approving all
  of them.

The rule this leaves behind: **before deleting a control because it is
redundant, check what routes through it.** A counter and a door can wear the
same button, and only one of them was redundant.

---

## 10l. Proportion is part of what makes a button a button

`Approve` sized to its label inside a 45px footer came out roughly as tall as it
was wide: a small green rectangle standing on end, which reads as a fragment of
something rather than as a control.

The fix was width, not height — `min-width: 104px` and real horizontal padding,
giving about 3:1. Height went the other way: `background-clip: content-box`
paints the tint inside 6px of vertical padding, so the fill is 32px while the
element stays the footer's full 45. **The target never moves.** Shrinking the
element is the obvious fix and the wrong one; it puts the control under the 44px
floor, which the mechanical gate catches.

At 374px and below the minimum drops to 88px rather than the padding coming off,
so it stays a button shape at a narrower size instead of reverting to the tall
rectangle.

---

## 10m. A sheet's rhythm belongs to the sheet, not to `.form`

`.form` is a flex column with a 12px `gap` between every child. That is right
for a form — a stack of equal fields — and wrong for a sheet that is five
things of five different kinds, each already carrying the margin that says how
close it is to the next.

The two stacked: 8px of margin plus 12px of gap between every pair, five times
over. **Sixty of the swap sheet's 265px of pre-results height was gap nobody had
asked for**, and every margin tightened on the elements themselves was fighting
a gap it could not see.

`gap: 0` on the sheet gives the margins sole authority, so a rule that says
"these two are close" is actually true. First candidate: 366px → 311px.

If a container sets both a `gap` and lets its children set margins, one of them
is lying about the spacing. Pick one.

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
- **The garment name never truncates.** Four arrangements were tried on the
  outfit row before §10h settled it. Truncating name and brand together
  produced `White Sneak…` beside `New Balanc…` at 360px, four rows of
  half-words. A garment name you cannot read is a row that has stopped doing
  its job, so the name wraps and nothing on the row is ever clipped.
- **`Usually` stays on a climate normal.** The brief asked for it to go, and it
  is the only thing on the card distinguishing a five-year average from a
  forecast. `01_ARCHITECTURE.md` §6 and the `trip_weather` schema both forbid
  presenting one as the other, and no shorter marker was both accurate and
  spoken correctly. Eight characters is the honest price.
- **`formalityLabel` still says "to".** `Smart casual–Formal` saves three
  characters and an en dash is not announced by VoiceOver, so the label would
  read as "Smart casual Formal". Not a trade worth making.
- **`Usually` still marks a climate normal.** Asked for a second time, and it
  is still the only thing distinguishing a five-year average from a forecast —
  `01_ARCHITECTURE.md` §6 forbids presenting one as the other. The compaction
  that was wanted came from dropping the redundant formality band instead,
  which is twenty-two characters against `Usually`'s eight and costs nothing.
- **The formality band left the swap sheet's context line, not the planner.**
  `Nice dinners · Smart casual to Formal` is one fact twice: the band comes from
  the activity's own template. It survives wherever there is no activity to
  imply it, and `passesFilters` still applies it as a hard filter — asserted by
  a test that checks the planner still refuses an over-casual garment.
- **No colour filtering, and no match tiers.** The concept image showed
  `Tap a color to filter` and `Best matches` / `Good matches` headings. The
  written brief rules the first out (§13) and the ranking already orders the
  list, so tier headings would be a second, coarser rendering of an order the
  list is already in.
- **The `BottomSheet` header is untouched.** It is shared by every sheet in the
  product, and shortening it from the Outfits work would be a change to eleven
  screens made while looking at one.
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

## 13. A control must not move under the thumb that is reaching for it

Alex reported this from his phone, and it is the first defect in this codebase that no existing gate
could have seen:

> "I was clicking 'add rule' but the response was tapping way lower on my screen to turn off a rule
> lower on the screen."

**The mechanism.** A sheet is `position: fixed; bottom: 0` and sizes to its content, so it grows
**upward**. Opened before its list has arrived it is short — a search field, one action, the word
"Loading…" — and when the reply lands the whole frame leaps up, carrying every control in it.
Measured at the real fold on the seeded database, before the fix:

| Sheet | top edge on open → settled | jump |
|---|---|---|
| Add to this trip | 419 → 100 | −319px |
| Your usual amounts | 414 → 117 | −297px |
| Packing rules | 378 → 100 | −278px |
| One last look | 513 → 427 | −86px |
| What Pack Smart has noticed | 513 → 476 | −37px |

Alex aimed at the one action the short sheet was showing him; the reply landed; a rule row landed
under his finger. On a phone the fetch is far slower than a local preview, so the window is wide.

**Why it is worse than an annoyance.** The wrong tap is **silent**. A packing rule switches off with
no undo bar and nothing on screen to say so, and he finds out when something is missing from his bag.
The same shape on the swap sheet silently changes a garment.

**Why nothing caught it.** The `touch-target` gate measures a control's *size*; this control was a
comfortable 44×44 the whole time. A screenshot shows the *settled* sheet, in which nothing is wrong.
Both gates were looking at a single moment, and the defect lives in the gap between two of them.

**The rule.** Nothing Alex can already touch may move when content arrives. Two halves, and the
second is the one that is easy to forget:

1. **The sheet holds its frame.** `BottomSheet`'s `loading` prop makes a sheet that is waiting for
   its content take the full height it is allowed from its first frame. Latched for the life of one
   opening — releasing it when the content lands would *shrink* the sheet instead, which is the same
   defect pointing the other way. Sheets whose content is in hand pass nothing and are unchanged.
2. **Controls below an absent list are not rendered yet.** Holding the frame still is not enough: a
   control *underneath* content that has not arrived is in a place it is about to leave. Three were
   still moving inside a stable frame — `Add an amount` (+297px), `Leave this empty` in the swap
   sheet (+1350px), and the rules sheet's `N rules need a look` banner, which was inserted *above*
   the search field and Add. A control that will move is worse than a control that is not there yet.

**The cost, accepted deliberately.** A reserved sheet is the height it is allowed rather than the
height of what is in it, so a short list leaves slack. `Your usual amounts` settles at 117 against a
664px fold and loses nothing; an *empty* state was a sentence at the top of a near-full-screen white
box, and reads as a sheet still loading. `.sheet-empty` centres it, so the space is deliberate. This
is the iOS detent model — Apple's own sheets are routinely taller than their contents — and the
alternative is a class of silent wrong actions.

**The gate.** `assertSheetHoldsStill` (`tests/visual/gates.ts`) samples every control in an open
sheet by accessible name, before and after its content lands, and reports anything that moved more
than 2px. Seven sheets covered. Two things were needed to make it able to fail at all, and without
either it reported three of the four sheets as stable while the bug was still in the build:

- **The API is slowed.** Against a local preview the reply lands inside the sheet's own slide-up, so
  the loading state never renders.
- **The service worker is blocked.** `page.route` cannot see a request a service worker makes, ours
  is network-first for `GET /api/*`, and the app re-registers one on every load — so unregistering
  alone is not enough.

One e2e test carries this to WebKit, which is the browser it happened in: the fix is `height: 85dvh`
on a flex column with a scrolling child, and `dvh` is exactly the unit Safari can measure differently.

---
