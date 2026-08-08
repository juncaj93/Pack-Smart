-- Wardrobe names that repeat their own fields (G6).
--
-- Raised by Alex and scoped in `product-docs/09…§6a`:
--
--   title  `Various Colors Pair of Thieves Boxer Briefs`
--   brand  `Pair of Thieves`
--   colour `Various Colors`
--
-- Three fields, two of them saying the same words twice. It is not a naming
-- accident: `composeDisplayName` in `shared/import.ts` built every clothing
-- name as `[colour] [brand] [description]`, and the workbook's description
-- column was already the clean answer. Measured across the 85 garment rows in
-- `seed-data/Master_Packing_Database_Complete.xlsx`: 70 carried both the brand
-- and the colour, 3 the brand alone, 11 the colour alone, and 1 neither —
-- because that row has neither field recorded.
--
-- WHAT THIS DOES, AND WHY IT IS A CORRECTION RATHER THAN A REWRITE
--
-- It removes exactly the two prefixes that function added, in the order it
-- added them, and only from rows that function named. Two guards, and both are
-- necessary:
--
--   * `source = 'seed_import'` — the ONLY rows `composeDisplayName` ever wrote.
--     A row Alex typed is `manual`; one promoted from a trip is
--     `trip_promoted`; and the five canonical rows migration 0009 seeds are
--     `manual`, because a person wrote those names out. Measured by removing
--     the guard and running the suite: what it catches on its own is a
--     `trip_promoted` garment. `Black Shinola` and `White Shinola` — two
--     watches told apart by their colour — turn out to be saved by the
--     never-leave-it-empty condition instead, since stripping both fields off
--     `Black Shinola` leaves nothing at all. Both are worth having, and the
--     honest statement is that the first draft of this file had neither the
--     right shape nor this guard, and `missing-items.test.ts` is what caught it.
--   * the row's OWN `brand` and `color` columns sitting at the front of the
--     name, character for character. Anything renamed since no longer matches
--     that shape and is left alone.
--
-- `CLAUDE.md` asks for deterministic cleanup where the structure proves the
-- redundancy, and nothing wider. Two proofs are what that took.
--
-- The colour step carries one extra condition, because the composer had one:
-- it only prepended a colour that was NOT already inside the description. So a
-- name is only stripped of its colour when the remainder does not contain that
-- colour either. Without it, a garment genuinely called `Black Black Diamond
-- Harness` could lose the wrong `Black`.
--
-- WHAT IT DOES NOT DO
--
--   * No `DELETE`, and no row is replaced. `item.id` never changes, so approved
--     outfits, `outfit_pairing`, learned rules, checklist rows, capabilities and
--     archive state all keep pointing at exactly what they pointed at.
--   * `checklist_entry.name_snapshot` is NOT touched. Those are snapshots on
--     purpose (0004): a finished trip still reads the way it read when Alex
--     packed it. A trip planned after this reads the new way, and the two are
--     each correct about their own moment.
--   * Gear is untouched. `parseGear` never composed anything; a gear name is
--     the spreadsheet's own `Item` cell already.
--   * Nothing is invented. A garment with no brand and no colour recorded keeps
--     the only name it has.
--
-- WHERE THE WORDS GO INSTEAD. `garmentDetail` in `shared/items.ts` is the one
-- place that renders brand, colour and pattern under a name, so seven
-- quarter-zips stay seven distinguishable rows. Search reaches all of them —
-- `listItems` already matched brand and colour, and now matches notes too.

-- ---------------------------------------------------------------------------
-- THE INVERSION, IN THE COMPOSER'S OWN ORDER
--
-- `composeDisplayName` built `[colour] [brand] [description]`, so a colour it
-- added is always followed by the brand when there is one. Undoing it has to
-- respect that, and the first draft of this migration did not: it stripped any
-- leading colour and then any leading brand, in two independent passes. On
-- `Taylor Stitch Denim Button-Up` — brand `Taylor Stitch`, colour `Denim`, and
-- a description Alex wrote as `Denim Button-Up` — the brand pass produced the
-- right answer and a SECOND run of the same file would then have eaten `Denim`
-- as well. `wardrobe-names.test.ts` runs it twice for exactly that reason.
--
-- So the three cases below are mutually exclusive, and each strips a whole
-- prefix rather than a piece of one. Nothing here can bite twice: after any of
-- them the name no longer begins with the pattern that matched it.

-- 1. Colour AND brand, in that order — what the composer produced whenever both
--    were recorded and the description did not already contain the colour.
UPDATE item
   SET display_name = ltrim(substr(display_name, length(color) + length(brand) + 2))
 WHERE kind = 'clothing'
   AND source = 'seed_import'
   AND color IS NOT NULL AND trim(color) <> ''
   AND brand IS NOT NULL AND trim(brand) <> ''
   AND substr(lower(display_name), 1, length(color) + length(brand) + 2)
       = lower(color) || ' ' || lower(brand) || ' '
   -- Never leave a garment with no name at all.
   AND length(trim(ltrim(substr(display_name, length(color) + length(brand) + 2)))) > 0;

-- 2. The brand alone — either no colour was recorded, or the description
--    already contained it and the composer did not prepend it.
UPDATE item
   SET display_name = ltrim(substr(display_name, length(brand) + 1))
 WHERE kind = 'clothing'
   AND source = 'seed_import'
   AND brand IS NOT NULL AND trim(brand) <> ''
   AND substr(lower(display_name), 1, length(brand) + 1) = lower(brand) || ' '
   AND length(trim(ltrim(substr(display_name, length(brand) + 1)))) > 0;

-- 3. The colour alone, and only where there is no brand for it to have come
--    before. With a brand recorded, a leading colour that is NOT followed by
--    that brand was in the description to begin with — case 1 would have caught
--    it otherwise — so it is Alex's wording and it stays.
UPDATE item
   SET display_name = ltrim(substr(display_name, length(color) + 1))
 WHERE kind = 'clothing'
   AND source = 'seed_import'
   AND (brand IS NULL OR trim(brand) = '')
   AND color IS NOT NULL AND trim(color) <> ''
   AND substr(lower(display_name), 1, length(color) + 1) = lower(color) || ' '
   -- The composer's own precondition, inverted: it did not prepend a colour the
   -- description already contained.
   AND instr(lower(ltrim(substr(display_name, length(color) + 1))), lower(color)) = 0
   AND length(trim(ltrim(substr(display_name, length(color) + 1)))) > 0;
