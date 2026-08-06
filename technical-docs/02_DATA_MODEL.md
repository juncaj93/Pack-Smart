# Pack Smart — Data Model

Status: **Approved.**

## 1. Two structural rules

These make most of the product's data-integrity requirements true *by construction* rather than by
developer discipline.

### Rule 1 — Catalog and trip state never share a write path

Catalog tables (`item`, `packing_rule`, `preference`) hold permanent state. Trip-scoped tables hold
per-trip state. **No endpoint writes across the boundary.** Editing a checklist row physically
cannot modify a preference or an inventory item.

This is how "trip edits default to this trip only" (doc 03 §7) stops being a rule anyone can forget.
Promoting a trip edit into a permanent preference is a separate, explicit endpoint.

### Rule 2 — Nothing is ever deleted

Items are archived (`archived_at`). Checklist rows are excluded (`excluded_at`). Import rows are
retained with their decision. Deletion is not part of the normal product surface.

Two rule operations are the exception, and both are narrow. A rule Alex wrote from scratch can be
deleted — there is nothing behind it to preserve and nothing it replaced. Removing an override is
also a delete, and is the mechanism by which the default it was shadowing comes back. A **system
default is never deleted**: it is switched off, which is reversible and keeps the spreadsheet
wording it was imported with.

## 2. Catalog tables

### `item`

One unified table for clothing and gear, discriminated by `kind` (`clothing` | `gear`), because
My Stuff is one experience (doc 02 §10) and the whole catalog is ~120 rows. Kind-specific columns
are simply nullable — a separate attributes table would be indirection at this scale.

```
id, kind, display_name, category, subcategory, color, pattern, brand, notes,
favorite, usage_frequency (frequent|sometimes|rare|new),
warmth 0-3, dressiness 0-4, weather_tags JSON, typical_uses JSON, reuse_capacity,
owned_quantity,
is_critical, requires_final_check, default_packing_timing,
always_include, never_include,
archived_at, source (seed_import|manual|trip_promoted), source_row_json,
created_at, updated_at
```

`owned_quantity` exists because three seed rows encode a count in the name
(`Boxer Briefs (~15 Pairs)`). Knowing Alex owns ~15 pairs lets the system warn that a 12-day trip at
2/day needs more than the drawer holds, instead of cheerfully asking for 24.

### `packing_rule`

```
id, item_id, rule_type, quantity_value, buffer, condition_json,
depends_on_item_id, enabled, original_text, needs_review, created_at,
source, supersedes_rule_id
```

`source` (`system` | `user` | `learned`) and `supersedes_rule_id` were added in migration 0011 and
are the whole of rule precedence. `source` says who decided a rule; `supersedes_rule_id` names the
default it replaces, as a real foreign key with a UNIQUE index so one default can never collect two
competing overrides.

**Editing a default writes a copy, never the default.** A rule Alex changes is stored as a
user-owned rule that supersedes the seeded one, so removing it restores the original exactly rather
than reconstructing it — the Rule 2 discipline below, applied to rules as well as to items. A
*disabled* override is how "switch this default off" is stored. `technical-docs/11_RULE_PRECEDENCE.md`
§3 is the full statement.

`rule_type` covers the eleven types in doc 03 §6: `fixed_per_trip`, `per_day`, `per_night`,
`per_activity_occurrence`, `per_outfit_group`, `minimum`, `maximum`, `spare`,
`duration_plus_buffer`, `conditional_include`, `dependency_include`.

`condition_json` is a small structured predicate DSL evaluated by a pure function:

```json
{"fact": "nights", "gte": 3}
{"fact": "activities", "contains": "safari"}
{"all": [{"fact": "international", "eq": true}]}
```

Each predicate renders to a human sentence for explanations. `original_text` always holds the source
string so a rule can be audited against where it came from.

### `preference`

Typed key/value. The approved seeded values:

