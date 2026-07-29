# Pack Smart — Packing Intelligence & Smart Setup Rules

## 1. Intelligence approach

Pack Smart v1 should feel intelligent without requiring a paid AI API.

Use a hybrid of:

- Structured trip facts
- Keyword and phrase detection
- Saved personal rules
- Curated activity templates
- Deterministic quantity formulas
- Selective follow-up questions
- Editable confirmation

Do not describe this internally or externally as advanced AI if it is rule-based.

Recommended product language:

- Smart Trip Setup
- Pack Smart understood
- Detected from your trip notes
- Personalized using your preferences

## 2. Parsing natural trip notes

The interpreter should recognize high-value travel concepts and common wording variants.

### Activity examples

- `safari`, `game drive`, `Kruger` → Safari
- `winery`, `vineyard`, `wine tasting` → Wine country
- `nice dinner`, `upscale restaurant`, `fine dining` → Nice dinner
- `sightseeing`, `city tour`, `museum` → City sightseeing
- `swim`, `pool`, `beach`, `swimsuit` → Swimming
- `hike`, `trail`, `trek` → Hiking
- `gym`, `workout`, `exercise` → Workout

### Constraint examples

- `carry-on only` → Carry-on constraint
- `checking a bag`, `checked suitcase` → Checked bag
- `no laundry`, `will not do laundry` → Laundry unavailable
- `probably no laundry` → Laundry likely unavailable; confirm
- `hotel has a washer` → Laundry available
- `nothing formal` → Maximum dressiness: smart casual
- `black tie` → Formalwear required

### Preference examples

- `all my shoes`, `bring every planned shoe` → Preserve selected shoes
- `at least two swimsuits` → Swimwear minimum = 2
- `extra pants`, `enough pants` → Increase pants variety
- `do not rewear shirts` → Low shirt reuse
- `I run cold` → Warmth bias
- `pack light` → Minimize noncritical quantity

## 3. Detection certainty

Internally classify detections as:

- **Certain** — explicit statement
- **Likely** — qualified statement requiring quick confirmation
- **Possible** — weak signal that should be suggested, not applied

Do not show numeric confidence percentages.

## 4. Recommendation sources

Every packing-list entry should have one source:

- Always packed
- Trip-triggered
- Outfit-generated
- User-added
- Dependency-triggered

Examples:

- Passport: Trip-triggered by international travel
- Toothbrush: Always packed
- Blue button-down: Outfit-generated
- Shaver charger: Dependency-triggered by shaver
- Extra jacket: User-added

This source should be retained for traceability, even if not always displayed.

## 5. Safety and reliability split

Use deterministic rules for:

- Passport
- Identification
- Medication
- Personal quantity formulas
- Pack timing
- Final verification
- Travel adapters
- Dependency items such as chargers

Use flexible ranking logic for:

- Outfit selection
- Optional travel gear
- Reuse and variety
- Near-match suggestions

Critical packing must never depend solely on fuzzy text interpretation.

## 6. Quantity-rule types

V1 should support a small practical set:

- Fixed per trip
- Per trip day
- Per trip night
- Per activity occurrence
- One per outfit group
- Minimum quantity
- Maximum quantity
- Add a spare
- Trip duration plus buffer
- Conditional inclusion
- Dependency inclusion

Examples:

- Underwear: **2 per inclusive calendar trip day**
- Contacts: **2 per inclusive calendar trip day**

> **Trip days are counted inclusively; nights are counted exclusively.**
> 31 July → 11 August is **12 trip days** and **11 nights**.
> So both underwear and contacts come to **12 × 2 = 24**.
>
> This is the approved rule and it supersedes the `Nights × 2` text in the source
> spreadsheet, which would give 22. Doc 03 §9's own worked examples — "Underwear:
> 14 of 24 packed" and "Contacts: 20 of 24 packed" — corroborate the calendar-day
> reading. The two counts are quietly easy to confuse and the difference is two
> pairs, so both are computed once as structured trip facts and never re-derived
> ad hoc.
- Synthroid: trip days + 2-day buffer
- Swim trunks: minimum 2 when swimming is present
- Shaver: include for trips longer than 2–3 nights
- Shaver charger: include only when shaver is included
- Passport: include for international trips
- Neck pillow: include for flights longer than 5 hours

## 7. Trip edits versus permanent preferences

Every change made while reviewing a trip defaults to **this trip only**.

After a meaningful change, the app may offer:

> Update your usual preference?

Examples:

- Quantity changed
- Favorite item consistently replaced
- Packing timing changed
- Item removed from multiple similar trips

Never silently alter permanent preferences from one trip edit.

## 8. Packing timing model

Packing timing and final verification are separate concepts.

### Packing timing

- Pack anytime
- Night before
- Day of departure
- Last-minute

### Final verification

A limited set of critical items may require reconfirmation before leaving, even if packed earlier.

Examples:

- Passport
- Wallet
- Phone
- Medication
- Keys
- Glasses or contacts

Do not require double verification for ordinary items.

## 9. Partial quantities

Support partial packing progress only where it adds value.

Examples:

- Underwear: 14 of 24 packed
- Contacts: 20 of 24 packed
- Medication doses
- Multiple shirts

A normal tap may mark the full quantity packed. Detailed progress can be edited from the row.

## 10. Not Bringing

Removing an item should usually move it to **Not Bringing**, not erase all evidence that it was considered.

Benefits:

- Easy restore
- Clear intentional exclusions
- Better outfit synchronization
- Future learning opportunities

Use undo after removal rather than a blocking confirmation dialog, except for critical items.

## 11. Critical-item removal

Removing a critical item should prompt a gentle warning.

Example:

> Passport is required for this international trip.

Actions:

- Keep it
- Remove anyway

The user remains in control.

## 12. Explanation rules

Do not explain every obvious item.

Explain when:

- A recommendation is unusual
- A less-favored item beats a favorite due to weather or activity
- A dependency adds another item
- A critical item is required
- A quantity is meaningfully calculated
- An item is excluded despite usually being packed

Keep explanations to one concise line.
