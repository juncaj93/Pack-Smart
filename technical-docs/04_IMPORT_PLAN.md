# Pack Smart — Spreadsheet Import Plan

Status: **Approved.** Implemented in Milestone 1.

## 0. Workbook states — keep these distinct

| | Clothing rows | Meaning |
|---|---|---|
| Original workbook | 85 rows → **13 distinct** | `Master_Packing_Database_Updated(1).xlsx`. Unusable: a 4-row block repeated 19×, tops and outerwear only. |
| Uploaded corrected workbook | **81** | What Alex supplied. Zero duplicates, full category coverage. |
| **Final approved seed workbook** | **85** | 81 + 4 restored jackets. **This is what the app imports.** All acceptance criteria are stated against 85. |

> ### ⚠ Pending action before Milestone 1
> The final 85-garment workbook has **not yet been created**. Alex deferred it. Before M1 begins:
> 1. Create `seed-data/Master_Packing_Database_Complete.xlsx` = the uploaded 81-row workbook plus
>    the 4 restored jackets in §2, appended to the `Tops & Outerwear / Outerwear` block.
> 2. Delete `seed-data/Master_Packing_Database_Updated(1).xlsx`.
> 3. Update the filename references in `product-docs/README.md` line 31 and
>    `product-docs/05_INVENTORY_AND_DATABASE_IMPORT.md` line 13.
> 4. Apply the deferred product-doc edits listed in `05_MILESTONE_PLAN.md` §0.

## 1. Sheets

| Sheet | Structure |
|---|---|
| `Clothing Inventory` | Rows 1–2 title, row 3 blank, **row 4 header**, then data rows |
| `Non-Clothing & Rules` | Rows 1–2 title, row 4 section header, **row 5 header**, rows 6–38 = 33 items; row 39 blank, row 40 section header, row 41 header, rows 42–48 = 7 conditional triggers (column C empty) |

No merged cells, no formulas, no hidden rows. But **two logical tables are stacked in the second
sheet**, so the parser must work by section rather than assuming one header row.

The `Non-Clothing & Rules` sheet is **byte-identical** between the original and corrected workbooks,
so every rule defect below still applies.

## 2. The four restored jackets

Restored verbatim from the original workbook. Provenance recorded here so the seed data is traceable
rather than quietly edited.

| Major Category | Subcategory | Item Description | Brand | Color | Style / Use Case | Notes / Versatility |
|---|---|---|---|---|---|---|
| Tops & Outerwear | Outerwear | Jacket | Arc'teryx | Black | Travel / Casual | Versatile lightweight black jacket |
| Tops & Outerwear | Outerwear | Parka Jacket | The North Face | Black | Cold Weather | Warm black parka for very cold weather |
| Tops & Outerwear | Outerwear | Jacket | Vuori | Black | Travel / Casual | Comfortable casual black jacket |
| Tops & Outerwear | Outerwear | Quilted Jacket | The North Face | Olive | Casual / Cool Weather | Quilted olive jacket; versatile cool-weather layer |

These also restore doc 04 §5's worked example ("olive quilted jacket selected instead of the usual
zip-up because the event is colder and outdoors"), which was unbuildable without them.

## 3. Final workbook coverage

| Major category | Subcategories | Rows |
|---|---|---|
| Tops & Outerwear | Outerwear 16, Mid-Layer 11, T-Shirt 12, Shirt 5, Tank Top 4 | 48 |
| Bottoms & Swimwear | Pants 9, Shorts 6, Swimwear 5 | 20 |
| Footwear | Shoes 6, Sandals 2 | 8 |
| Accessories & Undergarments | Accessories 4, Underwear 3, Basics 2 | 9 |
| | | **85** |

**Remaining coverage gap: no rain layer.** No row in the final workbook mentions rain,
waterproofing, a shell, or Gore-Tex — verified across all 85. Heavy outerwear is now present. The
gap is **reported in the import summary**, not guessed around. See `03_INTELLIGENCE_DESIGN.md` §12.

## 4. Field mappings

| Source | Target |
|---|---|
| `Item Description` + `Brand` + `Color / Pattern` | `display_name` |
| `Major Category` / `Subcategory` | `category` / `subcategory` |
| `Brand` | `brand` (`Unbranded` → `NULL`) |
| `Color / Pattern` | `color` + `pattern` (split on `/`, `&`) |
| `Style / Use Case` | `typical_uses[]` + `dressiness` hint |
| `Notes / Versatility` | `notes` + `warmth` / `reuse` hints |
| `Category` (non-clothing) | `category` (`Toiletries / Gear` → primary + secondary) |
| `Default Priority / Quantity Rule` | **split into three:** `is_critical`, `packing_rule`, `condition_json` |
| Trigger rows | `packing_rule` rows with `condition_json` |
| Every source row, verbatim | `item.source_row_json` + `import_row.raw_json` |

## 5. Normalization

General: whitespace and case; `Unbranded` → null; compound colors (`Green / White`, `Black & Gray`)
→ color + pattern; compound categories (`Toiletries / Gear`); free-text use cases → tag vocabulary;
criticality vocabulary — inconsistent across five phrasings (*Critical (Always), Almost always,
Usually, Frequently, Always*) — → an ordered enum with the original string preserved.

