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
-- a third writer cannot reintroduce it quietly, plus the one-off repair for
-- whatever the defect already produced.
--
-- THE REPAIR IS A MERGE, NOT A SURVIVAL CONTEST. An earlier draft of this file
-- ranked the duplicates and deleted the losers, which quietly threw away user
-- state: two rows where one is excluded and the other is packed both rank as
-- "Alex touched this", and deleting either loses a decision he made. Every
-- user-owned field below is carried onto the surviving row before anything is
-- removed.

-- ---------------------------------------------------------------------------
-- 0. Refuse rather than guess.
-- ---------------------------------------------------------------------------
--
-- Two rows for the same garment carrying two DIFFERENT hand-set quantities is
-- two explicit decisions that contradict each other, and no rule in doc 03 §7
-- says which one Alex meant. There is no defensible merge, so this migration
-- stops instead of picking one -- a failed migration is recoverable and a
-- silently discarded decision is not.
--
-- The CHECK is the abort: the insert fails when the count is anything but zero,
-- and it runs BEFORE a single row is modified. Everything after this point is a
-- conflict that reconciles deterministically.
CREATE TABLE _migration_0013_guard (
  irreconcilable INTEGER NOT NULL CHECK (irreconcilable = 0)
);

INSERT INTO _migration_0013_guard (irreconcilable)
SELECT count(*) FROM (
  SELECT trip_id, item_id
    FROM checklist_entry
   WHERE item_id IS NOT NULL AND qty_override IS NOT NULL
   GROUP BY trip_id, item_id
  HAVING count(DISTINCT qty_override) > 1
);

DROP TABLE _migration_0013_guard;

-- ---------------------------------------------------------------------------
-- 1. Pick which row survives.
-- ---------------------------------------------------------------------------
--
-- Not "which row is best" -- every field is merged in step 2, so this only
-- decides which `id` the trip keeps. It matters because `checklist_link`
-- references it, and because a stable choice makes the migration idempotent.
--
-- The order is the precedence Alex's own actions have:
--   1. a row he ADDED -- never dropped in favour of a generated duplicate
--   2. a row whose quantity he SET
--   3. a row he set aside
--   4. a row with something already in the bag
--   5. the oldest, then the lowest id -- deterministic, and the id every other
--      reference already points at
-- An ordinary table, not a TEMP one. **D1 rejects `CREATE TEMP TABLE` outright**
-- (`not authorized: SQLITE_AUTH`), which is not something the integration tests
-- can see: they run `node:sqlite` directly, where temp tables are perfectly
-- legal. The first version of this file used one, passed 24 tests, and failed
-- the moment CI stood a real Worker up. Dropped at the end of the migration.
CREATE TABLE _migration_0013_survivors AS
SELECT trip_id, item_id, id AS keep_id FROM (
  SELECT trip_id, item_id, id,
         ROW_NUMBER() OVER (
           PARTITION BY trip_id, item_id
           ORDER BY
             CASE WHEN source = 'user_added'        THEN 0 ELSE 1 END,
             CASE WHEN qty_override IS NOT NULL     THEN 0 ELSE 1 END,
             CASE WHEN excluded_at  IS NOT NULL     THEN 0 ELSE 1 END,
             CASE WHEN packed_qty > 0               THEN 0 ELSE 1 END,
             created_at,
             id
         ) AS rn
    FROM checklist_entry
   WHERE item_id IS NOT NULL
) WHERE rn = 1;

