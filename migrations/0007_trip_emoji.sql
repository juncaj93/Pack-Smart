-- One emoji per trip, stored rather than derived (02_DATA_MODEL.md §3).
--
-- A suggestion recomputed on every read would change under Alex whenever he
-- edited the trip, and an icon he recognises a trip by has to hold still.
--
-- Additive only: ADD COLUMN with a default, no DROP, no DELETE, no rewrite.
-- Existing trips get the neutral fallback and can be given a better one by
-- editing the trip, which is the same control a new trip has.

ALTER TABLE trip ADD COLUMN emoji TEXT NOT NULL DEFAULT '✈️';
