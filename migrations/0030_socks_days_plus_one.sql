-- Socks: one pair for each day, plus a spare.
--
-- Alex's ruling, recorded in `product-docs/09…§0x`. The rule he had said "at
-- least 5" — a floor that is too many for a weekend and too few for a
-- fortnight, and one that says the same thing about both. `days + 1` is what he
-- actually packs: `duration_plus_buffer` with a multiplier of 1 and a buffer of
-- 1, which is the same shape the contact lenses already use.
--
-- ADDITIVE ONLY, exactly as migration 0017 is. Nothing here updates, deletes or
-- rewrites a row. The change is a SUPERSEDING row — `supersedes_rule_id` naming
-- the rule it replaces — so:
--
--   * the old rule is untouched and still readable;
--   * `applyPrecedence` drops it because something supersedes it;
--   * *Use the default* in Packing rules puts it back, unchanged.
--
-- ---------------------------------------------------------------------------
-- Matching the item
-- ---------------------------------------------------------------------------
--
-- By the trimmed, lower-cased visible name, because the item's id was generated
-- at import time and there is no other handle. Two exact spellings rather than a
-- LIKE over names: `Socks` is what `extractQuantity` leaves after it takes
-- `(Multiple Pairs)` off the workbook's `Socks (Multiple Pairs)`, and the
-- unstripped form is carried in case a row was entered by hand. A wardrobe
-- holding two rows by either name gets one override each rather than having one
-- silently chosen — `CLAUDE.md` asks for likely duplicates to be surfaced, not
-- resolved here.
--
-- ---------------------------------------------------------------------------
-- The ids
-- ---------------------------------------------------------------------------
--
-- Derived from the row being superseded rather than generated, because SQL has
-- no UUID and a migration must produce the same result whenever it runs.
-- `supersedes_rule_id` is uniquely indexed, so one rule can never collect two of
-- these however often this file is applied.

-- ---------------------------------------------------------------- --
-- 1. Replace whatever quantity rule socks carry today               --
-- ---------------------------------------------------------------- --
--
-- Only the rule types that produce a NUMBER. A conditional or dependency rule
-- on socks would be saying *whether* to pack them, which is a different
-- question and not the one Alex answered.
--
-- `source` is deliberately not filtered. The "at least 5" he is replacing is a
-- rule he wrote himself in Settings, so a `source = 'system'` guard — right for
-- 0017, which retired seeded defaults — would match nothing at all here.
--
-- Two guards, and both are necessary:
--
--   1. `NOT EXISTS (… o.supersedes_rule_id = r.id)` — a rule that ALREADY
--      carries an override is skipped. The override is the rule in force, so
--      superseding the row it shadows would change no number on any list and
--      would spend the unique index on `supersedes_rule_id` doing it. The
--      override itself is matched by this statement in its own right, and that
--      is correct: Alex is replacing whatever socks are set to NOW, a decision
--      he made himself included. This differs from 0017 deliberately — that
--      migration retired seeded defaults and had to leave his own choices
--      alone; this one IS his own choice, restated.
--   2. `r.id NOT LIKE 'socks-per-day-%'` — the row this file itself writes.
--      Without it a second application supersedes its own output, the ids nest,
--      and the file stops being idempotent. The prefix is this file's own,
--      spelled out on the SELECT below, so the pattern cannot drift from what
--      it is guarding.
INSERT INTO packing_rule (
  id, item_id, rule_type, quantity_value, buffer, condition_json,
  depends_on_item_id, enabled, original_text, needs_review,
  source, supersedes_rule_id, created_at
)
SELECT 'socks-per-day-' || r.id, r.item_id, 'duration_plus_buffer', 1, 1, NULL,
       NULL, 1, 'One pair for each day, plus a spare.', 0,
       'user', r.id, unixepoch()
  FROM packing_rule r
  JOIN item i ON i.id = r.item_id
 WHERE lower(trim(i.display_name)) IN ('socks', 'socks (multiple pairs)')
   AND r.enabled = 1
   AND r.rule_type IN ('fixed_per_trip', 'per_day', 'per_night', 'minimum',
                       'maximum', 'spare', 'duration_plus_buffer')
   AND r.id NOT LIKE 'socks-per-day-%'
   AND NOT EXISTS (
     SELECT 1 FROM packing_rule o WHERE o.supersedes_rule_id = r.id
   );

-- ---------------------------------------------------------------- --
-- 2. And write the rule outright where socks carry none             --
-- ---------------------------------------------------------------- --
--
-- A fresh import is this case: `garmentRule` gives a quantity rule to boxer
-- briefs and to nothing else, so socks arrive with no rule at all and reach a
-- list only through outfit planning. Alex has now stated a basis for them, so
-- there is one to write.
--
-- Runs AFTER statement 1, which matters: a row that statement wrote is itself
-- enabled and unsuperseded, so the `NOT EXISTS` below sees it and this skips.
-- One rule either way, never two competing inside `computeQuantity`.
INSERT INTO packing_rule (
  id, item_id, rule_type, quantity_value, buffer, condition_json,
  depends_on_item_id, enabled, original_text, needs_review,
  source, supersedes_rule_id, created_at
)
SELECT 'socks-per-day-' || i.id, i.id, 'duration_plus_buffer', 1, 1, NULL,
       NULL, 1, 'One pair for each day, plus a spare.', 0,
       'user', NULL, unixepoch()
  FROM item i
 WHERE lower(trim(i.display_name)) IN ('socks', 'socks (multiple pairs)')
   AND i.archived_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM packing_rule r
      WHERE r.item_id = i.id
        AND r.enabled = 1
        AND NOT EXISTS (
          SELECT 1 FROM packing_rule o WHERE o.supersedes_rule_id = r.id
        )
   )
   AND NOT EXISTS (
     SELECT 1 FROM packing_rule x WHERE x.id = 'socks-per-day-' || i.id
   );
