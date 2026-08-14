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
  `source` (`generated|user`, migration 0029) records **who authored the outfit**,
  and it is the column the replan is written against. `generateOutfits` deletes
  every group that is not approved and identifies survivors **by name**, because
  ids are minted fresh on each run — both correct for a planner group and fatal
  for one Alex wrote, which would be deleted on the next replan and could be
  merged into a template's group by a shared display name. A `user` group is
  therefore never deleted, never regenerated, never renamed and never matched by
  name; it also carries no `activity_tag`, because a tag is a claim about which
  template a group belongs to and inferring one would hand his outfit a
  formality band, a required-slot shape and a day assignment he never chose. Its
  garments ARE reserved against the planner, so a draft cannot double-book a
  shirt he has already committed.
- **`outfit_slot`** — `slot_role` (`top|mid|outer|bottom|footwear|accessory|swim`), `required`,
  `item_id` (**nullable**), `reuse_allowed`, `rank_score`, `reason_json`, `filled_by`
  (`generated|user_swap`), `unmet_reason`.
  A nullable `item_id` with an `unmet_reason` is how doc 04 §15's "No suitable packed rain layer
  found" is represented — the system records a gap instead of inventing a garment.
  A slot Alex ADDS to an outfit is written `required = 0` and `filled_by =
  'user_swap'`. There is deliberately no third `filled_by` value: the column
  carries a CHECK, widening one in SQLite means rebuilding the table, and what
  distinguishes a manually added slot from a swapped one is the group it is in.
  `required = 0` is what lets a manual outfit be a t-shirt and shorts —
  `refreshGroupStatus` marks a group `incomplete` only for an empty REQUIRED
  slot, which is right for a template and wrong for an outfit he composed.
- **`checklist_entry`** — `item_id` (nullable for trip-only items), `name_snapshot`,
  `detail_snapshot`, `brand_snapshot`, `color_snapshot`,
  `category_snapshot`, `required_qty`, `qty_breakdown_json`, `qty_override`, `packed_qty`,
  `packing_timing`, `requires_final_check`, `final_checked_at`, `excluded_at`, `source`,
  `reason_text`, `rule_snapshot_json`, `is_critical`, `trip_only`, `sort_order`.
  `brand_snapshot` and `color_snapshot` (migration 0029) are the two fields
  `detail_snapshot` is composed FROM, kept apart because a one-line packing row
  shows the brand as text and the colour as a swatch. Parsing them back out of
  `Vuori · Dark Green` would be re-deriving a fact the row already has, and a
  brand like `Black Diamond` in a composed string matches a colour word nobody
  wrote in a colour column. All three are **snapshots**, like the name: a
  finished trip reads the way it read when it was packed. Backfilled only where
  `detail_snapshot` is already set — a row written before 0019 still carries the
  brand and the colour inside its `name_snapshot`, and filling these in would
  print the same two words twice.
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

---

## 11. Review Closet Items (H1d)

The queue that spends §§8–10 rather than adding to them. **One new table, no
column touched, no row rewritten** — because the ratings, the contexts and the
provenance the whole feature asks about already exist.

### Where the queue's evidence comes from

Nothing new is recorded on any write path. A standing review queue that needed
its own counters maintained on every pack, swap and removal would be a change to
the write side in service of a read-only screen, so all four signals are read
from tables that were already keeping them:

| Signal | Source | Query |
|---|---|---|
| frequently packed | `checklist_entry` | `packedTripCounts` — the same one `Most packed` sorts by |
| swapped in by hand | `outfit_slot.filled_by = 'user_swap'` | recorded since `0004` |
| repeatedly removed | `checklist_entry.excluded_at IS NOT NULL` | per trip, not per row |
| ranker ties | none — derived | `tieGroups`, over the wardrobe already loaded |

`tieGroups` is the one worth reading twice. It is not a guess at what "a tie"
means: it is read off `CRITERIA` in `shared/outfits.ts`. Two garments tie when
every criterion **above comfort** that is a property of the garment alone scores
the same — slot, weather capabilities, usage frequency, versatility signal and
dressiness contexts. Comfort is then literally the next criterion, so a rating on
one of those garments is a rating that changes an outcome.

### `closet_review_decision` (`0023`)

