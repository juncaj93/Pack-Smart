# Pack Smart — visual and interaction acceptance

**A gate, not a style guide.** Every item below is a reason to **reject** a screen and open a repair
task. Green CI says the code is consistent with itself; this says the screen is finished.

Reviewed from `npm run qa:visual` output: the real production build, seeded with representative
data, at **360 / 375 / 390 / 430** CSS px and a **664px** fold — the height Safari actually gives a
page on an iPhone 14, not the 844 of the screen. The same run writes
`.visual/measurements.txt`: how many pixels each screen spends before the thing Alex came for, and
how tall its repeated rows are. A density claim is judged against that file, not against an
impression.

The vocabulary a screen is built from — the spacing scale, the surface levels, the card/list/section
rule, the type roles, where progressive disclosure may put things — is
`technical-docs/13_VISUAL_SYSTEM.md`. This file is the gate; that one is the material.

---

## 1. Mechanically enforced

These are assertions in `tests/visual/`, not opinions. A failure fails the run.

| Rule | Why |
|---|---|
| No horizontal document scrolling at any width | Doc 06 §1 |
| Every control ≥ 44×44 px, including small labelled ones | iOS minimum; doc 02 §2 |
| Every text input ≥ 16px | Below it, Safari zooms on focus and never zooms back |
| Nothing of ours fixed to the bottom of the viewport | It would stack on Safari's toolbar — `09_IMPLEMENTATION_NOTES.md` §12 |
| The document itself scrolls on a long page | Safari only collapses its toolbar when the page scrolls |
| Every interactive element has an accessible name | VoiceOver |
| No focusable element behind an open sheet | Focus must not escape a modal surface |
| No content under the bottom 92px of the viewport that cannot be scrolled to | Safari chrome overlaps it |
| A row's primary action reachable without a gesture | Gestures are accelerators, never the only path |
| On a populated trip, a full packing row is inside the first 664px | The screen exists to pack. It began at 767px twice — see `technical-docs/13_VISUAL_SYSTEM.md` |

## 2. Rejected on sight

- **Wasted space.** A screen whose first viewport is mostly padding and hint text. A stack of
  full-width buttons each with its own explanatory paragraph.
- **Weak hierarchy.** Everything the same size and weight; the most important fact not the most
  prominent thing; a heading competing with the value beneath it.
- **Form appearance.** A screen that reads as a web form or an admin table rather than a personal
  tool: labels above every field where a value would do, borders around single lines of text.
- **Card abuse.** Cards nested in cards; a card around a single line; a border immediately inside
  another border.
- **Competing actions.** Two or more primary-weight buttons in one viewport. A destructive action
  with the same weight as the ordinary one.
- **Undersized or crowded controls.** A tap target that only *looks* 44px because of margin.
  Adjacent targets with no gap.
- **Inconsistency.** The same action styled differently on two screens. Two icon families. Headings
  that change position between screens. Emoji standing in for an icon system.
- **Tiny text hiding complexity.** 12px paragraphs used to fit something that should have been cut.
- **Unfinished states.** An empty screen with no explanation or action. A spinner where a skeleton
  belongs. A full-screen spinner for a one-row save.
- **Poor wrapping.** A label wrapping to two lines at 360px inside a control sized for one. An
  ellipsis where the whole value matters (a garment name).
- **Dishonest emphasis.** Two danger-tinted panels adjacent, so neither reads as urgent. An alarm
  colour on a routine state.
- **Motion that costs time.** An animation the user waits on. Anything decorative during packing.

## 3. Interaction rejections

- A swipe that completes from a small accidental movement.
- A swipe that steals a vertical scroll.
- A gesture with no visible alternative.
- A destructive result from a gesture with no Undo.
- A partial swipe that does not spring back cleanly.
- Two sheets stacked.
- A sheet whose primary action is under the keyboard.
- A button that appears to do nothing for more than ~100ms with no state change.
- "Something went wrong" where the real cause is known.
- An action that needs a confirmation dialog for something Undo already covers.

## 4. Required states per screen

Every screen is reviewed in **both** its empty and its populated state, and any of these that apply:
loading, error, offline, keyboard-open, long-page-scrolled, and one width at 360px.

A screen is not accepted until its empty state is deliberate — a sentence saying what will appear
and one action that makes it appear.

**And in both appearances.** Light and Dark are one product, not a theme applied to one of them. The
captures prefixed `dark-` cover the major surfaces, a sheet over its backdrop, and run every rule in
§1 again — because the failures Dark produces are ones Light cannot show: a border that dissolves
into its surface, an accent that stops carrying, an alarm tint that reads as decoration. A colour
that is right in one theme is not evidence about the other; `--color-danger` is a saturated red on
white and a pale pink on near-black, and using it the same way in both is how the essentials alert
stopped looking urgent.

**And the capture must be able to fail.** A state faked by intercepting the network is only evidence
if the run asserts the interception worked before it photographs anything. See `AUTONOMY.md` §8.

## 5. What good looks like here

- The first viewport answers the screen's question without scrolling.
- One obvious primary action; everything else quieter.
- Completed things visibly calmer than unfinished things.
- Numbers are legible and stable (`font-variant-numeric: tabular-nums` where they change).
- The same interaction behaves the same way everywhere.
- Nothing decorative. The calm comes from hierarchy and space, not effects.
