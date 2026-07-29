-- Outfits, the checklist, and the link between them.
--
-- Approved outfits are the source of truth for the clothing checklist
-- (product doc 04 §8). checklist_link is what makes that synchronisation work in
-- both directions, so Alex never maintains two conflicting clothing plans.

CREATE TABLE IF NOT EXISTS outfit_group (
  id                  TEXT PRIMARY KEY,
  trip_id             TEXT NOT NULL REFERENCES trip (id),
  name                TEXT NOT NULL,          -- e.g. "Safari mornings"
  activity_tag        TEXT,
  occurrences         INTEGER NOT NULL DEFAULT 1,
  dressiness          INTEGER CHECK (dressiness BETWEEN 0 AND 4),
  expected_conditions TEXT,                   -- JSON
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'approved', 'incomplete')),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outfit_trip ON outfit_group (trip_id, sort_order);

CREATE TABLE IF NOT EXISTS outfit_slot (
  id            TEXT PRIMARY KEY,
  outfit_group_id TEXT NOT NULL REFERENCES outfit_group (id),
  slot_role     TEXT NOT NULL CHECK (slot_role IN
                  ('top', 'mid', 'outer', 'bottom', 'footwear', 'accessory', 'swim')),
  required      INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),

  -- NULLABLE on purpose. A null item with an unmet_reason is how doc 04 §15's
  -- "No suitable packed rain layer found" is represented: the system records a
  -- gap rather than inventing a garment.
  item_id       TEXT REFERENCES item (id),
  unmet_reason  TEXT,

  reuse_allowed INTEGER NOT NULL DEFAULT 1 CHECK (reuse_allowed IN (0, 1)),
  rank_score    REAL,
  reason_json   TEXT,
  filled_by     TEXT CHECK (filled_by IN ('generated', 'user_swap')),
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_slot_group ON outfit_slot (outfit_group_id, sort_order);

CREATE TABLE IF NOT EXISTS checklist_entry (
  id                   TEXT PRIMARY KEY,
  trip_id              TEXT NOT NULL REFERENCES trip (id),

  -- Nullable for trip-only items, which stay attached to the trip and never
  -- pollute the permanent inventory (product doc 05 §10).
  item_id              TEXT REFERENCES item (id),

  -- Snapshots so a completed trip still reads correctly after the catalog
  -- changes (§7). Active trips show live values; completed trips show these.
  name_snapshot        TEXT NOT NULL,
  category_snapshot    TEXT NOT NULL,

  required_qty         INTEGER NOT NULL DEFAULT 1,
  -- The human-readable derivation ("12 trip days x 2 = 24"). This IS the
  -- explanation; there is no separate explanation logic that can drift.
  qty_breakdown_json   TEXT,
  qty_override         INTEGER,
  packed_qty           INTEGER NOT NULL DEFAULT 0,

  packing_timing       TEXT NOT NULL DEFAULT 'anytime'
                         CHECK (packing_timing IN
                           ('anytime', 'night_before', 'day_of', 'last_minute')),
  requires_final_check INTEGER NOT NULL DEFAULT 0 CHECK (requires_final_check IN (0, 1)),
  final_checked_at     INTEGER,

  -- Not Bringing. Removal keeps the evidence that the item was considered, so it
  -- can be restored and so outfits stay synchronised (product doc 03 §10).
  excluded_at          INTEGER,

  source               TEXT NOT NULL CHECK (source IN
                         ('always_packed', 'trip_triggered', 'outfit_generated',
                          'user_added', 'dependency_triggered')),
  reason_text          TEXT,
  rule_snapshot_json   TEXT,
  is_critical          INTEGER NOT NULL DEFAULT 0 CHECK (is_critical IN (0, 1)),
  trip_only            INTEGER NOT NULL DEFAULT 0 CHECK (trip_only IN (0, 1)),
  sort_order           INTEGER NOT NULL DEFAULT 0,

  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checklist_trip ON checklist_entry (trip_id, sort_order);

-- Many-to-many between checklist rows and the outfit slots that generated them.
-- Removing a clothing row can therefore name the affected outfits, and approving
-- an outfit can recompute exactly the right quantities.
CREATE TABLE IF NOT EXISTS checklist_link (
  checklist_entry_id TEXT NOT NULL REFERENCES checklist_entry (id),
  outfit_slot_id     TEXT NOT NULL REFERENCES outfit_slot (id),
  PRIMARY KEY (checklist_entry_id, outfit_slot_id)
);

CREATE TABLE IF NOT EXISTS wear_log (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL REFERENCES trip (id),
  item_id    TEXT NOT NULL REFERENCES item (id),
  event_id   TEXT REFERENCES trip_event (id),
  worn_date  TEXT NOT NULL,
  action     TEXT NOT NULL CHECK (action IN
               ('will_wear', 'already_wore', 'not_available', 'too_warm', 'too_cold')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wear_trip ON wear_log (trip_id, worn_date);

-- Persists the accepted plan so During Trip is continuous rather than
-- regenerated on each open, which would make the app look like it changed its
-- mind (risk R12).
CREATE TABLE IF NOT EXISTS daily_plan (
  id               TEXT PRIMARY KEY,
  trip_id          TEXT NOT NULL REFERENCES trip (id),
  plan_date        TEXT NOT NULL,
  event_id         TEXT REFERENCES trip_event (id),
  outfit_group_id  TEXT REFERENCES outfit_group (id),
  adjustments_json TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_plan_trip ON daily_plan (trip_id, plan_date);

-- Drives "Update your usual preference?" without ever auto-applying anything.
CREATE TABLE IF NOT EXISTS preference_change_suggestion (
  id            TEXT PRIMARY KEY,
  trip_id       TEXT REFERENCES trip (id),
  trigger_kind  TEXT NOT NULL,
  proposal_json TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'dismissed')),
  created_at    INTEGER NOT NULL
);

-- Import history. Every source row survives with its fate recorded; nothing is
-- silently discarded (product doc 05 §4).
CREATE TABLE IF NOT EXISTS import_run (
  id           TEXT PRIMARY KEY,
  filename     TEXT NOT NULL,
  file_hash    TEXT NOT NULL,
  summary_json TEXT,
  status       TEXT NOT NULL DEFAULT 'dry_run'
                 CHECK (status IN ('dry_run', 'committed', 'abandoned')),
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS import_row (
  id               TEXT PRIMARY KEY,
  import_run_id    TEXT NOT NULL REFERENCES import_run (id),
  sheet            TEXT NOT NULL,
  row_number       INTEGER NOT NULL,
  raw_json         TEXT NOT NULL,
  normalized_json  TEXT,
  identity_hash    TEXT,
  decision         TEXT NOT NULL CHECK (decision IN
                     ('imported', 'merged_duplicate', 'needs_review', 'skipped_by_user')),
  matched_item_id  TEXT REFERENCES item (id),
  note             TEXT
);

CREATE INDEX IF NOT EXISTS idx_import_row_run ON import_row (import_run_id);
