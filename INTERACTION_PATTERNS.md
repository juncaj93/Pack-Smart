# Pack Smart — interaction patterns

**One interaction language for the whole product.** If a pattern is not here, it does not get
invented on one screen: it gets added here first, then used everywhere it applies.

---

## 1. The rule that governs every gesture

**A gesture is an accelerator. It is never the only way to do anything.**

Every swipe action must also be reachable through a visible control — the row's own tap target, an
overflow control, or the detail sheet. VoiceOver, keyboard, switch control, and anyone who never
discovers the gesture must keep the whole product.

## 1a. How a gesture is proven

**A gesture test must exercise both distance and velocity, and at least one coarse, flick-style
pointer path. Fine-grained slow drags alone are not evidence that a touch gesture works.**

This is a standing rule because both halves of it have already been paid for, in one pass:

- **Velocity is half of every threshold here.** A drag whose duration is left to whatever the machine
  does is a test that cannot say which dismissal path it exercised — the same 50px was a spring-back
  locally and a flick on a CI runner. The test controls the duration: the unit suite stubs the clock,
  the e2e helper spends real time between moves.
- **A slow drag emits fine-grained moves; a real one does not.** Slow moves stay inside whatever
  small region the gesture started in, so they pass while the gesture is broken for every finger
  that actually hurries. The sheet drag did nothing at all on a quick flick, under a full suite of
  green threshold tests, because every one of them dragged slowly. A coarse path — one big jump that
  leaves the region — is the case that finds this, and there must always be one.

And the corollary, learned the same way: **a test that cannot fail is not evidence.** Before trusting
a gesture test, break the thing it guards and watch it go red. See `AUTONOMY.md` §8 for the same rule
applied to screenshots.

## 2. Swipe rows

Used on the packing checklist and in My Stuff. Nowhere else without a reason written here.

**Thresholds and behaviour** — these numbers are the contract, and the tests assert them:

| Property | Value | Why |
|---|---|---|
| Direction lock | Decided once, from the first **5px** of movement, **inside the `touchmove` handler that also vetoes the pan** | The browser is deciding the same question at the same time. A claim made after its decision cannot be enforced |
| Lock rule | Horizontal only if `|dx| > |dy| * 1.4` | Diagonal thumb movement while scrolling must stay a scroll |
| Finger tracking | 1:1 up to the action width, rubber-banded beyond | The row must feel attached to the thumb |
| Commit threshold | 45% of row width, **or** a flick faster than 0.5 px/ms that still crosses 25% | 45% is deliberate; a nudge is not a decision, however fast it is |
| Below threshold | Springs back, nothing happens | Cancelling must be free |
| Completion | Row settles **first**, then the action runs and the list may resort | Reordering under a finger that is still on the row is the "premature reorder" defect |
| Repeat | Swiping the same row again reverses it | Symmetry, not a hidden second gesture |
| Input model | **Touch events only** on a touch screen, plus a separate mouse path. **No Pointer Events**, no `setPointerCapture` | See below — this replaced the pointer model in the #32 hotfix |
| Capture | The implicit capture touch events already have. Nothing is claimed or released | `touchmove`/`touchend` are always dispatched to the `touchstart` target, so a release that lands on a neighbouring row still reaches the right one |
| Rendering | The transform and every state class are written to the element. **No React state changes between the finger landing and the settle** | A render mid-gesture is what lets a key change, a list resort, or an optimistic update replace the row under the thumb |

**Why not Pointer Events.** They were the model until PR #32, and they lost the axis to Safari
every time. With `touch-action: pan-y` the browser is still entitled to decide a thumb carrying a
few pixels of vertical drift is a vertical pan; when it does, it fires `pointercancel` and every
subsequent `touchmove` arrives with `cancelable === false`, so the veto cannot run. The row reset
with the finger still down and still moving, and the arbitration began again — the jitter. Touch
events remove the arbitration surface instead of negotiating with it. **`touch-action: pan-y` is
necessary and never sufficient**; the veto in the `touchmove` handler is what makes it work.

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

### 3a. The downward drag

Every sheet is the one `BottomSheet`, so these are set once and apply everywhere. The numbers are
the contract and the tests assert them:

