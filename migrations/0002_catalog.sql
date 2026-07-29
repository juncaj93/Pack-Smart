-- Catalog tables: the permanent record of what Alex owns.
--
-- Structural rule 1 from technical-docs/02_DATA_MODEL.md §1: catalog and trip
-- state never share a write path. These three tables hold permanent state and
-- no checklist or outfit endpoint may write to them. Promoting a trip edit into
-- a permanent preference is a separate, explicit endpoint.
--
-- Structural rule 2: nothing is ever deleted. Items are archived.

-- One unified table for clothing and gear, discriminated by `kind`, because My
-- Stuff is one experience (product doc 02 §10) and the whole catalog is ~120
-- rows. Kind-specific columns are simply nullable; a separate attributes table
-- would be indirection at this scale.
CREATE TABLE IF NOT EXISTS item (
  id                      TEXT PRIMARY KEY,
  kind                    TEXT NOT NULL CHECK (kind IN ('clothing', 'gear')),

  display_name            TEXT NOT NULL,
  category                TEXT NOT NULL,
  subcategory             TEXT,
  color                   TEXT,
  pattern                 TEXT,
  brand                   TEXT,
  notes                   TEXT,

  -- Favorite and usage frequency are independent signals (product doc 05 §9):
  -- a rarely used favorite can still win a specialised event.
  favorite                INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  usage_frequency         TEXT NOT NULL DEFAULT 'new'
                            CHECK (usage_frequency IN ('frequent', 'sometimes', 'rare', 'new')),

  warmth                  INTEGER CHECK (warmth BETWEEN 0 AND 3),
  dressiness              INTEGER CHECK (dressiness BETWEEN 0 AND 4),
  weather_tags            TEXT,   -- JSON array
  typical_uses            TEXT,   -- JSON array
  reuse_capacity          INTEGER,

  -- Three seed rows encode a count in the name (e.g. "Boxer Briefs (~15 Pairs)").
  -- Knowing the drawer holds ~15 lets the app warn that a 12-day trip at 2/day
  -- needs more than Alex owns, instead of cheerfully asking for 24.
  owned_quantity          INTEGER,

  is_critical             INTEGER NOT NULL DEFAULT 0 CHECK (is_critical IN (0, 1)),
  requires_final_check    INTEGER NOT NULL DEFAULT 0 CHECK (requires_final_check IN (0, 1)),
  default_packing_timing  TEXT NOT NULL DEFAULT 'anytime'
                            CHECK (default_packing_timing IN
                              ('anytime', 'night_before', 'day_of', 'last_minute')),

  always_include          INTEGER NOT NULL DEFAULT 0 CHECK (always_include IN (0, 1)),
  never_include           INTEGER NOT NULL DEFAULT 0 CHECK (never_include IN (0, 1)),

  -- Archive, never delete. The row and its foreign keys survive forever so old
  -- trips keep resolving (§7).
  archived_at             INTEGER,

  source                  TEXT NOT NULL DEFAULT 'manual'
                            CHECK (source IN ('seed_import', 'manual', 'trip_promoted')),
  source_row_json         TEXT,   -- verbatim source row, for traceability

  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);

-- Candidate selection filters on these constantly.
CREATE INDEX IF NOT EXISTS idx_item_kind_archived ON item (kind, archived_at);
CREATE INDEX IF NOT EXISTS idx_item_category      ON item (category);

CREATE TABLE IF NOT EXISTS packing_rule (
  id                 TEXT PRIMARY KEY,
  item_id            TEXT NOT NULL REFERENCES item (id),

  -- The eleven types in product doc 03 §6.
  rule_type          TEXT NOT NULL CHECK (rule_type IN (
                       'fixed_per_trip', 'per_day', 'per_night', 'per_activity_occurrence',
                       'per_outfit_group', 'minimum', 'maximum', 'spare',
                       'duration_plus_buffer', 'conditional_include', 'dependency_include')),

  quantity_value     REAL,
  buffer             REAL,

  -- Small structured predicate DSL, evaluated by a pure function and rendered to
  -- a human sentence for explanations. e.g. {"fact":"nights","gte":3}
  condition_json     TEXT,

  depends_on_item_id TEXT REFERENCES item (id),
  enabled            INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),

  -- Always keep the source string so a rule can be audited against where it came
  -- from, and flag rather than invent when it will not parse (risk R4).
  original_text      TEXT,
  needs_review       INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),

  created_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rule_item ON packing_rule (item_id);

-- Typed key/value. Seeded with the approved contacts/underwear bases.
CREATE TABLE IF NOT EXISTS preference (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
