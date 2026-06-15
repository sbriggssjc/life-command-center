# Claude Code — durable DB-growth prevention (close the whack-a-mole)

## Why (grounded live 2026-06-15)
DB-size bloat has caused two near-auth-lockout incidents (May: `sf_sync_log` 5.5 GB;
June: `staged_intake_artifacts` 9.85 GB). Audit verdict: the two SPECIFIC tables are
now durably fixed at the SOURCE (payloads externalized — sf_sync_log no longer
stores `payload` on ok rows; artifacts now write to SharePoint/Storage, confirmed
152/153 recent rows carry zero PG bytes). Retention prunes bound every big table
(sf_sync_log 30d, context_packets 7d, artifacts 50d, field_provenance 90d).
Autovacuum hardening was applied live 2026-06-15 to field_provenance / perf_metrics
/ signals / staged_intake_artifacts (joining the already-hardened sf_sync_log +
context_packets) so prune-freed space is reclaimed-for-reuse and file growth from
churn is capped.

TWO durable-prevention items remain — this prompt covers both.

## Unit 1 — commit the live autovacuum hardening as a repo migration (parity)
Applied live 2026-06-15 but not yet in the repo. Add a migration that re-applies
(idempotent `ALTER TABLE ... SET (...)`) so a rebuild/replay keeps the tuning:
```
field_provenance        : autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05, autovacuum_vacuum_threshold=10000
perf_metrics            : 0.05 / 0.05 / threshold 5000
signals                 : 0.05 / 0.05 / threshold 5000
staged_intake_artifacts : 0.05 / 0.05 / threshold 500
```
(context_packets + sf_sync_log already carry their hardening from prior migrations.)

## Unit 2 — alert when a critical MAINTENANCE cron is disabled (the real root cause)
The June incident's true cause: the artifact-offload cron was deliberately DISABLED
after a connection-exhaustion incident and silently stayed off while the backlog
grew — nothing flagged it. The hourly `lcc-cron-health-check` watches for run
FAILURES, not for jobs that are switched OFF (`cron.job.active=false`). So a disabled
maintenance job is a blind spot.

Add a disabled-critical-cron check (extend `lcc-cron-health-check` or a small new
function + the existing `lcc_health_alerts` path):
- Maintain a small allowlist of CRITICAL maintenance crons whose absence causes
  silent bloat/disk risk — at minimum: `lcc-artifact-offload-edge`,
  `sf-sync-log-prune`, `field-provenance-prune`, `lcc-context-packet-prune`,
  `lcc-staged-intake-artifacts-prune`, `lcc-disk-health-check`,
  `lcc-pg-net-response-cleanup`.
- Each tick: for any allowlisted job that is missing OR `active=false`, open a
  `maintenance_cron_disabled` alert in `lcc_health_alerts` (severity warn; one open
  per jobname, idempotent). Auto-resolve when the job is active again. This makes
  "a disabled prune/offload" loud instead of silent — exactly what would have
  caught the June bloat weeks earlier.
- Keep it conservative: allowlist only the maintenance/retention jobs, not every
  cron (a deliberately-disabled feature cron shouldn't alert).

## Verdict to record (for the audit log / CLAUDE.md)
- The two incident tables are durably source-fixed; they won't re-bloat.
- All big tables have retention prunes + (now) autovacuum hardening → growth is
  bounded, not whack-a-mole.
- The remaining systemic exposure was "a disabled maintenance cron goes unnoticed"
  → Unit 2 closes it.
- VACUUM FULL stays a rare manual tool (only needed after a bloat event); with
  source prevention it shouldn't be needed again. Note in the runbook: VACUUM FULL
  scratch space ≈ LIVE data size, not total table size — so a bloated-but-mostly-
  dead table (like the June artifacts) can be reclaimed even at low headroom.

## House rules
≤12 `api/*.js` (no api change needed — DB-only). `node --check` n/a. Idempotent
migrations. Apply Unit 1 anytime (additive); Unit 2 is additive (function + alert
rows). Both DB-only, no Railway dependency.
```