-- ---------------------------------------------------------------------------
-- 2. Carry every user-owned field onto the survivor.
-- ---------------------------------------------------------------------------
--
-- Field by field, and each one states which way it resolves and why:
--
--   packed_qty        MAX  -- never turn a packed item back to unpacked
--   excluded_at       MIN  -- never turn an excluded item back on; the earliest
--                             timestamp is when the decision was actually made
--   final_checked_at  MIN  -- same, for the final check
--   qty_override      the one non-null value; step 0 proved there is at most one
--   required_qty      MAX  -- "the highest required quantity unless a manual
--                             override explicitly controls it", and when an
--                             override exists it is what the screen shows
--   packing_timing    day_of wins -- Day-of is a deliberate placement and the
--                             conservative direction is to keep it. `last_minute`
--                             is its retired spelling and means the same thing.
--   source            user_added wins -- provenance Alex created outranks
--                             generated provenance
--   requires_final_check / is_critical / trip_only   MAX -- a flag raised on any
--                             row was raised for a reason; lowering it is the
--                             only direction that can lose a warning
--   reason_text / qty_breakdown_json / rule_snapshot_json
--                     first non-null, survivor first -- an explanation is better
--                             than a blank, and C1 exists so no row goes silent
--   created_at        MIN, updated_at MAX -- the true span of the row's life
--   sort_order        MIN  -- the earliest position it held on the list
--
-- Not merged, deliberately: `name_snapshot` and `category_snapshot` are the
-- survivor's. They are snapshots of the same catalog item, so the duplicates
-- differ only when the catalog changed between writes, and the survivor's is
-- the one already on screen.
--
-- There is no bag-assignment column to carry: bags are Release D11 and unbuilt.
-- When they ship, this file is the list of what a merge has to preserve.
UPDATE checklist_entry
   SET packed_qty = (
         SELECT max(d.packed_qty) FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id),
       excluded_at = (
         SELECT min(d.excluded_at) FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id
            AND d.excluded_at IS NOT NULL),
       final_checked_at = (
         SELECT min(d.final_checked_at) FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id
            AND d.final_checked_at IS NOT NULL),
       qty_override = (
         SELECT max(d.qty_override) FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id
            AND d.qty_override IS NOT NULL),
       required_qty = (
         SELECT max(d.required_qty) FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id),
       packing_timing = (
         SELECT CASE
                  WHEN sum(CASE WHEN d.packing_timing IN ('day_of', 'last_minute')
                                THEN 1 ELSE 0 END) > 0 THEN 'day_of'
                  ELSE checklist_entry.packing_timing
                END
           FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id),
       source = (
         SELECT CASE
                  WHEN sum(CASE WHEN d.source = 'user_added' THEN 1 ELSE 0 END) > 0
                    THEN 'user_added'
                  ELSE checklist_entry.source
                END
           FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id),
       requires_final_check = (
         SELECT max(d.requires_final_check) FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id),
       is_critical = (
         SELECT max(d.is_critical) FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id),
       trip_only = (
         SELECT max(d.trip_only) FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id),
       reason_text = COALESCE(checklist_entry.reason_text, (
         SELECT d.reason_text FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id
            AND d.reason_text IS NOT NULL
          ORDER BY d.created_at, d.id LIMIT 1)),
       qty_breakdown_json = COALESCE(checklist_entry.qty_breakdown_json, (
         SELECT d.qty_breakdown_json FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id
            AND d.qty_breakdown_json IS NOT NULL
          ORDER BY d.created_at, d.id LIMIT 1)),
       rule_snapshot_json = COALESCE(checklist_entry.rule_snapshot_json, (
         SELECT d.rule_snapshot_json FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id
            AND d.rule_snapshot_json IS NOT NULL
          ORDER BY d.created_at, d.id LIMIT 1)),
       sort_order = (
         SELECT min(d.sort_order) FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id),
       created_at = (
         SELECT min(d.created_at) FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id),
       updated_at = (
         SELECT max(d.updated_at) FROM checklist_entry d
          WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id)
 WHERE id IN (SELECT keep_id FROM _migration_0013_survivors)
   AND EXISTS (
     SELECT 1 FROM checklist_entry d
      WHERE d.trip_id = checklist_entry.trip_id AND d.item_id = checklist_entry.item_id
        AND d.id <> checklist_entry.id);

-- ---------------------------------------------------------------------------
-- 3. Move every outfit reference onto the survivor before anything is deleted.
-- ---------------------------------------------------------------------------
--
-- `checklist_link` is written by nothing today and is recorded as dead in
-- technical-docs/10 -- so in practice this moves nothing. It is here because
-- "in practice empty" is a fact about today, and a foreign key that outlives the
-- row it points at is not a risk worth taking on Alex's only database.
--
-- INSERT OR IGNORE then DELETE, rather than UPDATE, because two duplicates can
-- both link the same slot and the composite primary key would reject the update.
INSERT OR IGNORE INTO checklist_link (checklist_entry_id, outfit_slot_id)
SELECT s.keep_id, l.outfit_slot_id
  FROM checklist_link l
  JOIN checklist_entry e ON e.id = l.checklist_entry_id
  JOIN _migration_0013_survivors s ON s.trip_id = e.trip_id AND s.item_id = e.item_id;

DELETE FROM checklist_link
 WHERE checklist_entry_id NOT IN (SELECT keep_id FROM _migration_0013_survivors)
   AND checklist_entry_id IN (
     SELECT e.id FROM checklist_entry e WHERE e.item_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 4. Record what was merged, then remove the duplicates.
-- ---------------------------------------------------------------------------
--
-- The count is written down because production cannot be inspected from the
-- agent environment -- the deploy log is the only evidence, and a number the
-- database itself recorded is better evidence than a log line that scrolls.
INSERT OR REPLACE INTO preference (key, value_json, updated_at)
SELECT 'migration_0013_merged',
       json_object(
         'duplicate_rows_removed', count(*),
         'items_affected', count(DISTINCT item_id)
       ),
       0
  FROM checklist_entry
 WHERE item_id IS NOT NULL
   AND id NOT IN (SELECT keep_id FROM _migration_0013_survivors);

DELETE FROM checklist_entry
 WHERE item_id IS NOT NULL
   AND id NOT IN (SELECT keep_id FROM _migration_0013_survivors);

DROP TABLE _migration_0013_survivors;

-- ---------------------------------------------------------------------------
-- 5. Make a second one impossible.
-- ---------------------------------------------------------------------------
--
-- Partial, because `item_id` is NULL for every item Alex added by hand and two
-- of those on one trip is perfectly ordinary -- "Gift for Sam" twice is his
-- business. The constraint is about the catalog, where a second row is always a
-- bug.
CREATE UNIQUE INDEX idx_checklist_one_row_per_item
    ON checklist_entry (trip_id, item_id)
 WHERE item_id IS NOT NULL;
