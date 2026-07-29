# Implementation notes

What was actually built, where the code lives, and every decision that departs from — or
resolves an ambiguity in — the approved documents. Read alongside `05_MILESTONE_PLAN.md`,
which remains the definition of scope.

---

## 1. Where things live

| Concern | File |
|---|---|
| Trip dates, facts, validation | `shared/trips.ts` |
| The rules engine | `shared/rules.ts` |
| Checklist grouping and progress | `shared/checklist.ts` |
| Outfit planning | `shared/outfits.ts` |
| During Trip | `shared/during-trip.ts` |
| One Last Look | `shared/last-look.ts` |
| Import parsing and dedup | `shared/import.ts`, `shared/xlsx.ts` |

Everything in `shared/` is pure and runs in both the Worker and the browser. That is
deliberate: `sectionFor`, `isPacked` and `needsFinalCheck` must give the same answer on both
sides, and two implementations of "is this packed?" is how a checklist starts disagreeing with
itself.

Persistence is in `worker/repos/`, HTTP in `worker/routes/`, screens in `src/routes/`.

---

## 2. Decisions taken during implementation

### 2.1 Checklist candidacy is "has a rule", not "is gear"

The engine considers any active item with at least one enabled rule. Filtering by
`kind = 'gear'` silently dropped underwear — a garment carrying the approved
2-per-inclusive-trip-day basis — so the acceptance criterion said 24 and the list showed none.

A garment with no rule is still left entirely to outfit planning, so the two paths cannot
produce conflicting clothing plans (product doc 04 §8).

### 2.2 The underwear basis is realised as a rule at import

`underwear_basis` is an approved preference, but preferences are not a second engine. The only
mechanism that produces a quantity is a rule, so the preference becomes a `per_day` rule on the
boxer-briefs item during import, and stays editable in one place afterwards.

Deliberately narrow: it matches boxer briefs and nothing else in the Underwear subcategory.
Socks and compression shorts are worn per outfit and the docs state no basis for them. Inventing
2-per-day for socks would be exactly the confident-but-unsupported quantity this engine must
never produce.

### 2.3 Dependencies are resolved to real item ids at import

`packing_rule.depends_on_item_id` is a foreign key, so the spreadsheet's dependency *name* cannot
be stored in it. Resolution happens in a second pass after every item exists.

This matters more than it looks: `dependency_include` **vetoes** its item when the target is not
packed, so an unresolved rule does not degrade to "include anyway" — it degrades to "never
include". Anything unresolvable is flagged `needs_review` and surfaced at the top of the rules
list rather than disappearing.

### 2.4 Outfit slots hold one garment each, with a wearing count

A group worn nine times is not nine identical t-shirts. Each slot row holds one garment plus how
many of the group's days it covers, and the planner keeps choosing until the days are covered —
spreading across the wardrobe before repeating anything. `migrations/0006` adds that column;
it is additive only.

Reuse capacity limits how many wearings one garment provides. It is **not** an eliminating
filter: when everything suitable is spoken for, the planner reports how many days it cannot
dress rather than quietly wearing a shirt past its capacity.

### 2.5 Ranking is lexicographic, never a weighted sum

`shared/outfits.ts` compares candidates criterion by criterion in the approved order. A weighted
sum lets three weak signals outvote a strong one, which is how a loungewear quarter-zip wins a
nice dinner on "favorite". Ties break on item id so the same trip always plans the same way.

### 2.6 During Trip shows one day, from one function

`packedCatalog` is the single source of During Trip candidates, so the absolute rule in product
doc 04 §10 cannot be forgotten at a call site. Tests assert that Not Bringing, unpacked, and
archived items — including an item archived *after* it was packed — are unreachable.

"Bring" lists only gear this trip triggered (`trip_triggered` / `dependency_triggered`): the
binoculars for the safari, the neck pillow for the flight. Routine gear that lives in the
suitcase is not something to carry out for the day, and listing the whole bag buried the useful
entries.

### 2.7 An outfit missing a required garment cannot be approved

Approval writes clothing to the checklist, and a half-dressed plan should not get there. The
refusal is returned to the client and shown, rather than silently reverted.

