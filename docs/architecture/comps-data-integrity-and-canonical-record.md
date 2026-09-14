# Comps data quality → the canonical-record initiative (2026-08-04)

Scott's 10 comps issues + "we need constant cleaning so there's ONE accurate representation everywhere, the most
accurate data ingested from every source (current/past sales, current/past listings, every lease, Salesforce,
prior comps, call notes) for every property." Diagnosed against Dialysis_DB. Two tracks: **export polish** (fix
what existing data allows) and the **canonical-record data-integrity program** (the real fix Scott is pointing at).

## Diagnosis — each issue is EXPORT-mapping vs SOURCE-data (measured, 3,022 live sold; 434 active listings)
| # | Issue | Type | Evidence |
|---|-------|------|----------|
| 1 | Duplicate sales in pulls | reconcile | **610 properties have >1 live sold row** (portfolio-allocation + multi-source dupes) |
| 2 | Missing chair/patient counts | SOURCE | chairs on 2,212/3,022 (73%); patients 2,231 (74%) → ~810 blank |
| 3 | Missing expenses/bumps/options | SOURCE | active lease on 2,531/3,022 (84%) → ~490 have no lease record |
| 4 | No standardized bumps/options display | EXPORT | engine returns varied formats; normalize `X.X%/yr` + `(N) M-yr` |
| 5 | Missing ALL initial price/cap | SOURCE | linked listings have initial_price on **1,054/2,802 (38%)**, initial_cap **1,092 (39%)** |
| 6 | Missing last asking (some) | SOURCE | last_price on 1,799/2,802 (64%) → ~1,000 blank |
| 7 | No on-market dates (sold) | EXPORT | on_market_date populated on **2,802/2,802 (100%)** of linked listings — data exists, export drops it |
| 8 | Price-change calc missing | derived | depends on #5/#6 — resolves when those backfill |
| 9 | Cap band not appraisal-clean | reconcile/export | 15 sold <4%, 276 in 4-5.5%, **905 in 5.5-6.75%**, 1,022 >6.75% — tighten to a subject band; exclude 3.01% etc. |
| 10 | On-market rows mostly empty + a 19% cap | EXPORT + SOURCE | active listings: initial_cap 274/434 (63%), on_market_date 385/434 (89%); only **3** active caps >12% (the 19% is one) |

**Bottom line:** #4,7,10 are EXPORT mapping (data exists, isn't flowing); #1,9 are RECONCILE/dedup+band; #2,3,5,6,8
are SOURCE-COVERAGE gaps — the fields aren't ingested/reconciled for a large share of properties. The export can
only show what the DB holds, so the durable fix is the data-integrity program.

