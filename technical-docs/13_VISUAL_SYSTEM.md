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
```

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
  would have to be learned.
- **Packing intelligence was not touched.** Activity fit, outfit eligibility, ranking, `decidedBy`,
  swimwear quantities, aviation gating, bag planning and readiness semantics are all as they were.
  The only shared-code changes were presentational: where a row's explanation is rendered, and a
  compact form of the weather sentence.
