# Pack Smart — Risk Register

Status: **Approved.** Review at each milestone boundary; update status rather than deleting entries.

| ID | Risk | Status |
|---|---|---|
| R1 | Seed wardrobe coverage | **Mostly closed** — rain layer open |
| R2 | Scope size | Open — managed by milestone exclusions |
| R3 | Outfit recommendation quality | Open — mitigated by design, verified in M6 |
| R4 | Spreadsheet rule-data quality | Open — resolutions approved |
| R5 | Duplicate import handling | Open — mitigated, acceptance number fixed |
| R6 | Checklist ↔ outfit synchronization | Open — mitigated by design |
| R7 | Persistence and backup on iOS | Open — mitigated by architecture |
| R8 | Mobile Safari behavior | Open — primitives land in M0 |
| R9 | Private access | **Closed** — passphrase approved |
| R10 | Weather reliability | Open — mitigated by design |
| R11 | Verifying real iPhone Safari | Open — permanent, managed |
| R12 | During Trip state | Open — mitigated by design |
| R13 | Avoiding false intelligence | Open — enforced by invariant + tests |
| R14 | Long-term maintenance | Open — permanent, managed |

---

### R1 — Seed wardrobe coverage

- **Issue.** The original workbook held 13 distinct garments, all tops and outerwear — outfit
  generation was structurally impossible.
- **Resolution.** The corrected workbook (81) plus 4 restored jackets gives **85 garments** covering
  every outfit slot. Heavy outerwear is present.
- **Still open: no rain layer.** No row in the final workbook mentions rain, waterproofing, a shell,
  or Gore-Tex — verified across all 85. The Arc'teryx is the tempting case, but its own note reads
  "Versatile lightweight black jacket," and promoting brand reputation into a weather tag is exactly
  the fabricated inference doc 03 §5 forbids. **No garment is tagged rain-capable.** Doc 04 §15's
  "No suitable packed rain layer found" will correctly fire on a wet trip.
- **Action.** Import summary reports the gap. Alex adds a shell via Quick Add (M2) or confirms none
  is owned.

### R2 — Scope size for a single developer

- **Issue.** V1 is ~11 substantial subsystems. The realistic failure mode is eight half-finished
  ones and no usable trip.
- **Resolution.** Vertical slices; every milestone ends in something usable on a phone. Deferred to
  v1.1: PDF/image/URL/email itinerary extraction, an editable lexicon UI, post-trip review.

### R3 — Outfit recommendation quality

- **Issue.** "Mostly right on the first try" is a quality bar, not a feature. Naive weighted scoring
  produces plausible nonsense — a loungewear quarter-zip at a nice dinner because it scored well on
  "favorite".
- **Why it matters.** The first bad outfit destroys trust in the whole product.
- **Resolution.** Hard filters first, scoring second. Makes "specialized suitability overrides
  popularity" structurally true. Backed by ~8 realistic trip fixtures frozen as regression tests.

### R4 — Spreadsheet rule-data quality

- **Issue.** Beyond duplicates: `Default Priority / Quantity Rule` conflates three concepts; the
  shaver rule contradicts itself; the toothbrush charger depends on a distinction that doesn't
  exist; "Snacks" is triggered but absent; Bug Spray has a dual category; no row carries packing
  timing or final-verification data.
- **Why it matters.** Guessing here produces false intelligence in the safety-critical half of the
  system.
- **Resolution.** Parse into three explicit fields, always keep the original string, flag
  unparseable rules as `needs_rule_review` rather than inventing them. Approved resolutions in
  `04_IMPORT_PLAN.md` §7.

### R5 — Duplicate import handling

- **Issue.** Inverted since the corrected file: zero exact duplicates, but 13 same-name groups
  distinguished only by color, all genuinely distinct. A naive rule would flag ~30 rows and find
  nothing — and a review queue that cries wolf gets clicked through blindly, which is functionally
  the same as auto-merging.
- **Resolution.** Color as tier-3 discriminator. Verified: **exactly 3 review cards** from the
  85-row import. Never auto-merge on a loose match.

### R6 — Checklist ↔ outfit synchronization

- **Issue.** Two writable views over the same clothing set drift silently.
- **Resolution.** One derived quantity, not two. `checklist_link` ties rows to the slots that
  generated them; `required_qty` is recomputed; `qty_override` is stored separately and wins.
  Recomputation is a single pure function, unit-testable in isolation.

### R7 — Persistence and backup on iOS

- **Issue.** WebKit evicts script-writable storage after ~7 days of disuse. Alex packs a few times
  a year.
- **Resolution.** Server is the source of truth. D1 Time Travel + manual export + written restore.
  No automated off-platform copy in v1 (no stored token, no second personal-data copy).

### R8 — Mobile Safari behavior

- **Issue.** `100vh` overflow, focus zoom below 16px, `position: fixed` vs the home indicator,
  unstyleable native date inputs, safe-area insets, momentum scrolling in sheets.
- **Resolution.** Global primitives established in M0, not fixed per screen. Real-device testing
  budgeted in M10.

### R9 — Private access — **CLOSED**

- **Resolution.** Single passphrase → server-set `HttpOnly` cookie, 1-year expiry, rate-limited
  login. Server-set matters: WebKit caps *JS-set* cookies at 7 days, so this is the difference
  between logging in yearly and weekly. Cloudflare Access rejected.

### R10 — Weather reliability

- **Issue.** Trips are planned weeks out; free forecast horizons are ~16 days. Presenting a climate
  average as a forecast is fabricated confidence.
- **Resolution.** Open-Meteo; forecast within 16 days, labeled climate normals beyond; everything
  cached so the app degrades rather than fails.

### R11 — Verifying real iPhone Safari

- **Issue.** CI cannot run iOS Safari. Playwright WebKit approximates it but does not reproduce ITP
  storage policy, PWA standalone mode, safe-area insets, or the native date wheel.
- **Why it matters.** "Compiles and passes CI" is explicitly not a completion criterion.
- **Resolution.** Vitest carries the pure logic; Playwright WebKit @ 390×844 covers critical flows;
  a written manual iPhone checklist is executed on a real device before each milestone is called
  complete. **Permanent risk — managed, never closed.**

### R12 — During Trip state

- **Issue.** The hardest correctness rule ("only confirmed packed items") meets the worst network
  conditions, and regenerating on each open makes the app look like it changed its mind.
- **Resolution.** A single `packedItemsForTrip(tripId)` the During Trip path cannot bypass, with a
  test asserting not-bringing/unpacked/archived items never appear. `daily_plan` persists the
  accepted plan; adjustments are deltas.

### R13 — Avoiding false intelligence

- **Issue.** The gap between what a keyword matcher does and what it appears to promise.
- **Resolution.** The invariant in `03_INTELLIGENCE_DESIGN.md` §12: critical items may only be
  triggered by structured facts, never by a `possible`-certainty text match. No numeric confidence
  anywhere. Evidence is Alex's own quoted words. When nothing suitable exists, say so.

### R14 — Long-term maintenance

- **Issue.** Used a few times a year, idle between trips. Decay modes: stale dependency tree, a free
  tier that changes terms, rules that live only in someone's head.
- **Resolution.** ~5 runtime dependencies; rules stored as data with original source text preserved
  so they can be inspected and edited without a deploy; pinned toolchain; platform services with no
  idle-suspension behavior. Keep `/product-docs` and `/technical-docs` synchronized with behavior.