```
closet_review_decision(item_id, topic, decision, decided_at)
PRIMARY KEY (item_id, topic)
```

Three of the four card kinds have an answer that changes no row: `Keep as is` on
a name, `Keep both` on a duplicate, and `Keep my choice` on a disagreement all
leave the garment exactly as it was — and `decideWrite` deliberately carries
`was`/`wasSource` forward when a confirmation does not change the value, so the
disagreement stays legible tomorrow by design. Without a record, each of those is
a button that puts the same card back on screen. `Skip` and `Not sure` are
answers about the QUESTION and have nowhere on `item` to live at all.

`topic` is free-form TEXT because two of the four carry their subject —
`duplicate:<item id>`, `disagreement:<field>`. *These two are the same garment*
is a statement about a PAIR, and recording it against one id would suppress the
card for every other duplicate that garment has.

**The three decisions are not interchangeable.** `answered` and `not_sure`
withdraw a question; **`skipped` does not** — it moves the card behind everything
else and it is still there tomorrow. An early version treated any recorded
decision as settled, which made Skip delete the question; the ordering unit test
caught it.

`not_sure` is reversible from the queue's own empty state
(`POST /api/closet-review/reopen`, which deletes only `not_sure` rows). A queue
that can permanently lose a question is not one to trust with a closet.

### Writing one answer: `PATCH /api/items/:id`

`PUT` still owns the whole row and the editor still uses it. The review card
knows one field and must not send back a garment it never read — that is the
defect H1a removed from the importer, and a card posting a whole `ItemInput`
would walk it back in through the front door.

So `patchItem` executes `patchItemStatement` at `user_confirmed`: only the named
fields move, and clearing is the same call with `null` rather than a separate
verb. The allowlist is four fields — `comfort`, `versatility`,
`dressinessContexts`, `displayName` — deliberately narrower than
`PROVENANCED_FIELDS`, so this door cannot rewrite a category from a screen that
never shows one.

`Keep as is` and `Use spreadsheet value` are `confirmFields` and
`revertFieldValue`, both of which existed for H1a and are unchanged.

### A guessed set is still a question

`ratingAsks` asks about dressiness when the set is empty **or when nothing above
`inferred` ever wrote it**. Empty alone would have made this the weakest question
in the queue: `0022` gave every imported garment the one context its guessed
integer meant, so almost nothing is empty — and almost none of it is right
either. A shirt filed as Smart casual by `inferDressiness` has not been
classified; it has been glanced at.

### Merge is deferred, and *Same item* archives instead

Doc 09 §7 requires a merge to preserve packing history, outfit history, checklist
references, provenance, ratings, capabilities, learning evidence and archive
state. None of that is proven, and its ruling is explicit: do not delete either
record until merge is proven; an explicit deferral is an acceptable outcome.

`POST /api/closet-review/archive-duplicate` therefore archives the copy Alex did
not keep, which is the strongest provably safe thing available. Both rows
survive, every trip and outfit pointing at either still resolves, past trips
still show both, and Restore in My Stuff undoes it completely. The card says so
rather than implying a merge happened.

**Data impact of `0023`:** one new table, empty on creation. No backfill, no
column change, no down-migration needed — dropping the table restores the
previous behaviour exactly, because an absent decision and an empty table mean
the same thing to `buildReviewQueue`.

## 12. Outfit plan freshness (P1B)

Two nullable integer columns on `trip`, added by `0024_outfit_plan_freshness.sql`:

| column | written by | means |
|---|---|---|
| `days_changed_at` | `setTripDays` | the trip's days last moved at this second |
| `outfits_planned_at` | `generateOutfits` | the outfit plan was last built at this second |

`outfitsAreStale(db, tripId)` is the comparison, and it is the whole reason
`PUT /trips/:id/days` can answer without replanning first. Saving days used to
write the days and then rebuild every draft outfit over the whole wardrobe before
responding — 94% of the endpoint, and both callers navigate to Outfits the moment
it answers, so the tap was held through work Alex was about to watch happen.

