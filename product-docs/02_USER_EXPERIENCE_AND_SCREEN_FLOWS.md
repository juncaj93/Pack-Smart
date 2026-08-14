# Pack Smart — User Experience & Screen Flows

## 1. Platform priority

Pack Smart is an **iPhone product delivered through the web**.

Priority order:

1. **iPhone Safari — the primary experience.** Pack Smart must look and behave like a polished
   website when opened in the browser, because that is where it is normally used.
2. Added-to-Home-Screen experience — secondary, and **sharing the same layout**. Where the two
   could differ, prefer one design that works in both over two navigation systems to maintain.
3. Basic desktop usability for occasional management
4. Other platforms later

Being "app-like" is a description of how it should *feel* — calm, fast, one obvious action — not a
licence to imitate app chrome. Where imitating a native app fights the browser, the browser wins.

Every screen must be comfortable to operate with one hand while standing beside an open suitcase.

## 2. iPhone interaction principles

- Thumb-friendly controls
- Large tap targets
- **Top navigation** (see §3)
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

### The page scrolls; the app does not sit in a fixed frame

Pack Smart scrolls **the document**, like any website — not an inner region inside a full-height
shell. This is not a technical detail:

- Safari collapses its toolbar as you scroll a page and restores it when you scroll up. That only
  happens if the page itself scrolls. A fixed-height shell with an inner scroll region keeps
  Safari's toolbar permanently at full size, which is the single biggest thing that makes a web app
  read as a cheap imitation of a native one.
- Short pages must end naturally, with ordinary page padding — **no artificial band of background
  colour** propping up the bottom of the screen.

### Nothing custom is fixed to the bottom of the screen

**Safari's toolbar is the only persistent control at the bottom.** Pack Smart adds no bar of its
own there, and reserves no space for one.

Transient elements — an Undo toast, an open bottom sheet — may still appear near the bottom. They
are momentary, not chrome, and they do not compete for the same strip permanently.

## 3. Primary navigation

Use **one compact floating toolbar at the bottom of the screen**, with four destinations and a
centre action:

- **Home**
- **Trips**
- **Add** (the centre control)
- **My Stuff**
- **Settings**

Do not expose Clothing and Non-Clothing as separate top-level navigation destinations.

### Why the bottom, and why this supersedes the previous rule

**This section previously required navigation at the top and forbade a bottom bar.** That rule was
written against a full-width fixed tab bar, which in Safari sits directly on top of Safari's own
bottom toolbar — two navigation bars stacked on one edge, reading as an app fighting the browser
(`09_IMPLEMENTATION_NOTES.md` §12 records the three rounds spent optimising it before it was removed).

The objection was to the **shape**, not to the position. A bar that spans the full width and sits
flush against the bottom edge *is* browser chrome, and loses that argument. A bar that floats — with
a margin on all four sides and a radius of its own — reads as a control on the page, and does not
compete with Safari's toolbar for the same edge. That is what is required here.

The reason to move is reachability: the top of an iPhone screen is the hardest place to reach
one-handed, and primary navigation is the thing reached for most. **It is not a density win** — see
the measured cost below.

Requirements:

- A **floating** bar with side margins. Never edge-to-edge and never flush with the bottom.
- **Minimum 44pt tap target** for every destination and for the centre action.
- The active section is **obvious**, and stated in more than colour.
- Calm, minimal, and visibly one control. Around 56pt tall. **It must not become a dock**: no large
  pills behind each tab, no oversized centre button, no heavy shadow, no badges or counts.
- It must **never cover content**. One shared bottom inset, applied once, clears it on every screen.
- It must clear `env(safe-area-inset-bottom)` rather than capping it. Trimming that inset to buy
  pixels puts targets inside the system's swipe-up gesture region, and was explicitly abandoned.
- Present on every screen, except guided flows that carry their own named exit.

**What the move cost, measured at 390×664.** Content begins **57px higher** on every screen. The bar
occupies 64px of the viewport permanently against the 44px the old sticky row took, so the band of
never-obscured content is a **wash — about 7px narrower**. The gain is reachability and a screen that
starts higher; anyone revisiting this should not expect it to have bought vertical space.

The **same** navigation is used in Safari and in the Home Screen app. Two navigation systems for one
product is a maintenance cost with no user benefit, and it guarantees the secondary one rots.

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

#### More than one place

A trip may have several stops, each with its own arrive and leave dates.

- The **first stop stays a plain text field.** One destination is nearly every trip and must not
  get harder to enter.
- Extra stops are behind a disclosure, and only they ask for dates — with a single destination
  there is nothing to disambiguate.
- Dates are what buy a per-day forecast. Without them Pack Smart **will not guess** which city
  Alex is in on a given day; it says so and plans that day without weather rather than using the
  wrong city's forecast.

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

Accepted input:

- **Paste plain text**
- **Paste a link** — Pack Smart fetches the page and reads its text
- **Upload a PDF** — a text-based PDF; a scanned or photographed one is images,
  not text, and must be refused rather than guessed at

All three produce the same thing: **plain text fed to exactly the same
interpreter.** There is one set of detection rules, not three. A format that
cannot be turned into text is a failed extraction, and the screen says so and
offers the paste box — it never falls back to a partial or invented reading.

Screenshot and image upload, and email extraction, remain out of scope. They
need optical character recognition, which is a different problem from reading
text.

Avoid requiring itinerary import at all. The trip should still work without it.

#### What the itinerary is allowed to do

An itinerary is **evidence, never a decision.** Detected values are proposed for
confirmation and applied only once accepted, in line with §3 "Infer, then
confirm" of doc 01 and the certainty rules in doc 03 §3.

It should propose:

