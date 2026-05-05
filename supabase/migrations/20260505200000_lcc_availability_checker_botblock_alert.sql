-- ============================================================================
-- Round 76ej.h — bot-block self-alerting for availability-checker (LCC Opps)
--
-- The availability-checker Edge Function (Round 76ej.g) already classifies
-- 4xx/5xx and Cloudflare interstitial responses as 'unreachable' and lets
-- consecutive_check_failures climb until the third strike turns a listing
-- off-market. The risk we surface here is the OTHER failure mode: a sudden
-- bot-block storm that flips the unreachable share from a quiet baseline
-- (~5% of scanned) to a majority for a single run, mass-promoting healthy
-- listings to off-market on the third strike.
--
-- This migration adds:
--   1. lcc_record_availability_botblock(domain, scanned, unreachable,
--      share, threshold=0.30) — RPC the Edge Function calls once per
--      domain at the end of each run. If the unreachable share is at or
--      above the threshold, opens an `availability_checker_botblock`
--      alert in lcc_health_alerts (no-ops if one is already open). If
--      the share has recovered below the threshold, auto-resolves the
--      open alert.
--
--   2. lcc_health_alerts gains an alert_kind='availability_checker_botblock'
--      flavor. Schema doesn't change — the kind column is text.
--
-- Why a server-side RPC instead of inserting from the Edge Function: the
-- INSERT-only-if-not-exists pattern needs an atomic check, and RPC keeps
-- both halves of the recovery flow (open + auto-resolve) in one place.
-- The Edge Function just calls it; the existing lcc-cron-health-check
-- (every hour at :15) already surfaces unresolved rows in the daily
-- briefing.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_record_availability_botblock(
  p_domain            text,
  p_scanned           integer,
  p_unreachable       integer,
  p_unreachable_share numeric,
  p_threshold         numeric DEFAULT 0.30
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_source  text := 'availability_checker:' || p_domain;
  v_action  text;
  v_id      bigint;
BEGIN
  IF p_scanned IS NULL OR p_scanned < 5 THEN
    -- Tiny batches are too noisy to alert on. Single-listing tests would
    -- trip a 100% bot-block alert every time the test URL 404s. Five is
    -- the minimum signal we trust, matches the daily briefing's
    -- "interesting cohort" cutoff for other rollups.
    RETURN jsonb_build_object('action', 'skipped_low_sample', 'scanned', p_scanned);
  END IF;

  IF p_unreachable_share IS NOT NULL AND p_unreachable_share >= p_threshold THEN
    IF EXISTS (
      SELECT 1 FROM public.lcc_health_alerts
       WHERE alert_kind = 'availability_checker_botblock'
         AND source     = v_source
         AND resolved_at IS NULL
    ) THEN
      v_action := 'duplicate_open';
    ELSE
      INSERT INTO public.lcc_health_alerts (
        alert_kind, source, severity, summary, details
      ) VALUES (
        'availability_checker_botblock',
        v_source,
        'warn',
        format(
          'availability-checker (%s): %s/%s listings unreachable (%s%% >= %s%% threshold)',
          p_domain, p_unreachable, p_scanned,
          round(p_unreachable_share * 100, 1),
          round(p_threshold * 100, 1)
        ),
        jsonb_build_object(
          'domain', p_domain,
          'scanned', p_scanned,
          'unreachable', p_unreachable,
          'unreachable_share', p_unreachable_share,
          'threshold', p_threshold,
          'observed_at', now()
        )
      ) RETURNING alert_id INTO v_id;
      v_action := 'inserted';
    END IF;
  ELSE
    -- Share is below threshold (or null because nothing was scanned). If a
    -- prior alert is open for this domain, mark it resolved with a note
    -- explaining what triggered the auto-recovery.
    UPDATE public.lcc_health_alerts
       SET resolved_at  = now(),
           resolved_note = format(
             'auto-resolved: subsequent run share %s%% < %s%% threshold (%s/%s)',
             round(COALESCE(p_unreachable_share, 0) * 100, 1),
             round(p_threshold * 100, 1),
             p_unreachable, p_scanned)
     WHERE alert_kind  = 'availability_checker_botblock'
       AND source      = v_source
       AND resolved_at IS NULL;
    v_action := 'resolved_or_noop';
  END IF;

  RETURN jsonb_build_object('action', v_action, 'alert_id', v_id);
END $$;

COMMENT ON FUNCTION public.lcc_record_availability_botblock(text, integer, integer, numeric, numeric) IS
  'Round 76ej.h — called by the availability-checker Edge Function once
   per domain at the end of each run. Records or auto-resolves a
   bot-block alert in lcc_health_alerts based on the run''s unreachable
   share against a threshold (default 0.30). Skips low-sample runs
   (scanned < 5) so tiny test batches don''t produce phantom alerts.';

GRANT EXECUTE ON FUNCTION public.lcc_record_availability_botblock(text, integer, integer, numeric, numeric)
  TO authenticated, service_role, anon;

-- ============================================================================
-- pg_cron: lcc-availability-promotion-sweep
--
-- Runs every 6h at :45 — 15 min after lcc-availability-checker (Round
-- 76ej.g) and 45 min after lcc-auto-scrape-listings (Round 76cx Phase
-- 4b). Sequence on each tick:
--   :00  lcc-auto-scrape-listings        (sales-driven 'sold' detection,
--                                         active listings only)
--   :30  lcc-availability-checker        (URL-probe; writes 'off_market'
--                                         + 'unverified_assumed_off' for
--                                         pages that LOOK sold)
--   :45  lcc-availability-promotion-sweep (re-checks the unverified set
--                                         against sales_transactions and
--                                         upgrades to 'sold' on a deed
--                                         match — closes the loop)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-availability-promotion-sweep');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'lcc-availability-promotion-sweep',
      '45 */6 * * *',
      $cmd$SELECT public.lcc_cron_post(
        '/api/admin?_route=availability-promotion-sweep&domain=both&limit=50&max_age_days=90',
        '{}'::jsonb)$cmd$
    );
  END IF;
END $$;