## Track 1 — Comps pull/export polish (prompt 29) — near-term, uses existing data
Dedup to one canonical row per property-sale; fix the export-mapping gaps (#7 on-market date for sold, #10
on-market sheet fields, initial/last price+cap where present); standardize bumps/options display (#4);
subject-relative appraisal cap band + error exclusion (#9,10: drop <~4% and the 19%/>12% listings; primary band
around the subject ~5.5-6.75%; real out-of-band comps → labeled secondary). This is cosmetic+logic, not new data.

## Track 2 — The canonical-record data-integrity program (the real ask)
**Goal:** one continuously-reconciled canonical record per property, whose every field is the single most-accurate
value chosen from ALL sources (current+past sales, current+past listings, every lease, Salesforce, prior comps,
call notes/OMs), with lineage — used identically by comps, BOV, dossiers, everywhere.

**Reuse existing machinery, don't rebuild:** the ingestion pipelines, the record-linkage resolver
(`gracious-radiance`), `field_source_priority` (field-level precedence), `v_sales_comps`, the many backfill/
recompute functions (`dia_backfill_master_comp_fields`, `dia_recompute_caps_backfill`, `dia_promote_nm_comps`,
`propagate_sales_recompute`, `refresh_v_sales_comps`), and the LCC Health surface (coverage/observability). The
program is mostly *completing + connecting + continuously running* these, not greenfield.

**Phased plan**
- **P1 — AUDIT (prompt 30, understand-first):** inventory every source + ingestion path per field; produce the
  field-level coverage map (the null-rates above, extended to all fields + both gov and dia) and the current
  `field_source_priority` precedence; find where sources exist but aren't wired, where precedence is wrong, and
  where dedup/linkage fails (the 610). Deliver the canonical-record spec + a prioritized backfill/reconcile plan.
- **P2 — DEDUP/RECONCILE:** collapse the 610 duplicate-property sales + portfolio allocations to one canonical
  sale per event; strengthen the resolver/linkage so one property = one node across all sources.
- **P3 — BACKFILL COVERAGE:** fill the source gaps (initial price/cap, last ask, on-market dates, chairs/patients,
  leases) from CoStar/Salesforce/CMS/lease abstracts, honoring `field_source_priority`; never overwrite a
  higher-precedence value; render "Not on file" only when truly absent.
- **P4 — CONTINUOUS SCRUB:** schedule the reconcile+backfill+validation to run continuously (pg_cron), so new
  ingests are cleaned on arrival and every field converges to one accurate value; surface field-level coverage +
  drift on the Health surface as a standing dashboard.

Subject-resolution for comps (pin the actual under-contract deal record) is a P2/P3 beneficiary — once the
property graph is clean, "The Villages" resolves to the real asset with tenant/term/SF/chairs/cap.

## Update 2026-08-04 — dedup reframe + Ollama decision
Prompt 30's follow-up investigation reframes the duplicate-property symptom: the 610 live-sold duplicate groups
are not one bucket of bad duplicate sales. Of the 967 excess rows, **497 groups (81%) are genuine repeat sales**
more than two years apart and must remain distinct. The existing sale natural key (`normalized address|state|
sale_date`) is correctly preserving those repeat sales.

The actual P2 cleaning gap is narrower and more structural:
- **93 buildings have multiple `property_id` records** for the same normalized address. These should be handled
  by the calibrated record-linkage resolver (`gracious-radiance`) plus a reversible property-merge path that
  mirrors `lcc_merge_entity`: move related sales, leases, listings, and identities to a canonical winner; preserve
  a backup table and `batch_tag`; auto-merge only high-confidence matches; send ambiguous cases to review.
- **214 groups span multiple `data_source` values.** A subset are same sale events ingested from CoStar,
  Salesforce, CMS, or other sources with slightly different dates/prices. Reconcile these as same-event sale
  records only when property, buyer, price, and date-window evidence is strong; keep genuine repeat sales
  distinct. Canonical sale fields should follow `field_source_priority`; non-winning source rows are tagged
  `superseded`, never hard-deleted.
- **Comp-pull behavior remains one-row-per-property for appraisal.** Prompt 29's most-recent-per-property
  selection should remain in place; a sale-history view can expose older legitimate repeat sales when requested.
- **Prevent recurrence at ingest time.** New sales/listings for an existing building must attach to the existing
  `property_id` instead of creating the next duplicate property record.
- **Apply the same pattern to gov.** The audit found analogous government-side duplicate and coverage issues.

Ollama is intentionally not the primary dedup engine. Bulk dedup/linkage remains entity resolution
(Splink/Fellegi-Sunter + embeddings): fast, calibrated, auditable, and high-volume. Ollama belongs in P4 as an
assist layer on top of the resolver: triage ambiguous review-lane candidates using address/notes/OM/email text,
link unstructured references to the right property or sale, and narrate field conflicts for human or
priority-confirmed decisions. This should reuse the existing `invokeExtractionAI` seam across dia, gov, and ops
and surface on the Health surface.

## Update 2026-08-04 — dedup reframe + Ollama decision + connector-OAuth finding
Dedup reframe: 497/610 groups are genuine repeat sales (KEEP); real dups = 93 property-record dups + subset of 214
multi-source. P2 (prompt 31) = property consolidation + multi-source reconciliation, not deletion. Ollama cleaning
agent (prompt 32) = ASSIST layer only (review-lane triage + unstructured reconciliation; LLM proposes, resolver/
priority/human confirms; continuous P4 via invokeExtractionAI; all DBs). Connector-OAuth: the OAuth routes are
defined outside `mountLccMcp`, so they aren't on tranquil-delight → Cowork/Copilot MCP OAuth registration fails
(prompt 33 mounts them + sets MCP_BASE_URL).
