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
