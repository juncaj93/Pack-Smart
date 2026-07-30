# Pack Smart — UX acceptance criteria per screen

**What "finished" means for each surface.** `VISUAL_ACCEPTANCE.md` covers how a screen must look and
behave; this covers what it must contain and in what order. Both gates apply.

The universal shape, on every screen: **identity → the most important current state → one obvious
primary action → quieter secondary actions → advanced detail only when asked for.**

---

## Home

Answers, in this order and without scrolling: *what trip is next*, *how ready am I*, *what needs
attention*, *what should I do now*.

- The next trip is the largest thing on the screen; days-to-departure is present.
- Packing progress is a number, not only a bar.
- Unresolved essentials appear only when there are some, naming them.
- Exactly one primary action.
- Past trips and settings are present but visibly secondary.
- Empty state: one sentence about what Pack Smart will do, and **Plan a trip**.

## Trips

- Scannable rows: emoji, name, dates, derived status, compact progress.
- Upcoming and past separated; past offers **Plan again**.
- No raw stored fields, no tall cards.

## Plan / edit a trip

- Destination and dates first; a basic trip is creatable without opening anything advanced.
- Activities are one tap each.
- Itinerary import is offered as an accelerator, never a step.
- Luggage, laundry, formality, flight length, multi-city sit behind one clear disclosure.
- Validation next to the field it concerns, in plain words.
- The emoji is suggested and one tap to change.

## Trip command centre

- Identity, dates, day count.
- Weather, or an honest statement of why there is none — a climate normal is never presented as a
  forecast.
- Packing progress and unresolved essentials.
- Outfit and itinerary state summarised, not just linked.
- Unfinished sections read louder than finished ones.
- One best next action, chosen from the trip's actual state.
- No undifferentiated column of full-width buttons, each with its own paragraph.

## Packing checklist

The highest-priority surface. Must be usable one-handed beside an open suitcase.

- Progress updates immediately; search filters what is shown and never what is counted.
- Rows are large, and the whole row is the target.
- Swipe right packs; tapping packs; both reverse.
- Partial quantities are legible ("2 of 5 packed").
- Essentials are distinguishable without alarm styling on every row.
- Completed rows quieter but still readable.
- *Why this* is available per row, in plain arithmetic.
- Removing a garment surfaces affected outfits **before** it is final (doc 04 §8).
- Offline failure explains itself on the row that failed.
- Answers "what do I still need?" at a glance.

## Outfit planning

- Each outfit states its dates or occasions, activity, place, the conditions used, and formality.
- Selected garments and missing slots are both explicit; a missing slot says what is missing.
- The reason is plain language, never a score or an internal criterion name.
- Approved is unmistakable; remembered pairings are visible but subtle and reversible.
- Replacing a garment is one tap to a focused sheet of genuinely eligible choices, each with why it
  qualifies — and unsuitable ones are shown labelled rather than hidden.

## During Trip

- Today first: the outfit, the activity, expected conditions, what to carry.
- Marking worn / not worn is one tap.
- Says plainly when it can only use packed items.
- Not a second copy of the checklist.

## My Stuff

- Compact `+` in the heading, not a full-width button.
- Search is immediate; categories are understandable; filters earn their space.
- Swipe left reveals Edit and Archive; both also reachable by tapping the row.
- Archived is a clear mode, restore is one tap, permanent removal is deliberate and states the
  consequence.
- Advanced garment attributes stay optional and out of the way.
- Reads like a closet, not a table.

## Settings

Grouped by intent: **Packing behaviour · My wardrobe · What Pack Smart has learned · Trips and
weather · Data and backup · Account and app.**

- Every control says what it changes, in plain English.
- Every control demonstrably changes behaviour — anything display-only is repaired, removed, or
  labelled honestly.
- "Nothing noticed yet" is stated rather than shown as an empty panel.

## Cross-cutting states

- **Loading:** skeleton shaped like the content. No full-screen spinner for a small operation.
- **Empty:** what will appear, and the action that fills it.
- **Error:** the real cause and a retry.
- **Offline:** reads work and say so; a failed write says it was not saved and why.
- **Keyboard open:** the field being typed into and its primary action both stay visible.