| Property | Value | Why |
|---|---|---|
| Drag region | The grabber strip **and the header under it**, ~76px, as one surface | 32px of grabber was the strip a thumb has least reason to rest on. The title is where it already is |
| Body | Never drags | Content scrolls inside the sheet; a sheet that claimed every downward gesture would collapse while Alex scrolled a long list back to its top |
| Finger tracking | 1:1 | The sheet must feel attached to the thumb |
| Commit threshold | **96px**, **or** a flick faster than 0.5px/ms that still crosses **24px** | Velocity alone is a trap: a 15px slip in 10ms is 1.5px/ms. A nudge is not a decision, however fast it is — the same rule as §2 |
| Below threshold | Springs back, nothing happens | Cancelling must be free |
| Movement threshold | 6px before a touch is a drag; nothing is captured until then | `Done` lives inside the drag region. A press on it must stay a press, and a completed drag must not click what it ended on |
| Cancellation | `pointercancel` returns the sheet and dismisses nothing | The browser took the gesture away; nobody decided anything |
| Input model | `pointerdown` on the region, then **`pointermove`/`pointerup` on the window** for the duration of the drag. **No `setPointerCapture`** | A move is delivered to whatever is under the finger, and one coarse move leaves a 76px region — listening on the region alone works only for slow drags. Capture fixes that and breaks the buttons: the `click` after a `pointerup` goes to the capturing element, so `Done` and `Cancel` stop closing the sheet |
| Rendering | Transform written to the element on `requestAnimationFrame`. **No React state between the finger landing and the settle** | Same reason as §2, and more of it: what would re-render per move is a whole open sheet |
| Backdrop | Thins as the sheet leaves, floored at 0.45 | The drag reads as a dismissal in progress |

**Holding unsaved edits.** The two casual dismissals stop working: a backdrop tap does nothing, and
the drag is damped to at most 44px so the sheet gives a little and stops. The refusal is said in the
only language a drag has. **No confirmation dialogue** — that taxes every correct dismissal to catch
the rare wrong one, and §4 is explicit that a confirmation on a reversible action is a defect. The
deliberate exits are untouched and both on screen: `Cancel` at the top right, and the primary action
in the footer. Escape too; a key is not something a thumb does by accident.

**The grabber is decorative.** Small, centred, unlabelled, not focusable. It advertises the gesture;
it is never the only way out.

### 3b. The software keyboard

`position: fixed` resolves against the layout viewport, and the iOS keyboard changes neither that nor
`dvh` — so a sheet pinned to the bottom sits *behind* the keyboard, primary action and all.
`BottomSheet` measures the shortfall from `visualViewport` and publishes it as
`--sheet-keyboard-inset`; the sheet's bottom edge and its height cap both use it, so the sheet rises
by exactly as much as it loses and **its top edge does not move**. A shortfall under 80px is Safari's
own toolbar, not a keyboard, and is ignored.

Closing the keyboard must never close the sheet. Search fields carry `enterKeyHint="search"`: they
filter as you type, so the return key's only job is to put the keyboard away.

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

**One floating toolbar at the bottom**, four destinations either side of a centre Add, unchanged in
position on every screen. Guided flows that carry their own named exit hide it; nothing else does.

**Floating is the requirement, not a detail.** A full-width bar flush with the bottom edge stacks on
Safari's own toolbar and reads as an app fighting the browser — that is what was removed in
`09_IMPLEMENTATION_NOTES.md` §12, and the objection was to the shape rather than to the position. The
margins and the radius are what make this a control on the page. Never edge-to-edge, never flush.

**The page itself must still scroll**, or Safari never collapses its toolbar. A fixed bar does not
change that; a fixed-height shell with an inner scroll region would.

**It is not a density win.** Content starts 57px higher, the bar costs 64px of viewport against the
old sticky row's 44px, and the never-obscured band is about 7px narrower. The reason it is at the
bottom is that the top of an iPhone is the hardest place to reach one-handed.

**Add belongs to the screen, not to the toolbar.** The centre control invokes whatever the current
screen registered — `Plan a Trip`, `Add item`, `Add to this trip` — and is disabled where a screen
has nothing to add. A toolbar that decided for itself what Add means would silently drop the trip's
own Add flow, which is reachable no other way.

## 8. Search fields

Every search field in the product is `SearchInput`, and there are eight of them. A field holding
text shows a `×` at its right-hand end; an empty one shows nothing.

- **The tap area is 44px; the glyph is not.** The button is positioned inside the field over padding
  reserved for it, so clearing costs no row and no height.
- **Focus never leaves the field.** `pointerdown` is prevented so the browser does not move focus to
  the button at all — on an iPhone that is the difference between the keyboard staying up and it
  dismissing and reopening under a thumb. The next search costs no extra tap.
- **WebKit's own cancel button is removed**, not relied on. Desktop Safari and Chrome draw it,
  unstyleable; iOS Safari — the target platform — draws none. Trusting it would put the affordance
  in every screenshot and on nobody's phone.
- **Search fields only.** A field holding something Alex typed on purpose and means to keep — a trip
  name, a unique item, a passphrase — does not get one. Clearing is for a filter over a list, where
  the whole value is disposable.

## 9. Copy

Short heading. One sentence where a paragraph is tempting. Specific errors. Calm warnings.

Never in user-facing text: *criteria, engine, normalizer, rule type, mutation, sync, entry, record,
payload, status code*. Say what happened to the thing Alex is looking at.
