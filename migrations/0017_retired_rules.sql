-- Three rules Alex does not want, and two he does (G5).
--
-- Raised on 2026-08-04 and scoped in `product-docs/09…§4`:
--
--   * `Gas-X` is `duration_plus_buffer` with a buffer of 2, so a twelve-day
--     trip asks for fourteen. Retired.
--   * `Plane Seat Cushion` is a `conditional_include` on a flight over six
--     hours. Retired.
--   * The two sunglasses rules are the SAME rule. `parseGearRule` tests
--     `/outdoor/i` before `/warm weather/i`, so `Warm weather / outdoor trips`
--     and `Outdoor trips` both become `activities contains outdoor` — the two
--     items appear together or not at all, and no trip can want one without the
--     other. Each becomes a plain one-per-trip rule instead.
--
-- ADDITIVE ONLY. Nothing here updates, deletes or replaces a row. Every change
-- is a SUPERSEDING row — `source = 'user'`, `supersedes_rule_id` naming the
-- default it replaces — which is exactly the shape `disableRule` and `editRule`
-- write from the app. So:
--
--   * the seeded rule is untouched and still readable;
--   * `applyPrecedence` drops it because something supersedes it;
--   * *Use the default* in Settings restores it, unchanged, at any time.
--
-- Migration 0009 and `shared/missing-items.ts` are deliberately NOT edited.
-- They are a true record of what was inserted, `missing-items.test.ts` asserts
-- they agree, and migrations are forward-only. Retiring a rule is not the same
-- act as pretending it was never seeded.
--
-- ---------------------------------------------------------------------------
-- The ids
-- ---------------------------------------------------------------------------
--
-- Derived from the rule being superseded (`'g5-…-' || r.id`) rather than
-- generated, because SQL has no UUID and a migration must produce the same
-- result whenever it runs. `supersedes_rule_id` is uniquely indexed, so one
-- default can never collect two of these however often this file is applied.
--
-- ---------------------------------------------------------------------------
-- The two guards on every statement
-- ---------------------------------------------------------------------------
--
--   1. `r.source = 'system' AND r.supersedes_rule_id IS NULL` — only a seeded
--      default is superseded. A rule Alex wrote himself is not one of these.
--   2. `NOT EXISTS (… o.supersedes_rule_id = r.id)` — an override he has
--      already written is left completely alone. Without this the unique index
--      would fail the migration, which is the safe failure; skipping is the
--      right behaviour and it should be deliberate rather than incidental.

-- ---------------------------------------------------------------- --
-- Gas-X — retired                                                   --
-- ---------------------------------------------------------------- --
--
-- Matched on the trimmed, lower-cased visible name, because the item's id was
-- generated at import time and there is no other handle. Exact, never a LIKE —
-- and one override per matching rule, so a wardrobe holding two rows by this
-- name gets two rather than having one silently chosen. `CLAUDE.md` asks for
-- likely duplicates to be surfaced rather than resolved.
INSERT INTO packing_rule (
  id, item_id, rule_type, quantity_value, buffer, condition_json,
  depends_on_item_id, enabled, original_text, needs_review,
  source, supersedes_rule_id, created_at
)
SELECT 'g5-retire-' || r.id, r.item_id, r.rule_type, r.quantity_value, r.buffer,
       r.condition_json, r.depends_on_item_id, 0, r.original_text, 0,
       'user', r.id, unixepoch()
  FROM packing_rule r
  JOIN item i ON i.id = r.item_id
 WHERE r.source = 'system'
   AND r.supersedes_rule_id IS NULL
   AND lower(trim(i.display_name)) = 'gas-x'
   AND NOT EXISTS (
     SELECT 1 FROM packing_rule o WHERE o.supersedes_rule_id = r.id
   );

-- ---------------------------------------------------------------- --
-- Plane Seat Cushion — retired                                      --
-- ---------------------------------------------------------------- --
--
-- By STABLE ID, which migration 0009 fixed. The only one of the four that can
-- be addressed this way, and it is addressed this way precisely because it can.
INSERT INTO packing_rule (
  id, item_id, rule_type, quantity_value, buffer, condition_json,
  depends_on_item_id, enabled, original_text, needs_review,
  source, supersedes_rule_id, created_at
)
SELECT 'g5-retire-' || r.id, r.item_id, r.rule_type, r.quantity_value, r.buffer,
       r.condition_json, r.depends_on_item_id, 0, r.original_text, 0,
       'user', r.id, unixepoch()
  FROM packing_rule r
 WHERE r.source = 'system'
   AND r.supersedes_rule_id IS NULL
   AND r.item_id = 'a1f0b3c2-0003-4e00-9a00-packsmartv2003'
   AND NOT EXISTS (
     SELECT 1 FROM packing_rule o WHERE o.supersedes_rule_id = r.id
   );

-- ---------------------------------------------------------------- --
-- Both sunglasses — one per trip, every trip                        --
-- ---------------------------------------------------------------- --
--
-- `fixed_per_trip` with no condition, so each appears exactly once on every
-- trip and independently of the other. Two statements rather than an `IN`,
-- because they are two separate decisions about two separate objects and a
-- later change to one must not silently reach the other.
--
-- `original_text` is REWRITTEN rather than copied, and that is the one place
-- this differs from `createOverride`. The seeded text says `Outdoor trips`;
-- carrying that onto a rule that now fires on every trip would put a sentence
-- on the row (C1's *why it is here*) that contradicts the row it explains.
INSERT INTO packing_rule (
  id, item_id, rule_type, quantity_value, buffer, condition_json,
  depends_on_item_id, enabled, original_text, needs_review,
  source, supersedes_rule_id, created_at
)
SELECT 'g5-always-' || r.id, r.item_id, 'fixed_per_trip', 1, NULL, NULL,
       NULL, 1, 'One per trip.', 0,
       'user', r.id, unixepoch()
  FROM packing_rule r
  JOIN item i ON i.id = r.item_id
 WHERE r.source = 'system'
   AND r.supersedes_rule_id IS NULL
   AND lower(trim(i.display_name)) = 'prescription sunglasses'
   AND NOT EXISTS (
     SELECT 1 FROM packing_rule o WHERE o.supersedes_rule_id = r.id
   );

INSERT INTO packing_rule (
  id, item_id, rule_type, quantity_value, buffer, condition_json,
  depends_on_item_id, enabled, original_text, needs_review,
  source, supersedes_rule_id, created_at
)
SELECT 'g5-always-' || r.id, r.item_id, 'fixed_per_trip', 1, NULL, NULL,
       NULL, 1, 'One per trip.', 0,
       'user', r.id, unixepoch()
  FROM packing_rule r
  JOIN item i ON i.id = r.item_id
 WHERE r.source = 'system'
   AND r.supersedes_rule_id IS NULL
   AND lower(trim(i.display_name)) = 'regular sunglasses'
   AND NOT EXISTS (
     SELECT 1 FROM packing_rule o WHERE o.supersedes_rule_id = r.id
   );
