# GOV-UX1 — Gov Available: clicking a row jumps the app to Dialysis; owner click replaces the property panel and can't find the owner; verification card isn't in the same place across lanes

Source: `SB notes/done/gov availables view.docx` (2026-09-22) → TRIAGE `SBN-23` (the parity half), `SBN-24`, `SBN-25`.
Cowork's evidence is below. Re-measure before building.

## What Scott saw (his words)

- "The verification section here does not appear in our dialysis section. We want this LCC app user interface to be uniform across the various swimlanes."
- "When I click into a property on this availables section, it takes our background navigation back to the home dashboard of the dialysis section."
- "When I click into the ownership, it does not pop up in a owner sidebar window like we want but instead is opening over the prior sale view."
- "We also want as many of these resolutions and connections to be automated as possible rather than prompting the user for it. We want the leads to be created automatically when we have enough evidence for there to be a lead or connection. Same for the agency resolution. Or any other prompt we have."

## Measured

1. **Background navigation (SBN-24).** In screenshot 4, the Gov › Deals › Sales › Available row for 13923 Gold Cir, Omaha opened the property panel, and the top nav behind it switched to **Dialysis › Overview**. The row's handler is `showDetail(rowData, "gov-ownership")` (`gov.js`, Available table, ~line 9417). `showDetail` (`app.js:5668`) routes `gov-ownership` / `gov-lead` / `gov-listing` to the unified detail page. Find what changes the active domain tab: the unified detail open, its close/back path, or a default-tab fallback. Clicking a row must never move the background.

2. **Owner click (SBN-25).**
   - The property panel shows "Owner: Gold Circle Properties" and **Next step: "Create the lead — Owner resolved"**.
   - Clicking the owner replaced the property panel with an entity view (`detail-openers.js` ~185–217, the same `bodyEl`). It showed **"No entity found matching 'Gold Circle Properties, LLC'"**.
   - Live on LCC Opps, entity `ff84dd24-8177-4166-ada2-99402eabdf7b` "Gold Circle Properties" exists (a twin, `fe43e581…`, is already merged into it).
   - So the lookup searches the raw display string with the `, LLC` suffix and misses the entity the Next-step card itself calls "resolved".
   - The "What to do about this property" block then offers both **Create lead / Add to cadence** and a **"Resolve agency drift: property says 'General Services Administration', lease says 'DHS'"** prompt.

3. **Verification card parity (SBN-23).**
   - Gov renders `renderGovListingVerificationCard()` + `renderRecentGovVerificationsPanel()` on **Sales › Available** (`gov.js` ~9318/9329).
   - Dialysis renders `renderListingVerificationCard()` + `renderRecentDiaVerificationsPanel()` on the **On-Market** section of its overview (`dialysis.js` ~2994/2997), not on its Sales › Available tab.
   - The headline number also differs. Dialysis headlines `overdue (30d+)` (DIA_OVERVIEW_TILE_AUDIT Unit 4). Gov still headlines the "due now" count: "9" in the screenshot, beside "80 30d-overdue".
   - Gov's Recent Verifications panel showed 50/50 **cron-only** rows (`auto_scrape · inferred_active · no sale evidence in 3y`) and 0 evidence rows. That is a timer advance, not a verification.

## Ask

A. **Fix the navigation jump.** Opening or closing any detail/owner panel from any lane leaves the background lane, tab and sub-tab exactly where they were. Add a test that opens a gov Available row and asserts the active domain tab is unchanged.

B. **Owner panel.**
   - Open the owner in a **stacked side panel over the property panel**, with Back returning to the property: Scott's "owner sidebar window". Check whether a stacked-panel pattern already exists (`detail-panel-shell.js`, `detail-openers.js`) before building one.
   - Resolve the owner by **id** when the property already carries a resolved owner/entity link, and fall back to a name search that normalizes entity suffixes (LLC, Inc, LP, Ltd, trailing punctuation) through the existing `normalizeCanonicalName`. The "Owner resolved" card and the owner click must agree: one resolver, one answer.

C. **One verification surface for both lanes.** Same component, same placement (decide Sales › Available, or On-Market in both, and say why), and the same headline definition (`overdue (30d+)`). In the Recent panel, label cron-only timer advances as such, or hide them behind the existing "Cron-only" filter by default, so the panel leads with real evidence.

D. **Automation: measure, then recommend (don't build in this prompt).** For each prompt the property panel can raise ("Create the lead", "Add to cadence", "Resolve agency drift", and any other `next-best-action` class), report:
   - the live count of open instances (dia + gov);
   - what evidence the code already has when it raises it;
   - whether a deterministic rule could act on it with no human decision, following the standing doctrine: *only human-in-the-loop work belongs in a priority list; anything the code can decide, the code decides and logs*;
   - the proposed rule and its false-positive risk.

   Agency drift (property says GSA, lease says DHS) is the ID3a class, and `ID3a-drift` exists. Read it first. Lead auto-creation should reuse the BD opportunity writer. End with a ranked recommendation table; the build is a follow-up prompt.

## Do not touch

- Gov listing data (`GOV-AVAIL1` owns it).
- The ID3a canonicalizer logic.

## Done means

- Tests for A and B (including the `, LLC` case), each with a mutation that turns it red.
- A before/after screenshot description or a DOM-level assertion for C.
- The D table in the response and in `docs/audits/`.
- Backlog row `GOV-UX1` updated.
- Deploy = redeploy BOTH Railway services; cache busters bumped as a set.
