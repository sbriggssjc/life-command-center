# Claude Code prompt — R7 Phase 2: convert the legacy lanes + surface the surfaceless

Paste into Claude Code, run from the **life-command-center** repo. Phase 2 of
the Decision Center plan (`audit/data-flow-2026-05-30/LCC_DECISION_CENTER_DESIGN.md`
— read it first; Phases 0/1 + the Slice-3 write-back shipped on PR #1063 and
are live). Scott is actively working the app — keep every change additive and
deploy-safe; no behavior changes to the two live lanes.

## Goal

Every lane under "More review work" becomes a real decision lane — same
anatomy as Phase 1 (question → subject+context card → 2-4 one-click verdicts
that move the subject forward → workable top-N by $ value, universe count as
subtitle) — and the three decision types with NO surface today get one. A
lane "Open →" never again dumps the user onto a foreign page to figure out
the ask themselves.

## Anti-bloat rule (decide this FIRST, apply consistently)

Do NOT seed 14k/6.9k-row universes into `lcc_decisions` (the disk-incident
lesson — bounded tables only). Pattern: lanes LIST from their source view
(top-N by value, served fresh), and a decision row is created at
VERDICT time (`lcc_open_decision` + immediate verdict, or insert-decided) so
`lcc_decisions` stays the audit trail of judgments actually made, not a
mirror of every backlog. The Phase-1 seeded lanes stay as they are (they're
bounded); document the two modes ("seeded" vs "list-federated") in CLAUDE.md.

## Lanes to convert (verified machinery — reuse, don't rebuild)

1. **Staged intake — needs review** (542). The inbox verdict cards from R4-C
   already have the right actions (Create property → / Re-extract OCR /
   View extraction / Dismiss + the intake outcome join). Render those same
   cards in-lane (top-N by extracted asking_price), decision-record each
   verdict (`decision_type='intake_disposition'`). Don't duplicate logic —
   extract/reuse the card renderer.
2. **Property merges & duplicates** (gov dup addresses 6,914; dia has the
   same class via `v_data_quality_issues.duplicate_property_address`).
   Question: "Are these the same property?" Context: both property cards
   (address/city/tenant/rent/source). Verdicts: **Merge (keep A / keep B)** →
   existing `?_route=consolidate-property` machinery (`dia_merge_property` /
   gov equivalent — both verified present); **Not a duplicate** → records +
   suppresses the pair from the lane (a small dismissals table or metadata
   flag — make the source view exclude dismissed pairs); **Research**.
   Rank by combined rent/value. `decision_type='property_merge'`.
3. **Data conflicts & provenance** (`v_field_provenance_actionable`, 14,113 —
   plus the 67 `sales_price_xref_conflict` rows in dia
   `v_data_quality_issues`). Question: "Which value is right?" Context:
   field, the conflicting values, each side's source + confidence + date.
   Verdicts: **Keep A** / **Keep B** (write through `lcc_merge_field` /
   the provenance decision machinery so the priority registry learns) /
   **Skip**. Rank by field importance × property value (price/rent/cap
   fields first). `decision_type='provenance_conflict'`.
4. **Pending updates (Gov)** (2,087; state machine on `pending_updates`:
   table_name/property_id/field_name/reason/status). Question: "Apply this
   update?" Verdicts: **Apply** / **Reject** (advance the state machine via
   its existing transitions — find the consumer in the gov pipeline, don't
   invent new states) / **Research**. `decision_type='pending_update'`.
5. **Owner-contact links to confirm** (44 FL SOS weak links;
   `handleFlSosEnrichLink` machinery exists). Question: "Is this the right
   contact for this owner?" Verdicts: **Confirm link** / **Wrong person** /
   **Research**. `decision_type='owner_contact_link'`. This one is small and
   bounded — seeded mode is fine.

## Surfaceless types to add

6. **CMS↔property link suspects** (dia `v_property_cms_link_suspect`, 215;
   `suspect_kind` state_diff worst-first, `street_looks_unrelated` strong
   signal, `zip5_matches` low concern — the view self-describes severity).
   Question: "Is this clinic linked to the right property?" Verdicts:
   **Link is correct** / **Break link** (NULL the property↔clinic linkage
   via the existing cms-match machinery) / **Research**.
   `decision_type='cms_link_suspect'`.
7. **Junk entity names** (41 flagged `metadata.junk_name_flagged`).
   Question: "What should this entity be?" Context: the junk name, its
   identities/portfolio. Verdicts: **Rename to …** (inline input) /
   **Merge into …** (entity typeahead → `lcc_merge_entity`) / **Leave
   flagged**. `decision_type='junk_entity_name'`. Seeded mode (bounded).
8. **Implausible values** (the magnitude-flag class — the $950M rows
   suppressed from NBA). Source: whatever the QA#1/R4-D suppression reads
   (`SALE_PRICE_BLEED_CEILING` exclusions). Question: "Is this value real?"
   Verdicts: **Correct value is …** / **Confirm as-is** / **Void the
   record**. If the suppressed set lacks a queryable source, build the small
   view first. `decision_type='implausible_value'`.

## Cross-cutting

- Lane order on the page: open-decision lanes first (Phase 1's two), then
  these by workable-value descending; "More review work" section disappears
  when everything is a lane.
- `v_lcc_decision_open_counts` + the `/api/decisions?summary=1` payload
  extend to the new types (list-federated lanes report their source-view
  workable count instead).
- Every verdict: effect-first, outcome-truthful (the Slice-2 lesson —
  effects record what ACTUALLY happened; failures keep/leave the item
  retryable and 502).
- Cross-domain writes in this phase (merge, pending-update apply, CMS
  unlink, provenance keep-B) all ride EXISTING domain machinery — no new
  write paths, no new gates needed. The gov write-back flag
  (`DECISION_GOV_WRITEBACK`) governs ONLY the true-owner correction; these
  lanes' writes are already-blessed existing operations.
- Respect the 12-function ceiling; sub-routes on existing handlers;
  `node --check`; idempotent migrations; crons (if any sweep is needed)
  after routes deploy. ANALYZE after any bulk-refreshed table.

## Verify + ship
- Each lane: top item renders with real evidence; one verdict exercised
  live per lane where side-effect-safe (use Research/Skip/dismiss verdicts
  for the destructive ones — leave Merge/Apply/Break-link to Scott, who is
  actively working the app); decision rows record honestly.
- lcc_decisions stays bounded (report row count after).
- The two Phase-1 lanes unchanged (regression: counts + a verdict cycle).
- Report per-lane workable counts in the PR.
