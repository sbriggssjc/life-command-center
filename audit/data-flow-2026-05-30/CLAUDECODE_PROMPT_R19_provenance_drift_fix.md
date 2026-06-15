# Claude Code — R19: close the field-provenance drift (unranked sources → undefined precedence)

## Why (grounded live 2026-06-15)
The field-provenance engine is healthy — priority is enforced where rules exist
(30d: 581k skips of lower-priority writes, 468k supersedes, 23k same-priority
conflicts surfaced). But `v_field_provenance_unranked` = **42** (should be 0): 42
`(target_table, field_name, source)` combos record provenance with no matching
`field_source_priority` rule, so their source precedence is **undefined** — when two
sources disagree on those fields, the winner is arbitrary. Three classes:

### Class A — WRITER BUG: double-prefixed `gov.gov.leases` (fix the writer)
Eight rows target `gov.gov.leases` (doubled `gov.` prefix) instead of `gov.leases`:
`annual_rent, commencement_date, expense_structure, expiration_date,
renewal_options, rent_psf, tenant_agency, tenant_agency_full` (sources
`rca_sidebar` / `crexi_sidebar` / `crexi_sidebar_description`). A sidebar
provenance writer is constructing `target_table` as `'gov.' || 'gov.leases'` (or
schema+qualified-name doubled) somewhere on the CoStar/RCA/CREXi lease path. Effect:
those lease fields' provenance is mis-keyed → priority rules never match → precedence
undefined, AND lease provenance is fragmented across `gov.leases` (correct) and
`gov.gov.leases` (malformed). Find the writer building the doubled name (grep the
sidebar pipeline for how it derives the gov leases `target_table` / `targetTable`)
and fix it to emit `gov.leases`. Backfill: repoint the existing malformed
`field_provenance` rows `UPDATE ... SET target_database/target_table` from
`gov.gov.leases` → `gov.leases` (or leave them — they age out at the 90d prune;
fixing the writer stops new ones).

### Class B — register the ~20 real data fields (close the registration gap)
These are genuine contested data values written by capture sources with no priority
rule — register `field_source_priority` entries (mirror the existing CoStar/RCA
priorities: sidebar/aggregator quality ~55-70, om_extraction ~50). Fields by table:
- `gov.leases` / (the corrected ones above): `expense_structure, expiration_date,
  tenant_agency, tenant_agency_full, annual_rent, rent_psf, renewal_options,
  commencement_date` (sources rca_sidebar, crexi_sidebar, crexi_sidebar_description)
- `gov.properties`: `agency` (om_extraction), `assessed_value` (rca_sidebar)
- `gov.sales_transactions`: `financing_type, gross_rent_psf` (costar_sidebar)
- `dia.loans`: `originator` (costar_sidebar, rca_sidebar)
- `dia.ownership_history`: `end_date, notes` (costar_sidebar, rca_sidebar)
- `dia.contacts` / `gov.contacts`: `website` (costar_sidebar, rca_sidebar)
Use the existing source-priority ladder so these rank consistently with their
siblings (e.g. costar_sidebar vs rca_sidebar vs om_extraction precedence already
established for other fields on the same tables).

### Class C — bookkeeping fields: stop tracking (de-noise)
`property_id, sale_id, sale_role, data_source` on `dia.contacts`/`gov.contacts` are
FK/link/metadata, not contested data values — they don't need source precedence and
shouldn't be in the provenance ledger. Either exclude them at the writer
(`recordCoStarFieldsProvenance` / the sidebar provenance collector — don't emit
provenance for link/metadata fields) OR register trivial priority rules so the drift
detector stays at 0. Excluding at the source is cleaner (less ledger churn — these
were ~1,200 of the 30d writes).

## Goal / acceptance
`v_field_provenance_unranked` → 0 (or only transient new entries that get registered).
The double-prefix writer no longer emits `gov.gov.leases`. The ~20 data fields rank
consistently with their table-siblings. Bookkeeping fields no longer drift.

## Don't break / house rules
- Migrations additive (`field_source_priority` inserts ON CONFLICT DO NOTHING/UPDATE,
  mirroring the existing extension migrations). The writer fix ships on the Railway
  redeploy. ≤12 `api/*.js`. `node --check` if JS touched.
- Don't change existing priority RANKINGS — only ADD the missing rules + fix the
  malformed table name. (Re-ranking established sources is a separate blessed change.)
- The `v_field_provenance_unranked` view is the acceptance gate — it should return 0
  after this lands.

## Note
This is a provenance-INTEGRITY fix (correct source precedence + a clean audit trail),
not a data-corruption fix — the actual column writes went to the real tables; only
the provenance ledger was mis-keyed/unranked for these fields. Low urgency, high
tidiness: it makes "is the right source winning?" answerable for every field, and
keeps the drift detector meaningful (a non-zero count should mean a NEW gap, not
accumulated debt).
