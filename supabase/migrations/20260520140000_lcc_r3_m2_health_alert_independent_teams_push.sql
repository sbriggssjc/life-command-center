-- ============================================================================
-- LCC Opps — Round 3 finding R3-M-2 (2026-05-20):
-- Independent Teams push for unresolved health alerts (decoupled from briefing)
--
-- Background:
-- The lcc_health_alerts plane works, but its only delivery channel was the
-- daily briefing. The daily-briefing TEAMS card runs Mon-Fri; the only
-- weekend channel was the briefing EMAIL — which is itself a flow that can
-- fail (and did, R3-M-1, on Sat/Sun May 16-17). A failure with no working
-- channel is invisible. This is a circular dependency: the briefing can't
-- report that the briefing is broken.
--
-- Fix: a standalone pg_cron that reads open error-severity alerts straight
-- from the DB and POSTs them to a Teams Incoming Webhook 7 days/week, with
-- the smallest possible dependency surface (DB + pg_net + Teams). It does
-- NOT call any LCC /api endpoint, so it keeps working even if the whole
-- Vercel/Railway app is down.
--
-- Gated on a Vault secret `lcc_health_alert_webhook`. Until that secret is
-- populated the function returns {status: dormant} and posts nothing — so
-- this migration is safe to apply before the webhook exists.
--
-- Dedup / anti-spam: each alert is pushed once on first detection, then
-- re-nagged at most once per 24h while it stays unresolved.
-- ============================================================================

BEGIN;

-- 1. Dedup column ------------------------------------------------------------
ALTER TABLE public.lcc_health_alerts
  ADD COLUMN IF NOT EXISTS independent_notified_at timestamptz;

COMMENT ON COLUMN public.lcc_health_alerts.independent_notified_at IS
  'R3-M-2: last time this alert was pushed to the independent Teams channel '
  '(lcc_notify_health_alerts_teams). NULL = never pushed. Used to dedup so the '
  'every-30-min cron posts once on detection + re-nags at most daily.';

-- 2. Triage view -------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_health_alerts_open AS
  SELECT alert_id,
         detected_at,
         alert_kind,
         source,
         severity,
         summary,
         details,
         independent_notified_at,
         round(extract(epoch FROM (now() - detected_at)) / 3600.0, 1) AS age_hours
  FROM public.lcc_health_alerts
  WHERE resolved_at IS NULL
  ORDER BY (severity = 'error') DESC, detected_at;

COMMENT ON VIEW public.v_lcc_health_alerts_open IS
  'R3-M-2: unresolved health alerts, error-severity first, with age in hours. '
  'Triage feed for the independent Teams push and any future UI surface.';

-- 3. The push function -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_notify_health_alerts_teams()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault, net, pg_temp
AS $fn$
DECLARE
  v_webhook    text;
  v_count      integer;
  v_alerts     jsonb;
  v_text       text;
  v_request_id bigint;
BEGIN
  -- Dormant until the webhook secret is configured.
  SELECT decrypted_secret INTO v_webhook
    FROM vault.decrypted_secrets
   WHERE name = 'lcc_health_alert_webhook'
   LIMIT 1;
  IF v_webhook IS NULL OR v_webhook = '' THEN
    RETURN jsonb_build_object('status', 'dormant',
                              'reason', 'lcc_health_alert_webhook not set in vault');
  END IF;

  -- Open error-severity alerts that are due for a push:
  -- never pushed, or last pushed > 24h ago (daily re-nag while unresolved).
  WITH due AS (
    SELECT alert_id, alert_kind, source, summary, detected_at
      FROM public.lcc_health_alerts
     WHERE resolved_at IS NULL
       AND severity = 'error'
       AND (independent_notified_at IS NULL
            OR independent_notified_at < now() - interval '24 hours')
     ORDER BY detected_at
     LIMIT 20
  )
  SELECT count(*),
         jsonb_agg(jsonb_build_object(
           'source',  source,
           'kind',    alert_kind,
           'summary', summary,
           'age_h',   round(extract(epoch FROM (now() - detected_at)) / 3600.0, 1)
         ) ORDER BY detected_at)
    INTO v_count, v_alerts
    FROM due;

  IF coalesce(v_count, 0) = 0 THEN
    RETURN jsonb_build_object('status', 'quiet', 'open_error_alerts', 0);
  END IF;

  -- Plain-text bullet list for the card body.
  SELECT string_agg(
           '- [' || (a->>'source') || '] ' || (a->>'summary')
                 || ' (' || (a->>'age_h') || 'h open)',
           E'\n')
    INTO v_text
    FROM jsonb_array_elements(v_alerts) a;

  -- Legacy MessageCard payload — accepted by Teams Incoming Webhook
  -- connectors. If the webhook is a newer Power Automate "Workflows"
  -- webhook expecting an Adaptive Card, swap this body shape (see the
  -- companion note in ROUND_3_FINDINGS_2026-05-19.md).
  SELECT net.http_post(
           url     := v_webhook,
           headers := jsonb_build_object('Content-Type', 'application/json'),
           body    := jsonb_build_object(
             '@type',      'MessageCard',
             '@context',   'http://schema.org/extensions',
             'themeColor', 'D7263D',
             'summary',    'LCC health alerts',
             'title',      'LCC Health Alerts — ' || v_count || ' open (error)',
             'text',       v_text
           ),
           timeout_milliseconds := 30000
         ) INTO v_request_id;

  -- Optimistically mark as notified. (pg_net is async; a delivery failure
  -- will simply re-surface on the next 24h re-nag window. A response-checking
  -- refinement is captured as R3-M-2b.)
  UPDATE public.lcc_health_alerts
     SET independent_notified_at = now()
   WHERE resolved_at IS NULL
     AND severity = 'error'
     AND (independent_notified_at IS NULL
          OR independent_notified_at < now() - interval '24 hours');

  RETURN jsonb_build_object('status', 'posted',
                            'open_error_alerts', v_count,
                            'request_id', v_request_id);
END
$fn$;

COMMENT ON FUNCTION public.lcc_notify_health_alerts_teams() IS
  'R3-M-2 (2026-05-20): pushes open error-severity lcc_health_alerts to a Teams '
  'Incoming Webhook (vault secret lcc_health_alert_webhook), independent of the '
  'briefing render path. Dormant until the secret is set. Posts once per alert '
  'on detection, re-nags at most daily while unresolved. Returns a JSON status.';

REVOKE EXECUTE ON FUNCTION public.lcc_notify_health_alerts_teams() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.lcc_notify_health_alerts_teams() TO service_role;

-- 4. Schedule — every 30 min, 7 days/week ------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-health-alert-teams-push');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    PERFORM cron.schedule(
      'lcc-health-alert-teams-push',
      '*/30 * * * *',
      $cmd$SELECT public.lcc_notify_health_alerts_teams()$cmd$
    );
  END IF;
END $$;

COMMIT;
