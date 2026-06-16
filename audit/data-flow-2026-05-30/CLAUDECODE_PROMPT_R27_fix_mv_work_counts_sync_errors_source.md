# Claude Code — R27: fix `mv_work_counts.sync_errors` at the source (durable de-stale)

## Why (from the R25 Unit 3 reconciliation, 2026-06-15)
R25 fixed the two Today widgets by repointing them at the live bounded source
(`/api/sync?action=health` → `summary.error`, 0 fallback). But the underlying field
`mv_work_counts.sync_errors` still carries an **all-time row total mislabeled as
"current"** (it's what produced the stale 2,638 on the deployed build). The displays are
correct now, but ANY future consumer that reads `canonicalCounts.sync_errors` /
`mv_work_counts.sync_errors` (e.g. the ops-chat context packet, a new widget, an alert)
will silently inherit the stale all-time number. This round fixes it at the source so the
field means what its name says, for every present and future consumer.

## Grounded facts
- `mv_work_counts` is a materialized view on LCC Opps refreshed every 5 min by pg_cron
  (`refresh_work_counts`).
- Its `sync_errors` column is an all-time total (matched no bounded window in live
  grounding: sf_sync_log errors 24h=0 / all-time=117; ingest_write_failures 24h≈482).
- The intended meaning (per the cron-health 24h convention used everywhere else) is a
  **bounded recent count** of real connector/sync errors — i.e. the same thing
  `/api/sync?action=health` `summary.error` returns (0 today).

## The fix
Change the `sync_errors` expression in the `mv_work_counts` definition to a **bounded
recent window** consistent with the rest of the app, NOT an all-time total. Decide the
exact source to match `/api/sync?action=health summary.error` so the MV and the live API
agree:
- If `summary.error` counts recent connector errors (e.g. sf_sync_log `status='error'`
  in the last 24h, and/or `ingest_write_failures` in the last 24h), make
  `mv_work_counts.sync_errors` the SAME bounded expression.
- Keep the column name `sync_errors` (so existing readers keep working) — only the
  expression changes from all-time → bounded-recent.
- Migration on LCC Opps: `CREATE OR REPLACE` / drop-recreate the MV as required (preserve
  the unique index the `REFRESH ... CONCURRENTLY` cron needs — re-add it if a
  drop-recreate is necessary). Re-`ANALYZE` at the end. Confirm `refresh_work_counts`
  still succeeds (the gov `mv_gov_overview_stats` CONCURRENTLY-needs-a-unique-index lesson
  applies — don't break the concurrent refresh).

## Guards / house rules
- **Auth blast radius**: `mv_work_counts` is on LCC Opps (the auth DB). The change is a
  read-side MV expression only — no writes to auth schema, no long locks beyond the
  normal MV refresh. Verify the refresh still completes.
- Additive/safe: after the change, the MV's `sync_errors` should read ~0 today (matching
  the live widgets), and the value should track the bounded window going forward.
- ≤12 `api/*.js` (likely a pure DB migration — no JS needed; if any handler computes the
  field, align it to the same bounded source). `node --check` clean if JS touched; suite
  green.
- Verify live: `SELECT sync_errors FROM mv_work_counts;` ≈ the `/api/sync?action=health`
  `summary.error` value (0 today), NOT 2,638; `refresh_work_counts` runs clean; the Today
  widgets and any `canonicalCounts.sync_errors` consumer now agree at the source.

## Bottom line
LOW-priority durability: the displays are already correct, but this removes the stale
all-time total at its origin so no future consumer re-inherits it.
