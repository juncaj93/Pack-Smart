# Pack Smart — Technical Lead Handoff Brief

## 1. Role boundary

The Product Manager has defined the product behavior, experience, and scope.

The Technical Lead should now determine:

- Architecture
- Data storage
- Hosting
- Parsing implementation
- Weather and itinerary integrations
- Offline or persistence strategy
- Import mechanics
- Security and privacy choices
- Testing strategy
- Deployment approach

Do not reinterpret technical convenience as permission to weaken the product requirements without surfacing the tradeoff.

## 2. Product constraints

The implementation must respect:

- iPhone Safari is the primary platform.
- No paid AI API is required for core operation.
- The product is initially for one user: Alex.
- The website becomes the source of truth after spreadsheet import.
- Outfit and checklist data must remain synchronized.
- During Trip can recommend only confirmed packed items.
- Critical-item and quantity logic must be explainable.
- Common tasks must remain fast and uncluttered.

## 3. Required technical discovery before coding

The Technical Lead should evaluate and document:

- Best zero- or near-zero-cost hosting and persistence approach
- Whether authentication is necessary for a single-user personal site
- How to safely persist private travel and medication-related item names
- How to parse supported files and text without a paid AI service
- How to obtain weather data within free-tier constraints
- How to support installed Home Screen behavior
- How to preserve progress reliably on iPhone Safari
- How to import and deduplicate the current workbook
- How to model deterministic rules without exposing engineering complexity in the UI

## 4. Implementation priorities

Build in vertical slices that produce usable product value.

Recommended order:

1. Import and My Stuff management
2. Basic trip creation and structured activities
3. Personal rules and generated checklist
4. Pack Now / Pack Later / Final Check behavior
5. Outfit grouping and synchronization
6. Natural-language phrase detection and confirmation
7. One Last Look
8. During Trip mode
9. Itinerary file parsing and weather refinements

The Technical Lead may propose a different order but should preserve early end-to-end usability.

## 5. Phrase detection requirements

This is a curated travel interpreter, not general natural-language intelligence.

It should:

- Recognize a maintainable vocabulary of high-value phrases
- Handle common negation and uncertainty
- Produce structured trip facts
- Show uncertain facts for confirmation
- Allow manual fallback

It should not:

- Claim arbitrary language understanding
- Generate long conversational responses
- Make critical safety decisions from weak keyword matches

## 6. Import requirements

The current workbook contains duplicate-looking clothing rows. Import logic must include:

- Exact duplicate detection
- Likely duplicate grouping
- Human review for ambiguity
- Import summary
- Original-value traceability where useful

Do not assume every source row is a unique garment.

## 7. UX implementation requirements

- Design at iPhone widths first.
- Test on real iPhone Safari behavior, not desktop emulation alone.
- Use mobile-native interaction patterns.
- Keep the main checklist fast with large tap targets.
- Use progressive disclosure for item metadata.
- Avoid desktop-first tables and multi-column dashboards.
- Ensure date inputs and overlays behave correctly on iOS.
- Preserve current trip context and scroll position where practical.

## 8. Data integrity requirements

- Trip-only edits remain trip-only unless explicitly promoted.
- Historical trips retain references to archived items.
- Removed items remain recoverable through Not Bringing or undo.
- Outfit changes update checklist quantities.
- Checklist removals identify affected outfits.
- During Trip filters against confirmed packed inventory.
- Critical rules remain inspectable and testable.

## 9. Product analytics

No external analytics platform is required for v1.

Useful local or internal signals may include:

- Time to create a trip
- Number of corrections before packing
- Items added or removed
- Outfits swapped
- Items marked worn
- Items repeatedly excluded

Do not let analytics collection complicate privacy or hosting.

## 10. Definition of implementation readiness

Before coding the full product, the Technical Lead should return:

- Proposed architecture
- Hosting and operating-cost expectation
- Data model
- Integration plan
- Import and deduplication plan
- Major risks
- Open product questions that cannot be resolved technically
- Recommended milestone plan

The Technical Lead should challenge requirements when a simpler approach preserves user value, but should not add scope without a clear product reason.

## 11. Product source documents

Read all numbered MD files in this package before producing architecture or code.

Do not rely only on this brief. It is an entry point, not a replacement for the detailed requirements.
