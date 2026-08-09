-- P3: which bags are actually coming, and the seven facts that decide what goes
-- in them.
--
-- ## The trip half
--
-- `luggage_mode` holds one of `carry_on` / `checked` / `unknown`, and that
-- cannot say "a personal item and a checked bag" — which is most flights — nor
-- "no bags of that kind at all", which is every train and every drive. It is
-- NOT dropped: it is still the answer for every trip that predates this, and
-- `availableBags` falls back to it whenever `bags_json` is NULL. Dropping a
-- column that existing rows depend on would be a destructive migration for no
-- gain.
--
-- `bags_json` is a JSON array of `personal_item` / `carry_on` / `checked`.
-- NULL means "not stated" and reads through to the old column. An empty array
-- means "none of these", which is a real answer for a road trip and is
-- deliberately different from NULL.
--
-- ## The item half
--
-- Seven nullable columns, and **nullable is the point**. NULL is *not recorded*
-- and never reads as false: "we do not know whether this is a full-size liquid"
-- must not become "this is not a full-size liquid", because the second sentence
-- would let a 200ml bottle through cabin security on Pack Smart's say-so. Every
-- rule that reads these treats NULL as unknown and declines to conclude.
--
-- Only facts that CHANGE a bag recommendation are here. Colour, weight, exact
-- dimensions and the rest would be a packing ontology, and doc 09 §8.4 is
-- explicit that this must not become one. Everything else the rules need —
-- category, subcategory, criticality, warmth, weather tags, typical uses — is
-- already on the row.
--
-- `liquid_size` is a two-value distinction rather than millilitres: `cabin`
-- means it is within the usual 100ml cabin limit, `full` means it is not. Alex
-- knows which of those a bottle is at a glance; he does not know its volume.
--
-- Additive only. No column is dropped, no value is rewritten, and a Worker
-- running the previous code against this schema behaves exactly as it does now.

ALTER TABLE trip ADD COLUMN bags_json TEXT;

ALTER TABLE item ADD COLUMN is_liquid INTEGER CHECK (is_liquid IN (0, 1));
ALTER TABLE item ADD COLUMN liquid_size TEXT CHECK (liquid_size IN ('cabin', 'full'));
ALTER TABLE item ADD COLUMN is_fragile INTEGER CHECK (is_fragile IN (0, 1));
ALTER TABLE item ADD COLUMN is_valuable INTEGER CHECK (is_valuable IN (0, 1));
ALTER TABLE item ADD COLUMN is_medical INTEGER CHECK (is_medical IN (0, 1));
ALTER TABLE item ADD COLUMN is_transit_needed INTEGER CHECK (is_transit_needed IN (0, 1));
ALTER TABLE item ADD COLUMN is_bulky INTEGER CHECK (is_bulky IN (0, 1));
