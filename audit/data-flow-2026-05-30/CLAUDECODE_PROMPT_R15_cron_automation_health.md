# Claude Code prompt — R15: cron / automation health sweep

Audit grounded live 2026-06-08 across all three DBs. **The automation layer is
overwhelmingly healthy** — ~120 crons (LCC Opps ~60, dia 34, gov 26), nearly
all `succeeded` with zero real failures; pg_net responses 201/201 = HTTP 200 in
12h (every Vercel/edge endpoint call lands). The "server restarted" entries are
Supabase infra noise, not code failures. The health-alert pipeline itself works
(`lcc-health-alert-teams-push` healthy; the one "failed" was an infra restart).

But the alert system surfaced three genuine issues — one HIGH severity.

## Unit 1 — HIGH: disk pressure on the auth-hosting DB (artifact-offload cron was MISSING)

`lcc_health_alerts` has an open `disk_pressure`: **LCC Opps = 11.02 GB**, over
the 11 GB warn threshold (crit 12.5 / read-only ~13 — disk-full forces the DB
read-only and locks out ALL sign-in; the documented 2026-05-29 outage).

Root cause grounded: **the `lcc-artifact-offload` cron did not exist.** The only
artifact cron was `lcc-staged-intake-artifacts-prune` (deletes old rows, does
NOT offload). `staged_intake_artifacts` = **9,483 MB (86% of the DB)**, almost
entirely TOAST: **1,407 artifacts still hold 9,133 MB of base64 `inline_data`**,
with `inline_but_offloaded = 0` — the May-29 offload-to-Storage remediation had
never run on any of them. The route `/api/artifact-offload`
(`handleArtifactOffload`) is deployed and works (verified: a live POST offloaded
real 20 MB OM PDFs to the `lcc-om-uploads` bucket, `inline_data` nulled,
`storage_path` set, 0 errors).

**What I already did live (relief in motion):**
- Re-created the cron: `lcc-artifact-offload`, `2-59/10 * * * *`, calling
  `/api/artifact-offload?limit=15`. It's active and draining now.
- Verified the offload path end-to-end on real rows.

**What this prompt needs:**
1. **Find out WHY the cron was missing and make it self-healing.** CLAUDE.md
   references migration `20260529130000_lcc_artifact_offload_cron.sql`. Either
   it was never applied to live, or a DB branch-reset/restore dropped the
   schedule. Confirm the migration exists + is idempotent (unschedule-then-
   schedule), and that it's in the applied set so the cron can't silently
   vanish again. If the migration is missing/incomplete, commit it. (My live
   re-schedule is not captured in a migration — make it durable.)
2. **VACUUM FULL reclamation (MANUAL — Scott, low-traffic window).** Nulling
   `inline_data` is a LOGICAL clear; the 9 GB of TOAST is NOT returned to the OS
   until `VACUUM FULL public.staged_intake_artifacts`. The `disk_pressure`
   alert reads physical `pg_database_size`, so **it will NOT drop below warn
   until the VACUUM FULL runs** — even after the cron fully drains inline_data.
   `VACUUM FULL` can't run in a migration/transaction and takes an ACCESS
   EXCLUSIVE lock on the table, so it must be a manual op in a quiet window,
   AFTER the offload cron has drained the backlog (~the 1,407 at ~2-3 large
   files/tick × 6 ticks/hr ≈ a few days; smaller files go faster). Document the
   exact command + the ordering (drain first, then VACUUM FULL) for Scott.
3. **Headroom check:** 11.02 → 12.5 GB crit is ~1.5 GB; growth is slow, so
   there's time — but the VACUUM FULL shouldn't wait indefinitely. If you want
   faster relief, the offload `limit` can be raised, but the 20 MB PDFs are
   time-budget-bound per tick; consider a one-shot higher-budget drain from a
   workstation if Scott wants the DB shrunk sooner.

## Unit 2 — gov `refresh-gov-overview-stats` fails nightly (stale stats MV)

Gov cron `refresh-gov-overview-stats` (daily 01:00) fails every run:
```
ERROR: cannot refresh materialized view "public.mv_gov_overview_stats"
concurrently
HINT: Create a unique index with no WHERE clause on one or more columns…
```
The cron does `REFRESH MATERIALIZED VIEW CONCURRENTLY` but the MV has no unique
index, so it errors → **`mv_gov_overview_stats` is stale** (frozen at its last
successful refresh). Whatever gov overview/dashboard surface reads it shows
out-of-date numbers.

Fix: add a unique index with no WHERE clause on a column (or column set) that's
unique in the MV (so `CONCURRENTLY` works and the refresh holds no long lock),
OR — if the MV has no natural unique key — switch the cron to a non-concurrent
`REFRESH MATERIALIZED VIEW` (locks readers briefly, but a 1am daily refresh can
afford it). Prefer the unique index. Migration on the gov DB; verify the next
manual refresh succeeds and the MV's contents update.

## Unit 3 — minor: stale flow_failure alert not auto-resolving

`lcc_health_alerts` has an open `flow_failure` (source `HTTP-Switch`,
`failure_id 35`, single `flow_run_id`, detected 11:00, stale >6h). It's ONE
historical failed run of the SF lookup flow (the flow itself is healthy —
succeeding every few minutes). `lcc-autoresolve-flow-failures` (hourly) isn't
clearing it. Either the autoresolve only resolves when a NEWER success
supersedes by a key the single failure doesn't carry, or single ad-hoc
failures need a TTL. Fix: give the autoresolve a path to close a flow_failure
that has had no recurrence within N hours (TTL-resolve), so stale single
failures don't sit open forever and mask a real one. Low priority — but a
chronically-open benign alert trains the operator to ignore the alert panel.

## Verify + ship
- Unit 1: artifact-offload cron durable (migration confirmed applied +
  idempotent); the VACUUM FULL runbook documented for Scott; report the
  post-drain projected size.
- Unit 2: unique index (or non-concurrent) applied on gov; next refresh
  succeeds; MV contents current.
- Unit 3: autoresolve TTL path; the stuck flow_failure clears.
- House rules: `node --check` if any JS; migrations idempotent; crons after
  routes; report per-unit. Note: the offload cron + a couple drain ticks were
  applied LIVE this session (auth-DB disk risk) — same standing posture.