```
contacts_basis   = { per: "trip_day", multiplier: 2 }
underwear_basis  = { per: "trip_day", multiplier: 2 }
```

plus reuse defaults and warmth bias.

### `outfit_pairing`

Which garments Alex has approved **together**, for doc 04 §5 criterion 3.

```
item_a_id  TEXT  -- canonically the LOWER id of the pair
item_b_id  TEXT
times_approved   INTEGER
last_approved_at INTEGER
PRIMARY KEY (item_a_id, item_b_id)
```

A **catalog** table, not a trip-scoped one, which is the whole point: it outlives the trip that
taught it. It is the only place a per-trip action produces lasting catalog state, so the write is
announced and undoable in the UI (doc 04 §5).

- Canonical ordering (`item_a_id < item_b_id`) means one row per pair however it is looked up.
  Storing both directions would let the two halves disagree.
- Written on the **draft → approved** transition and reversed on **approved → draft**. The
  transition is checked before writing; re-approving an already-approved group must not double
  count, and un-approving must not leave the count behind.
- Rows reaching zero are deleted. That is not a violation of Rule 2 — a count of zero and an absent
  row mean exactly the same thing, and this table records a **current** belief rather than history.
  Nothing about the trips themselves is lost.
- Archived garments keep their rows. An archived item cannot be recommended anyway (stage 1 filters
  it), and deleting the pairing would destroy the record if it were ever un-archived.

**`trip_day` is the inclusive calendar count** (`(end − start) + 1`). **`night` is the exclusive
count.** 31 July → 11 August is **12 trip days** and **11 nights**. Both are computed once as
structured trip facts and never re-derived ad hoc — the two are quietly easy to confuse and the
difference is two pairs of contacts.

## 3. Trip-scoped tables

- **`trip`** — dates, status (`planning|packing|active|completed`), `notes_raw`, luggage mode,
  laundry, max dressiness, flight hours, international flag, timezone, and `emoji`.
  `emoji` is the trip's identity (product doc 02 §9a). It is **stored, not derived at read
  time**: a suggestion computed on every render would change under Alex when he edits the trip,
  and an icon he recognises a trip by has to be stable. Suggested on creation, overridable, and
  never recalculated afterwards.
- **`trip_destination`** — name, lat/lon, country, arrive/depart dates, order. **All of these are
  now written**; `arrive_date`, `depart_date` and the coordinates sat NULL until multi-city
  existed. `destinationForDate()` in `shared/trips.ts` is the single stated rule for which stop a
  date belongs to, and it returns NOTHING for a multi-stop trip with no dates rather than guessing
  — the answer decides which forecast a day is planned against, and a wrong one is a confident
  forecast for the wrong continent.
- **`trip_fact`** — the explainability backbone: `fact_key`, `value_json`, `certainty`
  (`certain|likely|possible`), `source` (`user|structured|detected|preference|default`),
  `evidence_text` + character offsets, `confirmed_at`, `superseded_by`. Every fact traces to a
  quotable cause. This is what "Here is what Pack Smart understood" reads from.
- **`trip_event`** — date, times, title, activity tag, indoor/outdoor, dressiness, `outfit_group_id`.
- **`trip_weather`** — per destination-date min/max temp, precipitation, wind, and crucially
  `source` (`forecast` | `climate_normal`) plus `fetched_at`. `destination_id` **is now
  populated** — it was NULL on every row until multi-city, which meant the same date on two stops
  was indistinguishable. A NULL still reads as "the trip's one place", so rows written before this
  are not orphaned.
