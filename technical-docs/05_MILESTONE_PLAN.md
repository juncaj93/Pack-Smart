# Pack Smart — Milestone Plan

Status: **Approved.** One milestone at a time. A milestone is complete only when its user-facing
acceptance criteria are verified against the running app — never because the code compiles.

## 0. Deferred pre-M1 corrections

Alex deferred these when approving M0. **They must be done before Milestone 1 begins.**

### Applied

- ✅ `product-docs/README.md` — workbook filename.
- ✅ `product-docs/05_INVENTORY_AND_DATABASE_IMPORT.md` — workbook filename; contacts rule note.
- ✅ `product-docs/03_PACKING_INTELLIGENCE_AND_SMART_SETUP.md` §6 — contacts **and** underwear =
  **2 pairs per inclusive calendar trip day**, with the 31 Jul → 11 Aug = 12 days = 24 worked
  example.
- ✅ `product-docs/02_USER_EXPERIENCE_AND_SCREEN_FLOWS.md` §5 Step 3 — plain-text paste only in v1;
  PDF and image upload moved to v1.1.
- ✅ `product-docs/01_PRODUCT_VISION_AND_SCOPE.md` §7 and
  `product-docs/06_ACCEPTANCE_CRITERIA_NON_GOALS_ROADMAP.md` §4 — deferred itinerary formats added
  to the v1.1 roadmap.

### Still blocked — the workbook itself

- ⛔ Create `seed-data/Master_Packing_Database_Complete.xlsx` (81 uploaded rows + the 4 restored
  jackets in `04_IMPORT_PLAN.md` §2 = **85**).
- ⛔ Delete `seed-data/Master_Packing_Database_Updated(1).xlsx`.

**The 81-row corrected workbook has never existed in this repository.** Verified across every
commit on every branch and against the whole object store, including unreachable objects: the only
spreadsheet ever committed is the obsolete one. The corrected file exists solely in the Technical
Lead conversation and cannot be recovered from git.

It must be re-supplied by Alex. It is **not** reconstructable here: inventing garments would breach
doc 04 §15 and the no-false-intelligence invariant in `03_INTELLIGENCE_DESIGN.md` §12.

Deleting the obsolete file is deliberately held until the replacement exists — removing the only
seed data on hand, with no substitute, would be strictly worse than leaving it in place clearly
marked as superseded.

**M1 (import) is blocked on this. M2 onward is not**, and proceeds against the schema rather than
against the file.

## Approved scope decisions affecting all milestones

| Decision | Resolution |
|---|---|
| Launch URL | Free `*.workers.dev`. No custom domain in v1. $0.00/month |
| Private access | Single passphrase, server-set cookie, 1-year expiry. Not Cloudflare Access |
| Wardrobe | 85 garments (81 uploaded + 4 restored jackets) |
| Rain layer | No garment tagged rain-capable. Honest coverage warning retained |
| Contacts / underwear | 2 pairs per **inclusive calendar trip day** |
| Shaver | `nights ≥ 3` |
| Charging accessories | Explicit `dependency_include` rules on their devices |
| Backups | D1 Time Travel + manual export + documented restore. **No automated GitHub snapshot** |
| Offline | Reads first, queued writes second, admin online-only, replay may slip to M11 |
| Itinerary | V1: structured setup, notes, **plain-text paste**. V1.1: PDF, image, URL, email |

---

## M0 — Foundation

- **User-visible outcome.** Alex opens the URL on an iPhone, unlocks with a passphrase, adds it to
  the Home Screen, and sees an (empty) four-tab app that stays logged in.
- **Major work.** Vite/React/TS scaffold; Worker + Hono serving API and assets; D1 with migration
  runner; passphrase auth with a 1-year server-set cookie; bottom nav with safe-area insets; the
  shared BottomSheet primitive; the global CSS system (dvh, 16px inputs, 44px targets); PWA manifest
  and iOS icons; GitHub Actions deploy.
- **Dependencies.** Cloudflare account.
- **Risks.** R8 (mobile Safari), R9 (auth). Front-loading the iOS layout primitives here is what
  prevents per-screen fixes later.
- **Acceptance.** Installs to the Home Screen and launches standalone; session survives a week of
  disuse and a phone restart; no horizontal scroll and no input zoom at 390×844; bottom nav clears
  the home indicator.
- **Excludes.** All product features.

## M1 — Data import

- **User-visible outcome.** Alex uploads the workbook and sees an honest summary — 85 clothing items,
  33 gear items, 7 trigger rules, 3 near-matches to confirm — reviews the ambiguous cases, commits.