Specific to the clothing sheet:

- **Quantities embedded in descriptions.** `Socks (Multiple Pairs)`, `Boxer Briefs (~15 Pairs)`,
  `Compression Shorts (4 Pairs)` → clean `display_name` + `owned_quantity` (15 and 4; "Multiple" is
  unknown → review).
- **`Unspecified` colors** on 4 rows → `NULL`, never the literal string, so no display name reads
  "Unspecified Slides".
- **Non-brands in the Brand column** — `Michigan State`, `Detroit Tigers`, `France Nat'l Team`,
  `Big Sky`, `Saugatuck`. Harmless as data, but the display-name composer must not assume
  `{Color} {Brand} {Description}` always reads well; fall back to description + color.

## 6. Defaults for missing fields

- **Clothing:** warmth, dressiness, weather suitability, favorite, usage frequency, reuse capacity,
  active status — derived from category and `Style / Use Case` keywords. Every derived value is
  flagged `derived` so the review screen shows it as an assumption, not source data.
- **Non-clothing:** packing timing (default `anytime`; `last_minute` for phone/wallet/keys),
  final-verification flag (default true for doc 03 §8's critical set), quantity for "Always" items
  (default 1), dependency direction.

## 7. Known source defects and their approved resolutions

| Defect | Resolution |
|---|---|
| Shaver: item row says "> 2-3 nights", trigger says "> 3 Nights", another says 1–2 skip — **3 nights undefined** | **`nights ≥ 3`.** Both source strings preserved. Also more consistent with the source, whose only exclusion row is "1–2 nights: skip" |
| Contacts: sheet says `Nights × 2`; doc 01 §4 says per day | **Calendar trip days × 2**, inclusive. Approved decision outranks the sheet. `Nights × 2` preserved in import history |
| Toothbrush Charger conditioned on "electric toothbrush trips" but no electric/manual distinction exists | Modeled as `dependency_include` on the toothbrush. Ambiguous string goes to review, not rewritten |
| Shaver Charger | `dependency_include` on the shaver |
| "Snacks" triggered by the Driving/Road Trip rule but absent from inventory | Imported as a new gear item so the trigger is not dangling |
| Bug Spray has dual category `Toiletries / Gear` | Primary + secondary category |
| "Medicine Wheel" is an ambiguous display name | Surfaced in review |

Any row whose rule text does not parse cleanly **imports the item** but flags the **rule** as
`needs_rule_review`. The item is never dropped and the rule is never invented.

## 8. Duplicate detection — three tiers, color as discriminator

1. **Exact match** — hash of the normalized full row tuple → auto-merge. *(0 hits on the final file.)*
2. **Identity match** — hash of `normalize(description) + brand + color` → auto-merge. *(0 hits;
   tiers 1 and 2 both yield 85, a useful cross-check.)*
3. **Near match** — same description and brand, escalated to human review **only when** a color is
   absent or a placeholder, the colors are identical, or **one color string contains the other**.
   Distinct meaningful colors are auto-accepted as distinct garments.

Tier 3's color rule is the important refinement. **Re-run against the final 85-garment workbook**
(not carried over from the 81-row analysis), it yields exactly **three review cards** — unchanged,
because each restored jacket forms a unique description+brand group and collides with nothing. A
trigram sweep at Dice ≥ 0.85 across all same-brand pairs adds **zero** further candidates.

| Item | Colors | Why ambiguous |
|---|---|---|
| Columbia Zip-Up Jacket | `Black` vs `Black & Gray` | Containment |
| Nordstrom Layering T-Shirt | `Heather Gray` vs `Gray` | Containment |
| Brooks Running Shoes | `White` vs `Black & White` | Containment |

A naive same-description-and-brand rule would flag 13 groups covering ~30 rows. The color
discriminator auto-resolves **14 pairs** as distinct and leaves only these 3.

**Acceptance number: exactly 3 review cards from an 85-row import.**

## 9. Preview and review flow

`Upload → parse client-side → POST dry-run → summary → review queue → Commit`.

**Nothing is written until Alex taps Commit.** For the final workbook the summary reads: **85
clothing items, 0 duplicates, 33 gear items, 7 trigger rules, 3 near-matches to confirm**, plus the
rule defects in §7 and the rain-layer gap. The review queue resolves one card at a time on a phone.
The whole run is reversible because the pre-import state is a D1 Time Travel point.

## 10. Validation rules

Non-empty description required. Unrecognized categories land in an `Uncategorized` review bucket
rather than being guessed. Fully blank rows are skipped and counted. The header signature is verified
before parsing, so a changed sheet layout fails loudly rather than silently mismapping columns.

## 11. Safe re-import

`file_hash` plus per-row `identity_hash` make re-import idempotent. A second run matches existing
items by identity hash and defaults to **no change**, showing field-level diffs where the source
actually changed and asking before overwriting anything Alex has since edited in the app.

Items present in the database but absent from a newer file are **never deleted** — the app offers to
archive them.

Every run is recorded in `import_run` / `import_row`, so any import can be explained after the fact.