- **`outfit_group`** — name ("Safari mornings"), activity tag, `occurrences`, dressiness, expected
  conditions, status (`draft|approved|incomplete`).
  `incomplete` means **a required slot is unfilled**, and nothing else. An approved outfit standing on
  a garment the trip is not bringing (doc 04 §8) is *also* shown as incomplete, but that is **derived
  on read** from the checklist and never written here — writing it would drop the group out of
  `syncChecklistFromOutfits` and take its other garments off the list. See
  `09_IMPLEMENTATION_NOTES.md` §2.10.
  `deferred_at` (migration 0012) records "decide later" from the guided review.
  Deliberately **not** a fourth status: deferral is orthogonal to completeness, so
  a deferred group is still `draft` or still `incomplete` and is still counted as
  unresolved by `readiness()`. It changes nothing else — the slots, the status and
  the packing list are untouched, and only `status = 'approved'` puts clothing on
  the list.
  `dressiness` and `expected_conditions` exist in the schema and are written
  `NULL` by `generateOutfits`; the screen derives both from the template and the
  stored forecast instead. Recorded so neither column is mistaken for populated.
- **`outfit_slot`** — `slot_role` (`top|mid|outer|bottom|footwear|accessory|swim`), `required`,
  `item_id` (**nullable**), `reuse_allowed`, `rank_score`, `reason_json`, `filled_by`
  (`generated|user_swap`), `unmet_reason`.
  A nullable `item_id` with an `unmet_reason` is how doc 04 §15's "No suitable packed rain layer
  found" is represented — the system records a gap instead of inventing a garment.
- **`checklist_entry`** — `item_id` (nullable for trip-only items), `name_snapshot`,
  `category_snapshot`, `required_qty`, `qty_breakdown_json`, `qty_override`, `packed_qty`,
  `packing_timing`, `requires_final_check`, `final_checked_at`, `excluded_at`, `source`,
  `reason_text`, `rule_snapshot_json`, `is_critical`, `trip_only`, `sort_order`.
- **`checklist_link`** — many-to-many between `checklist_entry` and `outfit_slot`. This is the table
  that makes outfit↔checklist synchronization work in both directions.
- **`wear_log`** — item, event, date, action
  (`will_wear|already_wore|not_available|too_warm|too_cold`).
- **`daily_plan`** — per trip-date-event: accepted outfit group + `adjustments_json`, so During Trip
  is continuous rather than regenerated on each open.
- **`preference_change_suggestion`** — trigger kind, proposal, status
  (`pending|accepted|dismissed`). Drives "Update your usual preference?" without ever auto-applying.

## 4. Import tables

- **`import_run`** — filename, file hash, summary JSON, status.
- **`import_row`** — sheet, row number, `raw_json`, `normalized_json`, `identity_hash`, `decision`
  (`imported|merged_duplicate|needs_review|skipped_by_user`), `matched_item_id`, note.

Every source row survives with its fate recorded. Nothing is silently discarded.

## 5. Derived, never stored

The four checklist sections are **computed**. Storing both a timing and a section is the
two-sources-of-truth bug in miniature.

- **Not Bringing** = `excluded_at IS NOT NULL`
- **Final Check** = `requires_final_check AND NOT final_checked_at` (shown *in addition to* its
  timing section — doc 03 §8 makes packing timing and final verification separate concepts)
- **Pack Later** = timing `day_of` or `last_minute`
- **Pack Now** = everything else

"Packed" is likewise derived from `packed_qty >= required_qty`, so a tap that fills the quantity and
a manual quantity edit can never disagree.

## 6. Quantity composition

`required_qty` is recomputed, never hand-maintained:

```
base = max(rule-derived demand, outfit-derived demand)
  → apply minimum floors
  → add spares
  → apply maximum caps
  → qty_override, if set, wins absolutely
```

`qty_breakdown_json` holds the human-readable derivation ("12 trip days × 2 = 24") and *is* the
explanation — there is no separate explanation logic that can drift out of sync.

## 7. How old trips stay accurate after inventory changes

Four layers:

1. **Archive, never delete.** `archived_at` is set; the row and its foreign keys survive forever.
2. **Snapshots on trip rows.** `name_snapshot` and `category_snapshot` are captured when an item
   enters a trip. Renaming "Black Zip-Up" to "Old Black Zip-Up" in 2027 does not rewrite what the
   2026 checklist said. Active trips display live values; completed trips display snapshots.
