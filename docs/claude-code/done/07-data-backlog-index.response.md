# Response - 07 Data-backlog index

Status: index reconciled.

## Cowork close list

Close follow-up prompts 0, 1, 2, 3, 4, 5, and 6.

- Prompt 0: reconciliation artifact exists at `docs/architecture/dossier-design-vs-production-23654.md`.
- Prompt 1: landed in `f4518ada` and verified against current code paths using CMS clinic economics instead of bad property-denorm revenue.
- Prompt 2: rent/SF and current escalated rent are implemented; returned response is `docs/claude-code/done/07-followup2-rent-per-sf.response.docx`.
- Prompt 3: transaction/listing timeline is implemented from `sales_transactions` plus `available_listings`; returned response is `docs/claude-code/done/07-followup3-transactions-timeline.response.docx`.
- Prompt 4: lease abstract fields are populated/rendered where sourced; guaranty scope remains `Not on file` because the PDF was silent; returned response is `docs/claude-code/done/07-followup4-lease-abstract.response.docx`.
- Prompt 5: superseded and closed by prompt 04 loan propagation plus the debt/graph fix worklog. DIA loan 913 exists for 23654; brokerages are suppressed as lenders; Radar Woodbridge / Clue Drive candidates are not currently attached.
- Prompt 6: document aggregation wiring is implemented. Live 23654 correctly returns linked intake docs and reports CRE/SF stores as `not_yet_reconciled` because no matching live rows exist.

## Cowork carry-forward list

Keep only two residual items open:

1. Prompt 7 live DB apply: apply `supabase/migrations/dialysis/20260801190000_dia_dossier_relocation_competition.sql` with proper Supabase migration credentials.
2. Prompt 8 Census radius demographics: configure `CENSUS_API_KEY`, backfill `property_demographics` for 23654, then work the broader missing-demographics list in `DIA_DEMOGRAPHICS_COVERAGE_GAPS_2026-08-01.md`.

Prompt 8's map thumbnail, Places tenant callouts, ZIP census fallback, payer mix, and dossier rendering are already implemented.