**This is not a client promise.** The obvious cheap version — navigate with
`{ replan: true }` in router state and let the destination act on it — is lost by
a refresh, a second tab, or an app that is closed between the two, and what it
leaves behind is a trip whose outfits quietly do not match its itinerary. Two
timestamps on the row cannot be lost. `GET /api/trips/:id/outfits` answers
`stale`, and the Outfits screen replans when it is true, however Alex arrived.

### Why the stamp is on the trip and not derived from the outfits

`outfit_group` already carries `updated_at`, and comparing the newest of those
against `days_changed_at` would need no migration at all. It also would not
terminate. Approving an outfit freezes it (D1c), and `generateOutfits`
deliberately writes nothing for an approved group — so a trip whose outfits are
all approved would have no group newer than its last day change, would report
stale for ever, and would replan the entire wardrobe on every single visit to
Outfits. `outfits_planned_at` is written on every run, whatever the planner
decided to keep, which is what makes the comparison converge.
`tests/integration/itinerary-apply-cost.test.ts` asserts that case directly and
fails if the write is made conditional.

**Data impact of `0024`:** two nullable columns, `NULL` for every existing row.
No backfill, and `NULL` is the correct reading rather than a convenient one —
every trip on the database was replanned synchronously by the endpoint this
change replaced, so none of them is behind. A Worker running the previous code
against this schema behaves exactly as it did.

## 13. Which bag each thing goes in (P3)

`0025_bags_and_item_traits.sql` adds one column to `trip` and seven to `item`.
The rules that read them are `shared/bags.ts`, which is pure and shared, so the
Worker and the screens cannot hold different opinions about where Alex's
passport should be.

### The trip half

| column | means |
|---|---|
| `bags_json` | JSON array of `personal_item` / `carry_on` / `checked` |

Three states, and collapsing any two loses an answer:

- **NULL** — not stated. `availableBags` reads `luggage_mode` through for it,
  which is every trip that predates this migration.
- **`[]`** — *none of these*, which a road trip genuinely has.
- **a list** — exactly those.

`luggage_mode` is **not dropped**. It is still the answer for existing trips,
and dropping a column that live rows depend on is a destructive migration for
no gain. Whether the trip involves a flight is **derived from `flightHours`**
rather than stored again — the trip sheet already asks, and a second source of
truth for one boolean is how the two come to disagree.

### The item half

`is_liquid`, `liquid_size` (`cabin` | `full`), `is_fragile`, `is_valuable`,
`is_medical`, `is_transit_needed`, `is_bulky` — all nullable.

**Nullable is the point.** NULL is *not recorded* and never reads as false:
"we do not know whether this is a full-size liquid" must not become "this is
not a full-size liquid", because the second sentence would send a 200 ml bottle
through cabin security on Pack Smart's say-so. Every rule treats NULL as unknown
and declines to conclude, and there is a test for it.

Only facts that CHANGE a recommendation are here. Everything else the rules need
— category, subcategory, `is_critical`, warmth, weather tags, typical uses — is
already on the row. `liquid_size` is a two-value distinction rather than
millilitres because that is what Alex can answer at a glance.

### Read live, never snapshotted

`listChecklist` reads the seven traits with a `LEFT JOIN item` — one query, not
two, so no extra D1 round trip on the busiest read in the app. They are
deliberately NOT snapshotted onto `checklist_entry` the way `name_snapshot` and
`category_snapshot` are: those record what Alex took, these feed a
**recommendation**, and a recommendation is computed on read so that answering
one question fixes every trip rather than the next one. A trip-only row has no
`item_id`, gets nulls, and reads as *not recorded*.

### The safety floor

`mustStayWithYou` returns true for the `Documents`, `Medication`, `Vision` and
`Electronics` categories, for anything Alex flagged `is_critical`, and for
anything recorded as medical, valuable or transit-needed. **Nothing it returns
true for is ever recommended for the hold** — not to relieve capacity pressure,
not because the hold is the only bag selected.

When there is no cabin bag, the planner recommends **nothing** and
`bagProblems` says so once at the top of the screen. Inventing an unsafe
assignment because a bag exists is the failure this is built to prevent, and
those tests are mutation-checked: five separate mutations of the floor and its
neighbours each fail them.

**Data impact of `0025`:** eight nullable columns, NULL for every existing row.
No backfill. `bagFor(entry)` with no trip context reproduces the pre-P3 answer
exactly — the four category rules and the `is_critical` fallback — so no screen
changed what it said the day this shipped.