3. **Rule snapshots.** `rule_snapshot_json` and `reason_text` are frozen onto each checklist entry,
   so a completed trip can still explain why it packed 24 pairs of underwear even after the
   preference changes.
4. **One archive filter, in one place.** Candidate selection for new recommendations passes through
   a single function applying `archived_at IS NULL`. Historical reads never call it. This satisfies
   "archived items do not appear in new recommendations but remain visible in historical trips"
   without scattering the condition across every query.

---

## 8. Per-value provenance on `item` (H1a)

`item.source` says where the **row** came from — `seed_import`, `manual`,
`trip_promoted`. `item.field_provenance` says where each **value** came from.
They are separate on purpose: a `seed_import` row can hold a dressiness Alex
confirmed himself, and until H1a there was no way to write that down.

The precedence rules live in `shared/provenance.ts`; migration
`0020_item_field_provenance.sql` is the storage. This section is the contract.

### Why it had to exist before any rating ships

G5b's *Update existing* writes the spreadsheet over the stored row. A comfort
score or a confirmed dressiness shipped without provenance is silently
overwritten by the next import — the exact failure `CLAUDE.md` forbids. Doc 09
§7 records the dependency: provenance is not a sub-task of Review Closet Items,
it is its precondition.

### The order of authority

| Rank | Source | Means |
|---|---|---|
| 0 | `system_default` | Nobody decided it. A column default, or a value `normalise` filled in |
| 1 | `inferred` | We worked it out from something else, and it is a guess |
| 2 | `imported` | A column the workbook actually has, read rather than guessed |
| 3 | `learned_proposal` | A learned proposal **Alex accepted** |
| 4 | `user_confirmed` | Alex said this value, in the editor or in the review queue |

**The whole rule: a write at rank R may set a field whose current rank is at
most R.** Greater-or-*equal*, so a source can correct itself — a second import
may revise what the first wrote. What it may not do is climb.

`learned_proposal` sits above `imported` because accepting a proposal is Alex
answering a question, and an import that arrives later must not undo an answer.
An **unaccepted** proposal never appears here at all: it is not a durable value,
it lives in the review queue, and the row keeps whatever it had. `user_confirmed`
sits above it because a direct answer beats an accepted suggestion.

**An absent entry is rank 0.** That single choice is what makes 0020 safe: every
row written before it has a NULL column, every field on those rows reads as the
floor, and every writer can still write them — exactly what those rows did the
day before.

### Which fields carry provenance, and which do not

**A field is provenanced when more than one authority can write it.** That is
the whole membership test.

| Provenanced | Why |
|---|---|
| `displayName`, `category`, `subcategory`, `color`, `pattern`, `brand`, `notes`, `typicalUses`, `ownedQuantity` | Written by the importer at `imported`, and by Alex |
| `warmth`, `dressiness` | Written by the importer at `inferred` — `normalizeGarment` guesses both from the Style / Use Case column and says so — and by Alex |
| `isCritical`, `requiresFinalCheck`, `alwaysInclude` | Written by the **gear** importer at `imported`, and by Alex |

| Not provenanced | Why |
|---|---|
| `favorite`, `usageFrequency`, `weatherTags`, `reuseCapacity`, `defaultPackingTiming`, `neverInclude` | Only Alex writes them. After H1a no importer *can* |
| `kind` | A function of `category`, not a value anyone chooses |
| `archivedAt` | A lifecycle state, not an opinion about the garment |
| `source`, `createdAt`, `updatedAt` | Facts about the row |

The list is **code** (`PROVENANCED_FIELDS`), not schema. Adding a field when a
second writer appears — H1b's comfort and versatility, H1c's dressiness range —
costs a line and **no migration**. That is the reason the storage is one JSON
column rather than fourteen dedicated ones or a side table.