### 2.8 Offline reads, but not offline writes

Reads are non-negotiable (`01_ARCHITECTURE.md` §5). Writes are deliberately not queued: a failed
save fails visibly, because a checklist that silently disagrees with the bag beside you is worse
than one that admits it could not save. The mutation queue remains available as v1.1 work.

The session check is never served from cache — telling Alex he is signed in when he may not be is
worse than asking again. But a device that has unlocked before stays in when the check cannot be
*reached*, because locking him out of a cached packing list on a plane is the exact failure
offline reads exist to prevent. Any real 401 still drops back to Unlock.

### 2.9 Chips are full-size touch targets

Raised from 36px to 44px. The original justification — "not a primary action" — stopped holding
once chips carried activity selection, the yes/no answers that shape the list, and the mid-trip
swap options.

---

## 3. Not built, and why

| Item | Status |
|---|---|
| **Weather** (Open-Meteo) | **Blocked in this environment.** `api.open-meteo.com` and the geocoding endpoint are unreachable from the build sandbox, so an adapter could not be verified against the live API. Nothing in the UI claims conditions it does not have; no placeholder forecast is shown. The `trip_weather` table and the `source` discriminator that keeps a climate normal from being presented as a forecast are already in the schema. |
| **M7 phrase detection** | Not started. Trip facts come only from structured input, which is what §2.1 of `03_INTELLIGENCE_DESIGN.md` requires anyway — no critical item is ever triggered by text. |
| **Offline mutation queue** | Deferred per the M10 escape hatch. Offline reads shipped. |
| **Post-trip review** | v1.1 by the approved scope. |
| **Itinerary events** | The `trip_event` table exists and outfit groups can reference it; no UI creates events yet, so day plans are assigned from the trip's dates. |

---

## 4. Testing

- **Unit** (`tests/unit/`) — pure logic with exact inputs.
- **Integration** (`tests/integration/`) — the real migrations applied to a real SQLite database
  via `node:sqlite`, with foreign keys on. D1 is SQLite, so these run the same statements
  production will. Built-in to Node 22, so no dependency.
- **End to end** (`tests/e2e/`) — a real browser against the production build behind the real
  Worker, including a network-cut offline test that a service worker cannot be unit-tested for.
- **`scripts/verify-import.mjs`** — drives a full import of the real 85 garments and 33 gear
  items through the HTTP endpoints and checks the M4 acceptance numbers. "The tests pass" and
  "the app gives Alex the right answer" are different claims.

WebKit could not be installed in this environment (the Playwright browser CDN is unreachable), so
the e2e suite ran locally under the documented `chromium-fallback` project. CI installs WebKit
only and runs the approved `iphone-webkit` target, so the WebKit results quoted here come from CI.

### 4.1 Offline reads are NOT verified on WebKit — read this before trusting them

Two tests are skipped under WebKit. This is the one gap in the suite that could matter to Alex,
so it is stated here rather than left in a code comment.

Playwright's WebKit driver does not put `context.setOffline` in front of the service worker. A
reload aborts inside the driver before the page is involved; an in-app navigation reaches the
worker without its `fetch` failing the way a genuinely lost connection makes it fail. Route
interception is not a substitute — `page.route` does not intercept service-worker-initiated
requests in WebKit, so the worker would reach the live server and the test would pass while
proving nothing. **A test that cannot fail is worse than no test**, which is why one was not
written.

What this means:

- **Verified in Chromium:** the caching logic, the cache-vs-network precedence, the offline
  banner, and the honest failure for a trip that was never loaded.
- **Not verified on the engine that ships:** that iOS Safari, in Airplane Mode, serves the cached
  trip. The mechanism is standard and there is no reason to expect it to differ, but that is a
  reasoned expectation, not evidence.
- **The acceptance test is therefore manual**, and it is the Airplane Mode section of
  `08_MANUAL_IPHONE_CHECKLIST.md`. Offline reads should not be treated as delivered until that
  passes on Alex's phone.

This is precisely the division risk R11 describes: CI cannot run iOS Safari, and passing CI is
explicitly not a completion criterion.
