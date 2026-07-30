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
depends_on_item_id, enabled, original_text, needs_review, created_at
```

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
