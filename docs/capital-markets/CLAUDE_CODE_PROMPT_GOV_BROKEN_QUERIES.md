# Claude Code prompt — fix two broken gov queries (surfaced in the post-deploy log audit)

> Surfaced in the gov postgres logs during the 2026-06-22 incident audit, separate from the 4-issue
> hotfix. Two queries reference columns that don't exist → they error every run. Low-severity (the
> rest of the pipeline is fine) but they spam the error log and silently skip whatever they feed.
> Receipts-first; bounded; reversible.

## Receipts (gov postgres log, recurring ERRORs)
- `column sales_transactions.document_number does not exist`
- `column sf_comps_staging.id does not exist`

(NOTE: a third log line, `"array_agg" is an aggregate function`, was a one-off diagnostic query run
during the audit — NOT a pipeline bug. Ignore it.)

## The ask
For each, find the writer/view/cron/function referencing the missing column and fix it:
1. **`sales_transactions.document_number`** — confirm the live `sales_transactions` schema (the deed
   `document_number` lives on `deed_records`, not `sales_transactions`). Repoint the query to the
   correct column/table, or drop the reference if obsolete.
2. **`sf_comps_staging.id`** — check the live `sf_comps_staging` PK/columns (it may use a different PK
   name, e.g. `comp_id` / `staging_id`, or the column was renamed). Fix the select/join.
- Grep both repos + check live `pg_proc` / `pg_views` / `cron.job` for the references (one or both
  may be live-only objects like the hotfix's score-sync was).

## Gate
Both error lines stop recurring in the gov postgres log; whatever they feed (a sync / comp-staging
step) now completes instead of erroring. No change to working pipelines. Reversible.
