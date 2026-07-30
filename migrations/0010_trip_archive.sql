-- Archiving a trip.
--
-- ADDITIVE ONLY: one nullable column and one index. Nothing is dropped,
-- rewritten or backfilled, and every existing trip reads as not archived —
-- which is exactly what it was.
--
-- Archive is a state, separate from the upcoming/past split that is DERIVED from
-- the dates. A finished trip is still a record of what Alex actually took, and
-- `CLAUDE.md` requires archived inventory to stay visible on historical trips —
-- so archiving hides a trip from the everyday list without touching a single
-- thing inside it, and restoring is one tap.
--
-- Permanent deletion needs no schema of its own: it is a DELETE across the
-- trip-scoped tables, in `worker/repos/trips.ts`, where the list of what goes and
-- what stays can be read and tested rather than inferred from a cascade.

ALTER TABLE trip ADD COLUMN archived_at INTEGER;

-- The trips list filters on this on every load.
CREATE INDEX IF NOT EXISTS idx_trip_archived ON trip (archived_at);
