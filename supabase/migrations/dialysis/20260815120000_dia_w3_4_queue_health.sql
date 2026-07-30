-- ============================================================================
-- W3.4 — dia queue depth-alert + SLA framework  (audit 3.4). Dialysis_DB.
-- Additive / reversible / idempotent. Mirror of the gov queue-health migration,
-- for the two dia orphan queues:
--   • dia_comp_review_queue            (Decision-Center comp-review drain)
--   • property_metadata_backfill_queue (Research metadata-backfill worklist)
-- (dia has no ownership_research_queue — that queue is gov-only.)
--
-- "SLA row" = one row per queue in v_dia_queue_sla_status. The check function is
-- folded into the hourly dia-cron-health-check tick and opens/auto-resolves
-- queue_depth + queue_sla_breach warns against the shared lcc_health_alerts table.
--
-- REVERSAL: DROP FUNCTION dia_check_queue_slas(); DROP VIEW v_dia_queue_sla_status;
--   restore dia-cron-health-check to 'SELECT public.lcc_check_cron_health();'.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_dia_queue_sla_status AS
WITH q(queue_name, drain_surface, depth, oldest_open_at, depth_threshold, sla_days) AS (
  SELECT 'dia_comp_review_queue', 'Decision Center → Comp reconciliation reviews',
         (SELECT count(*)         FROM public.dia_comp_review_queue WHERE status = 'open'),
         (SELECT min(first_flagged_at) FROM public.dia_comp_review_queue WHERE status = 'open'),
         250, 45
  UNION ALL
  SELECT 'property_metadata_backfill_queue', 'Research → Property metadata backfill',
         (SELECT count(*)     FROM public.property_metadata_backfill_queue WHERE status = 'open'),
         (SELECT min(enqueued_at) FROM public.property_metadata_backfill_queue WHERE status = 'open'),
         6000, 60
)
SELECT queue_name, drain_surface, depth, oldest_open_at,
       CASE WHEN oldest_open_at IS NULL THEN 0
            ELSE floor(extract(epoch FROM now() - oldest_open_at) / 86400)::int END AS oldest_open_age_days,
       depth_threshold, sla_days,
       (depth > depth_threshold) AS depth_breach,
       (oldest_open_at IS NOT NULL AND now() - oldest_open_at > make_interval(days => sla_days)) AS sla_breach
  FROM q;

COMMENT ON VIEW public.v_dia_queue_sla_status IS
  'W3.4: one SLA row per dia orphan queue — depth, oldest-open age, depth/SLA thresholds and breach flags.';

GRANT SELECT ON public.v_dia_queue_sla_status TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dia_check_queue_slas()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_new int := 0; v_resolved int := 0; v_rc int;
BEGIN
  FOR r IN SELECT * FROM public.v_dia_queue_sla_status LOOP
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

  RETURN jsonb_build_object('new_alerts', v_new, 'resolved', v_resolved,
                            'queues', (SELECT count(*) FROM public.v_dia_queue_sla_status));
END; $$;

REVOKE ALL ON FUNCTION public.dia_check_queue_slas() FROM public;
GRANT EXECUTE ON FUNCTION public.dia_check_queue_slas() TO service_role;
COMMENT ON FUNCTION public.dia_check_queue_slas() IS
  'W3.4: opens/auto-resolves queue_depth + queue_sla_breach alerts per dia orphan queue (from v_dia_queue_sla_status). Folded into dia-cron-health-check.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    BEGIN PERFORM cron.unschedule('dia-cron-health-check'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('dia-cron-health-check', '15 * * * *',
      'SELECT public.lcc_check_cron_health(); SELECT public.dia_check_queue_slas();');
  END IF;
END $$;
