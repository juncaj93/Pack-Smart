-- The approved seeded preferences.
--
-- technical-docs/02_DATA_MODEL.md §2 and product doc 03 §6:
-- contacts AND underwear are 2 per INCLUSIVE CALENDAR TRIP DAY.
--
-- 31 July -> 11 August is 12 trip days and 11 nights, so both come to 24.
-- The source spreadsheet says "Nights x 2" for contacts, which would give 22;
-- the approved product decision outranks it, and the original string is kept in
-- import history rather than overwritten.
--
-- INSERT OR IGNORE so re-running is harmless and never overwrites a value Alex
-- has since changed.

INSERT OR IGNORE INTO preference (key, value_json, updated_at) VALUES
  ('contacts_basis',   '{"per":"trip_day","multiplier":2}', 0),
  ('underwear_basis',  '{"per":"trip_day","multiplier":2}', 0),

  -- Per-category reuse defaults (product doc 04 §6). Jackets, shoes and belts
  -- are effectively unlimited; shirts and tees are worn once.
  ('reuse_defaults',
   '{"outerwear":99,"mid":99,"footwear":99,"accessory":99,"bottom":3,"top":1,"swim":2}', 0),

  -- Neutral until Alex says otherwise. "I run cold" shifts this.
  ('warmth_bias',      '{"offset":0}', 0);
