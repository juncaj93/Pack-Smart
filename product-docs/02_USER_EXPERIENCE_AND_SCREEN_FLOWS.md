# Pack Smart — User Experience & Screen Flows

## 1. Platform priority

Pack Smart is an **iPhone product delivered through the web**.

Priority order:

1. iPhone Safari
2. Added-to-Home-Screen experience
3. Basic desktop usability for occasional management
4. Other platforms later

Every screen must be comfortable to operate with one hand while standing beside an open suitcase.

## 2. iPhone interaction principles

- Thumb-friendly controls
- Large tap targets
- Bottom navigation
- Bottom sheets for quick editing
- Native-feeling controls
- No hover dependence
- No tiny icons
- No dense tables
- No horizontal scrolling
- Minimal typing
- Immediate feedback
- Undo instead of unnecessary confirmation dialogs
- Swipe gestures may be shortcuts but never the only available action
- Respect iPhone safe areas and the Home indicator

## 3. Primary navigation

Use four bottom-navigation destinations:

- **Home**
- **Trips**
- **My Stuff**
- **Settings**

Do not expose Clothing and Non-Clothing as separate top-level navigation destinations.

## 4. Home

The home screen should prioritize the current or next trip.

### When a trip is being packed

Show:

- Trip name
- Dates or departure countdown
- Packing progress
- Primary action: **Continue Packing**

Then show:

- Upcoming trips
- New Trip
- Recent trips

### During an active trip

The primary card changes to:

- Today's location
- Next event
- Primary action: **See Today's Outfit**

Avoid dashboard clutter and speculative suggestion feeds.

## 5. New Trip flow

The setup should feel conversational but must not depend on a paid AI API.

### Step 1 — Where and when?

Collect:

- Destination or destinations
- Departure date
- Return date

Infer where possible:

- Trip duration
- Domestic or international
- Season
- Time zone
- Likely transportation

### Step 2 — What are you doing?

Show relevant activity chips and a free-text notes field.

Examples:

- Safari
- Winery
- Nice dinners
- Sightseeing
- Swimming
- Hiking
- Gym
- Business
- Wedding
- Beach

The user may type naturally, such as:

> Several safari drives, two winery days, a few nice dinners, and normal sightseeing. Bring all planned shoes, at least two swimsuits, and enough pants. Laundry probably will not be available.

### Step 3 — Add itinerary

V1 priority inputs:

- Paste plain text
- Upload PDF
- Upload screenshot or image

Avoid requiring itinerary import. The trip should still work without it.

### Step 4 — Here is what Pack Smart understood

Show a concise editable summary:

- Destinations
- Duration
- Activities
- Dinner formality
- Laundry status
- Luggage status
- Personal packing preferences detected from notes

Separate:

- **Understood**
- **Please confirm**

Do not use a fabricated confidence percentage.

### Step 5 — Only unresolved questions

Ask only questions that materially affect recommendations, commonly:

- Carry-on only or checked bag?
- Laundry available?
- Dressiest event level?
- Any equipment rented rather than packed?

### Step 6 — Review outfits

Show outfit groups by event or activity rather than a rigid daily calendar by default.

Examples:

- Flight
- Safari mornings
- Cape Town sightseeing
- Winery and nice dinners
- Pool and downtime

### Step 7 — One Last Look

Before packing begins, show:

1. Favorites not included
2. Relevant near-match items
3. Search or browse remaining closet

Allow **Add** or **Swap**.

### Step 8 — Start packing

Open the interactive packing checklist.

## 6. Active Trip structure

Use three views within a trip:

- **Pack**
- **Outfits**
- **Trip**

Before departure, default to **Pack**.

During the trip, default to **Today** or the During Trip experience while keeping Pack and Trip accessible.

## 7. Packing checklist

The default checklist should be clean and scan-friendly.

### Sections

- Pack Now
- Pack Later
- Final Check
- Not Bringing

### Row content

A typical row contains:

- Checkbox or completion control
- Item name
- Quantity when relevant
- Optional one-line reason only when useful

Example:

> Black Arc'teryx Zip-Up · 1  
> Flight + cool safari mornings

### Row interactions

- Tap completion control: mark packed
- Tap row: open edit bottom sheet
- Swipe: optional shortcut for Pack Later or Remove

### Bottom-sheet actions

- Change quantity
- Change packed quantity
- Change packing timing
- View recommendation reason
- Move category
- Remove from this trip
- Update permanent preference when explicitly chosen

## 8. Add Item behavior

From any trip checklist:

- Add only to this trip
- Add to My Stuff for future trips

Default to **this trip only** to avoid accidental permanent clutter.

## 9. One Last Look behavior

This screen should reduce omissions without encouraging indiscriminate overpacking.

Lead with:

- Favorites excluded
- Items close to qualifying
- Commonly used items not selected

Place the full remaining closet behind search or category filters.

When adding a similar item, ask:

- Replace an existing item
- Add as an extra

Do not call this screen “Final Check,” because Final Check is reserved for departure essentials.

## 10. My Stuff

Use one unified management area with categories such as:

- Clothing
- Toiletries
- Electronics
- Medication
- Documents
- Travel Gear

### Clothing list

No photos are required.

A row may show:

- Category emoji
- Item name
- Brand or color when useful
- Favorite status
- Usage frequency

Example:

> 🧥 Black Arc'teryx Zip-Up  
> Favorite · Frequently used

### Add Clothing

Required fields:

- Item name
- Category
- Color
- Typical use

Optional details under progressive disclosure:

- Brand
- Warmth
- Dressiness
- Weather suitability
- Favorite
- Frequency preference
- Notes

Saving should not require all optional data.

### Archive behavior

Archive rather than delete by default.

Archived items remain attached to historical trips but do not appear in future recommendations.

## 11. Empty, loading, and error states

Every state should provide one obvious next action.

Examples:

- No trips: **Create Your First Trip**
- No matching clothing: **Add an Item I Own**
- Itinerary could not be read: **Paste Trip Details Instead**
- No outfit available: show the missing requirement rather than inventing an item