### Storage

One nullable `TEXT` column holding an object keyed by field name:

```json
{"dressiness": {"source": "user_confirmed", "at": 1780000000,
                "was": 2, "wasSource": "inferred"}}
```

`was` / `wasSource` are **one level of undo**, and one is the whole requirement:
G5's *Use the default* restores the value an override replaced, and this is the
same promise for a field. A full history would grow without bound in a column
parsed on every catalog read, to answer a question no screen asks.

An unparseable column, an unknown field name and an unrankable source all read
as *nothing recorded* rather than throwing — the same posture as `parseJsonArray`
beside it.

### Every case, and what happens

| Case | Behaviour |
|---|---|
| **First import** | Read columns land at `imported`, `warmth` and `dressiness` at `inferred`. A field the workbook left blank gets **no entry** — writing one would claim the spreadsheet said something it did not |
| **Repeated import** | Identical file is all `exact_duplicate` and writes nothing. A changed file at `update_existing` is decided per field |
| **Import vs a confirmed value** | Refused. The stored value stands, and the difference is returned in `refusedWrites` as a suggestion — reported, never applied |
| **Import vs a confirmed value that agrees** | Silent. A refusal that changes nothing is not worth a review card |
| **Editing in My Stuff** | Only fields whose value **actually moved** are stamped `user_confirmed`. The form posts the whole item back; stamping the lot would mean changing a colour silently promised no import may ever touch the dressiness |
| **Confirming without editing** (*Keep as is*) | `confirmFields` — the value does not move, its authority does. This is the review queue's door, and it is why the editor's restraint above is safe |
| **Clearing a confirmed value** | The value becomes null and the provenance stays `user_confirmed`. "I do not want a value here" **is** an answer; dropping the entry would let the next import helpfully refill it |
| **Reverting** (*Use the value from my spreadsheet*) | Restores the superseded value **and** its source, so the field is genuinely back under that source's authority and an import may write it again |
| **Copied item** | Inherits the provenance verbatim. Provenance is about the garment; duplicating a row does not un-confirm it. The copy's `item.source` becomes `manual` because the **row** is new |
| **Archived item** | Untouched — archiving is not a write to any value. Confirmations still hold against an import |
| **Duplicate reconciliation** | `exact_duplicate`, `keep_existing`, `skip` write nothing. `import_separately` gives the new row its own fresh provenance — the confirmation belongs to the garment Alex confirmed, not to a new one sharing its name |
| **Accepted learning** | Written at `learned_proposal`. Outranks a later import; outranked by a direct confirmation |
| **Rejected proposal** | Nothing is written. The field stays exactly where it was, still writable by the source that owns it |

### What H1a fixed on the way past

`updateItemStatement` took a whole `ItemInput` and wrote every column from it.
The importer only ever fills part of one — `toItemInput` carries eleven fields,
`gearToItemInput` six — so `normalise` turned each omission into a **default**
and the UPDATE wrote the default over whatever was there.

Measured: choosing *Update existing* on one changed garment reset `favorite` to
0, `usage_frequency` to `new`, `reuse_capacity` to NULL, `default_packing_timing`
to `anytime`, the three include flags to 0, and `weather_tags` to `[]` — on a row
the workbook said nothing about any of that.

**The weather one is the serious one.** §9 of doc 09 makes `weather_tags` the
only source the planner trusts for rain, so a jacket silently stopped being a
rain layer.

It is now `patchItemStatement`, which takes only the fields the caller carries.
A field the writer does not name cannot be defaulted over, because it is not
there.

### The migration

`0020` is additive: one nullable column, no column dropped, no CHECK loosened.

It **does** backfill, which this repository normally does not (0019 says so in
as many words). The exception is worth it because the backfill writes **no
value** and changes **no import outcome**, and it is the difference between the
H1d queue being able to say *this dressiness was guessed* on day one and not
being able to say it at all.

