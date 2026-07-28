# Pack Smart Project Instructions

## Product authority

Read all files inside `/product-docs` before making product or implementation decisions.

Use this priority order:

1. Approved product documents
2. Approved architecture decisions
3. Approved milestone plan
4. Existing implementation behavior

Do not silently override an approved product requirement.

## Product constraints

* Pack Smart is initially a private, single-user application for Alex.
* Design specifically for iPhone Safari first.
* Treat Pack Smart as an iPhone product delivered through the web.
* Desktop usability is secondary and must not compromise the iPhone experience.
* Do not use paid AI APIs.
* Avoid ongoing paid services unless Alex explicitly approves them.
* Use deterministic, explainable packing intelligence.
* Use keyword and phrase detection, saved preferences, structured rules, and targeted follow-up questions.
* Do not describe deterministic behavior as artificial intelligence.
* The spreadsheet in `/seed-data` is initial seed data only.
* After launch, the website becomes the source of truth.
* Clothing, items, rules, and preferences must be manageable through the website.
* Clothing photos are not required.
* Outfit recommendations may use only clothing Alex owns.
* During Trip recommendations may use only items confirmed as packed for that trip.
* Approved outfits and the consolidated packing checklist must remain synchronized.
* The checklist must support Pack Now, Pack Later, Final Check, and Not Bringing.
* Trip edits should default to affecting only the current trip.
* Permanent preference changes must be explicit.
* Archived inventory must remain visible in historical trips.
* Detect and surface likely spreadsheet duplicates instead of silently importing them as separate items.
* Post-trip review is v1.1 and must not block v1.
* Do not expand scope without approval.

## User-experience principles

* Optimize for one-handed use beside an open suitcase.
* Every screen should have one obvious primary action.
* Keep common actions immediately accessible.
* Keep uncommon administrative actions out of the way.
* Use progressive disclosure rather than exposing every field.
* Prefer bottom sheets over desktop-style modals.
* Prefer undo over unnecessary confirmation dialogs.
* Avoid hover-dependent behavior.
* Avoid dense tables and desktop-dashboard layouts.
* Minimize typing.
* Use large, comfortable touch targets.
* Preserve the user’s exact location and progress when reopening the app.
* The interface should feel calm, sleek, fast, and Apple-like.
* Apple-like means clear hierarchy and excellent behavior—not excessive visual effects.

## Engineering working rules

* Use Plan Mode before major implementation.
* Work on one approved milestone at a time.
* Do not begin full implementation until the Technical Lead plan is approved.
* Prefer simple, maintainable solutions over clever architecture.
* Avoid unnecessary frameworks, abstractions, dependencies, and services.
* Do not delete substantial files without approval.
* Do not reset or destroy stored data without approval.
* Do not perform destructive database migrations without approval.
* Do not deploy production changes without approval.
* Do not add paid services without approval.
* Test throughout development at realistic iPhone viewport sizes.
* Validate important behavior in iPhone Safari whenever possible.
* Keep documentation synchronized with implementation.
* Do not call a milestone complete only because the code compiles.
* Verify the user-facing acceptance criteria.

## Communication rules

When identifying a concern, use:

* **Issue**
* **Why it matters**
* **Recommended resolution**
* **Product decision required**, only when genuinely necessary

Do not ask questions that can be answered by reading the product documents, inspecting the seed database, or examining the existing project.

Challenge unnecessary complexity and feature creep rather than automatically agreeing with every proposed implementation.
