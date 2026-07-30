# How packing rules combine

Written before user-created rules exist, which is the point: the first moment
two rules can target one item is the moment a user can write the second one.
Doc 09 §18 asks for this to be documented rather than discovered.

**This describes what `computeQuantity` in `shared/rules.ts` actually does
today**, verified against the code at `ef8b61e`, not what would be tidy. Where
the current behaviour is a gap rather than a decision, it says so.

---

## 1. Several rules, one item

Every enabled rule for an item is evaluated, and they combine — they do not
compete. There is no "winning rule".

| Rule kind | How it contributes |
|---|---|
| `fixed_per_trip` | **Assigns** the base outright — see §1.1 |
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
is the behaviour to expect from something called "add a rule".

**No duplication.** Rules add quantity to one checklist row; they never produce
two rows for one item. Doc 09 §18's "do not duplicate an item because several
rules apply" is satisfied by construction rather than by de-duplication.

### 1.1 `fixed_per_trip` makes order matter, and that is a gap

Found by writing the test that was meant to confirm the opposite.

Every other quantity rule combines with `Math.max`. `fixed_per_trip` **assigns**,
so on a ten-day trip:

| Order | Result |
|---|---|
| `per_day: 2`, then `fixed_per_trip: 3` | **3** — the 20 is overwritten |
| `fixed_per_trip: 3`, then `per_day: 2` | **20** |

Nothing in the seeded data pairs the two, so it has never mattered. **The moment
Alex can write his own rules, it can** — which is why this is written down now
rather than after.

**Deliberately not corrected yet.** Changing it changes the quantity on generated
packing lists, and that is a product decision rather than a cleanup;
`CLAUDE.md` forbids silently changing behaviour. The behaviour is pinned in
`tests/unit/worker/rule-precedence.test.ts`, so fixing the engine will fail that
test — which is exactly the right moment to read §3 below.

---

## 2. A gate beats a quantity

`conditional_include` and `dependency_include` are not quantities. If either
fails, the item is **not packed at all**, whatever the other rules say.

This is why order does not matter: a gate short-circuits, so a `per_day` rule
saying "two per day" cannot smuggle an item onto a list whose condition says it
does not belong there.

**Unknown counts as no.** A condition whose fact was never recorded evaluates to
`unknown`, and unknown does not pack. Packing something because a fact was
*missing* is the confident-but-unsupported behaviour `CLAUDE.md` rules out, and
the row is marked incomplete so the trip can say what it could not decide.

---

## 3. The order of authority

Doc 09 §18 asks for this list. Stated as it stands today, with the gaps named:

1. **An explicit trip-level decision.** `qty_override` on a checklist row wins
   over everything — it is read in place of `required_qty` everywhere the app
   resolves a quantity. Removing a row (`excluded_at`) likewise survives
   regeneration. *Implemented.*
2. **A user-created or user-edited rule.** Editing a threshold or a quantity
   clears `needs_review`, and a disabled rule is skipped entirely. *Partly
   implemented:* editing exists (PR #25, #27); creating does not yet, so there
   is no `user` vs `default` distinction stored on a rule.
3. **An accepted learned preference.** Only ever applied by an explicit
   acceptance, and reversible in Packing rules. *Implemented.*
4. **A system default.** The seeded rules. *Implemented.*
5. **Fallback.** No rule at all means the item is not suggested — never a
   guessed quantity. *Implemented.*

### What must be decided when creation ships

Levels 2 and 4 are **not distinguishable in the database today**: a rule has no
column saying who wrote it. That is fine while every rule is seeded, and it is
the first thing to break when Alex can add his own — because "a user rule beats
a default for the same item" cannot be implemented against a schema that cannot
tell them apart.

The choice, when A4 lands, is between:

**And separately, §1.1's ordering gap has to be settled**, because "always pack
3" plus "2 per day" is a pairing a user can create on his first afternoon with
rule creation, and today the answer depends on which row the database returns
first.


- **adding a `source` column** to `packing_rule` (additive, forward-only, in
  keeping with the migration discipline), and
- **keeping `Math.max` for everything** and accepting that a user rule cannot
  lower a default — only disabling the default can.

The second is simpler and matches §1's reasoning, but it makes "I want fewer
than the default" impossible without two actions. **This is a genuine product
decision and is deliberately not being made here**, ahead of the code that needs
it.

---

## 4. What none of this may do

From `CLAUDE.md` and doc 09 §25, restated because they are the failure modes
that matter more than any ordering:

- A rule that appears saved and is not read by generation.
- A rule shown as active while generation ignores it.
- An item duplicated because several rules applied.
- A quantity that cannot be explained — every contribution above appends to the
  breakdown Alex can read on the row.
- A silent change to global behaviour.