The behaviour-neutrality is arithmetic, not a hope: the backfill writes
`inferred` (1) and `imported` (2), an import writes at rank 2, and 2 ≥ 2 and
2 ≥ 1 — so every field stays exactly as overwritable as it was.
`tests/integration/provenance.test.ts` asserts that rather than trusting this
paragraph.

Scoped to `source = 'seed_import'` — the only rows the importers wrote — and
split by `kind`, because the clothing importer never sets the gear flags and the
gear importer never sets `typicalUses`. Marking either would attribute a
`normalise` default to a workbook that never mentioned it. A `manual` row gets
nothing: claiming Alex confirmed fourteen fields because he once saved a form is
precisely the guess this column exists to end.

---

## 9. Comfort and versatility (H1b)

Two optional 1–5 ratings only Alex can give: `item.comfort` and
`item.versatility`, added by `migrations/0021_comfort_versatility.sql`. Both
nullable, neither backfilled, and **NULL means not rated** — never three.

### The product ruling: substitution, not addition

Alex, 2026-08-06: **a user-confirmed versatility rating REPLACES the inferred
score for ranking. The two are never added together.**

| Situation | The ranking signal |
|---|---|
| No rating | `typicalUses.length`, exactly as before H1b |
| Rated | the rating, 1–5 |
| Rated then cleared | back to `typicalUses.length` |

That is the whole of `versatilitySignal` in `shared/outfits.ts`. Adding them
would let a garment out-rank another for having been reviewed at all, and would
count one property twice under two names — the failure doc 09 §7 named when it
scoped this.

**The two scales are compatible, and that was measured rather than assumed.**
Across the 85 garments in `seed-data/Master_Packing_Database_Complete.xlsx`,
`typicalUses.length` is **0 for 11, 1 for 40, 2 for 33, and 3 for one** — a 0–3
band sitting inside the rating's 1–5. So substitution is a like-for-like swap in
the same small range, and the most a rating can do is lift a garment two places
above anything inference could express. Deliberate: 5 is Alex answering, 3 is us
counting tags. A rating of 1 still scores 1, above the eleven garments with no
recorded uses at all — "very specific use" is knowledge, an empty tag list is an
absence.

**With nothing rated, every score is the number the planner produced the day
before.** That is the property that made this safe to land in a working planner,
and it is asserted rather than described.

### `typicalUses` keeps its other two jobs

Only the ranking NUMBER moved. `typicalUses` remains:

- the **eligibility** filter in `passesFilters` — a garment whose recorded uses
  do not overlap the template's is out, rating or no rating;
- what **explanations** read.

So a rating can reorder eligible garments and can never create one.

### Comfort, and why unrated is silent rather than zero

Nothing in this schema approximates comfort. `favorite`, `usageFrequency` and
`reuseCapacity` are all adjacent and none of them mean it. So unlike versatility
there is **no fallback**, and `comfortSignal` returns `null` for an unrated
garment.

`compare` skips a criterion where either side is `null`. The alternative —
scoring unknown as 0 — would rank a garment nobody has rated **below** one Alex
called *Uncomfortable*, inventing a judgement out of an absence, and would then
make later rating it `1` look like a promotion. `decidedBy` uses the same rule,
or a card would say comfort decided a choice comfort said nothing about.

### Where comfort sits, and why that is its modesty

The lexicographic order, with H1b's addition marked:

| | Criterion |
|---|---|
| 1 | You asked for it |
| 2 | Suits the conditions |
| 3 | You wear these together |
| 4 | A favorite |
| 5 | You wear it often |
| 6 | Works for several days *(versatility — rating or inference)* |
| 7 | Already packed for another day |
| 8 | **Comfortable to wear** ← H1b |
| 9 | Something different |

Comfort speaks only when everything above it ties. That is "a modest ranking
influence" expressed as an ORDERING rather than as a weight nobody can audit,
and it is why no formula or number is exposed in the UI.

