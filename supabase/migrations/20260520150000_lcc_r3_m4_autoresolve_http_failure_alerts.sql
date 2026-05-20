-- ============================================================================
-- LCC Opps — Round 3 finding R3-M-4 (2026-05-20):
-- Auto-resolve stale http_failure health alerts
--
-- Background (root-cause of the 8 alerts R3-M-2 surfaced):
-- lcc_check_cron_health() (Round 76au/76bv) auto-resolves `cron_failure`
-- alerts when the job later succeeds, but it has NO equivalent for
-- `http_failure` alerts ('pg_net:no_response', 'pg_net:404 [host]', etc.).
-- Those are point-in-time signals ("N calls failed in the last 24h"). pg_net
-- only retains net._http_response for ~6h, so once a failure class stops
-- recurring it can never be re-observed — but the alert stays open forever.
--
-- Result: 8 'pg_net:no_response' alerts accumulated over 22 days, all stale.
-- The underlying issue was fixed by Round 76cw (pg_net timeout 5s->60s);
-- net._http_response now shows 100% 2xx. The alerts just never closed.
--
-- This migration adds a dedicated auto-resolve sweep: for each open
-- http_failure alert, if its specific failure code has NOT recurred in
-- net._http_response within the last 2h, mark it resolved. Since responses
-- retain ~6h, a 2h-clean window reliably means the failure class cleared.
-- If it later recurs, lcc_check_cron_health() opens a fresh alert (correct
-- flapping behaviour — resolve on clear, re-alert on recurrence).
--
-- Implemented as a standalone function + its own hourly cron (at :20, 5 min
-- after lcc-cron-health-check at :15) rather than editing the ~100-line
-- monitor in place — lower transcription risk, and it reads as a clear
-- companion. A future consolidation could fold this into
-- lcc_check_cron_health() next to the cron_failure auto-resolve block.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.lcc_autoresolve_stale_http_alerts()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $fn$
DECLARE
  v_resolved integer;
BEGIN
  WITH resolved AS (
    UPDATE public.lcc_health_alerts a
       SET resolved_at = now(),
           resolved_note = 'Auto-resolved (R3-M-4): failure code not seen in net._http_response in last 2h'
     WHERE a.alert_kind = 'http_failure'
       AND a.resolved_at IS NULL
       AND a.source LIKE 'pg_net:%'
       AND NOT EXISTS (
         SELECT 1
           FROM net._http_response r
          WHERE r.created > now() - interval '2 hours'
            AND (
              -- no_response alerts: match a NULL status_code
              (substring(a.source FROM 'pg_net:([^ ]+)') = 'no_response'
               AND r.status_code IS NULL)
              OR
              -- numeric-code alerts (404/400/500/...): match that status_code
              (substring(a.source FROM 'pg_net:([^ ]+)') ~ '^[0-9]+$'
               AND r.status_code = substring(a.source FROM 'pg_net:([^ ]+)')::int)
            )
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_resolved FROM resolved;

  RETURN v_resolved;
END
$fn$;

COMMENT ON FUNCTION public.lcc_autoresolve_stale_http_alerts() IS
  'R3-M-4 (2026-05-20): resolves open http_failure (pg_net:*) alerts whose '
  'failure code has not recurred in net._http_response in the last 2h. '
  'Companion to lcc_check_cron_health''s cron_failure auto-resolve. Prevents '
  'stale http_failure alerts from accumulating forever (net._http_response '
  'retains only ~6h, so failures can never be re-observed once they stop).';

REVOKE EXECUTE ON FUNCTION public.lcc_autoresolve_stale_http_alerts() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.lcc_autoresolve_stale_http_alerts() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-autoresolve-http-alerts');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    -- :20 each hour — 5 min after lcc-cron-health-check (:15) so any
    -- freshly-opened alert this hour gets a fair chance before the sweep.
    PERFORM cron.schedule(
      'lcc-autoresolve-http-alerts',
      '20 * * * *',
      $cmd$SELECT public.lcc_autoresolve_stale_http_alerts()$cmd$
    );
  END IF;
END $$;

COMMIT;
