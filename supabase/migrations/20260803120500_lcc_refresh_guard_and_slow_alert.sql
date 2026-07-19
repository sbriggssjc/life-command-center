-- Unit 2 (incident 2026-07-19): give the priority-queue refresh a cost-observability
-- guard + an ALARM when it degrades, so a pathological v_priority_queue_live can never
-- again run 60s+ every few minutes and saturate the auth DB's connection pool unnoticed.
--
-- KEY FACT (verified live): statement_timeout is armed only at the START of the top-level
-- statement; setting it inside a function/DO (proconfig OR `SET LOCAL`) does NOT re-arm the
-- timer for inner statements, and a statement_timeout cancel cannot be reliably
-- caught-and-continued in plpgsql. Therefore the HARD fail-fast ceiling lives at the CRON
-- CALL SITE (see 20260803121000_lcc_restore_priority_queue_cron_cadence_with_ceiling.sql):
-- "SET statement_timeout='45s'; SELECT lcc_refresh_priority_queue_resolved();". A refresh
-- that blows past the ceiling is cancelled, its transaction rolls back (cache left intact --
-- cache-or-live => stale is safe), the connection is freed, and the run is recorded as a
-- cron failure surfaced by the existing hourly lcc-cron-health-check (no new watcher --
-- R18 Unit 2 lesson).
--
-- The reliable in-function guard is the EARLY WARNING: it records every completed refresh's
-- duration + row count, and opens a 'slow_refresh' warn alert once a refresh takes >=15s
-- (auto-resolving when healthy). This incident degraded gradually (~9s mean -> 62s); a 15s
-- warn would have fired days before the saturation. Surfaced by v_cron_health_summary +
-- the hourly lcc-cron-health-check + daily briefing. Reversible.

CREATE TABLE IF NOT EXISTS public.lcc_refresh_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  refresh_name  text        NOT NULL,
  refreshed_at  timestamptz NOT NULL DEFAULT now(),
  duration_ms   numeric,
  row_count     integer,
  ok            boolean     NOT NULL DEFAULT true,
  error         text
);
CREATE INDEX IF NOT EXISTS idx_lcc_refresh_log_name_time
  ON public.lcc_refresh_log (refresh_name, refreshed_at DESC);

CREATE OR REPLACE FUNCTION public.lcc_refresh_priority_queue_resolved()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer:=0; v_t0 timestamptz:=clock_timestamp(); v_ms numeric; v_slow_ms constant numeric := 15000;
BEGIN
  DELETE FROM public.lcc_priority_queue_resolved;
  INSERT INTO public.lcc_priority_queue_resolved
    (entity_id, name, workspace_id, vertical, owner_user_id, contact_id, bd_opportunity_id, priority_band, reason, next_touch_due, days_overdue, last_touch_at, last_touch_type, effective_owner_role, owner_role_confidence, source_domain, source_property_id, refreshed_at)
  SELECT entity_id, name, workspace_id, vertical, owner_user_id, contact_id, bd_opportunity_id, priority_band, reason, next_touch_due, days_overdue, last_touch_at, last_touch_type, effective_owner_role, owner_role_confidence, source_domain, source_property_id, now()
  FROM public.v_priority_queue_live;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ANALYZE public.lcc_priority_queue_resolved;
  v_ms := round(extract(epoch FROM clock_timestamp()-v_t0)*1000);
  INSERT INTO public.lcc_refresh_log(refresh_name,duration_ms,row_count,ok,error) VALUES ('lcc_refresh_priority_queue_resolved',v_ms,v_n,true,NULL);
  IF v_ms >= v_slow_ms THEN
    INSERT INTO public.lcc_health_alerts(alert_kind,source,severity,summary,details)
    SELECT 'slow_refresh','lcc_refresh_priority_queue_resolved','warn','Priority-queue refresh took '||v_ms||' ms (threshold '||v_slow_ms||' ms). Investigate v_priority_queue_live before it crosses the 45s cron ceiling and saturates connections.',jsonb_build_object('duration_ms',v_ms,'row_count',v_n,'threshold_ms',v_slow_ms)
    WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a WHERE a.alert_kind='slow_refresh' AND a.source='lcc_refresh_priority_queue_resolved' AND a.resolved_at IS NULL);
  ELSE
    UPDATE public.lcc_health_alerts a SET resolved_at=now(), resolved_note='Auto-resolved: refresh back to '||v_ms||' ms' WHERE a.alert_kind='slow_refresh' AND a.source='lcc_refresh_priority_queue_resolved' AND a.resolved_at IS NULL;
  END IF;
  DELETE FROM public.lcc_refresh_log WHERE refreshed_at < now() - interval '30 days';
  RETURN v_n;
END $function$;

-- A function-scoped statement_timeout does NOT bound inner work (see header). Ensure none
-- lingers on the queue-cache refreshes; the real ceilings are the cron call-site SETs.
ALTER FUNCTION public.lcc_refresh_priority_queue_resolved() RESET statement_timeout;
ALTER FUNCTION public.lcc_refresh_review_lane_counts()      RESET statement_timeout;
ALTER FUNCTION public.lcc_refresh_buyer_spe_resolved()      RESET statement_timeout;
