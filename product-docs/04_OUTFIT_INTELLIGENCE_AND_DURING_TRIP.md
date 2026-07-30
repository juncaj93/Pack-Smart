# Pack Smart — Outfit Intelligence & During Trip Mode

## 1. Purpose

The outfit system should remove the hardest clothing decisions while avoiding fashion-management busywork.

It should answer:

- What combinations make sense for this trip?
- How many clothing items are actually needed?
- Which versatile items can be reused?
- What should Alex wear for today's event?

## 2. Outfit groups before packing

Generate outfits by activity or event group rather than forcing a unique outfit for every calendar day.

Examples:

- Flight outfit
- Safari outfit ×3
- Casual sightseeing outfits
- Winery and nice-dinner outfits
- Pool and downtime outfit
- Workout outfit

Outfit groups may later be associated with specific itinerary events.

## 3. Outfit inputs

Recommendations should consider:

- Activity
- Weather range
- Morning versus afternoon versus evening
- Indoor versus outdoor
- Dressiness
- Warmth
- Rain and wind where relevant
- Saved favorites
- Usage frequency
- Versatility
- Rewear tolerance by clothing type
- Must-bring requests
- Already-selected shoes and outerwear
- Clothing availability and archive status

## 4. Favorite versus usage frequency

These are separate signals.

### Favorite

An explicit preference indicating Alex generally likes or prefers the item.

### Usage frequency

A behavioral or manual signal:

- Frequently used
- Sometimes used
- Rarely used
- New / insufficient history

A rarely used favorite can still be chosen for a specialized event. A frequently used item should not override activity suitability.

## 5. Ranking priorities

A reasonable ranking order is:

1. Required or explicitly requested item
2. Activity and weather suitability
3. Approved saved outfit relationship
4. Favorite status
5. Frequency of use
6. Versatility across the trip
7. Reuse efficiency
8. Variety needs

Specialized suitability may override popularity.

### What "approved saved outfit relationship" means

There is **no separate "save this outfit" action.** Approving an outfit is the save — hence
*approved* saved outfit. Doc §7 keeps the controls minimal and does not add one.

When an outfit is approved, Pack Smart records that those garments were worn **together**. On a
later trip, a candidate is preferred in proportion to how often it has been approved alongside the
garments already chosen for that outfit. It is a relationship between items, never a property of one
item, and it is counted rather than guessed.

**The learning is announced, and undoable.** Approving affects one trip by default
(`CLAUDE.md`: *"Permanent preference changes must be explicit"*), so a pairing that will outlive the
trip cannot be created silently. On approval, say plainly that the combination was remembered and
offer **Undo** — the house style, rather than a confirmation dialog nobody reads.

Consequences of this design, all deliberate:

- **Un-approving an outfit forgets what approving it learned.** The record must not drift from what
  Alex actually stands behind.
- **A pairing is evidence, not a rule.** It ranks at position 3 — below activity and weather
  suitability, so it can never put Alex in the wrong clothes for the conditions to honour a habit.
- **No pairing data means no effect.** On a first trip, and for any garment never approved with
  another, this criterion scores zero and the ranking is exactly what it would have been.
- **Pack Smart must be able to name the pairing it used** — "you approved this with your olive
  jacket before". A preference that cannot be traced to something Alex did is not explainable, and
  doc 01 §4 requires explainable.

### Anchor first, then coordinate

An outfit is filled in slot order, so **the first garment has nothing to pair with yet.** It is
chosen on its own merits — activity, weather, favourite, frequency — and everything after it is
chosen partly to go with it.

This is the intended behaviour, not a limitation to design around. It is how getting dressed
actually works: pick the shirt, then trousers and shoes that go with *that* shirt. The alternative —
re-ranking every slot against every other until the outfit settles — buys little and makes the
result harder to explain, and "why this shirt" must stay answerable.

The practical consequence, stated so nobody is surprised: **pairings never change which top is
picked.** They change the bottom, the footwear, and the layers.

Example:

