# Prompt 30 — Data-integrity Phase 1: AUDIT the sources, coverage, precedence & linkage (understand-first)

## Why
Scott: "constant cleaning so there's ONE accurate representation everywhere — the most accurate data ingested from
every source (current/past sales, current/past listings, every lease, Salesforce, prior comps, call notes) for
every property." Design + measured gaps: `docs/architecture/comps-data-integrity-and-canonical-record.md`. Before
building the canonical-record program, AUDIT what exists so we complete/connect the existing machinery rather than
rebuild. **No schema/data changes in this prompt — audit + plan only.**

## Task — inventory and map (both Dialysis_DB and Government DB)
1. **Sources & ingestion paths.** For each source (current sales, past sales, current listings, past listings,
   leases, Salesforce records, prior comps, call notes/OMs, CMS, CoStar): which table(s) it lands in, which
   pipeline/function ingests it, and its cadence/freshness. Note the existing machinery — pipelines, the
   `gracious-radiance` resolver, `field_source_priority`, `v_sales_comps`, the recompute/backfill functions
   (`dia_backfill_master_comp_fields`, `dia_recompute_caps_backfill`, `dia_promote_nm_comps`,
   `propagate_sales_recompute`, `refresh_v_sales_comps`, etc.), and the Health surface.
2. **Field-level coverage map.** For the canonical comp/property fields (address, RBA/land/year, tenant/credit,
   lease terms/rent/bumps/options/expiration, chairs/patients, sale price/date/cap, initial+last ask + cap,
   on-market date, buyer/seller, source), report null-rate per field per source table (extend the measured dia
   numbers: cap 73%, chairs 73%, patients 74%, lease 84%, initial_price 38%, initial_cap 39%, last_price 64%).
   Flag fields where a source HAS the value but it isn't propagated to the record the comps engine reads.
3. **Precedence & reconciliation.** Document the current `field_source_priority` rules per field; identify where
   precedence is missing/wrong (e.g. a modeled cap winning over a human-sourced one), and where multiple sources
   conflict with no resolution.
4. **Dedup/linkage.** Characterize the 610 duplicate-property live-sold rows (genuine repeat sales vs portfolio
   allocations vs multi-source dupes) and how the resolver/linkage currently (fails to) collapse them; same for
   properties duplicated across sources.

## Deliverable
`docs/architecture/data-integrity-audit-2026-08.md`: the source×field coverage matrix, the precedence map, the
dedup/linkage findings, and a **prioritized, phased backfill+reconcile+continuous-scrub plan** (which gaps to
close first for comp/appraisal quality, which existing function to extend for each, and where continuous scrub +
a coverage dashboard hook into pg_cron + the Health surface). Recommend the canonical-record model (one row per
property, field-level chosen value + lineage) concretely against the existing tables.

## Guardrails
Audit only — do not migrate, backfill, or dedup in this prompt. No fabrication; where behavior is unclear from
code/SQL, say so and cite the table/function. Reconcile against the design doc; correct its numbers if the full
audit differs.
