-- What Alex says after a trip, and whether he has said it (F1, doc 09 §16).
--
-- One nullable column and one new table. Nothing existing is rewritten, no
-- CHECK is loosened, nothing is dropped. A database at 0015 upgrades by gaining
-- two objects, and every trip already in it reads as "not reviewed yet", which
-- is exactly what it is. Safe to apply ahead of the code that uses it, which is
-- the order the deploy workflow applies migrations in.

-- ---------------------------------------------------------------------------
-- trip.reviewed_at
-- ---------------------------------------------------------------------------
--
-- Whether the post-trip sitting happened, which is NOT the same question as
-- whether it produced anything.
--
-- A review where Alex reads the summary, has nothing to report and taps Finish
-- is a complete review that leaves no answers behind. Deriving "reviewed" from
-- the existence of an answer row would therefore keep offering the review to
-- the person who has already done it and had nothing to say — which is the one
-- outcome most likely to be true, and the fastest way to teach him to ignore
-- the prompt.
--
-- It is also the only piece of review state `readiness()` needs. The model's
-- `finished` stage is the one stage that returns no recommended action; this
-- column is what lets it recommend the review exactly once.
ALTER TABLE trip ADD COLUMN reviewed_at INTEGER;

-- ---------------------------------------------------------------------------
-- trip_review_answer
-- ---------------------------------------------------------------------------
--
-- The answers, and deliberately not the proposals.
--
-- `shared/learning.ts` derives its two proposal kinds from evidence that was
-- already recorded — `excluded_at`, `wear_log` — and stores nothing, because a
-- stored proposal goes stale against the history that produced it.
-- `preference_change_suggestion` (migration 0004) is unused for that reason and
-- stays unused.
--
-- That argument does not reach here. "What did you forget" is the one class of
-- evidence in the product that exists only because Alex typed it: nothing in
-- the checklist, the wear log or the outfits records the thing that never made
-- it into the bag. So the ANSWER is stored, and the proposal is still derived —
-- from the answer plus whatever the rules say at the moment it is read. An item
-- whose spare already exists produces no proposal, without anything having to
-- go back and invalidate a stored one.
CREATE TABLE IF NOT EXISTS trip_review_answer (
  id       TEXT PRIMARY KEY,
  trip_id  TEXT NOT NULL REFERENCES trip (id),

  -- What Alex told it. One kind per question the review asks, and the CHECK is
  -- the list — a kind nothing knows how to turn into a proposal must not be
  -- storable.
  kind     TEXT NOT NULL CHECK (kind IN
             ('forgot', 'ran_out', 'too_many', 'outfit_wrong', 'missing_from_screen')),

  -- The thing it is about, when it is about something Pack Smart knows.
  -- NULLABLE for the same reason `checklist_entry.item_id` is: "I forgot a
  -- European plug adapter" is a real answer about a thing he does not own, and
  -- refusing it would be the app declining evidence because it has no row for
  -- it. `note` carries that case.
  item_id         TEXT REFERENCES item (id),
  outfit_group_id TEXT REFERENCES outfit_group (id),
  note            TEXT,

  -- Whether the proposal this answer produces has been acted on.
  --
  -- The existing two proposal kinds have no equivalent and do not need one: a
  -- derived proposal Alex ignores simply reappears when the evidence does,
  -- which is correct for evidence that accumulates. A sentence he typed does
  -- not accumulate, so declining it once has to be final or the review would
  -- ask about the same sentence for ever.
  resolution  TEXT NOT NULL DEFAULT 'pending'
                CHECK (resolution IN ('pending', 'accepted', 'declined')),
  resolved_at INTEGER,

  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_answer_trip ON trip_review_answer (trip_id, created_at);
