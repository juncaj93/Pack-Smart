-- Which garments Alex has approved together (product doc 04 §5 criterion 3).
--
-- ADDITIVE ONLY. Creates one table and one index; touches no existing row and
-- drops nothing. Safe to apply to production with data in it.
--
-- A CATALOG table rather than a trip-scoped one, which is the point: it outlives
-- the trip that taught it. See technical-docs/02_DATA_MODEL.md.

CREATE TABLE IF NOT EXISTS outfit_pairing (
  -- Canonically ordered so a pair has exactly one row however it is looked up:
  -- item_a_id is always the lower of the two ids. Storing both directions would
  -- let the halves disagree.
  item_a_id        TEXT NOT NULL REFERENCES item (id),
  item_b_id        TEXT NOT NULL REFERENCES item (id),

  -- How many approved outfits have contained both. Counted, never inferred from
  -- colour, brand or name — doc 04 §5 requires the pairing be traceable to
  -- something Alex actually approved.
  times_approved   INTEGER NOT NULL DEFAULT 0,
  last_approved_at INTEGER NOT NULL,

  PRIMARY KEY (item_a_id, item_b_id),
  CHECK (item_a_id < item_b_id)
);

-- Ranking looks up "everything paired with this garment", and the primary key
-- only covers that for the item that sorts first.
CREATE INDEX IF NOT EXISTS idx_pairing_b ON outfit_pairing (item_b_id);
