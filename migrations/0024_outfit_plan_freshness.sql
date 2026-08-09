-- P1B: the two timestamps that let the outfit plan be replanned AFTER the tap
-- rather than during it.
--
-- Applying an itinerary saved the days and then replanned the entire wardrobe
-- before answering, and the client waited for all of it before navigating.
-- Moving the replan off that path needs one thing the schema could not say:
-- whether the plan on the database is older than the days it is a plan FOR.
--
-- Without it, "replan afterwards" would be a promise the CLIENT makes — and a
-- promise that is broken by a closed tab, a dropped connection, or a refresh,
-- leaving a trip whose outfits quietly do not match its itinerary. With it, the
-- Outfits screen can tell on arrival, from any entry point, and put it right.
--
-- Both columns are nullable and both default to NULL, which is what every
-- existing trip gets: no recorded day change, so nothing is stale. That is
-- correct rather than convenient — every trip on the database today was
-- replanned synchronously by the endpoint that is being changed, so none of
-- them is behind.
--
-- Additive only. No column is dropped, no value is rewritten, and a Worker
-- running the previous code against this schema behaves exactly as it does now.

ALTER TABLE trip ADD COLUMN days_changed_at INTEGER;
ALTER TABLE trip ADD COLUMN outfits_planned_at INTEGER;
