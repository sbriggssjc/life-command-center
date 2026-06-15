# Claude Code — minor fix: flow_failure auto-resolve strands the earliest alert in a cluster

## Why (grounded live 2026-06-13)
`lcc_autoresolve_recovered_flow_failures()` (the hourly `lcc-autoresolve-flow-failures`
cron) clears flow_failure alerts via a single-failure TTL ("≤1 failure in the 18h
window AND none in the last 6h ⇒ resolve") + a full-recovery path. It works 37/38
times. But when transient failures **cluster**, the EARLIEST alert gets stranded:

Live example — three transient SF-Object-Sync failures on 2026-06-13:
- alert 561 @ 03:17 → **stranded open ~20h** (manually resolved during the audit)
- alert 562 @ 04:00 → auto-resolved 10:35 (TTL)
- alert 563 @ 12:27 → auto-resolved 18:35 (TTL)

Root cause: the "single non-recurring failure" check disqualifies an alert that had a
**neighbor failure** in its window. When 561 came due (~09:17), 562 (04:00) was a
neighbor → 561 not "single" → skipped. Once 562/563 later auto-resolved, nothing
re-evaluated 561, so it sat open indefinitely. A stuck "error" alert trains the
operator to ignore the panel — the exact thing the TTL was meant to prevent.

## The fix (small)
In the resolver's "single non-recurring" predicate, count only **still-OPEN
(unresolved)** neighbor failures, not all-time failures — OR, equivalently, re-
evaluate any flow_failure alert whose neighbors have since resolved. So once a
transient cluster fully clears, the earliest alert resolves too. Either:
- change the neighbor-count to `WHERE resolved_at IS NULL` (don't let an already-
  resolved sibling block the TTL), or
- add a sweep: an open flow_failure with no NEW failure (same flow) in the last 6h
  resolves regardless of historical neighbors.

Keep the genuine-recurrence guard intact: a flow that is ACTIVELY failing (a new
failure in the last 6h) must still stay alerted. The change only stops *resolved*
siblings from stranding the earliest alert.

## Tests / house rules
Same signature (cron binding unchanged). Test: three failures clustered within 9h,
all transient → after the 6h-quiet window, ALL THREE resolve (not just the later
two). A flow with an ongoing failure in the last 6h stays open.

## Note
Minor — 1 stranded alert in 38, already manually cleared live. Bundle it whenever you
next touch `lcc_autoresolve_recovered_flow_failures` / the health-alert layer; not
worth a standalone deploy.
