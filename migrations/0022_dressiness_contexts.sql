-- Where a garment works, as a SET rather than a point on a ladder (H1c).
--
-- `item.dressiness` is one INTEGER, so a garment had to be filed at its one
-- best level. An Oxford shirt is Smart casual AND Dressy; a suit is Dressy AND
-- Formal; sweatpants are Loungewear AND Casual. Doc 09 §7 named this as the one
-- H1 change that reaches the planner, and Alex's ruling of 2026-08-06 made it
-- a multi-select rather than a wider range.
--
-- A JSON array, because `weather_tags` and `typical_uses` are already JSON
-- arrays in this table and the read path parses all three in the same function.
-- A bitmask would be smaller and unreadable in a `SELECT`, which is the wrong
-- trade at ~120 rows.
--
-- Canonical form is enforced in `shared/dressiness.ts`, not here: sorted into
-- `DRESSINESS_CONTEXTS` order, de-duplicated. Two garments Alex marked the same
-- way must serialise identically or H1a's `sameValue` calls every save a change.
ALTER TABLE item ADD COLUMN dressiness_contexts TEXT;

-- ---------------------------------------------------------------------------
-- the legacy mapping — one context each, and NOT a context more
-- ---------------------------------------------------------------------------
--
-- Every stored integer becomes exactly ONE context:
--
--   0 -> loungewear   1 -> casual   2 -> smart_casual   3 -> dressy   4 -> formal
--
-- **No broadening.** A garment recorded as Smart casual becomes `Smart casual`
-- and not `Casual + Smart casual`, even though the second is probably true of
-- most of them. The importer guessed those integers from a free-text column
-- (`inferDressiness`), so widening them here would be inventing an answer to a
-- question Alex has not been asked — twice over, since the guess was ours to
-- begin with. Broader applicability is exactly what the H1d review queue is
-- for, and a value Alex confirms there outranks this one (H1a).
--
-- **Behaviour-preserving, and that is arithmetic rather than a hope.**
-- Eligibility becomes `garmentSet ∩ acceptableSet ≠ ∅`. With every garment at
-- one context, that is true precisely when the old `minDress <= dressiness <=
-- maxDress` was true, because `acceptableSet` is the same contiguous band
-- expanded. `tests/unit/worker/dressiness.test.ts` asserts the equivalence
-- across all 5 levels × all 13 template bands × every cap.
--
-- **Idempotent.** The guard is `dressiness_contexts IS NULL`, so a second run
-- writes nothing — and in particular it can never widen a set Alex has since
-- edited, which a bare `UPDATE … WHERE dressiness IS NOT NULL` would do.
--
-- `json_array` rather than a string literal so SQLite stores real JSON and a
-- `json_extract` in a later migration reads it without reparsing.
UPDATE item
   SET dressiness_contexts = json_array(
         CASE dressiness
           WHEN 0 THEN 'loungewear'
           WHEN 1 THEN 'casual'
           WHEN 2 THEN 'smart_casual'
           WHEN 3 THEN 'dressy'
           WHEN 4 THEN 'formal'
         END)
 WHERE dressiness_contexts IS NULL
   AND dressiness IS NOT NULL
   AND dressiness BETWEEN 0 AND 4;

-- ---------------------------------------------------------------------------
-- provenance for what was just written
-- ---------------------------------------------------------------------------
--
-- The contexts are a restatement of the integer, so they inherit ITS source
-- rather than claiming a new one. `dressiness` is `inferred` on every
-- `seed_import` row (0020 backfilled it that way, because `normalizeGarment`
-- guesses warmth and dressiness from the Style / Use Case column and says so),
-- and a mechanical re-expression of a guess is still a guess.
--
-- `inferred` is rank 1, below `imported` (2) and far below `user_confirmed` (4),
-- so this is the FIRST thing a later, better source may correct — which is the
-- right standing for a value nobody has looked at. A row Alex typed is `manual`
-- and gets nothing, exactly as in 0020: claiming he confirmed a context because
-- he once picked a dressiness is the guess provenance exists to end.
--
-- `json_patch` merges, so this adds one key and leaves H1a's and H1b's entries
-- alone.
UPDATE item
   SET field_provenance = json_patch(
         ifnull(field_provenance, '{}'),
         json_object('dressinessContexts',
                     json_object('source', 'inferred', 'at', updated_at)))
 WHERE source = 'seed_import'
   AND dressiness_contexts IS NOT NULL;

-- No index: the planner loads the whole active wardrobe through
-- `listActiveCandidates` and intersects in memory, so an index would be
-- maintained on every write and used by no query.
--
-- No down-migration, consistent with 0018 onwards. `dressiness` is NOT dropped:
-- it stays as the importer's inferred value and as what `reconcile` diffs a
-- re-import against. Two columns, two authorities, and
-- `technical-docs/02_DATA_MODEL.md` §10 says which one the planner reads.
