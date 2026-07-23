# Claude Code (LCC extension) — give the SOS Research Worklist a front door

Small UX fix. The SOS Research Worklist (`renderLlcResearchQueue`) is the surface that STARTS
the SOS capture flow, but today it has no entry point of its own — the only way to reach it is
the **"Research Queue"** button (`#llcQueueBtn`, `extension/sidepanel.js` ~line 3263), which
renders ONLY inside the post-scan entity-details view. So a user must scan some org page just to
open the worklist that's supposed to begin the workflow — an inverted, buried entry point. Live
worklist has 887 gov owners waiting; there's no clean way in.

## The fix

Add a **persistent "SOS Research Worklist"** entry point on the **Property tab** so the worklist
is reachable without scanning first.

Minimum (both are cheap, do both):

1. **In the no-context empty-state** (`extension/sidepanel.js` ~line 695-707, the
   `if (!source)` block that renders "Scan This Page"): add a second button
   **"SOS Research Worklist"** below Scan This Page, wired to
   `renderLlcResearchQueue('government')`. This is the state the panel shows when you're not on a
   recognized property page — exactly when a user wants to open the worklist to start SOS work.

2. **Persistent access even when a property/entity IS shown:** add the same
   "SOS Research Worklist" affordance so it's reachable from the Property tab regardless of
   context — e.g. a small always-present button in the Property tab (header or a fixed action),
   not only in the empty-state and not only after a scan. Keep it unobtrusive; it's a secondary
   action, but always available.

The worklist itself already renders the Gov/Dialysis toggle + the state picker (Unit 1 of the
Option-B round), so this is purely the missing DOOR — reuse `renderLlcResearchQueue`, do not
rebuild it.

## Boundaries

Extension side-panel only (`sidepanel.js` / `sidepanel.html`) · reuse the existing
`renderLlcResearchQueue('government')` + its state picker · no server/API change · no new
worklist logic · keep the existing "Research Queue" button in the scan-result view (it's fine
there too) · unobtrusive secondary styling.

## Verify

1. `node --check extension/sidepanel.js`; suite/boot as applicable.
2. On any non-property page (e.g. a state SOS site, or `about:blank`), open the side panel →
   Property tab shows a **"SOS Research Worklist"** button → clicking it opens the worklist with
   the 887 owners + state picker, WITHOUT scanning anything first.
3. The button is also reachable from the Property tab when a property/entity IS displayed.
4. The intended flow now works front-to-back from the door: Worklist → pick a state (e.g. FL) →
   pick owner → "Look up SOS" → Scan This Page → "SOS → Owner".

## Context

This unblocks Scott's live end-to-end test of the Option-B SOS capture flow (he'll test with
Florida/Sunbiz — the free, no-login, fixture-tested state). The whole capture→writeback→
observations→reconcile chain is live; it just needs a usable door. Extension changes ship when
Scott reloads the unpacked extension (not a Railway deploy).
