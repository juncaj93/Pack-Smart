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
