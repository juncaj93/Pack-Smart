-- One checklist row per item per trip, enforced rather than agreed.
--
-- Two functions write `checklist_entry` and each believed it owned the row:
-- `generateChecklist` keyed its lookup on `item_id` across every source, so it
-- picked up the row `syncChecklistFromOutfits` owned and rewrote its `source`;
-- the outfit writer then filtered on `source = 'outfit_generated'`, found no row
-- it owned, and inserted another. A garment carrying a packing rule that an
-- approved outfit also uses -- underwear is the documented case -- grew a row on
-- every alternating regeneration, and Alex saw it twice at two quantities.
--
-- The ownership rule is fixed in the two writers (D1b). This is the backstop, so
-- a third writer cannot reintroduce it quietly.

-- 1. Merge what is already there.
--
-- MERGE, not truncate. Which row survives is decided by how much of Alex is in
-- it: a quantity he set, a decision to leave it behind, or anything already in
-- the bag outranks a freshly generated duplicate. Ties go to the oldest row, so
-- the surviving id is the one every other reference already points at.
DELETE FROM checklist_entry
 WHERE item_id IS NOT NULL
   AND id NOT IN (
     SELECT id FROM (
       SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY trip_id, item_id
                ORDER BY
                  CASE
                    WHEN excluded_at IS NOT NULL THEN 0
                    WHEN qty_override IS NOT NULL THEN 0
                    WHEN packed_qty > 0 THEN 0
                    ELSE 1
                  END,
                  created_at,
                  id
              ) AS rn
         FROM checklist_entry
        WHERE item_id IS NOT NULL
     )
      WHERE rn = 1
   );

-- 2. Make a second one impossible.
--
-- Partial, because `item_id` is NULL for every item Alex added by hand and two
-- of those on one trip is perfectly ordinary -- "Gift for Sam" twice is his
-- business. The constraint is about the catalog, where a second row is always a
-- bug.
CREATE UNIQUE INDEX idx_checklist_one_row_per_item
    ON checklist_entry (trip_id, item_id)
 WHERE item_id IS NOT NULL;
