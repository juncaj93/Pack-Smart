-- Where each VALUE on an item came from, not just where the row came from (H1a).
--
-- `item.source` (`seed_import` / `manual` / `trip_promoted`) describes the ROW.
-- It cannot say "Alex confirmed this dressiness" as distinct from "the importer
-- guessed it from the Style / Use Case column", and until it can, every rating
-- H1b and H1c collect is one `Update existing` away from being overwritten by
-- the spreadsheet. Doc 09 §7 states the dependency plainly: provenance is not a
-- sub-task of Review Closet Items, it is its precondition.
--
-- WHY ONE JSON COLUMN RATHER THAN A TABLE OR FOURTEEN COLUMNS
--
-- The shape follows the two rules 0002 already set for this table. "One unified
-- table … a separate attributes table would be indirection at this scale" rules
-- out a `item_field_provenance` table: it would be ~14 rows per item, ~1,700 in
-- total, joined on every catalog read, to answer a question about a row we have
-- already loaded. And fourteen dedicated columns would mean a migration every
-- time a field joins the set — H1b adds comfort and versatility, H1c adds the
-- dressiness range, and H1d may add weather tags. One nullable TEXT column
-- costs one migration for all of them.
--
-- `weather_tags` and `typical_uses` are already JSON in this table, so the read
-- path parses this the same way it parses those, in the same function.
--
-- Shape, by example — one entry per field that has a recorded source:
--
--   {"dressiness":{"source":"user_confirmed","at":1780000000,
--                  "was":2,"wasSource":"inferred"}}
--
-- `was` / `wasSource` are ONE level of undo, and one is the whole requirement:
-- G5's *Use the default* restores the value a user override replaced, and this
-- is the same promise for a field. A full history would grow without bound in a
-- column read on every request, to answer a question nothing asks.
--
-- Precedence, ranks and every documented case: `shared/provenance.ts` and
-- `technical-docs/02_DATA_MODEL.md` §12. NULL means "nothing recorded", which
-- is the floor, which is exactly how every row behaved before this file.

ALTER TABLE item ADD COLUMN field_provenance TEXT;

-- ---------------------------------------------------------------------------
-- backfill — metadata only, and provably behaviour-neutral
-- ---------------------------------------------------------------------------
--
-- Normally this repository does not backfill (0019 says so in as many words).
-- This one is worth the exception because it writes NO value and CHANGES NO
-- import outcome, and it is the difference between the H1d review queue being
-- able to say *this dressiness was guessed* on day one and not being able to
-- say it at all.
--
-- The behaviour-neutrality is arithmetic rather than a hope. The precedence
-- rule is "a write at rank R may set a field whose current rank is at most R",
-- and the two ranks written here are `inferred` (1) and `imported` (2). An
-- import writes at rank 2, so 2 >= 2 and 2 >= 1: every field these rows carry
-- stays exactly as overwritable by the next import as it was yesterday. A user
-- edit writes at rank 4 and was never in question. `provenance.test.ts` asserts
-- this rather than trusting the paragraph.
--
-- Scoped to `seed_import`, which is the only source `normalizeGarment` ever
-- wrote — the same guard 0018 uses, for the same reason. A row Alex typed is
-- `manual` and gets nothing here: claiming he confirmed fourteen fields because
-- he once saved a form is precisely the guess this column exists to end.
--
-- `warmth` and `dressiness` are `inferred` because the importer GUESSES them
-- from the Style / Use Case column and says so — `normalizeGarment` pushes
-- "Warmth and dressiness were guessed from the Style / Use Case column" into
-- `derived` for exactly these two. Everything else is a column the workbook
-- actually has, so it is `imported`. The distinction is read from the importer's
-- own statement about itself, not invented here.
--
-- Only fields that are non-NULL get an entry: a row with no brand has no brand
-- to have a source for, and writing `imported` over an absence would claim the
-- spreadsheet said something it did not say.
-- The two both importers write, for every row either of them made.
UPDATE item
   SET field_provenance = json_object(
         'displayName',  json_object('source', 'imported', 'at', updated_at),
         'category',     json_object('source', 'imported', 'at', updated_at)
       )
 WHERE source = 'seed_import';

-- The nullable ones, folded in individually so an absent value stays absent.
-- `json_patch` merges rather than replaces, so each statement adds its own key
-- and leaves the others alone.
UPDATE item SET field_provenance = json_patch(field_provenance,
         json_object('subcategory', json_object('source','imported','at',updated_at)))
 WHERE source = 'seed_import' AND subcategory IS NOT NULL;

UPDATE item SET field_provenance = json_patch(field_provenance,
         json_object('color', json_object('source','imported','at',updated_at)))
 WHERE source = 'seed_import' AND color IS NOT NULL;

UPDATE item SET field_provenance = json_patch(field_provenance,
         json_object('pattern', json_object('source','imported','at',updated_at)))
 WHERE source = 'seed_import' AND pattern IS NOT NULL;

UPDATE item SET field_provenance = json_patch(field_provenance,
         json_object('brand', json_object('source','imported','at',updated_at)))
 WHERE source = 'seed_import' AND brand IS NOT NULL;

UPDATE item SET field_provenance = json_patch(field_provenance,
         json_object('notes', json_object('source','imported','at',updated_at)))
 WHERE source = 'seed_import' AND notes IS NOT NULL;

UPDATE item SET field_provenance = json_patch(field_provenance,
         json_object('ownedQuantity', json_object('source','imported','at',updated_at)))
 WHERE source = 'seed_import' AND owned_quantity IS NOT NULL;

UPDATE item SET field_provenance = json_patch(field_provenance,
         json_object('warmth', json_object('source','inferred','at',updated_at)))
 WHERE source = 'seed_import' AND warmth IS NOT NULL;

UPDATE item SET field_provenance = json_patch(field_provenance,
         json_object('dressiness', json_object('source','inferred','at',updated_at)))
 WHERE source = 'seed_import' AND dressiness IS NOT NULL;

-- ---------------------------------------------------------------------------
-- the two importers write different sets, and the backfill has to say so
-- ---------------------------------------------------------------------------
--
-- `toItemInput` (clothing) carries `typical_uses` and never the three gear
-- flags; `gearToItemInput` carries the three flags and never `typical_uses`.
-- `normalise` fills whichever the caller omitted with a DEFAULT — `[]` for the
-- array, 0 for the flags — so those stored values are the repository's, not the
-- spreadsheet's, and marking them `imported` would attribute a default to a
-- workbook that never mentioned it.
--
-- Splitting on `kind` is what keeps this a statement of fact. A t-shirt's
-- `is_critical = 0` gets no entry, because nothing decided it.
UPDATE item SET field_provenance = json_patch(field_provenance,
         json_object('typicalUses', json_object('source','imported','at',updated_at)))
 WHERE source = 'seed_import' AND kind = 'clothing';

UPDATE item SET field_provenance = json_patch(field_provenance,
         json_object(
           'isCritical',         json_object('source','imported','at',updated_at),
           'requiresFinalCheck', json_object('source','imported','at',updated_at),
           'alwaysInclude',      json_object('source','imported','at',updated_at)))
 WHERE source = 'seed_import' AND kind = 'gear';
