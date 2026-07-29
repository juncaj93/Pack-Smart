-- Additive only. Adds one nullable column; nothing is dropped or rewritten.
--
-- A slot needs to record how many of its group's days that particular garment
-- covers. A "Casual days x 9" group is not nine identical t-shirts: it is nine
-- wearings spread across whatever suitable tops Alex owns, and each slot row
-- holds one garment plus the number of days it takes care of.
--
-- Without this the round trip loses the split, and the clothing quantities on
-- the checklist come out wrong in both directions — one shirt for nine days, or
-- nine copies of the same shirt.

ALTER TABLE outfit_slot ADD COLUMN wearings INTEGER NOT NULL DEFAULT 1;
