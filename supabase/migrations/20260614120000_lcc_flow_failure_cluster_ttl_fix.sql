-- ============================================================================
-- 2026-06-14 — flow_failure auto-resolve: stop transient clusters stranding the
--              EARLIEST alert (follow-up to R15 Unit 3 / migration 20260608210500)
--
-- Background: migration 20260608210500 added a 6h "single non-recurring failure"
-- TTL path to lcc_autoresolve_recovered_flow_failures(): an alert resolves when
-- the flow has had AT MOST ONE failure in the 18h window AND none in the last 6h.
-- A recurring failure (>=2 in the 18h window) only clears via full recovery, so
-- genuinely-broken flows stay alerted. That works 37/38 times.
--
-- The miss (grounded live 2026-06-13): when transient failures CLUSTER, the
-- EARLIEST alert is stranded. The "<= 1 failure in the window" count counted
-- ALL failures regardless of resolution state, so an alert whose window happened
-- to contain a neighbor failure was never "single" — even after that neighbor
-- recovered and its forensic row was resolved. Nothing re-evaluated the earliest
-- alert under a relaxed predicate, so it sat open indefinitely.
--   Live example — three transient SF-Object-Sync failures 2026-06-13:
--     561 @ 03:17 → stranded open ~20h (cleared manually during the audit)
--     562 @ 04:00 → auto-resolved 10:35 (TTL)
--     563 @ 12:27 → auto-resolved 18:35 (TTL)
--   When 561 came due, 562 was a neighbor → 561 "not single" → skipped; once
--   562/563 resolved, nothing re-evaluated 561.
--
-- Fix (surgical): the TTL "single failure" count now counts only STILL-OPEN
-- (resolved_at IS NULL) neighbor failures, not all-time failures. An
-- already-resolved sibling no longer blocks the earliest alert's TTL, so once a
-- transient cluster fully clears the earliest alert resolves on the next cron
-- tick. The genuine-recurrence guard is intact and arguably tighter:
--   * a flow with a NEW failure in the last 6h still matches neither path (the
--     `NOT EXISTS (... last 6h ...)` clause is unchanged) and stays alerted; and
--   * a flow carrying >=2 UNRESOLVED failures (failures that have not recovered)
--     still only clears via full recovery — it is genuinely still broken.
-- The forensic flow_run_failures backstop UPDATE gets the same `resolved_at IS
-- NULL` count so the two stay consistent.
--
-- Signature is UNCHANGED — (p_quiet_hours int DEFAULT 18) — so the existing cron
-- `lcc-autoresolve-flow-failures` ('35 * * * *') keeps working. CREATE OR REPLACE
-- (same signature) keeps the binding intact. Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_autoresolve_recovered_flow_failures(p_quiet_hours int DEFAULT 18)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_resolved int;
  v_single_ttl_hours int := 6;  -- isolated/recovered failures clear after this quiet window
BEGIN
  WITH recovered AS (
    UPDATE public.lcc_health_alerts a
       SET resolved_at = now(),
           resolved_note = CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM public.flow_run_failures f
                WHERE f.flow_name = a.source
                  AND f.detected_at > now() - make_interval(hours => p_quiet_hours)
             )
               THEN format('Auto-resolved: no new failure for flow "%s" in %sh (recovered)', a.source, p_quiet_hours)
             ELSE format('Auto-resolved (TTL): flow "%s" has <=1 unresolved failure and has been quiet %sh', a.source, v_single_ttl_hours)
           END
     WHERE a.alert_kind = 'flow_failure'
       AND a.resolved_at IS NULL
       AND (
         -- (1) recovered: no failure at all within the full quiet window
         NOT EXISTS (
           SELECT 1 FROM public.flow_run_failures f
            WHERE f.flow_name = a.source
              AND f.detected_at > now() - make_interval(hours => p_quiet_hours)
         )
         -- (2) single-failure TTL: at most one STILL-OPEN failure in the quiet
         --     window AND none within the short TTL window. Counting only
         --     unresolved neighbors stops a recovered sibling from stranding the
         --     earliest alert in a transient cluster.
         OR (
           (SELECT count(*) FROM public.flow_run_failures f
             WHERE f.flow_name = a.source
               AND f.detected_at > now() - make_interval(hours => p_quiet_hours)
               AND f.resolved_at IS NULL) <= 1
           AND NOT EXISTS (
             SELECT 1 FROM public.flow_run_failures f
              WHERE f.flow_name = a.source
                AND f.detected_at > now() - make_interval(hours => v_single_ttl_hours)
           )
         )
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_resolved FROM recovered;

  -- Close the forensic flow_run_failures rows under the same dual predicate so
  -- they don't linger after the operator-facing alert clears. Same unresolved-only
  -- neighbor count.
  UPDATE public.flow_run_failures f
     SET resolved_at = now(),
         resolved_note = format('Auto-resolved: flow quiet (quiet %sh / single-TTL %sh)', p_quiet_hours, v_single_ttl_hours)
   WHERE f.resolved_at IS NULL
     AND (
       NOT EXISTS (
         SELECT 1 FROM public.flow_run_failures f2
          WHERE f2.flow_name = f.flow_name
            AND f2.detected_at > now() - make_interval(hours => p_quiet_hours)
       )
       OR (
         (SELECT count(*) FROM public.flow_run_failures f2
           WHERE f2.flow_name = f.flow_name
             AND f2.detected_at > now() - make_interval(hours => p_quiet_hours)
             AND f2.resolved_at IS NULL) <= 1
         AND NOT EXISTS (
           SELECT 1 FROM public.flow_run_failures f2
            WHERE f2.flow_name = f.flow_name
              AND f2.detected_at > now() - make_interval(hours => v_single_ttl_hours)
         )
       )
     );

  RETURN v_resolved;
END
$function$;

COMMENT ON FUNCTION public.lcc_autoresolve_recovered_flow_failures(int) IS
  'Closes flow_failure health alerts + flow_run_failures rows when a flow recovers (no failure in p_quiet_hours, default 18h) OR when it has <=1 STILL-OPEN failure in the window AND has been quiet for the internal 6h single-failure TTL. Counting only unresolved neighbors (2026-06-14) stops a transient cluster from stranding the earliest alert; a flow with a failure in the last 6h, or >=2 unresolved failures, still stays alerted. Builds on R15 Unit 3 (20260608210500) on top of 20260522123000.';

-- Keep the cron binding (no-op re-schedule, idempotent — same jobname/schedule).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('lcc-autoresolve-flow-failures'); exception when others then null; end;
    perform cron.schedule('lcc-autoresolve-flow-failures', '35 * * * *',
      $cmd$SELECT public.lcc_autoresolve_recovered_flow_failures(18)$cmd$);
  end if;
end $$;
