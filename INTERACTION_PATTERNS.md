# Pack Smart — interaction patterns

**One interaction language for the whole product.** If a pattern is not here, it does not get
invented on one screen: it gets added here first, then used everywhere it applies.

---

## 1. The rule that governs every gesture

**A gesture is an accelerator. It is never the only way to do anything.**

Every swipe action must also be reachable through a visible control — the row's own tap target, an
overflow control, or the detail sheet. VoiceOver, keyboard, switch control, and anyone who never
discovers the gesture must keep the whole product.

## 2. Swipe rows

Used on the packing checklist and in My Stuff. Nowhere else without a reason written here.

**Thresholds and behaviour** — these numbers are the contract, and the tests assert them:

| Property | Value | Why |
|---|---|---|
| Direction lock | Decided once, from the first ~10px of movement | A row that fights vertical scrolling is worse than no gesture |
| Lock rule | Horizontal only if `|dx| > |dy| * 1.4` | Diagonal thumb movement while scrolling must stay a scroll |
| Finger tracking | 1:1 up to the action width, rubber-banded beyond | The row must feel attached to the thumb |
| Commit threshold | 45% of row width, **or** a fast flick (> 0.5 px/ms) | 45% is deliberate; a nudge is not a decision |
| Below threshold | Springs back in `--duration-fast`, nothing happens | Cancelling must be free |
| Completion | Row animates into its completed state, Undo offered | Doc 02 §2 prefers undo over confirmation |
| Repeat | Swiping the same row again reverses it | Symmetry, not a hidden second gesture |
| Pointer events | Pointer/touch events with `touch-action: pan-y` | Never click simulation; the vertical scroll must survive |

**Checklist — swipe right:** mark packed. Reveals a check and the word *Packed* behind the row,
tracking the finger. Completing it fills the row's tick, quiets the row, and shows Undo.

**Checklist — swipe left:** reveals non-destructive actions only — *How many*, *Why this*, *Not
bringing*. *Not bringing* removes the item **from this trip**, never from the wardrobe, and routes
through the affected-outfit replacement flow (doc 04 §8) when an approved outfit was wearing it.

**My Stuff — swipe left:** *Edit* and *Archive*. **Never permanent deletion.** Permanent removal
lives inside the item flow, behind a deliberate action that states the consequence.

**Never:** a full-width horizontal gesture that competes with Safari's back swipe; a destructive
result the moment a swipe begins; a gesture on a row whose action is not also visible.

## 3. Sheets

A bottom sheet is for one focused task: add an item, pick a category, choose filters, replace a
garment, edit a quantity, pick activities, review an itinerary, see why something was recommended.

- Clear title. One primary action. Secondary actions quieter.
- Content scrolls inside the sheet; the page behind it does not.
- Visible close affordance, plus backdrop tap and downward drag where dismissing is safe.
- Focus moves into the sheet on open and returns to the opener on close.
- The primary action is never under the keyboard.
- **Never stack a sheet on a sheet.** Replace the content of the one that is open.
- Never use a sheet where inline editing is simpler.

## 4. Destructive severity

Escalate only as far as the damage justifies:

1. **Ordinary action** — no ceremony. Packing, unpacking, approving.
2. **Swipe reveal** — a labelled action behind a row.
3. **Undo** — anything reversible: not bringing an item, archiving, quantity changes.
4. **Confirmation** — only for permanent loss that Undo cannot cover, and it must say what is lost.

A confirmation dialog on a reversible action is a defect, not caution.

## 5. Feedback

Every meaningful action changes something visible within ~100ms:

| Action | Pattern |
|---|---|
| Packing a row | Immediate row state change, optimistic, reconciled on response |
| Saving a field | Inline saved state on the field, no toast |
| Removing / archiving | Undo bar naming what happened |
| Generating, importing, refreshing weather | Progress on the control that started it |
| First load of a list | Skeleton in the shape of the content, never a centred spinner |
| Failure | The real reason, on the thing that failed, with a retry |

**Offline is a known reason.** "Not saved — you are offline" is required; "Something went wrong" is
a defect wherever the cause is known.

## 6. Motion

Motion exists to explain continuity, and never to be admired:

| Thing | Duration | Notes |
|---|---|---|
| Sheet in/out | `--duration-sheet` (240ms) | Transform only |
| Row completion, swipe spring-back | `--duration-fast` (120ms) | |
| Progress fill | `--duration-fast` | Already tokenised |
| List insert/remove | `--duration-fast` | Opacity + height, never a bounce |

No action waits for an animation to finish. `prefers-reduced-motion` already reduces every
transition globally in `global.css` — new motion must go through tokens so it inherits that.

**Haptics:** not reliably available to this runtime. Not used, not claimed.

## 7. Navigation

Compact sticky top navigation, four destinations, unchanged in position on every screen.

**Never a fixed bottom bar.** In Safari it stacks directly on the browser's own toolbar and costs
~50px of the screen forever (`09_IMPLEMENTATION_NOTES.md` §12). The page itself must scroll, or
Safari never collapses its toolbar.

## 8. Copy

Short heading. One sentence where a paragraph is tempting. Specific errors. Calm warnings.

Never in user-facing text: *criteria, engine, normalizer, rule type, mutation, sync, entry, record,
payload, status code*. Say what happened to the thing Alex is looking at.
