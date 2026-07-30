-- ============================================================================
-- W3.4 — gov queue depth-alert + SLA framework  (audit 3.4: "every queue gets a
-- depth alert + SLA row in the health framework"). Government DB. Additive /
-- reversible / idempotent.
-- ----------------------------------------------------------------------------
-- One SLA ROW per orphan-queue drain we stood up in W3.4, plus a check function
-- folded into the existing hourly gov-cron-health-check tick that opens/auto-
-- resolves alerts against the shared public.lcc_health_alerts table (same shape
-- as lcc_check_cron_health). Covers the three gov queues:
--   • gov_comp_review_queue            (Decision-Center comp-review drain)
--   • property_metadata_backfill_queue (Research metadata-backfill worklist)
--   • ownership_research_queue         (gated + triaged in the sibling migration)
--
-- "SLA row" = one row per queue in v_gov_queue_sla_status (depth, oldest-open
-- age, threshold, sla_days, depth_breach, sla_breach). "Depth alert" = the check
-- function opens a warn when depth_breach; a separate queue_sla_breach warn when
-- an item sits open past sla_days; a queue_regrowth warn if the GATED ownership-
-- research producer starts refilling (>200 new rows / 24h) — the guard for the
-- W3.4 kill-switch.
--
-- REVERSAL: DROP FUNCTION gov_check_queue_slas(); DROP VIEW v_gov_queue_sla_status;
--   restore gov-cron-health-check to 'SELECT public.lcc_check_cron_health();'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The SLA-status view — one row per queue.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_gov_queue_sla_status AS
WITH q(queue_name, drain_surface, depth, oldest_open_at, depth_threshold, sla_days) AS (
  SELECT 'gov_comp_review_queue', 'Decision Center → Comp reconciliation reviews',
         (SELECT count(*)         FROM public.gov_comp_review_queue WHERE status = 'open'),
         (SELECT min(first_flagged_at) FROM public.gov_comp_review_queue WHERE status = 'open'),
         250, 45
  UNION ALL
  SELECT 'property_metadata_backfill_queue', 'Research → Property metadata backfill',
         (SELECT count(*)     FROM public.property_metadata_backfill_queue WHERE status = 'open'),
         (SELECT min(enqueued_at) FROM public.property_metadata_backfill_queue WHERE status = 'open'),
         6000, 60
  UNION ALL
  SELECT 'ownership_research_queue', 'Gated producer (ENABLE_OWNERSHIP_RESEARCH_QUEUE) + triage archive',
         (SELECT count(*)      FROM public.ownership_research_queue WHERE task_status = 'queued'),
         (SELECT min(created_at) FROM public.ownership_research_queue WHERE task_status = 'queued'),
         2000, 60
)
SELECT queue_name, drain_surface, depth, oldest_open_at,
       CASE WHEN oldest_open_at IS NULL THEN 0
            ELSE floor(extract(epoch FROM now() - oldest_open_at) / 86400)::int END AS oldest_open_age_days,
       depth_threshold, sla_days,
       (depth > depth_threshold) AS depth_breach,
       (oldest_open_at IS NOT NULL AND now() - oldest_open_at > make_interval(days => sla_days)) AS sla_breach
  FROM q;

COMMENT ON VIEW public.v_gov_queue_sla_status IS
  'W3.4: one SLA row per gov orphan queue — depth, oldest-open age, depth/SLA thresholds and breach flags. Read by gov_check_queue_slas() and surfaceable in LCC.';

GRANT SELECT ON public.v_gov_queue_sla_status TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. The check function — folded into the hourly health tick.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gov_check_queue_slas()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r          record;
  v_new      int := 0;
  v_resolved int := 0;
  v_rc       int;
  v_regrowth int;
BEGIN
  FOR r IN SELECT * FROM public.v_gov_queue_sla_status LOOP
    -- depth alert -----------------------------------------------------------
    IF r.depth_breach THEN
      INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
      SELECT 'queue_depth', r.queue_name, 'warn',
             'Queue '||r.queue_name||' depth '||r.depth||' exceeds threshold '||r.depth_threshold||
             ' — its drain ('||r.drain_surface||') is not keeping up.',
             jsonb_build_object('depth', r.depth, 'threshold', r.depth_threshold, 'drain', r.drain_surface)
      WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
                         WHERE a.alert_kind='queue_depth' AND a.source=r.queue_name AND a.resolved_at IS NULL);
      GET DIAGNOSTICS v_rc = ROW_COUNT; v_new := v_new + v_rc;
    ELSE
      UPDATE public.lcc_health_alerts
         SET resolved_at=now(), resolved_note='Auto-resolved: depth '||r.depth||' within threshold '||r.depth_threshold
       WHERE alert_kind='queue_depth' AND source=r.queue_name AND resolved_at IS NULL;
      GET DIAGNOSTICS v_rc = ROW_COUNT; v_resolved := v_resolved + v_rc;
    END IF;

    -- SLA-breach alert ------------------------------------------------------
    IF r.sla_breach THEN
      INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
      SELECT 'queue_sla_breach', r.queue_name, 'warn',
             'Queue '||r.queue_name||' has an item open '||r.oldest_open_age_days||'d — past its '||r.sla_days||
             'd SLA. Work the oldest items in '||r.drain_surface||'.',
             jsonb_build_object('oldest_open_age_days', r.oldest_open_age_days, 'sla_days', r.sla_days, 'depth', r.depth)
      WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
                         WHERE a.alert_kind='queue_sla_breach' AND a.source=r.queue_name AND a.resolved_at IS NULL);
      GET DIAGNOSTICS v_rc = ROW_COUNT; v_new := v_new + v_rc;
    ELSE
      UPDATE public.lcc_health_alerts
         SET resolved_at=now(), resolved_note='Auto-resolved: oldest open item within SLA'
       WHERE alert_kind='queue_sla_breach' AND source=r.queue_name AND resolved_at IS NULL;
      GET DIAGNOSTICS v_rc = ROW_COUNT; v_resolved := v_resolved + v_rc;
    END IF;
  END LOOP;

  -- regrowth guard for the GATED ownership_research_queue producer ----------
  SELECT count(*) INTO v_regrowth
    FROM public.ownership_research_queue WHERE created_at > now() - interval '24 hours';
  IF v_regrowth > 200 THEN
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'queue_regrowth', 'ownership_research_queue', 'warn',
           'ownership_research_queue gained '||v_regrowth||' rows in 24h — the W3.4 producer kill-switch '||
           '(ENABLE_OWNERSHIP_RESEARCH_QUEUE) may have been re-enabled or a new unguarded writer added.',
           jsonb_build_object('new_rows_24h', v_regrowth)
    WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
                       WHERE a.alert_kind='queue_regrowth' AND a.source='ownership_research_queue' AND a.resolved_at IS NULL);
    GET DIAGNOSTICS v_rc = ROW_COUNT; v_new := v_new + v_rc;
  ELSE
    UPDATE public.lcc_health_alerts
       SET resolved_at=now(), resolved_note='Auto-resolved: <200 new rows in 24h (producer gated)'
     WHERE alert_kind='queue_regrowth' AND source='ownership_research_queue' AND resolved_at IS NULL;
    GET DIAGNOSTICS v_rc = ROW_COUNT; v_resolved := v_resolved + v_rc;
  END IF;

  RETURN jsonb_build_object('new_alerts', v_new, 'resolved', v_resolved,
                            'regrowth_24h', v_regrowth,
                            'queues', (SELECT count(*) FROM public.v_gov_queue_sla_status));
END;
$$;

REVOKE ALL ON FUNCTION public.gov_check_queue_slas() FROM public;
GRANT EXECUTE ON FUNCTION public.gov_check_queue_slas() TO service_role;

COMMENT ON FUNCTION public.gov_check_queue_slas() IS
  'W3.4: opens/auto-resolves queue_depth + queue_sla_breach alerts per gov orphan queue (from v_gov_queue_sla_status) and a queue_regrowth guard on the gated ownership_research_queue producer. Folded into gov-cron-health-check.';

-- ----------------------------------------------------------------------------
-- 3. Fold into the hourly gov-cron-health-check tick (no new watcher cron).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    BEGIN PERFORM cron.unschedule('gov-cron-health-check'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('gov-cron-health-check', '15 * * * *',
      'SELECT public.lcc_check_cron_health(); SELECT public.gov_check_queue_slas();');
  END IF;
END $$;