- **Major work.** Client-side xlsx parsing; two-section parsing of the second sheet; normalization
  (embedded quantities, `Unspecified` colors, display-name composition); three-tier dedup with the
  color discriminator; rule-text parsing; `import_run`/`import_row` persistence; the mobile review
  queue; the wardrobe coverage report; dry-run and commit endpoints.
- **Dependencies.** M0, plus the §0 corrections.
- **Risks.** R4, R5.
- **Acceptance.** All 85 garments import as distinct; **exactly 3 review cards**; the 4 restored
  jackets import with their original text intact; `Boxer Briefs (~15 Pairs)` → "Boxer Briefs" with
  `owned_quantity = 15`; `Unspecified` never appears in a display name; every source row has a
  recorded decision; re-importing produces zero changes; the shaver, contacts, Snacks, and
  toothbrush-charger defects and the rain-layer gap all surface.
- **Excludes.** Editing items (M2); any outfit logic.

## M2 — Inventory management (My Stuff)

- **User-visible outcome.** Alex can browse, search, add, edit, archive, and restore all 85 garments
  and 33 gear items, and can fill the one remaining gap — a rain layer — quickly on a phone.
- **Major work.** My Stuff list with category filters; item detail with progressive disclosure;
  **Quick Add** for rapid repeat entry; favorite and usage frequency as independent controls;
  archive/restore; rule and preference editors.
- **Dependencies.** M1.
- **Risks.** R1 (residual, narrowed to the rain layer only).
- **Acceptance.** A garment can be added in under ~20 seconds with no optional fields; browsing 85
  items stays fast and scannable without a dense table; archived items vanish from candidate lists
  but remain visible on past trips; routine management needs no spreadsheet.
- **Excludes.** Photos; bulk edit; trip-scoped items.

## M3 — Trip setup (structured)

- **User-visible outcome.** Alex creates a trip with destination, dates, and activity chips, and sees
  a correct "Here is what Pack Smart understood" summary built from structured facts.
- **Major work.** New Trip flow steps 1–2 and 4; destination geocoding; inference of duration,
  season, international status, timezone; `trip_fact` with evidence and certainty; the
  Understood / Please confirm split; iOS-correct date inputs; trip list and Home card.
- **Dependencies.** M0.
- **Risks.** Native date inputs behave differently on iOS than in any emulator.
- **Acceptance.** Creatable on iPhone Safari with minimal typing; every interpreted detail editable
  before generation; **trip days counted inclusively (31 Jul → 11 Aug = 12) and nights exclusively
  (11)**; no fabricated confidence anywhere.
- **Excludes.** Free-text note parsing (M7); weather (M5); all itinerary file formats (v1.1).

## M4 — Rules engine and generated checklist

- **User-visible outcome.** The first genuinely useful output: a correct non-clothing packing list
  with quantities and one-line reasons.
- **Major work.** Condition-predicate evaluator; all eleven quantity rule types; the
  precedence/aggregation pipeline; dependency resolution; the source taxonomy; the explanation
  renderer; checklist generation.
- **Dependencies.** M1, M3.
- **Risks.** R13 — critical items must be driven only by structured facts.
- **Acceptance.** A 31 Jul–11 Aug international trip (12 days / 11 nights) yields Synthroid at
  days+2, **contacts at 24**, **underwear at 24**, passport and adapter; the shaver is absent at 2
  nights and **present at exactly 3**; chargers appear only with their devices; every quantity shows
  its breakdown; unit tests cover all eleven rule types plus the inclusive day/night boundary.
- **Excludes.** Clothing (M6); UI interactions (M5).

## M5 — Checklist workflow and weather

- **User-visible outcome.** Alex packs a real trip from the phone.
- **Major work.** The four derived sections; the row bottom sheet; undo; critical-item removal
  warning; partial quantities; progress on Home; scroll-position restoration; **Open-Meteo
  integration with forecast/normals labeling and caching**.
- **Dependencies.** M4.
- **Risks.** R7, R8, R10.
- **Acceptance.** Progress survives closing/reopening and a phone restart; every action reachable
  one-handed; removal undoable without a dialog; critical removal warns without blocking; weather
  never presents a normal as a forecast.
- **Deviation from doc 07 §4:** weather is pulled forward from position 9 because M6 depends on it,
  and building outfits against placeholder temperatures would mean building them twice.
- **Excludes.** Outfits; During Trip.

## M6 — Outfit planning and synchronization

- **User-visible outcome.** Alex reviews outfit groups by activity, swaps items, approves them, and
  the clothing checklist updates automatically and correctly.
- **Major work.** Outfit group derivation; the hard-filter → scoring ranking engine; reuse capacity
  and greedy assignment with repair; slot UI and a single Swap action; approval; `checklist_link`;
  bidirectional recomputation; unmet-slot messaging.
