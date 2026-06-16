# Claude Code — R34: cadence dashboard value-rank + small hygiene (right-sized after grounding)

## Why (grounded live 2026-06-16)
Investigating the "first sends" adoption gap, I checked the cadence set against the live DB.
The table is HEALTHY — this is NOT a big cleanup. 437 active cadences:
- **0 entities with duplicate active cadences** (the "Karinna Cassidy appeared twice" in the
  dashboard was a VIEW fanout, not real dup rows).
- **1 stale row** > 180d overdue (a 1,314-day onboarding cadence) — not systemic.
- 0 `owner_role='broker'` cadences; **37** have a brokerage-domain contact email. Brokers
  are legit CRE relationships — do NOT purge them; just don't let them crowd the top of a
  value-ranked list.

The actual problems are small + presentational. Scope accordingly — don't over-engineer.

## Unit 1 — fix the `v_bd_cadence_dashboard` row fanout
The view returns >1 row for a single active cadence (verified: 0 entities have >1 active
cadence, yet the dashboard rendered a contact twice). Find the 1:many join (likely to
`bd_opportunities`, `activity_events`, or a portfolio/value table) and collapse it to
**exactly one row per active cadence** (de-dup via the right join key / a DISTINCT-ON
cadence_id, or aggregate the many-side). Verify `count(*) == count(distinct cadence_id)`
post-fix.

## Unit 2 — value-rank the dashboard (the real lever) + show value on the card
`v_bd_cadence_dashboard` currently has no value column, so the operator can't see/sort by
relationship value — which is why low-value broker contacts surfaced at the top of the
"ready to send" view.
- Add a **`rank_value`** column = the entity's portfolio/connected value, reusing the SAME
  source the priority queue uses (`v_priority_queue_enriched.rank_annual_rent` for the
  entity, or `lcc_entity_connected_value.connected_property_value`, COALESCEd). Append at
  the end of the view (R7 rule).
- The cadence-dashboard API/UI (`operations.js ?action=cadence_dashboard` + `ops.js
  renderCadenceDashboard`) should **order by `rank_value DESC NULLS LAST`, then
  days_overdue DESC**, and display the value + property count on each row. High-value owner
  relationships lead; broker/small contacts fall below (no exclusion — just honest ranking).

## Unit 3 — retire the one stale cadence + a light staleness guard
- Retire/reset the single >180d-overdue onboarding cadence (the 1,314-day row) — set it to
  a terminal/`paused` state (reversible; not a hard delete), or reset `next_touch_due` if
  it's a real live target. Inspect before acting; it's clearly abandoned.
- Add a light guard so an onboarding/steady-state cadence can't silently sit >N days
  overdue (e.g. surface cadences >90d overdue with no touch as a "review/expire" flag on the
  dashboard, or auto-pause). Small + conservative — the goal is to prevent a future
  1,314-day row, not to mass-expire.

## Boundaries / house rules
- This is hygiene + presentation, NOT a re-architecture. Do NOT purge broker cadences, do
  NOT change the cadence engine, do NOT touch the reachability gate (R10/R20). Additive view
  column + ORDER BY + one stale-row fix. ≤12 `api/*.js`; `node --check`; suite green;
  cache-or-live-safe migration.
- Verify live: dashboard returns 1 row per cadence; top rows are the highest-value owner
  relationships (not brokers); the 1,314-day row is gone from the active set.

## The honest bigger picture (NOT in this prompt — for Scott)
R34 makes the dashboard *show* the right order, but the deeper adoption truth stands: the
highest-value targets (P-BUYER parents like Boyd Watterson Global $163M, big owners) are
**not email-reachable in the cadence set** — they run through the P-BUYER buy-side
contact-pick path. So the real "first sends" lever is (a) working P-BUYER buy-side in-app
and (b) the R16 SF contact-acquisition for high-value owners — not the cadence table, which
is already healthy. R34 is the presentation fix; the adoption move is behavioral.
