-- What Alex has already answered in Review Closet Items (H1d).
--
-- Additive: one new table, no column touched, no row rewritten. Every existing
-- query, every existing screen and every existing test behaves exactly as it
-- did with this file absent — an empty table means "nothing decided", which is
-- the state the whole feature starts from anyway.
--
-- WHY THERE HAS TO BE STORAGE AT ALL
--
-- Most of the queue needs none. *Rate the comfort* stops being asked the moment
-- `item.comfort` is not NULL; the row itself is the record. Three of the four
-- card kinds do NOT have that property, and each of them is a button that would
-- otherwise do nothing:
--
--   * `Keep as is` on a name — the name is already what it is, so a queue built
--     from the row would put the identical card back on the next open.
--   * `Keep both` on a possible duplicate — both rows survive, which is the
--     point, and both still look like duplicates afterwards.
--   * `Keep my choice` on a disagreement — `confirmFields` re-stamps the field,
--     and `decideWrite` deliberately CARRIES `was`/`wasSource` forward when the
--     value has not changed (so *use the spreadsheet value* stays available).
--     The disagreement is therefore still legible tomorrow, by design.
--
-- Plus `Not sure` and `Skip`, which are answers about the QUESTION rather than
-- about the garment and have nowhere on `item` to live.
--
-- WHY A TABLE RATHER THAN ANOTHER JSON COLUMN ON `item`
--
-- 0020 argued the other way for provenance and both arguments are about shape.
-- Provenance is at most one entry per field on a row already being read — it
-- rides along for free. These are sparse (most garments will never have one),
-- unbounded in count per row (one per duplicate partner, one per disagreeing
-- field), and are only ever read by ONE screen. A JSON column would be parsed
-- on every catalog read, by every screen, to answer a question only the review
-- queue asks.
--
-- WHY `topic` IS TEXT AND NOT A CHECKED ENUM
--
-- Two of the four topics carry their subject: `duplicate:<other item id>` and
-- `disagreement:<field>`. *These two are the same garment* is a statement about
-- a PAIR, and recording it against one id alone would suppress the card for
-- every other duplicate that garment has. A CHECK constraint cannot express
-- "one of two literals, or a prefix and an id", and a constraint that only
-- half-describes the values is worse than the comment that fully describes
-- them. `shared/closet-review.ts` owns the vocabulary.
--
-- NOTHING HERE IS DESTRUCTIVE, AND NOTHING HERE IS FINAL
--
-- Every decision is reversible: `not_sure` is offered back from the queue's
-- empty state, and a row deleted from this table simply restores the question.
-- No decision writes a value, archives anything, or merges anything — the
-- writes all go through `confirmFields`, `clearFieldValue` and
-- `revertFieldValue`, which existed before this table and are unchanged by it.

CREATE TABLE IF NOT EXISTS closet_review_decision (
  item_id    TEXT NOT NULL REFERENCES item (id),

  -- 'ratings' | 'name' | 'duplicate:<item id>' | 'disagreement:<field>'
  topic      TEXT NOT NULL,

  -- 'answered'  — settled; the card stops being offered.
  -- 'not_sure'  — cannot answer; withdrawn until Alex asks for it back.
  -- 'skipped'   — not now; moves behind everything else, never disappears.
  decision   TEXT NOT NULL CHECK (decision IN ('answered', 'not_sure', 'skipped')),

  decided_at INTEGER NOT NULL,

  -- One decision per question. Answering again replaces the previous answer,
  -- which is what an UPSERT on this key gives for free — and what stops a
  -- garment skipped four times from holding four rows saying the same thing.
  PRIMARY KEY (item_id, topic)
);

-- The queue reads every decision at once and joins nothing, so the primary key
-- is the only index it needs. An index on `item_id` alone would duplicate the
-- left edge of that key.
