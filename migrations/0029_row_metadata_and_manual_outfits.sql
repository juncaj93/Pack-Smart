-- Two additive columns, for the two halves of this pass.
--
-- Kept in one file because they ship together and neither can be applied on its
-- own without leaving the code that reads it half-served. Nothing is dropped,
-- nothing is rewritten except the backfill below, and a Worker running the
-- previous code against this schema behaves exactly as it does now.

-- ---------------------------------------------------------------------------
-- 1. A packing row's brand and colour, as their own fields
-- ---------------------------------------------------------------------------
--
-- `detail_snapshot` (0019) holds `Vuori · Dark Green` — brand, colour and
-- pattern already composed into one presentation string. That was the right
-- shape while the fact lived on a second line under the name. It is the wrong
-- shape for a one-line row, which needs the brand as TEXT on the right and the
-- colour as a SWATCH beside it.
--
-- The alternative was to parse the composed string back apart, and this
-- repository has already written down why that is wrong: `OutfitSlotView`
-- carries `itemColor` separately rather than pulling a colour out of
-- `Columbia · Black · Striped`, because re-deriving a fact a row already has is
-- how two screens come to disagree about one garment. A brand like
-- `Black Diamond` in a composed string would also match a colour word that
-- nobody wrote in a colour column.
--
-- Snapshots, like the name and the detail beside them (0004, 0019): a finished
-- trip should read the way it read when Alex packed it.
ALTER TABLE checklist_entry ADD COLUMN brand_snapshot TEXT;
ALTER TABLE checklist_entry ADD COLUMN color_snapshot TEXT;

-- Backfilled ONLY where the row already carries a detail snapshot.
--
-- That condition is the whole of 0019's reasoning, inverted. A row written
-- before 0019 has `detail_snapshot IS NULL` because its `name_snapshot` still
-- contains the brand and the colour — filling these in for such a row would
-- print the same two words twice on a row that reads correctly today. Those
-- rows stay NULL and render exactly as they always have.
--
-- A row written since 0019 had its detail composed from these same two columns
-- on the item, so this is the fields it was already showing, separated rather
-- than changed. A trip-only row has no `item_id`, matches nothing, and stays
-- NULL — which is correct: it has no brand and no colour.
UPDATE checklist_entry
   SET brand_snapshot = (SELECT i.brand FROM item i WHERE i.id = checklist_entry.item_id),
       color_snapshot = (SELECT i.color FROM item i WHERE i.id = checklist_entry.item_id)
 WHERE item_id IS NOT NULL
   AND detail_snapshot IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Who authored an outfit
-- ---------------------------------------------------------------------------
--
-- An outfit Alex writes himself has to survive a replan, and until now nothing
-- in the schema could say which outfits those are. `generateOutfits` deletes
-- every group that is not approved and plans the trip again, and it matches
-- surviving groups to templates BY NAME because ids are minted fresh on each
-- run. Both of those are correct for a planner-generated group and both are
-- fatal for a user-authored one: a manual `Lounging at hotel` would be deleted
-- the next time anything replanned, and a manual group that happened to be
-- called `Travel days` would silently merge with the planner's own.
--
-- So provenance is recorded rather than inferred. `generated` is what every
-- existing row is and what the planner keeps writing; `user` is a group Alex
-- created, and it is never deleted, never regenerated, never renamed and never
-- matched by name against a template.
--
-- NOT NULL with a default rather than a nullable column, because "we do not
-- know who made this outfit" is not a state this product has: every group on
-- the database today was written by the planner. No CHECK constraint, because
-- adding one to an existing table in SQLite means rebuilding it, which is a
-- destructive migration and needs Alex — the two values are enforced by the
-- type in `OutfitGroupView` and by the two functions that write the column.
ALTER TABLE outfit_group ADD COLUMN source TEXT NOT NULL DEFAULT 'generated';
