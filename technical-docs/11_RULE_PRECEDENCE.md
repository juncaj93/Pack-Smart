# How packing rules combine

Written before user-created rules existed, which was the point: the first moment
two rules can target one item is the moment a user can write the second one.
Doc 09 §18 asks for this to be documented rather than discovered.

**This describes what `computeQuantity` in `shared/rules.ts` actually does**,
verified against the code, not what would be tidy.

The first version of this document ended with two open questions it deliberately
refused to answer — whether a user rule could ask for *fewer* than a default, and
what to do about `fixed_per_trip` making the answer depend on row order. Both
were ruled on before A4b was built. **§1.1 and §3 are those rulings**; the rest
is the behaviour they left alone.

---

## 1. Several rules, one item

Every rule for an item that is **in force** is evaluated, and they combine — they
do not compete. There is no "winning rule".

"In force" is doing work in that sentence, and §3.1 is where it is defined: a
rule that another rule explicitly replaces is not evaluated at all.

| Rule kind | How it contributes |
|---|---|
| `fixed_per_trip` | **`Math.max`** — a floor, see §1.1 |
| `per_day`, `per_night`, `duration_plus_buffer`, `per_activity_occurrence` | **`Math.max`** against the base so far |
| `minimum` | Raises the final answer if it came out lower |
| `maximum` | Lowers the final answer if it came out higher |
| `spare` | Added on top, after everything else |
| `conditional_include` | A **gate**, not a quantity — see §2 |
| `dependency_include` | A gate on another item being packed |
| `per_outfit_group` | Left to the outfit engine, which knows how many groups exist |

**`Math.max`, deliberately.** Two rules that both describe how many to bring are
two opinions about the same thing, and the larger is the safe one: packing a
spare pair of socks costs a little space, and arriving one short costs the
evening. It also means adding a rule can never *reduce* what Alex packs, which
is the behaviour to expect from something called "add a rule" — and, since A4b,
the reason asking for fewer is a change to a rule rather than a new one.

**No duplication.** Rules add quantity to one checklist row; they never produce
two rows for one item. Doc 09 §18's "do not duplicate an item because several
rules apply" is satisfied by construction rather than by de-duplication.

### 1.1 `fixed_per_trip` is a floor — Alex's ruling

*"Always pack 3"* means *"pack at least 3"*. It is **not** an instruction to
replace a larger quantity another applicable rule worked out.

On a ten-day trip:

| Rules | Result |
|---|---|
| `per_day: 2` | 20 |
| `fixed_per_trip: 3` | 3 |
| both, in either order | **20** |

This corrects a real gap. `fixed_per_trip` used to **assign** the base where
every other quantity rule takes a maximum, so the pair above gave 3 or 20
depending on which row the database returned first. Nothing seeded pairs them,
so it never mattered in practice; a user rule can pair them on the first
afternoon.

**If an exact replacement quantity is ever wanted, it gets an explicit
user-facing mode.** It does not get `fixed_per_trip` quietly becoming
order-dependent again.

### 1.2 Order cannot change the answer, and that is enforced

`computeQuantity` sorts its rules into a fixed fold order — by rule type, then
by id — before it does any arithmetic, and evaluates every gate before any
quantity. Three consequences worth stating, because each was a real defect:

- **The quantity is stable.** No rule assigns, so no rule can overwrite another.
- **The explanation is stable.** `qtyBreakdown` is assembled as the fold
  proceeds, so an unsorted fold produced the same number with the steps written
  in a different order — a row whose reasoning changed between two regenerations
  of one trip.
- **`incomplete` is stable.** Gates used to return at the first failure, so with
  one gate answering "no" and another answering "the trip never recorded that",
  whether the row was marked as needing an answer depended on row order.

Pinned by `tests/unit/worker/rule-precedence.test.ts`, which asserts the reverse
of every rule list gives the same result, and by
`tests/integration/rule-source-migration.test.ts`, which re-generates the whole
real catalog after inverting every rule id.

---

## 2. A gate beats a quantity

`conditional_include` and `dependency_include` are not quantities. If either
fails, the item is **not packed at all**, whatever the other rules say.

Gates are evaluated first, all of them, before any arithmetic. A `per_day` rule
saying "two per day" cannot smuggle an item onto a list whose condition says it
does not belong there.

**Unknown counts as no.** A condition whose fact was never recorded evaluates to
`unknown`, and unknown does not pack. Packing something because a fact was
*missing* is the confident-but-unsupported behaviour `CLAUDE.md` rules out, and
the row is marked incomplete so the trip can say what it could not decide. If
several gates fail and any one of them failed for want of a fact, the row is
marked incomplete — the reason a fact is missing does not stop being worth
reporting because something else also said no.

**A gate supplies a quantity only when nothing else did.** "Pack this" implies
one; a rule that actually counts always decides.

---

## 3. The order of authority

Doc 09 §18 asks for this list. As implemented:

1. **An explicit trip-level decision.** `qty_override` on a checklist row wins
   over everything — it is read in place of `required_qty` everywhere the app
   resolves a quantity. Removing a row (`excluded_at`) likewise survives
   regeneration.