Below *Already packed for another day* on purpose: a comfortable shirt must not
add a garment to the bag when one already in it would serve. This is a packing
app before it is a wardrobe app.

### What neither rating may do

- **Reach eligibility.** `passesFilters` runs first and reads neither. A
  five-star parka still fails a hot-weather outfit; a five-star dress shoe still
  fails an active walking requirement.
- **Outrank weather, activity, dressiness, category or slot compatibility.**
- **Outrank an explicit choice.** `You asked for it` is criterion 1.
- **Change an approved outfit.** Ratings feed candidate ranking only; D1c freezes
  approved outfits and G3 protects explicit swaps.
- **Reach Today's alternatives.** `weather-conflict.ts` filters PACKED options by
  capability and never calls `rank`, so the packed-clothing-only rule is
  untouched — by construction rather than by a guard.
- **Break determinism.** A complete tie still falls to `item.id`.

### Provenance

Both fields join `PROVENANCED_FIELDS` (§8). **No new mechanism**, and no storage
change beyond the two value columns — which was the argument for one JSON
provenance column over fourteen dedicated ones.

No importer writes either, and none ever will: the workbook has no comfort column
and no versatility column. The second authority is the **learning** side —
`learned_proposal` is already a rank — and without provenance an accepted
proposal would be indistinguishable from Alex's own answer.

A rating is therefore protected twice over: the importer's patch does not carry
these fields at all, and precedence would refuse the write even if it did.

**Clearing** a rating writes NULL and leaves the field `user_confirmed` — a
confirmed unknown (§8). For versatility that means the value goes back to unknown
and `versatilitySignal` resumes using inference, while the *provenance* still
records that Alex decided it. Those are two different questions and the schema
answers both.

### The migration

Two nullable columns, `CHECK (… BETWEEN 1 AND 5)`, no index, no backfill, no
down-migration.

There is no 0: "not rated" is NULL, and having two ways to say the same thing is
how one of them ends up meaning something else. A backfilled middle value would
also be invisible afterwards — a stored 3 looks exactly like an answered 3.

**Data impact: none.** Every existing row gets NULL on both columns, which is
what it already meant, and `versatilitySignal` returns `typicalUses.length` for
every one of them. No quantity, no outfit and no checklist row moves.

---

## 10. Dressiness as a set of contexts (H1c)

`item.dressiness` is one INTEGER, so a garment had to be filed at its one best
level. `item.dressiness_contexts` (migration `0022`) is a JSON array of the
contexts a garment actually works in, and it is what the planner reads.

### The five contexts

`loungewear`, `casual`, `smart_casual`, `dressy`, `formal`.

**The index in `DRESSINESS_CONTEXTS` is the legacy integer**, permanently. That
one alignment gives the legacy mapping, the template bands and the trip cap for
free, and it is why migration 0022 is a lookup rather than a translation table
someone has to keep in step.

**The order is not a ranking of quality.** It is the order formality is
conventionally listed in, which is what makes a floor and a ceiling expressible.
What it must never be read as is *better*: a Formal-only garment fails a Casual
need, and `Loungewear` is not a worse answer than `Formal` — it is a different
one.

### Eligibility is set intersection

`fitsContexts(garment, acceptable)` — true when they share at least one context.
That is the whole rule.

| Need accepts | Garment | Eligible |
|---|---|---|
| Casual | Casual | yes |
| Casual | Casual + Smart casual | yes |
| Casual | Formal | **no** |
| Smart casual | Smart casual + Dressy | yes |
| Smart casual | Casual | no |
| Smart casual **or** Dressy | anything containing either | yes |
| Dressy | Casual + Smart casual | **no** |

**Never collapse a garment's set to its highest or lowest level for
eligibility.** `Smart casual + Dressy` must satisfy both, and either collapse
loses one of them. `dressiness.test.ts` fails against both collapses by name.

