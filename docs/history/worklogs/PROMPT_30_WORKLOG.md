# Prompt 30 Worklog - Data-integrity audit

## Objective
Audit the existing Dialysis_DB and Government DB comp/property data machinery before any canonical-record build:
sources, ingestion paths, field coverage, precedence, reconciliation, dedup/linkage, and a phased plan.

## Guardrails
- Audit only: no schema migrations, no backfills, no deduplication, no data mutation.
- Prefer evidence from code, SQL migrations, read-only catalog queries, and read-only aggregate coverage queries.
- Where behavior is unclear, state uncertainty and cite the closest table/function/view.

## Progress
- Read `AGENTS.md`, `CLAUDE.md`, and `docs/architecture/comps-data-integrity-and-canonical-record.md`.
- Confirmed current architecture references: Railway runtime, domain DB topology, `field_source_priority`,
  field provenance, `v_sales_comps`, cap recompute/backfill functions, and Health surface hooks.
- Inventoried relevant migrations/docs for `v_sales_comps`, data-health snapshots, cap recompute/backfill,
  Salesforce comp promotion, provenance/priority, and queue health.
- Ran read-only PostgREST coverage/count queries against Dia, Gov, and LCC Opps using local Supabase env values.
- Created the deliverable: `docs/architecture/data-integrity-audit-2026-08.md`.

## Findings
- Dia `v_sales_comps` has 3,022 rows; cap present 2,182, rent 1,994, current ask 2,078, original ask 1,392,
  list date/DOM 2,543.
- Gov `v_sales_comps` has 4,806 rows; sold cap present 2,780, agency 4,636, buyer 3,780, seller 3,647.
- Dia duplicate-property live-sold count matches the design doc: 610 properties, 1,577 rows, 967 excess rows
  beyond one-per-property. All groups are repeat-sale-by-date groups under current logic; 370 are multi-source.
- LCC Opps provenance/priority state: 2,055 `field_source_priority` rules; 1,636,796 `field_provenance` rows;
  33 unranked provenance triples; 1,155 provenance conflicts; zero invalid priority columns.
- Main audit conclusion: build an additive canonical property/sale/listing/lease layer that reuses
  `field_source_priority`, `lcc_merge_field`, resolver aliases, `v_sales_comps`, recompute functions, and Health
  surface hooks. Do not destructively clean source tables.

## Verification
- No schema/data changes made.
- Verification was read-only: Supabase REST `GET` counts/samples and local code/doc inspection.