## 14. Asking about a bag trait (P3b)

`0026_delay_sensitivity.sql` adds `is_delay_sensitive` to `item`, on the same
terms as the seven above: nullable, additive, no backfill, and NULL is *not
recorded* rather than *no*.

It is the one bag fact about CONSEQUENCE rather than about the thing itself —
*would it be a major problem if your checked bag arrived a day late?* — and it
is the only input `resilienceSet` takes from Alex. `1` keeps something out of
the hold that no subcategory rule would have picked; `0` keeps something out of
the resilience set that a rule did pick. His answer outranks the guess in **both
directions**, because a trait that could only ever add would be a question with
one useful answer.

`RESILIENCE_USER_CAP` bounds what he can add to four. "Outranks" is not
"unbounded", and a cabin bag holding twelve contingency items is its own kind of
bad advice.

### Where the answers come from, and why so few are asked

Every one of these columns is NULL on every row, so a queue built by scanning
for empty fields would open on 119 garments times five questions. That is the
null scan H1d exists to prevent, arriving through a new door.

`shared/bag-questions.ts` gates on one rule instead:

> **A question is asked only when its possible answers would put the item in
> different bags, on a trip Alex has not taken yet.**

The gate SIMULATES every answer through the real planner, against the real
checklist row, on the real trip, and asks only when the answers disagree with
each other about where the thing goes. The brief's five conditions — liquids
only when flying, fragility only where it changes cabin versus hold, and so on
— are each an instance of that rule rather than a separate rule, because
`recommendBag` already reads liquids only when flying and `resilienceSet`
already returns empty without a checked bag. A rule written twice is a rule that
comes to disagree with itself.

Plausibility is a **separate, earlier** gate, and it is not redundant: flipping
`is_liquid` on a T-shirt genuinely changes its recommendation, so the simulation
passes and the question is still absurd. The simulation says whether knowing
would matter; the plausibility list says what could be true.

`delay` has no category list. Its gate is the resilience set itself — the
question is a confirmation of what the rules already decided, which bounds it to
the four rows they picked rather than every garment on the list.

### Writing an answer

`PATCH /api/items/:id/traits` and `setItemTraits`, which are deliberately NOT
the provenanced patch path. Provenance exists to arbitrate between two writers
and these have exactly one: no importer writes them, nothing infers them,
nothing guesses. Adding eight entries to `PROVENANCED_FIELDS` would be machinery
for a conflict that cannot happen — a disagreement card that can never appear
and a revert with nothing to revert to. `shared/provenance.ts` states the
membership rule itself: a field joins when a **second** writer appears. If one
ever does, that is the day, and it is still one line each.

Only the keys sent are written, so answering the liquid question cannot disturb
a fragility answer given a second earlier. `PUT /api/items/:id` does not list
these columns, so saving a row from the editor leaves them alone.

**Data impact of `0026`:** one nullable column, NULL for every existing row. No
backfill. With nothing recorded, `resilienceSet` picks exactly what it picked
before, so no trip's plan moved the day this shipped.

---

## 15. What the plan was made from (migration 0027)

Two additive nullable columns, both written and read only by the outfit
repository.

`trip.outfit_plan_inputs` holds the JSON snapshot `planSignals` produces at the
end of every successful plan — the planner's own thresholds, not its raw
inputs: the warmth **band** rather than the temperature, `rain likely` rather
than a percentage. That is what makes a forecast moving 67°F to 65°F compare
equal and create no work, while one that crosses a band does not. See
`03_INTELLIGENCE_DESIGN.md` §14.

`outfit_group.review_reason` holds one short sentence naming a garment and what
is wrong with it, on an **approved** outfit whose garments no longer pass the
planner's filters. An approved outfit is Alex's decision and may not be silently
replanned (doc 04 §5), but one the trip has moved out from under has to say so.
It is set and cleared in the same pass on every replan, so it cannot outlive the
condition that produced it.

Both default to NULL, which is what every existing row gets. No snapshot means
no comparison is possible and `planChanges` returns empty rather than claiming
everything changed — the right answer, because the plans already on the database
are not wrong. Nothing is flagged until a replan actually looks at it.