- **Dependencies.** M2, M5.
- **Risks.** R3, R6 — the highest-risk milestone.
- **Acceptance.** Outfits are activity- and weather-appropriate; a specialized item beats a favorite
  when conditions demand it, with a reason; approving adds exactly the right clothing at the right
  quantities; removing a clothing row identifies affected outfits and offers replacement; **no
  outfit ever contains a garment Alex does not own**; a rainy-trip fixture produces the honest "no
  suitable rain layer" message rather than substituting a hoodie; the ~8-trip fixture suite passes.
- **Excludes.** One Last Look (M8); During Trip (M9).

## M7 — Smart interpretation (phrase detection)

- **User-visible outcome.** Alex types trip notes in plain language and Pack Smart extracts
  activities, constraints, and preferences — quoting Alex's own words as evidence.
- **Major work.** Lexicon; matcher; clause splitting and negation; hedge-based certainty; the
  follow-up question catalogue with diff-based materiality; conflict resolution; Understood / Please
  confirm wiring.
- **Dependencies.** M3, M4.
- **Risks.** R13. Doc 02 §5's sample note is a required fixture, as is every phrase in doc 03 §2.
- **Acceptance.** The sample note yields safari, winery, nice dinners, sightseeing, all-shoes,
  swimwear-minimum-2, more pants, laundry-unavailable-*likely*; "probably no laundry" → Please
  confirm while "no laundry" applies directly; all negation cues pass; no critical item triggered by
  text alone; at most four questions, only material ones.
- **Includes** plain-text itinerary paste, feeding the same interpreter.
- **Excludes.** A lexicon-editing UI (v1.1); PDF, image, URL, email extraction (v1.1).

## M8 — One Last Look

- **User-visible outcome.** Before packing, Alex sees excluded favorites and relevant near-matches,
  and can add or swap.
- **Major work.** Exclusion analysis; near-match scoring; Add vs Swap; search behind progressive
  disclosure.
- **Dependencies.** M6.
- **Risks.** Leading with the full closet would encourage overpacking — doc 04 §9 forbids it.
- **Acceptance.** Leads with favorites and near-matches, not the closet; Swap updates both the
  outfit and the checklist; the screen is not labeled "Final Check".
- **Excludes.** Shopping suggestions.

## M9 — During Trip mode

- **User-visible outcome.** On the trip, Alex opens the app and immediately sees what to wear and
  bring for today's events.
- **Major work.** Automatic switch to Today; the packed-only candidate function; per-event
  recommendations from the approved plan; delta-based weather adjustment; the wear log; the five
  controls; `daily_plan` persistence; the missing-item message with alternatives.
- **Dependencies.** M6, M5.
- **Risks.** R12.
- **Acceptance.** A test proves not-bringing, unpacked, and archived items can never be recommended;
  reopening shows the same plan, not a regenerated one; weather changes produce small explained
  adjustments; "I will wear this" records worn status; a missing rain layer produces the honest
  message and alternatives.
- **Excludes.** Post-trip review (v1.1); laundry ledger.

## M10 — iPhone polish and offline

- **User-visible outcome.** The app feels like an iPhone app: fast, calm, resilient on a hotel
  network.
- **Major work.** Service worker and app-shell caching; **offline reads of the active trip and Today
  plan (priority 1)**; the mutation queue with idempotency keys (priority 2); transition and gesture
  refinement; empty/loading/error states; the full doc 06 §1 iPhone pass on a real device.
- **Dependencies.** M9.
- **Risks.** R8, R11.
- **Acceptance.** Every item in doc 06 §1's iPhone list passes on a real iPhone; the active trip and
  Today plan are readable in airplane mode; no core action depends on hover; the app resumes exactly
  where it left off.
- **Excludes.** Full offline CRUD; inventory admin, import, and trip creation are online-only.
- **Escape hatch.** If mutation replay is not solid here it moves to M11. Offline *reads* are not
  negotiable; offline *writes* are.

## M11 — Testing, hardening, and launch

- **User-visible outcome.** Alex plans and packs a complete real trip end to end with confidence.
- **Major work.** Filling rule-engine test gaps; the Playwright critical-path suite; the manual
  iPhone checklist; the **Export My Data** button and **written restore instructions**; a restore
  rehearsal; any mutation-replay work deferred from M10; documentation sync.
- **Dependencies.** M0–M10.
- **Risks.** R7, R14.
- **Acceptance.** Every v1 acceptance criterion in doc 06 §1 verified against the running app, not
  the code; export produces a complete restorable dataset; **a restore from that export has actually
  been performed once and the steps written down**; queued mutations replay without duplicating;
  `/product-docs` and `/technical-docs` match shipped behavior.
- **Excludes.** Everything in doc 06 §2's non-goals.
