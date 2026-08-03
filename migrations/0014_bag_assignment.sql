-- Which bag each thing goes in (doc 09 §11).
--
-- On the TRIP's checklist row, not on the catalog item. Where a passport lives
-- is a fact about a journey, not about the passport: it is in the personal item
-- on a long-haul flight and in a hotel safe on a road trip, and a default
-- written onto the catalog would carry one trip's answer onto every future one.
-- Doc 05 §10 keeps trip-specific decisions on the trip for exactly this reason,
-- and nothing approved asks for reusable bag defaults yet.
--
-- Two columns, because "which bag" and "who decided" are different questions and
-- collapsing them loses the one that matters. A recommendation Pack Smart made
-- can be improved by a better rule next release; a choice Alex made may never be
-- silently overwritten. `bag_source` is what tells them apart.
--
-- Additive, and nullable. Every existing row means "not assigned", which is
-- exactly what it is, and no trip needs repairing.

ALTER TABLE checklist_entry ADD COLUMN bag TEXT
  CHECK (bag IN ('wear', 'personal_item', 'carry_on', 'checked', 'either'));

-- 'recommended' -- Pack Smart's deterministic suggestion. Replaceable.
-- 'user'        -- Alex said so. Never overwritten by a recommendation.
ALTER TABLE checklist_entry ADD COLUMN bag_source TEXT
  CHECK (bag_source IN ('recommended', 'user'));

-- Filtering by bag reads this on the screen Alex opens most.
CREATE INDEX idx_checklist_bag ON checklist_entry (trip_id, bag);
