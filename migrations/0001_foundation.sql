-- Milestone 0 — Foundation
--
-- Only what M0 needs. The inventory, trip, outfit, and checklist schema from
-- technical-docs/02_DATA_MODEL.md lands in M1 and later, one migration per
-- milestone, so each is reviewable on its own.

-- Failed login attempts, used for rate limiting. D1-backed rather than
-- in-memory because Workers isolates are per-colo and an in-memory counter
-- would reset unpredictably.
CREATE TABLE IF NOT EXISTS login_attempt (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_key    TEXT    NOT NULL,
  attempted_at  INTEGER NOT NULL  -- epoch seconds
);

CREATE INDEX IF NOT EXISTS idx_login_attempt_client
  ON login_attempt (client_key, attempted_at);
