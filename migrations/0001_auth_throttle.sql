-- Milestone 0 — login throttle state.
--
-- This is deliberately the ONLY table in M0. The product schema (item, trip,
-- checklist_entry, outfit_group, ...) is specified in technical-docs/02_DATA_MODEL.md
-- and lands in the milestones that actually use it; creating those tables now
-- would freeze a schema ahead of the import work that validates it.
--
-- Migration convention (technical-docs/01_ARCHITECTURE.md §2):
--   * numbered NNNN_description.sql, applied in order
--   * forward-only — never edit a migration that has been applied
--   * no destructive statement without explicit approval (CLAUDE.md)

CREATE TABLE IF NOT EXISTS auth_throttle (
  -- Coarse bucket key. Single-user app: one row in practice, but keyed so the
  -- shape does not have to change if per-source throttling is ever wanted.
  key               TEXT    PRIMARY KEY,
  failure_count     INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL DEFAULT 0,
  locked_until      INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0
);
