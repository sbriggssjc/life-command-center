-- LCC Opps: BD-mirror sync freshness / no-op health check, 2026-06-02
-- ---------------------------------------------------------------------------
-- The BD mirror sync crons (lcc-property-attrs / entity / portfolio /
-- listing-event sync) read the dia/gov Supabase URL+anon_key from the LCC-Opps
-- vault. When those secrets are absent the pg_net sync functions RAISE NOTICE +
-- skip, and the cron records "succeeded / 0 rows" — so the mirror silently
-- freezes while every dashboard looks green. A 2026-06-02 audit found
-- lcc_property_attributes frozen ~10 days exactly this way (secrets missing).
--
-- This adds a check (run daily 05:00, after the 04:35 property-attrs sync) that
-- opens an lcc_health_alerts row — surfaced by v_cron_health_summary + the daily
-- briefing — on either signal, and auto-resolves when healthy:
--   * bd_sync_secret_missing (critical) — any of the 4 domain vault secrets absent (root cause)
--   * bd_sync_stale (warn)             — lcc_property_attributes max(updated_at) older than threshold (symptom)

CREATE OR REPLACE FUNCTION public.lcc_check_bd_sync_freshness(p_stale_days int DEFAULT 2)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_missing text[];
  v_age_days numeric;
  v_secret_alerts int := 0;
  v_stale_alerts int := 0;
BEGIN
  SELECT array_agg(req.name ORDER BY req.name) INTO v_missing
  FROM (VALUES ('dia_supabase_url'),('dia_supabase_anon_key'),
               ('gov_supabase_url'),('gov_supabase_anon_key')) req(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
     WHERE s.name = req.name AND COALESCE(length(s.decrypted_secret),0) > 0);

  IF v_missing IS NOT NULL THEN
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'bd_sync_secret_missing','vault','critical',
      'BD mirror sync is no-opping: missing domain vault secret(s) '||array_to_string(v_missing,', ')||
      '. The pg_net sync crons report success/0 rows while the lcc_property_attributes / entity / portfolio / listing mirrors silently freeze.',
      jsonb_build_object('missing', v_missing)
    WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
      WHERE a.alert_kind='bd_sync_secret_missing' AND a.source='vault' AND a.resolved_at IS NULL);
    GET DIAGNOSTICS v_secret_alerts = ROW_COUNT;
  ELSE
    UPDATE public.lcc_health_alerts a SET resolved_at=now(),
      resolved_note='Auto-resolved: all 4 domain vault secrets present'
    WHERE a.alert_kind='bd_sync_secret_missing' AND a.source='vault' AND a.resolved_at IS NULL;
  END IF;

  SELECT EXTRACT(EPOCH FROM (now() - max(updated_at)))/86400.0 INTO v_age_days
  FROM public.lcc_property_attributes;

  IF v_age_days IS NULL OR v_age_days > p_stale_days THEN
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'bd_sync_stale','lcc_property_attributes','warn',
      'BD mirror lcc_property_attributes is stale ('||round(COALESCE(v_age_days,9999),1)||
      'd since last update; threshold '||p_stale_days||'d) — sync may be no-opping or failing.',
      jsonb_build_object('age_days', round(COALESCE(v_age_days,9999),1), 'stale_days_threshold', p_stale_days)
    WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
      WHERE a.alert_kind='bd_sync_stale' AND a.source='lcc_property_attributes' AND a.resolved_at IS NULL);
    GET DIAGNOSTICS v_stale_alerts = ROW_COUNT;
  ELSE
    UPDATE public.lcc_health_alerts a SET resolved_at=now(),
      resolved_note='Auto-resolved: lcc_property_attributes refreshed '||round(v_age_days,1)||'d ago'
    WHERE a.alert_kind='bd_sync_stale' AND a.source='lcc_property_attributes' AND a.resolved_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'missing_secrets', COALESCE(v_missing, ARRAY[]::text[]),
    'attrs_age_days', round(COALESCE(v_age_days,9999),1),
    'new_secret_alerts', v_secret_alerts,
    'new_stale_alerts', v_stale_alerts);
END;
$function$;

SELECT cron.schedule('lcc-bd-sync-health-check','0 5 * * *',
  $$SELECT public.lcc_check_bd_sync_freshness()$$);