> Olive quilted jacket selected instead of the usual zip-up because the event is colder and outdoors.

## 6. Clothing reuse

Default reuse expectations should vary by category.

Usually reusable:

- Jackets
- Quarter-zips and layers
- Pants
- Shoes
- Belts

More limited reuse:

- T-shirts
- Performance shirts after hot activities
- Underwear
- Socks

Alex's explicit preferences override defaults.

## 7. Outfit editing

Keep controls minimal:

- Swap item
- Add an item
- Remove outfit
- Approve outfit
- Mark item for reuse

Do not create separate buttons for every swap type. A single Swap action can support replacing a top, pants, shoes, or layer.

### Learning from what gets removed

Removing something from a packing list is a decision. Repeated across trips it is a habit, and Pack
Smart should stop asking.

After the **same item has been taken off three separate trips**, Settings offers to stop adding it
automatically. Three, not two: a swimsuit removed from two winter trips says nothing about the
summer.

- **Reading the suggestion changes nothing.** Accepting is the explicit act, because this is a
  permanent preference change.
- **It is reversible.** Accepting disables the rule; Packing rules turns it back on, and nothing
  about why the rule existed is lost.
- **It says what it saw** — the item, and the number of trips. Never a score, never a confidence.
- **It never offers to stop adding something marked essential.** That would leave a critical item no
  rule can place, which is exactly the silent omission doc 02 §9c exists to catch — the app would
  help Alex disable his own passport and then warn him about it.
- **Nothing noticed says so plainly**, rather than showing an empty panel that looks broken.

The same shape applies to other repeated actions as they are connected: observe, state what was
observed, propose once, and be refusable.

## 8. Outfit-to-checklist synchronization

Approved outfits are the source of truth for the clothing checklist.

When an outfit changes:

- Add newly used clothing to the checklist
- Remove clothing no longer used unless independently required
- Recalculate quantities

When a clothing item is removed from the checklist:

- Identify outfits using it
- Offer to replace it
- Allow removal anyway, with affected outfits marked incomplete

The user must never maintain two conflicting clothing plans.

## 9. One Last Look

Before packing begins, show:

- Favorites excluded
- Frequently used items excluded
- Near-match items
- Searchable remaining clothing

Tapping a similar item should offer:

- Swap with a current item
- Add as extra

The system should not encourage overpacking by leading with the full closet.

## 10. During Trip rule

This rule is absolute:

> During Trip may recommend only clothing and gear confirmed as packed for that trip.

Do not recommend:

- Not Bringing items
- Unpacked items
- Archived items
- Items the user never confirmed owning

## 11. During Trip default screen

When the trip begins, the main active-trip experience becomes **Today**.

Show:

- Current location
- Today's events
- Expected conditions
- Recommended outfit per event
- Bring-with-you items
- Optional layer or backup

Example:

### Morning Safari

Wear:

- Olive performance shirt
- Khaki pants
- Walking shoes
- Black zip-up

Bring:

- Quilted jacket
- Hat
- Sunglasses
- Binoculars

## 12. Planned outfit versus live adjustment

Start with the approved pre-trip outfit.

Use current conditions to make small adjustments rather than regenerating the entire plan.

Examples:

- Bring the rain jacket
- Skip the layer this afternoon
- Switch to the warmer packed jacket

This preserves trust and continuity.

## 13. During Trip controls

- I will wear this
- Swap
- Already wore this
- Not available
- Too warm
- Too cold

When Alex selects **I will wear this**, mark those garments as worn for trip-level tracking.

## 14. Worn-item behavior

The system may:

- Avoid repeating shirts too soon
- Reuse pants, shoes, and jackets appropriately
- Show clean alternatives
- Track whether planned outfits were used

V1 should not require Alex to maintain a perfect laundry ledger. Worn status is helpful guidance, not rigid inventory accounting.

## 15. Missing suitable item

Never invent clothing Alex does not own.

Show:

> No suitable packed rain layer found.

Then offer:

- Use another packed layer
- Add an item I own
- Ignore

Shopping suggestions are outside v1.
