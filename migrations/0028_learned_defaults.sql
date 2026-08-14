-- What repeated corrections are allowed to become, and what Alex has said no to
-- (P4c, product doc 04 §7).
--
-- ADDITIVE ONLY. One nullable column and one new table. Nothing existing is
-- rewritten, no CHECK is loosened, nothing is dropped, and a database at 0027
-- upgrades by gaining two objects. Every trip, every item and every test already
-- in it behaves exactly as it did with this file absent — a NULL default_bag is
-- "no learned preference", which is the state everything starts from, and an
-- empty decision table is "nothing declined".
--
-- ---------------------------------------------------------------------------
-- THE RULE THIS SCHEMA HAS TO EXPRESS
-- ---------------------------------------------------------------------------
--
--   Behaviour creates a PROPOSAL. Alex creates TRUTH.
--
-- Neither object below is ever written by observation. `default_bag` is written
-- only when Alex accepts a proposal, and a decision row is written only when he
-- declines one or sets it aside. The evidence itself — `checklist_entry.bag`,
-- `packing_timing`, `qty_override` — is already recorded and is counted on read,
-- which is why there is no table of observations here and no counter anywhere
-- that a write path has to maintain.
--
-- ---------------------------------------------------------------------------
-- item.default_bag
-- ---------------------------------------------------------------------------
--
-- The one learned preference with nowhere existing to live.
--
-- The other two proposal families in this slice need no schema at all, and that
-- is not a coincidence — it is the test that was applied before adding anything:
--
--   * a repeated TIMING correction lands on `item.default_packing_timing`,
--     which has existed since 0002 and is already what seeds a new row;
--   * a repeated QUANTITY correction lands on the rule's `quantity_value`,
--     written through `editRule` as a `learned` override exactly the way
--     `acceptRemovalProposal` already writes one.
--
-- A bag has no such column. `checklist_entry.bag` is per-trip by construction —
-- it is where this garment went on THIS trip — and reusing it as a catalog
-- default would make one row mean two things. So one nullable column, holding
-- the same five values `BagKey` already has.
--
-- WHY NOT A TRAIT
--
-- The seven trait columns from 0025 describe the OBJECT: is it a liquid, is it
-- fragile. `bag_for` derives a recommendation from them. This is not a fact
-- about the object at all — it is Alex's habit — so it sits beside the traits
-- rather than among them, and `recommendBag` reads it BEFORE the trait rules and
-- AFTER an explicit per-trip choice. That ordering is the whole safety story:
-- the cabin-only floor still wins over it (a learned "checked bag" for a
-- passport can never be proposed, because the floor never let the passport be
-- assigned there to be observed), and a bag Alex picks on a trip still wins over
-- everything.
ALTER TABLE item ADD COLUMN default_bag TEXT
  CHECK (default_bag IN ('wear', 'personal_item', 'carry_on', 'checked', 'either'));

-- ---------------------------------------------------------------------------
-- learning_decision
-- ---------------------------------------------------------------------------
--
-- What Alex has said about a SUGGESTION, as opposed to about a garment.
--
-- Until now the two derived proposal families had no decline at all: a
-- suggestion Alex disagreed with came back on every open, forever, which is the
-- fastest way to teach him the panel is not worth reading. Accepting was
-- self-clearing (the rule is disabled, so the proposal stops being derived) and
-- that half was fine; declining had nowhere to go.
--
-- WHY A TABLE AND NOT A COLUMN
--
-- The subject of a decision is not always an item. A quantity proposal is about
-- a RULE, and future families may be about neither — so the key is a free-text
-- subject plus a topic, the same shape `closet_review_decision` settled on in
-- 0023 for the same reason.
--
-- WHY NOT REUSE `closet_review_decision`
--
-- It is keyed on `item_id` with a foreign key to `item`, which a rule-scoped
-- decision cannot satisfy, and `listDecisions` reads every row in it for a
-- different screen. Two features sharing one table where one of them cannot
-- honour the key is a constraint waiting to be dropped.
--
-- WHY THE TOPIC CARRIES THE VALUE
--
-- `bag:checked` rather than `bag`. Declining *put this in the hold* must not
-- silence a later, different observation — if the habit changes to the personal
-- bag, that is new evidence and deserves to be asked about once. Silencing the
-- whole subject would turn one "no" into a permanent deafness.
--
-- NOTHING HERE IS FINAL
--
-- `not_sure` is withdrawn until Alex asks for it back, exactly as in 0023, and
-- deleting a row simply restores the question. No decision writes a preference,
-- disables a rule or touches a trip.
CREATE TABLE IF NOT EXISTS learning_decision (
  -- The item id, or the rule id for a quantity proposal. Deliberately not a
  -- foreign key: the two subject kinds point at two different tables, and a
  -- constraint that can only be right for one of them is worse than none.
  subject    TEXT NOT NULL,

  -- 'timing:<value>' | 'bag:<value>' | 'amount:<n>'
  topic      TEXT NOT NULL,

  -- 'declined'  — he disagreed; this exact suggestion stops being offered.
  -- 'not_sure'  — cannot answer now; withdrawn until he asks for it back.
  decision   TEXT NOT NULL CHECK (decision IN ('declined', 'not_sure')),

  decided_at INTEGER NOT NULL,

  -- One decision per suggestion. Answering again replaces the previous answer,
  -- which an UPSERT on this key gives for free.
  PRIMARY KEY (subject, topic)
);
