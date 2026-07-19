-- Unit 3 (incident 2026-07-19): restore the queue-refresh cadence now that
-- v_priority_queue_live is fast again (view 1.7s / refresh 1.45s, band signatures
-- byte-identical), AND bake in the fail-fast ceiling at the CRON CALL SITE -- the only
-- place statement_timeout can bound the refresh (proven: a function/DO-scoped SET does not
-- re-arm the timer for inner statements). A refresh that ever blows past the ceiling is
-- cancelled, its transaction rolls back (cache left intact -- cache-or-live => safe), the
-- connection is freed, and pg_cron records a failed run surfaced by the existing hourly
-- lcc-cron-health-check.
--
-- Emergency mitigation applied during the incident had backed these off (priority-queue
-- */5 -> */20, review-lane-counts */5 -> */10) to cut the ~20% connection duty cycle a 62s
-- refresh caused. This migration is the committed source of truth for the RESTORED cadence
-- so a replay/rebuild cannot resurrect either the */5-against-a-slow-view state or leave the
-- emergency back-off in place. cron.schedule() upserts by jobname (idempotent, in-place).

-- Priority queue: restore */5, 45s ceiling.
SELECT cron.schedule(
  'lcc-priority-queue-refresh',
  '*/5 * * * *',
  $cmd$SET statement_timeout TO '45s'; SELECT public.lcc_refresh_priority_queue_resolved();$cmd$
);

-- Review-lane counts: restore */5, 60s ceiling.
SELECT cron.schedule(
  'lcc-review-lane-counts-refresh',
  '*/5 * * * *',
  $cmd$SET statement_timeout TO '60s'; SELECT public.lcc_refresh_review_lane_counts();$cmd$
);

-- Buyer-SPE cache (queue-adjacent, same class): cadence unchanged (*/15), add a 60s ceiling.
SELECT cron.schedule(
  'lcc-buyer-spe-refresh',
  '*/15 * * * *',
  $cmd$SET statement_timeout TO '60s'; SELECT public.lcc_refresh_buyer_spe_resolved();$cmd$
);
