# Pack Smart — V1 Acceptance Criteria, Non-Goals & Roadmap

## 1. V1 acceptance criteria

### Smart trip setup

- Alex can create a trip on iPhone Safari.
- The flow collects destination and dates with minimal typing.
- Alex can select activities and enter natural trip notes.
- The system recognizes the agreed high-value travel phrases.
- Explicit statements are applied automatically.
- Uncertain statements are shown for confirmation.
- Only unresolved questions that materially affect packing are asked.
- Alex can correct every interpreted detail before recommendations are generated.

### Inventory import

- The provided workbook can seed clothing and non-clothing records.
- Exact duplicate rows are detected.
- Likely duplicate garments are not blindly imported as separate items.
- Existing quantity and trigger rules are preserved or mapped for review.
- An import summary identifies imported, skipped, and ambiguous records.

### Self-sufficient management

- Alex can add clothing without a photo.
- Alex can edit clothing and non-clothing items through the site.
- Alex can set favorites and usage frequency independently.
- Alex can archive and restore items.
- Alex can add an item permanently or for one trip only.
- Routine operation requires no spreadsheet editing.

### Outfit planning

- The system creates activity-appropriate outfit groups from owned clothing.
- Favorites and usage frequency influence ranking without overriding suitability.
- Clothing reuse is considered by category.
- Alex can swap outfit items.
- The approved outfit plan generates the clothing checklist.
- Outfit and checklist changes remain synchronized.
- The system never invents clothing Alex does not own.

### One Last Look

- Alex can review excluded favorites and relevant alternatives.
- Alex can browse or search remaining items.
- Similar additions offer Add or Swap.
- The review does not lead with an overwhelming complete closet list.

### Packing checklist

- The checklist is interactive on iPhone Safari.
- Alex can add, remove, edit, restore, and change quantities.
- The list supports Pack Now, Pack Later, Final Check, and Not Bringing.
- Partial quantities are available where useful.
- Critical-item removal produces a warning without removing user control.
- Trip edits do not silently overwrite permanent preferences.
- Checklist progress persists when the app is closed and reopened.

### During Trip

- The trip experience shifts to Today when the trip begins.
- Recommendations use only confirmed packed items.
- Event-level outfit and bring-with-you guidance is shown.
- The approved planned outfit is the default basis.
- Weather changes cause small adjustments rather than full unexplained regeneration.
- Alex can mark an outfit worn, swap it, or report temperature mismatch.

### iPhone experience

- No core action depends on hover.
- No core screen requires horizontal scrolling.
- Common controls are thumb-friendly.
- Item editing uses a mobile-appropriate overlay or bottom sheet.
- The active trip is quickly accessible from Home.
- The experience remains usable when added to the iPhone Home Screen.

## 2. V1 non-goals

Do not build these in v1:

- Paid AI API dependency
- Generalized public signup product
- Multi-user or shared trips
- Partner duplicate coordination
- Visual rule builder
- Complex machine-learning claims
- Clothing photos or image recognition
- Shopping recommendations
- Affiliate links
- Luggage weight and volume optimization
- Apple Watch application
- Apple Wallet integration
- Full travel itinerary replacement
- Airline baggage-rule automation
- Voice assistant
- Social features
- Trip photo gallery
- Global search across a tiny initial dataset
- Advanced desktop dashboard
- Native iOS app

## 3. Explicit design non-goals

Avoid:

- Excessive glass effects
- Decorative animations that slow routine actions
- Giant headings that reduce usable space
- Multiple badges on every row
- Visible database fields everywhere
- Dense management screens as the default experience
- Confirmation dialogs for reversible ordinary actions
- Fake confidence scores

## 4. V1.1 roadmap

Potential v1.1 additions:

- Post-trip review
- Forgot-anything feedback
- Packed-but-unused feedback
- Favorite outfit feedback
- Explicit saved preference improvements
- Weather re-check before departure
- More useful usage-history signals
- Better similar-trip reuse
- Itinerary import beyond pasted text: PDF, screenshot or image, URL, and email
  extraction (v1 accepts plain-text paste only — see doc 02 §5 Step 3)

## 5. Later roadmap

Potential later features, only after core use is validated:

- Shared trips
- Partner packing coordination
- Calendar integration
- Airline baggage allowance awareness
- Offline mode improvements
- Packing reminders based on departure time
- Pack Now room-by-room guidance
- Data export and backup UI
- Outfit preview calendar
- Voice questions during travel

## 6. Scope-control test

Before adding any feature, ask:

1. Does it reduce a recurring packing or outfit decision?
2. Will Alex use it on most trips?
3. Can the same value be delivered more simply?
4. Does it add maintenance burden?
5. Does it make the iPhone experience calmer or more cluttered?

Cut or defer features that do not clearly pass this test.
