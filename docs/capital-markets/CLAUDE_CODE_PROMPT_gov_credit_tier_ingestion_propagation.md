# Claude Code Prompt — Gov Credit-Tier Ingestion + Propagation Investigation

## Context
The government capital markets export chart `cap_rate_by_credit` is visually sparse for State and Municipal cap rates. A live read-only check on 2026-08-10 found:

- `cm_gov_cap_by_credit_q`: Federal `117/117` quarters (`1997-03-31` to `2026-03-31`), State `77` quarters (`2004-12-31` to `2025-09-30`), Municipal `29` quarters (`2014-12-31` to `2023-03-31`).
- `cm_gov_cap_by_credit_m`: Federal `351` months, State `230` months, Municipal `84` months.
- Recent TTM counts show Municipal falls below the current view gate (`muni_n >= 2`) after `2023-03-31` except for isolated rows.
- Many 2023+ cap-eligible unclassified sales have blank `government_type` and `agency`, so the gap appears to be source-data/enrichment/propagation related, not primarily an Excel chart rendering issue.
- Some rows have ambiguous `government_type = 'Local/State'` with state agencies, and classifier behavior depends on SQL CASE ordering.

## Objective
Investigate the full ingestion and propagation path for government deal credit tier metadata so future government capital markets exports have the best possible State/Municipal coverage without fabricating data.

Do not mutate canonical records in the first pass. Produce a grounded audit with counts, examples, and a recommended remediation plan.

## Required Reading
1. `CLAUDE.md`
2. `.github/AI_INSTRUCTIONS.md`
3. `CAPMARKETS_TAB_PACKET_WORKLOG.md`
4. `docs/capital-markets/ROUND66_DATA_AUDIT_2026-06-01.md`
5. `docs/capital-markets/ROUND66_EXPORT_FEEDBACK_WORKLOG.md`
6. `supabase/migrations/20260694_cm_round66_gov_export_feedback_view_fixes.sql`
7. `supabase/migrations/20260699_cm_round66e_gov_credit_classifier.sql`
8. `api/capital-markets.js`
9. `api/_shared/cm-excel-export.js`
10. `api/_shared/cm-native-chart-injector.js`

## Investigation Questions
1. What are all current ingestion paths that write government sale/deal rows into `sales_transactions`?
2. Which fields are available at each ingestion stage for tenant/agency/credit tier classification?
3. Where should `government_type`, `agency`, and any future normalized `credit_tier` field be set?
4. Are recent unclassified sales missing source metadata entirely, or is metadata present upstream but not propagated into `sales_transactions`?
5. Does the live Gov DB view definition for `cm_gov_cap_by_credit_q` match the latest migration in this repo?
6. Should `Local/State` map to Municipal, State, or be split by agency text first?
7. Should the chart continue using quarterly `_q`, or should the export use monthly `_m` for this chart to reveal sparse but real observations more clearly?
8. Are the `n >= 2` gates for State/Municipal correct, or should the view expose point counts plus single-observation marker rows while the chart labels them as thin?

## Suggested Read-Only Queries
Use read-only Supabase access. Do not update rows.

1. Coverage of chart views:
   - Count rows and non-null `federal_cap`, `state_cap`, `municipal_cap` in `cm_gov_cap_by_credit_q`.
   - Count rows and non-null `federal_cap`, `state_cap`, `municipal_cap` in `cm_gov_cap_by_credit_m`.
   - For each tier, report first/last non-null period and recent non-null periods.

2. Eligible sale classification coverage:
   - Pull cap-eligible sales where `sale_date IS NOT NULL`, `sold_price > 0`, `sold_cap_rate BETWEEN 0.04 AND 0.12`, `sale_date <= cm_last_completed_quarter_end()`, and `cap_rate_quality IS DISTINCT FROM 'implausible_unverified'`.
   - Group by year and derived credit tier using the live SQL classifier logic.
   - Separately group by raw `government_type` and raw/normalized `agency`.

3. Unclassified sale audit:
   - For 2023+, list a sample of unclassified eligible sales with `property_id`, `sale_date`, `sold_price`, `sold_cap_rate`, `government_type`, `agency`, tenant fields, source fields, and any raw ingestion payload/provenance fields available.
   - Determine whether each row has no upstream metadata, has metadata under another column/table, or has metadata that the classifier misses.

4. Propagation path audit:
   - Trace writers/importers that set `sales_transactions.government_type` and `sales_transactions.agency`.
   - Search code for `government_type`, `agency`, `sales_transactions`, `gov`, `rca_import`, `sidebar`, `intake`, `apply-change`, and Capital Markets import paths.
   - Identify whether source rows in listings/leases/properties carry agency/tenant metadata that should propagate to sales.

5. View-definition drift:
   - Compare live `cm_gov_cap_by_credit_q` definition with `supabase/migrations/20260699_cm_round66e_gov_credit_classifier.sql`.
   - If drift exists, document whether the migration was never applied, later overwritten, or intentionally superseded.

## Deliverables
1. A markdown audit saved under `docs/capital-markets/` with:
   - Current coverage table.
   - Ingestion/provenance map.
   - Examples of recoverable unclassified rows.
   - Examples of truly missing source metadata.
   - View-definition drift findings.
   - Recommended remediation plan split into safe phases.

2. A proposed DB remediation plan, but do not execute it without explicit approval:
   - Phase A: additive/read-only diagnostics views or scripts.
   - Phase B: classifier/view fix if live definition is stale or CASE ordering is wrong.
   - Phase C: ingestion propagation fix so future rows carry `government_type`/`agency` reliably.
   - Phase D: optional backfill proposal using conservative, provenance-tagged fill-blanks only.

3. A chart/export recommendation:
   - Whether to keep `_q`, switch chart display to `_m`, or expose both.
   - Whether to keep `n >= 2` gates or render single-observation State/Municipal points with explicit thin-sample notes.

## Guardrails
- No fabrication and no silent imputation.
- Fill blanks only, with provenance, if a later phase is approved.
- Do not lower gates or connect null gaps merely to make the chart look fuller.
- Keep native Excel and PNG/app renderers in sync for any future chart change.
- If changing `/api/`, re-read `.github/AI_INSTRUCTIONS.md` and mount/route rules first.
- If changing DB views, apply additive schema/view changes before dependent JS changes and record exact live verification.
