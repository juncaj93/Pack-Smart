-- The five wardrobe rows Alex owns that were never in the workbook.
--
-- Canonical list: `shared/missing-items.ts`. That file is the source; this one
-- must agree with it, and `tests/unit/worker/missing-items.test.ts` reads both
-- real files and fails if they drift.
--
-- ADDITIVE ONLY. Nothing here updates, deletes, drops or replaces a row. The
-- workbook is not re-imported. A test asserts this file contains no UPDATE,
-- DELETE, DROP or INSERT OR REPLACE, so the guarantee survives the next edit.
--
-- Matching is on the TRIMMED, LOWER-CASED visible name:
--
--   * a production row differing only in case or padding counts as present and
--     is left completely alone — including any rule, rating or edit Alex has
--     since made to it;
--   * a merely SIMILAR name does not count. If production holds a `Shinola`,
--     this still adds `Black Shinola`, and both survive. A wrongly merged item is
--     unrecoverable; a duplicate is one archive tap away, and `CLAUDE.md` asks
--     for likely duplicates to be surfaced rather than silently resolved.
--
-- Re-running adds nothing, which matters because the runner is forward-only but
-- the same file will be applied to a fresh local database on every clean clone.

-- ---------------------------------------------------------------- --
-- The items                                                         --
-- ---------------------------------------------------------------- --

INSERT INTO item (
  id, kind, display_name, category, color, brand,
  is_critical, requires_final_check, source, created_at, updated_at
)
SELECT 'a1f0b3c2-0001-4e00-9a00-packsmartv2001', 'gear', 'Bite Guard', 'Medication',
       NULL, NULL, 1, 1, 'manual', unixepoch(), unixepoch()
WHERE NOT EXISTS (
  SELECT 1 FROM item WHERE lower(trim(display_name)) = 'bite guard'
);

INSERT INTO item (
  id, kind, display_name, category, color, brand,
  is_critical, requires_final_check, source, created_at, updated_at
)
SELECT 'a1f0b3c2-0002-4e00-9a00-packsmartv2002', 'gear', 'Hairspray', 'Toiletries',
       NULL, NULL, 0, 0, 'manual', unixepoch(), unixepoch()
WHERE NOT EXISTS (
  SELECT 1 FROM item WHERE lower(trim(display_name)) = 'hairspray'
);

INSERT INTO item (
  id, kind, display_name, category, color, brand,
  is_critical, requires_final_check, source, created_at, updated_at
)
SELECT 'a1f0b3c2-0003-4e00-9a00-packsmartv2003', 'gear', 'Plane Seat Cushion', 'Travel Gear',
       NULL, NULL, 0, 0, 'manual', unixepoch(), unixepoch()
WHERE NOT EXISTS (
  SELECT 1 FROM item WHERE lower(trim(display_name)) = 'plane seat cushion'
);

-- Two watches, two rows. A shared brand is not a reason to merge them, and no
-- warmth, dressiness, weather tag or typical use is invented for either.
INSERT INTO item (
  id, kind, display_name, category, color, brand,
  is_critical, requires_final_check, source, created_at, updated_at
)
SELECT 'a1f0b3c2-0004-4e00-9a00-packsmartv2004', 'clothing', 'Black Shinola',
       'Accessories & Undergarments', 'Black', 'Shinola', 0, 0, 'manual',
       unixepoch(), unixepoch()
WHERE NOT EXISTS (
  SELECT 1 FROM item WHERE lower(trim(display_name)) = 'black shinola'
);

INSERT INTO item (
  id, kind, display_name, category, color, brand,
  is_critical, requires_final_check, source, created_at, updated_at
)
SELECT 'a1f0b3c2-0005-4e00-9a00-packsmartv2005', 'clothing', 'White Shinola',
       'Accessories & Undergarments', 'White', 'Shinola', 0, 0, 'manual',
       unixepoch(), unixepoch()
WHERE NOT EXISTS (
  SELECT 1 FROM item WHERE lower(trim(display_name)) = 'white shinola'
);

-- ---------------------------------------------------------------- --
-- Their rules                                                       --
-- ---------------------------------------------------------------- --
--
-- Each guard is `EXISTS (item with THIS migration's id)`. Because those ids are
-- fixed and belong to nothing else, that is exactly "the row above was inserted
-- by this migration" — so a `Hairspray` Alex added himself keeps his own rules
-- and gains no orphan of ours. The second guard makes re-running a no-op.
--
-- `conditional_include` rather than a conditioned `fixed_per_trip`: the engine
-- applies conditions only to the conditional types (`shared/rules.ts`
-- `computeQuantity`), so a condition on a fixed rule would be decoration and the
-- item would be packed on every trip.

INSERT INTO packing_rule (
  id, item_id, rule_type, quantity_value, condition_json, enabled, original_text, created_at
)
SELECT 'b2e0c4d3-0001-4e00-9a00-packsmartv2001',
       'a1f0b3c2-0001-4e00-9a00-packsmartv2001',
       'conditional_include', 1, '{"fact":"nights","gte":1}', 1,
       'Critical. One per trip, whenever the trip has a night in it.', unixepoch()
WHERE EXISTS (SELECT 1 FROM item WHERE id = 'a1f0b3c2-0001-4e00-9a00-packsmartv2001')
  AND NOT EXISTS (
    SELECT 1 FROM packing_rule WHERE item_id = 'a1f0b3c2-0001-4e00-9a00-packsmartv2001'
  );

INSERT INTO packing_rule (
  id, item_id, rule_type, quantity_value, condition_json, enabled, original_text, created_at
)
SELECT 'b2e0c4d3-0002-4e00-9a00-packsmartv2002',
       'a1f0b3c2-0002-4e00-9a00-packsmartv2002',
       'fixed_per_trip', 1, NULL, 1, 'One per trip.', unixepoch()
WHERE EXISTS (SELECT 1 FROM item WHERE id = 'a1f0b3c2-0002-4e00-9a00-packsmartv2002')
  AND NOT EXISTS (
    SELECT 1 FROM packing_rule WHERE item_id = 'a1f0b3c2-0002-4e00-9a00-packsmartv2002'
  );

-- A trip with no recorded flight_hours evaluates to UNKNOWN, not false, so the
-- cushion is left off and the entry is marked incomplete rather than decided.
INSERT INTO packing_rule (
  id, item_id, rule_type, quantity_value, condition_json, enabled, original_text, created_at
)
SELECT 'b2e0c4d3-0003-4e00-9a00-packsmartv2003',
       'a1f0b3c2-0003-4e00-9a00-packsmartv2003',
       'conditional_include', 1, '{"fact":"flight_hours","gt":6}', 1,
       'One per trip, on a flight longer than 6 hours.', unixepoch()
WHERE EXISTS (SELECT 1 FROM item WHERE id = 'a1f0b3c2-0003-4e00-9a00-packsmartv2003')
  AND NOT EXISTS (
    SELECT 1 FROM packing_rule WHERE item_id = 'a1f0b3c2-0003-4e00-9a00-packsmartv2003'
  );

-- The two watches get no rule at all. A watch is not packed by the engine; it is
-- chosen by an outfit, or caught by One Last Look.