**An empty garment set passes.** A garment nobody has classified is not excluded,
exactly as an unrecorded `dressiness` was never excluded — that would punish
missing data rather than unsuitability (doc 05 §4).

### The template floor and the trip cap

`acceptableContexts(band, cap)` returns the contexts a slot will accept, and a
`capConflict` flag.

1. the template's band expands to the set it always meant;
2. the trip cap removes contexts above the trip's maximum;
3. **if that empties the set, the template's FLOOR is kept and `capConflict` is
   true** — the cap loses. Saying "nothing formal" about a trip that includes a
   wedding must not put Alex in loungewear at the wedding (doc 09 §9).

**This generalises the arithmetic it replaced rather than changing it.** The old
line was `max(minDress, min(templateMax, cap))`, which on a contiguous band is
exactly `templateSet ∩ capSet` falling back to the floor. Asserted across
**13 templates × 6 cap values × 5 levels = 390 comparisons**, all agreeing. So a
wardrobe of single-context garments — which is every garment migration 0022
produces — behaves exactly as it did before H1c.

`capConflict` is returned and **no screen renders it yet**. Surfacing it is a
trip-level message and belongs with H1d's review work; H1c stops at making the
conflict observable and tested rather than silent.

### The one legitimate collapse

`laundryReducible` reads `highestContext(...)` — the DRESSIEST context claimed.

It is legitimate because the question is a **ceiling**, not a membership test: a
shirt that also works Dressy is the dress shirt for the one nice dinner, exactly
the garment the laundry ruling says must never be cut. Reading the minimum would
start cutting it, because `Smart casual + Dressy` has a minimum of Smart casual.

**Nothing else may use `highestContext` to make an eligibility decision.**

### Two columns, two authorities

`dressiness` is **not dropped**. It remains:

- what `inferDressiness` guesses from the Style / Use Case column;
- what `reconcile` diffs a re-import against (`COMPARED`);
- a legacy value a client may still send.

`dressiness_contexts` is what the planner reads. They are separate provenanced
fields on purpose: the integer records what the spreadsheet was read to say, and
the set records where the garment works. An import may legitimately correct the
integer while a confirmed set stands beside it, and a test asserts exactly that.

`dressinessContexts` joins `PROVENANCED_FIELDS` (§8) — no new mechanism. The
importer writes it at **`inferred`**, because a mechanical re-expression of a
guess is still a guess; Alex writes it at `user_confirmed` from the multi-select.

### Writing a set

- **Canonical always**: sorted into `DRESSINESS_CONTEXTS` order, de-duplicated,
  on the way in and on the way out. Two garments marked the same way must
  serialise identically, or H1a's `sameValue` reads an identical save as a change
  and the review queue fills with differences nobody made.
- **`undefined` and `[]` are different.** `[]` is Alex clearing every context —
  an answer, stored as one. `undefined` is a caller that only knows the legacy
  integer, and gets the single context that level means, so no write path can
  silently lose a garment's formality.
- Clearing writes NULL and leaves the field `user_confirmed` (§8), so nothing
  refills it.

### The migration

`0022` adds one nullable TEXT column and backfills each legacy integer to
**exactly one** context: 0→Loungewear, 1→Casual, 2→Smart casual, 3→Dressy,
4→Formal.

**No broadening.** Smart casual becomes `Smart casual`, not `Casual + Smart
casual`, even though the second is probably true of most of them — the integers
were themselves guessed from free text, so widening here would be inventing an
answer on top of a guess. Broadening is the H1d review queue's job, and a value
Alex confirms there outranks this one.

**Idempotent**, guarded on `dressiness_contexts IS NULL` rather than
`dressiness IS NOT NULL`. The difference matters exactly once: a re-run of the
second form would reset a set Alex has since broadened back to the one the
integer means.

**Data impact:** no value changes; the integer is preserved; every garment gains
one context that reproduces the eligibility it already had. No index, no
down-migration.
