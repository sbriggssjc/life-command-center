# Prompt 07 - Data-backlog index (property-dossier P0-P3)
- Priority: mixed (P0-P3)
- Status: index - close completed items below; only carry forward remaining blockers
- Related: `docs/architecture/dossier-followup-prompts-for-claude-code.md` (full text of each), `docs/architecture/dossier-v2-audit-and-triage.md`
- Response file: `../responses/07-data-backlog-index.response.md`

The property-dossier data backlog lives in full in `docs/architecture/dossier-followup-prompts-for-claude-code.md` (Prompts 0-8).

## Close / Carry-Forward Status as of 2026-08-01

| Follow-up | Topic | Status | Cowork action |
|---|---|---|---|
| Prompt 0 | Design-vs-production reconciliation for 23654 | Done | Close. Reconciliation artifact exists at `docs/architecture/dossier-design-vs-production-23654.md`; worklog updated in `docs/architecture/dossier-reconciliation-23654-worklog.md`. |
| Prompt 1 | P0 CMS reconciliation + $104.6M revenue bug | Done | Close. Landed in commit `f4518ada` ("Correct operations export to use corrected CMS clinic economics"); code now reads CMS sources and suppresses bad property revenue fallback. |
| Prompt 2 | Rent/SF + current-escalated-rent | Done | Close. `detail.js`, `entities-handler.js`, and `dossier-generator.js` render Year-1 rent, current rent, per-SF values, and term remaining; response is in `done/07-followup2-rent-per-sf.response.docx`. |
| Prompt 3 | Transactions/listings timeline | Done | Close. Deal History and dossier use `sales_transactions` live rows plus `available_listings`; response is in `done/07-followup3-transactions-timeline.response.docx`. |
| Prompt 4 | Lease abstract: guarantor + responsibilities | Done | Close. Lease 16307/property 23654 has guarantor "DaVita Incorporated"; roof/shared, structure/landlord, parking/shared, HVAC/shared; `guaranty_scope` remains null because the PDF was silent. Response is in `done/07-followup4-lease-abstract.response.docx`. |
| Prompt 5 | Loan feeder + finances suppression + bad 2026 graph edges | Done via prompt 04 loan propagation and debt/graph fix work | Close. Structured loan propagation populated DIA loan/mortgage data for 23654, suppresses brokerages as lenders, filters quarantined relationships, and confirmed Radar Woodbridge / Clue Drive candidates are no longer attached. Response is `responses/04-loan-propagation.response.md`; worklog is `docs/history/worklogs/DOSSIER_DEBT_GRAPH_FIX_WORKLOG.md`. |
| Prompt 6 | Documents reconciliation: SharePoint + Salesforce | Done for aggregation; no live CRE/SF candidates for 23654 | Close the wiring item. `action=documents` now aggregates promoted intake artifacts, `lcc_cre_property_documents`, and `sf_files`, with `reconciled_status`, dates, and source history. Live 23654 has 4 linked intake docs; CRE and Salesforce sources honestly report `not_yet_reconciled` because no matching live rows exist. Response is `responses/Reconcile Documents and Dossiers.docx`. |
| Prompt 7 | Relocation lineage + market competition | Code done; live DB apply pending credentials | Keep carry-forward only for DB apply. LCC code and dialysis migration exist (`supabase/migrations/dialysis/20260801190000_dia_dossier_relocation_competition.sql`), but Supabase migration credentials are still needed to activate the live view/RPC/backfill. Response is `responses/Backfill dialysis lineage query.docx`. |
| Prompt 8 | Location & Trade Area | Partial: map/Places/rendering done; Census radius backfill blocked | Keep carry-forward only for Census radius demographics. Static Maps cache, Places tenant storage, ZIP census fallback, payer mix, and coverage audit helper are implemented and live migration was applied; `property_demographics` rows for 23654 remain absent because `CENSUS_API_KEY` is not configured. Coverage gap list is `DIA_DEMOGRAPHICS_COVERAGE_GAPS_2026-08-01.md`; response is `responses/Implement dossier trade area.docx`. |

## Remaining Actionable Carry-Forwards

1. Apply `supabase/migrations/dialysis/20260801190000_dia_dossier_relocation_competition.sql` to Dialysis_DB with proper Supabase migration credentials.
2. Configure `CENSUS_API_KEY`, then run/apply the radius-demographics backfill for property 23654 and audit the 994 dialysis properties that still lack `property_demographics` rows.

Everything else in the P0-P3 property-dossier backlog can be closed.

## Update 2026-08-01 (session 2d): backlog RECONCILED (Claude Code)
Claude Code returned a reconciliation: **close prompts 0,1,2,3,4,5,6**; carry forward only 7 & 8 (credential/env).
- P0 design-vs-prod reconciliation: artifact `docs/architecture/dossier-design-vs-production-23654.md`. DONE.
- P1 CMS revenue bug: landed f4518ada. DONE.
- P2 rent/SF, P3 timeline, P4 lease abstract: DONE (see done/07-followup2/3/4).
- P5 loan feeder + finances suppression: DONE (asset-metadata-loan-feeder + quarantine; 8 M&M edges quarantined;
  Radar Woodbridge/Clue Drive found zero attached). See done/07-followup5-debt-graph.
- P6 documents reconciliation: DONE — shared gatherer (intake + lcc_cre_property_documents + SF files) with
  per-doc reconciled status; 23654 shows 4 linked docs, CRE/SF report not_yet_reconciled (no matching rows).
  See done/07-followup6-documents.
- **Carry-forward (in prompt 16):** P7 relocation/competition — code done, live migration apply pending; P8
  Location & Trade Area — map + Places callouts (Walmart/Walgreens/Dollar Tree) done, radius demographics pending
  CENSUS_API_KEY.
