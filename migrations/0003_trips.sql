-- Trip-scoped tables.
--
-- Everything here is per-trip state. No endpoint writing these may touch the
-- catalog (technical-docs/02_DATA_MODEL.md §1), which is what makes "trip edits
-- stay trip-only" true by construction rather than by developer discipline.

CREATE TABLE IF NOT EXISTS trip (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,

  -- ISO dates. Trip days are counted INCLUSIVELY, nights EXCLUSIVELY:
  -- 31 Jul -> 11 Aug is 12 trip days and 11 nights. Both are computed once as
  -- structured facts and never re-derived ad hoc — the difference is two pairs
  -- of contacts (product doc 03 §6).
  start_date        TEXT NOT NULL,
  end_date          TEXT NOT NULL,

  status            TEXT NOT NULL DEFAULT 'planning'
                      CHECK (status IN ('planning', 'packing', 'active', 'completed')),

  notes_raw         TEXT,
  luggage_mode      TEXT CHECK (luggage_mode IN ('carry_on', 'checked', 'unknown')),
  laundry_available INTEGER CHECK (laundry_available IN (0, 1)),
  max_dressiness    INTEGER CHECK (max_dressiness BETWEEN 0 AND 4),
  flight_hours      REAL,
  international     INTEGER CHECK (international IN (0, 1)),
  timezone          TEXT,

  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trip_status ON trip (status, start_date);

CREATE TABLE IF NOT EXISTS trip_destination (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trip (id),
  name         TEXT NOT NULL,
  country      TEXT,
  latitude     REAL,
  longitude    REAL,
  arrive_date  TEXT,
  depart_date  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_destination_trip ON trip_destination (trip_id, sort_order);

-- The explainability backbone. Every fact traces to a quotable cause, which is
-- what "Here is what Pack Smart understood" reads from.
CREATE TABLE IF NOT EXISTS trip_fact (
  id            TEXT PRIMARY KEY,
  trip_id       TEXT NOT NULL REFERENCES trip (id),
  fact_key      TEXT NOT NULL,
  value_json    TEXT NOT NULL,

  -- certain -> applied and listed under Understood
  -- likely   -> applied but listed under Please confirm, with the evidence quoted
  -- possible -> NOT applied; offered as a suggestion chip only
  certainty     TEXT NOT NULL CHECK (certainty IN ('certain', 'likely', 'possible')),

  source        TEXT NOT NULL
                  CHECK (source IN ('user', 'structured', 'detected', 'preference', 'default')),

  -- Alex's own words, quoted back verbatim as evidence. Never a percentage.
  evidence_text TEXT,
  evidence_start INTEGER,
  evidence_end   INTEGER,

  confirmed_at  INTEGER,
  superseded_by TEXT REFERENCES trip_fact (id),
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fact_trip ON trip_fact (trip_id, fact_key);

CREATE TABLE IF NOT EXISTS trip_event (
  id              TEXT PRIMARY KEY,
  trip_id         TEXT NOT NULL REFERENCES trip (id),
  event_date      TEXT NOT NULL,
  start_time      TEXT,
  end_time        TEXT,
  title           TEXT NOT NULL,
  activity_tag    TEXT,
  outdoor         INTEGER CHECK (outdoor IN (0, 1)),
  dressiness      INTEGER CHECK (dressiness BETWEEN 0 AND 4),
  outfit_group_id TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_event_trip ON trip_event (trip_id, event_date, sort_order);

CREATE TABLE IF NOT EXISTS trip_weather (
  id             TEXT PRIMARY KEY,
  trip_id        TEXT NOT NULL REFERENCES trip (id),
  destination_id TEXT REFERENCES trip_destination (id),
  weather_date   TEXT NOT NULL,
  temp_min_c     REAL,
  temp_max_c     REAL,
  precipitation  REAL,
  wind_kph       REAL,

  -- Crucial: a climate normal must never be presented as a forecast
  -- (01_ARCHITECTURE.md §6). The UI labels this.
  source         TEXT NOT NULL CHECK (source IN ('forecast', 'climate_normal')),
  fetched_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_weather_trip ON trip_weather (trip_id, weather_date);
