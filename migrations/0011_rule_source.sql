-- Who decided a rule, and which default it replaces.
--
-- `11_RULE_PRECEDENCE.md` §3 named this as the first thing to break when Alex
-- can write his own rules: levels 2 and 4 of the order of authority — "a user
-- rule" and "a system default" — were not distinguishable in the database. A
-- rule had no column saying who wrote it, so "a user rule beats a default for
-- the same item" could not be implemented at all.
--
-- Additive and forward-only, in keeping with the migration discipline: two new
-- columns, no column dropped, no row deleted, no CHECK loosened. Every existing
-- rule keeps the behaviour it had, because every existing rule becomes a
-- `system` rule that nothing supersedes.

-- ---------------------------------------------------------------------------
-- source
-- ---------------------------------------------------------------------------
--
-- `learned` is in the CHECK from the start even though nothing writes it yet.
-- Alex's ruling asks for a design where another approved source can be added
-- later "without rewriting the model", and in SQLite a CHECK constraint can
-- only be widened by rebuilding the table — so the third value is admitted now,
-- while the table is small and the migration is free. `acceptRemovalProposal`
-- becomes its first writer in this same release.
--
-- The default is `system`, which is the honest reading of every row that
-- already exists: they all came from the spreadsheet import or a seed
-- migration. The one exception is backfilled below.
ALTER TABLE packing_rule ADD COLUMN source TEXT NOT NULL DEFAULT 'system'
  CHECK (source IN ('system', 'user', 'learned'));

-- ---------------------------------------------------------------------------
-- supersedes_rule_id
-- ---------------------------------------------------------------------------
--
-- The smallest additive relationship that makes an override safe.
--
-- A `source` column ALONE cannot say WHICH default a user rule replaces, and
-- Alex's ruling is explicit that the answer must not come from row ordering or
-- loose name matching: creating an unrelated rule for a different circumstance
-- must never be read as a silent reduction of an existing default. An explicit
-- reference removes the guesswork — a rule either names the default it replaces
-- or it does not replace one.
--
-- A real foreign key, so an override cannot point at a rule that was never
-- there. UNIQUE (partial, because SQLite treats NULLs as distinct but a unique
-- index still reads better with the predicate stated) so one default can never
-- collect two competing overrides — which would put us back to asking the
-- database which row comes first.
ALTER TABLE packing_rule ADD COLUMN supersedes_rule_id TEXT REFERENCES packing_rule (id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_supersedes
  ON packing_rule (supersedes_rule_id)
  WHERE supersedes_rule_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- backfill
-- ---------------------------------------------------------------------------
--
-- One class of existing row is genuinely Alex's rather than the spreadsheet's:
-- an amount added through `Your usual amounts`, which `worker/routes/settings.ts`
-- has always stamped with this exact wording. Marking those `user` is a
-- statement of fact about data that already exists, and it changes no quantity:
-- nothing supersedes anything, so every rule still combines exactly as it did.
--
-- Matched on the literal string our own code wrote, not on a pattern. A LIKE
-- would also catch a spreadsheet row that happened to contain the phrase, and
-- guessing at provenance is precisely what this migration exists to end.
UPDATE packing_rule
   SET source = 'user'
 WHERE original_text = 'Set in Your usual amounts';
