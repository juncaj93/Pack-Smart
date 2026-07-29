# Pack Smart — Inventory, Closet & Database Import

## 1. Source-of-truth principle

The Master Packing Database is used to seed Pack Smart.

After launch, the website must support creating, editing, archiving, restoring, and organizing all clothing and non-clothing items. Routine use must not require spreadsheet editing.

## 2. Initial workbook

Expected workbook:

`Master_Packing_Database_Complete.xlsx` — 85 garments, 33 gear items, 7 trigger
rules.

The earlier `Master_Packing_Database_Updated(1).xlsx` is superseded and must not
be imported. It held 85 clothing rows but only 13 distinct garments, all tops and
outerwear, because a four-row block repeated nineteen times.

Expected sheets:

- `Clothing Inventory`
- `Non-Clothing & Rules`

## 3. Observed source fields

### Clothing Inventory

- Major Category
- Subcategory
- Item Description
- Brand
- Color / Pattern
- Style / Use Case
- Notes / Versatility

### Non-Clothing & Rules

- Item
- Category
- Default Priority / Quantity Rule
- Conditional trip triggers

Examples in the current source include:

- Synthroid: trip days + 2-day buffer
- Contacts: 2 per **inclusive calendar trip day** — the approved rule, which
  supersedes the `Nights × 2` text in the source sheet. The original string is
  preserved in import history. See doc 03 §6.
- Passport: international trips
- Shaver: trips longer than 2–3 nights
- Shaver charger: only when shaver is brought
- Neck pillow and compression socks: long flights
- Binoculars: safari
- Bug spray and hiking gear: outdoor or hiking trips

## 4. Import must not be blind

The source workbook contains repeated clothing rows, particularly repeated quarter-zip entries. The import process must not automatically treat every repeated row as a separate physical garment.

Required import safeguards:

- Normalize whitespace and capitalization
- Detect exact duplicate rows
- Detect likely duplicates using item description + brand + color
- Present ambiguous duplicates for confirmation
- Preserve genuinely distinct items with similar names
- Produce an import summary

Example summary:

- 28 unique clothing items imported
- 44 likely duplicate rows ignored
- 3 items need review

Do not silently discard ambiguous data.

## 5. Clothing data model — product requirements

V1 clothing records should support:

### Required

- Display name
- Category
- Color
- Typical uses
- Active or archived status

### Recommended

- Brand
- Warmth
- Dressiness
- Weather suitability
- Favorite
- Usage frequency
- Notes

### System-maintained where available

- Times packed
- Times selected for outfits
- Times marked worn
- Last packed

No photo field is required for the product experience.

## 6. Non-clothing data model — product requirements

V1 non-clothing records should support:

- Display name
- Category
- Criticality
- Quantity rule
- Trip triggers
- Dependency rules
- Packing timing
- Final-verification requirement
- Always include / never include
- Active or archived status
- Notes

## 7. Unified My Stuff experience

My Stuff contains:

- Clothing
- Toiletries
- Electronics
- Medication
- Documents
- Travel Gear

Use category-specific fields without exposing the underlying database complexity.

## 8. Add Clothing flow

Required input:

- Name
- Category
- Color
- Typical use

Optional under **More details**:

- Brand
- Warmth
- Dressiness
- Weather suitability
- Favorite
- Usage frequency
- Notes

Use category defaults to reduce typing.

Examples:

- Jacket: reusable layer, likely quantity 1–2
- Swim trunks: swimming/beach relevance, reusable
- Button-down: smart casual, winery, dinner, business

## 9. Favorite and usage frequency

These must be editable independently.

Favorite:

- Yes / No

Usage frequency:

- Frequent
- Sometimes
- Rare
- New / unknown

The system may later calculate actual usage, but v1 must support a manual starting value.

## 10. Add from a trip

When adding an item during trip review or packing:

- Add only to this trip
- Add to My Stuff for future trips

Trip-only items should remain attached to the trip but not automatically pollute the permanent inventory.

## 11. Archive and history

Use archive rather than permanent deletion for normal item retirement.

Archived items:

- Do not appear in new recommendations
- Remain visible in historical trips
- Can be restored

## 12. Import mapping recommendations

Map existing spreadsheet fields as follows:

- `Item Description` + relevant brand/color → human-readable display name
- `Major Category` / `Subcategory` → normalized category
- `Brand` → brand
- `Color / Pattern` → color and optional pattern note
- `Style / Use Case` → typical uses and dressiness hints
- `Notes / Versatility` → notes, warmth, or versatility hints
- `Default Priority / Quantity Rule` → criticality and quantity logic
- Conditional trigger rows → trip-trigger rules

Do not force every spreadsheet phrase into a user-visible field. Preserve original import text for traceability where useful.

## 13. Export and backup

The site should eventually support exporting its current data in a portable format. This is not required to block v1 launch, but the Technical Lead should avoid choices that make user-owned data difficult to export later.