2. **An applicable user override.** A rule with `source = 'user'` that names the
   default it replaces. The default is not evaluated; the override is. See §3.1.
3. **An accepted learned preference.** A rule with `source = 'learned'`, written
   only by an explicit acceptance in *What Pack Smart has noticed*, and
   reversible in Packing rules. Structurally identical to a user override — it
   *is* an override, differing only in who wrote it.
4. **A system default.** The seeded and imported rules, `source = 'system'`.
5. **Fallback.** No rule at all means the item is not suggested — never a
   guessed quantity.

Levels 2, 3 and 4 are one mechanism, not three. What separates them is who wrote
the rule and whether it names a default, both of which are now columns.

### 3.1 Provenance, and what an override is

`packing_rule` gained two columns in migration 0011:

- **`source`** — `system`, `user` or `learned`. Additive and forward-only;
  `learned` was admitted to the CHECK before anything wrote it, so approving a
  further source is a migration rather than a table rebuild.
- **`supersedes_rule_id`** — a real foreign key to the rule this one replaces,
  UNIQUE so a default can never collect two competing overrides.

A `source` column **alone would not have been enough**. It says who wrote a rule;
it does not say *which* default a rule is about, and Alex's ruling is explicit
that the answer must not come from row ordering or loose name matching. An
explicit reference removes the guesswork entirely: a rule either names a default
or it does not.

**`applyPrecedence` is the whole of the resolution.** Any rule named by another
rule's `supersedes_rule_id` is dropped before evaluation. Everything that
survives combines as §1 describes.

Two properties fall straight out of that:

- **A user rule may ask for fewer than a default.** *Underwear — 2 per day*
  seeded, edited to *1 per day*, gives 10 on a ten-day trip. The override
  replaces the default rather than arguing with it, so `Math.max` never sees
  the 2.
- **An unrelated rule cannot silently reduce a default.** A rule created from
  scratch supersedes nothing — `POST /api/settings/rules` has no way to express
  it — so it can only ever combine. Writing *"at least 1"* alongside *"2 per
  day"* still gives 20.

`applyPrecedence` deliberately ignores `enabled` on the replacing rule, because a
**disabled override is how "switch this default off" is stored**. Resolving
after filtering disabled rules would resurrect the default the override exists to
silence.

### 3.2 Editing a default never writes to it

The canonical system record is never mutated. `editRule` decides this from the
rule's own provenance rather than leaving it to each caller — including
*Your usual amounts*, *Packing rules*, and the learning panel:

1. the system rule is preserved, wording and all;
2. a user-owned **copy** of it is created or updated, carrying the change;
3. the interface shows the effective value, and says what it changed from;
4. `Use the default` deletes the copy, and the default is back exactly — not
   reconstructed, because it never went anywhere.

Disabling is the same mechanism: an override that contributes nothing. It is an
explicit, reversible decision recorded beside the default rather than a deletion
of it. This is also how accepting a learning suggestion works now; it used to
write `enabled = 0` straight over a seeded row, which left the default and the
decision to stop using it as the same record with nothing to restore to.

**What can be deleted**, and nothing else: a rule Alex wrote from scratch. A
default is turned off; an override is removed by restoring the default. Both
refusals say what to do instead.

### 3.3 What A4b did not build

Creating a rule offers four kinds — always pack, at least, no more than, spare
(`CREATABLE_RULE_TYPES`). Two absences are deliberate:

- **`per_day` and `per_night`** already have a friendlier door in *Your usual
  amounts*. Two screens creating the same row in the same table is how they
  start disagreeing about what a duplicate is.
- **The conditional kinds.** Authoring a condition needs a vocabulary of trip
  facts on screen, and doc 09 §18 rules out a generic builder over raw database
  fields. The single number inside an existing conditional rule is editable
  (PR #27); writing a new one is not part of A4b.

---

## 4. Existing trips are not rewritten

Making the engine deterministic must not reach backwards into a trip that is
already planned. Alex's ruling, and what `generateChecklist` does:

- **A hand-set quantity or an exclusion is preserved.** It is level 1 of §3, and
  regeneration counts it as `preserved` rather than touching it.
- **Rows the engine owns follow the rules**, on a newly generated list, on an
  explicit regeneration, and on a recalculation triggered by a relevant trip
  change such as its dates.

So a finalised list keeps the numbers Alex settled on, and an untouched row picks
up the corrected arithmetic the next time that trip is generated. Nothing
rewrites a stored quantity as a side effect of deploying this.

---

## 5. What none of this may do

From `CLAUDE.md` and doc 09 §25, restated because they are the failure modes
that matter more than any ordering:

- A rule that appears saved and is not read by generation.
- A rule shown as active while generation ignores it.
- An item duplicated because several rules applied.
- A quantity that cannot be explained — every contribution above appends to the
  breakdown Alex can read on the row.
- A silent change to global behaviour.
- A change to a default that cannot be undone, or that loses the wording the
  default was imported with.