- Trip dates
- Destinations
- Activities
- **Which activity falls on which date**, where the itinerary is dated

The last of these is the point. A dated itinerary is the one input that knows a
safari runs on four days rather than one, and that is what turns one safari
outfit into four. Undated mentions still propose the activity, without a day.

Every proposal must quote the words it came from. A proposal Alex cannot trace
to a line of his own itinerary is not reviewable, and an unreviewable proposal
is a guess wearing a confirmation dialog.

#### Honest limits, stated on the screen

- A link behind a login returns the login page, not the itinerary. Airline and
  hotel confirmation links are usually of this kind. When the fetched text
  yields nothing, say the page could not be read and offer the paste box.
- A scanned PDF contains no text to extract. Say so; do not return an empty
  reading as though the itinerary were blank.

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

## 9c. Silent omissions — the one failure that must not be quiet

Pack Smart prevents forgetting to **pack** an essential. It must also prevent forgetting to **plan**
one.

The checklist only contains items that a rule put there. So an item Alex owns but that carries no
rule never appears on any list, and the app looks complete and confident while a charger sits at
home. "Still not packed" cannot help — it only reports rows that already exist.

Every trip therefore reports **what it knows it is not covering**, in plain words.

### What is reported, and what is not

**Reported — an essential that can never appear.** Anything Alex has marked critical that no rule
will ever place on a list. This uses his own marking and his own item name, so it is a statement of
fact:

> Your Passport is marked essential but no rule will ever add it to a list.

**Reported — a universal essential that is missing entirely.** A very short list of things every trip
needs regardless of taste:

| Essential | When |
|---|---|
| A phone charger | Every trip |
| A passport | International trips only |

**Not reported — a personal essential that is absent.** Pack Smart must never say "you have no
medication". Owning none may be exactly right, and a warning about a thing Alex does not need is how
a useful alert becomes noise he learns to dismiss. Medication, glasses and the like are only reported
when he **has** them and no rule will ever place them.

That asymmetry is the whole design. The universal list stays tiny for the same reason.

### How it behaves

- **It names Alex's own items**, never a generic category, and never invents an item he might want.
- **It offers the fix, and does not perform it.** Adding a rule or an item is his action.
- **It is quiet.** One short line, in the same place as "Still not packed" — not a banner, not a
  modal, not a blocking step before packing.
- **When nothing is missing it says nothing at all.** A permanent reassurance panel is clutter.

## 9a. Trip identity

Every trip carries **one emoji**, and it is part of how the trip is recognised
rather than decoration.

- Shown wherever the trip is identified: the trip card, the trip-detail header,
  Home / Next Trip, and trip history.
- **One emoji per trip.** Not a row of icons — competing glyphs are noise, and
  the point is instant recognition in a list.
- Suggested automatically from the destination and the activities.
- **Always overridable** while creating or editing the trip.
- Stored with the trip, so it never changes on its own. A trip Alex recognises
  by its icon must still look like that trip after an edit.
- Falls back to ✈️ when nothing stronger matches. A weak match is worse than the
  neutral one — a wrong-but-specific icon is a claim about the trip.

Presentation is quiet and Apple-like: the emoji sits beside the trip name at
text size, not as a large graphic, and never replaces the name.

Indicative suggestions:

| Signal | Emoji |
|---|---|
| safari, game drive | 🦁 |
| beach | 🏖️ |
| ski, snowboard | ⛷️ |
| city sightseeing | 🏙️ |
| camping | 🏕️ |
| cruise | 🚢 |
| wedding | 💍 |
| hiking | 🥾 |
| winery | 🍷 |
| business | 💼 |
| nothing stronger | ✈️ |

## 9b. Trip history and reuse

A trip leaves the active list **automatically, on its end date**. It is never deleted: a finished
trip is the record of what Alex actually took, which is the only thing that makes the next one
better.

Its status follows the dates rather than whatever was last written to it. A trip that ended last
month must not sit under "Past trips" wearing a "Planning" label.

### Plan again

Every past trip carries one compact **Plan again**. It opens the normal trip sheet with last
time's answers already in it, and **creates nothing until Alex saves** — the same propose-then-
confirm shape as the itinerary importer, so he can tap it, change his mind, and leave nothing
behind.

**Carried across** — everything that describes the shape of a trip:

- Destinations, and the trip's icon
- Activities, and which day of the trip each fell on, as **offsets** rather than dates
- Notes, luggage mode, laundry, formality, flight hours, international status

**Never carried across** — everything that is a record of a trip that happened:

- Packed and checklist state
- Wear history and daily plans
- Outfits
- The old forecast

The new trip generates its own packing list and outfits against **today's** wardrobe and its
**new** dates, and fetches fresh weather. Carrying the record across would show Alex a trip
already half packed, for a week that is over.

**The dates are deliberately left empty.** Everything else is worth reusing; the dates are the one
thing that is certainly wrong, and prefilling last year's would invite saving a trip in the past.

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

### The Add control

Adding is the primary action of this screen, and it belongs in the header.

- A compact **“+”** button — circular or rounded square — beside the **My Stuff**
  heading, at the top right.
- Visible without scrolling, always. My Stuff holds well over a hundred rows;
  an Add at the end of the list is an Add that cannot be found, which is exactly
  what happened.
- **It must not take a full-width row or any vertical space of its own.** The
  list is what the screen is for.
- Minimum **44×44pt tap target** even where the drawn glyph is smaller.
- Carries an accessible label — “Add item” — because a bare “+” names nothing.
- Opens the existing add-item flow. There is one way to add an item.
- **No second large Add button lower on the page.** One primary action, in one
  place.

An empty wardrobe is the exception: an empty state may carry its own action,
because there is no list for the header control to sit above.

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
