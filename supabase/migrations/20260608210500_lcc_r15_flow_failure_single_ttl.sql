-- ============================================================================
-- R15 Unit 3 — TTL-resolve isolated single flow failures (LCC Opps)
--
-- Background: migration 20260522123000 built lcc_autoresolve_recovered_flow_failures(),
-- which closes a flow_failure health alert once its flow has had NO new failure
-- for p_quiet_hours (default 18h). That correctly keeps a genuinely-broken,
-- daily-failing flow continuously alerted — but it also keeps a ONE-OFF benign
-- failure open for up to 18h.
--
-- Observed 2026-06-08: a single "HTTP-Switch" failure (one flow_run_id, detected
-- 11:00) sat open with the flow otherwise succeeding every few minutes. With the
-- 18h window it would not clear until ~05:00 the next day. A chronically-open
-- benign alert trains the operator to ignore the alert panel and can mask a real
-- one.
--
-- Fix: add a shorter TTL path for ISOLATED single failures, alongside the
-- existing full-recovery path. An alert resolves when EITHER:
--   (1) recovered  — no failure for the flow in the last p_quiet_hours (18h), or
--   (2) single-TTL — the flow has had at most ONE failure in the last
--                    p_quiet_hours window AND no failure in the last
--                    v_single_ttl_hours (6h).
--
-- A recurring failure (≥2 in the 18h window) never qualifies for the short TTL —
-- it only clears via path (1), so daily-failing flows stay continuously alerted.
-- If a resolved flow fails again, lcc_record_flow_failure opens a fresh alert
-- (it dedups only on UNRESOLVED rows), so nothing is permanently silenced.
--
-- Signature is UNCHANGED — (p_quiet_hours int DEFAULT 18) — so the existing cron
-- `lcc-autoresolve-flow-failures` ('35 * * * *', calls the 1-arg form) keeps
-- working with no overload ambiguity. The 6h single-failure TTL is an internal
-- constant (a recurring failure is the thing that must persist; a one-off does
-- not need to be operator-configurable).
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq). CREATE OR REPLACE (same signature)
-- keeps the cron binding intact.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_autoresolve_recovered_flow_failures(p_quiet_hours int DEFAULT 18)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_resolved int;
  v_single_ttl_hours int := 6;  -- isolated single failures clear after this quiet window
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
             ELSE format('Auto-resolved (TTL): single non-recurring failure for flow "%s", quiet %sh', a.source, v_single_ttl_hours)
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
         -- (2) single-failure TTL: at most one failure in the quiet window AND
         --     none within the short TTL window (a one-off, not a recurrence)
         OR (
           (SELECT count(*) FROM public.flow_run_failures f
             WHERE f.flow_name = a.source
               AND f.detected_at > now() - make_interval(hours => p_quiet_hours)) <= 1
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
  -- they don't linger after the operator-facing alert clears.
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
             AND f2.detected_at > now() - make_interval(hours => p_quiet_hours)) <= 1
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
  'Closes flow_failure health alerts + flow_run_failures rows when a flow recovers (no failure in p_quiet_hours, default 18h) OR when an isolated single failure has been quiet for the internal 6h single-failure TTL. Recurring failures (>=2 in the quiet window) only clear via the full-recovery path, so genuinely-broken flows stay alerted. R15 Unit 3 (2026-06-08) added the single-failure TTL on top of migration 20260522123000.';

-- Keep the cron binding (no-op re-schedule, idempotent — same jobname/schedule).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('lcc-autoresolve-flow-failures'); exception when others then null; end;
    perform cron.schedule('lcc-autoresolve-flow-failures', '35 * * * *',
      $cmd$SELECT public.lcc_autoresolve_recovered_flow_failures(18)$cmd$);
  end if;
end $$;
