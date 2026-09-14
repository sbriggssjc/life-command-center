-- ============================================================================
-- MB2e — a feed that returns HTTP 200 with real <item>s and contributes ZERO
-- to the brief (item_count > 0, items_after_cutoff = 0) is a DIFFERENT fault
-- from a dead feed (item_count = 0), and `lcc_check_market_brief_feed_health`
-- could not see it -- it only ever alerts on `item_count`.
--
-- MB2b built `items_after_cutoff` for exactly this shape (Federal Register
-- ESRD) and gave it a per-feed maxAgeHours override, but nothing READ the
-- column to open an alert. Measured live 2026-09-14: two MORE feeds were in
-- this state on the same day -- Federal Register (GSA) and Tax Foundation,
-- both publishing a few times a week, both hit with the 72h news-cutoff
-- default on a Monday check (newest item 82h / 92h old). Fixed at the
-- source (maxAgeHours widened to 168h on both, same migration's companion
-- JS change) -- this is the MONITOR half, so the *next* instance of the
-- class is caught without a human re-reading the health table by hand.
--
-- Same class, same fix twice already applies (FEED2's calendar-days-not-
-- checks fix, and the sequencing this migration follows): count CONSECUTIVE
-- CHECKS, never calendar days; a feed with no `items_after_cutoff` history
-- (every row NULL, pre-MB2b) must not alert -- "we don't know" is not
-- "zero contributed" (P180); auto-resolve the moment a check contributes.
--
-- The alert kind is DELIBERATELY DISTINCT from `market_brief_feed_stale` --
-- one names "the feed answers but is starved by too tight a window" (widen
-- maxAgeHours), the other names "the feed is dead or the URL/parser broke"
-- (replace the feed). Folding them into one alert would read as the same
-- fault with two different fixes, which is worse than two alerts.
--
-- REVERSAL RUNBOOK:
--   DROP FUNCTION IF EXISTS public.lcc_check_market_brief_feed_no_contribution(integer);
--   DROP VIEW IF EXISTS public.v_market_brief_feed_health_no_contribution;
-- Neither is read by any other object; no data is touched.
-- ============================================================================

CREATE VIEW public.v_market_brief_feed_health_no_contribution AS
WITH latest AS (
  SELECT DISTINCT ON (stream, source)
    stream, source, feed_url, checked_date, ok, item_count, items_after_cutoff, error
  FROM public.market_brief_feed_health
  ORDER BY stream, source, checked_date DESC
),
last_contribution AS (
  SELECT stream, source, MAX(checked_date) AS last_contributed_date
  FROM public.market_brief_feed_health
  WHERE items_after_cutoff > 0
  GROUP BY stream, source
)
SELECT
  l.stream,
  l.source,
  l.feed_url,
  l.checked_date        AS last_checked_date,
  l.ok                  AS last_ok,
  l.item_count          AS last_item_count,
  l.items_after_cutoff  AS last_items_after_cutoff,
  l.error               AS last_error,
  c.last_contributed_date,
  -- Consecutive CHECKS (never calendar days -- FEED2) that parsed at least
  -- one item (item_count > 0, ruling out a plain dead feed, which
  -- market_brief_feed_stale already owns) but contributed nothing
  -- (items_after_cutoff = 0, NEVER NULL -- a NULL row is "unmeasured", not
  -- "zero", and must not count toward the streak either way -- P180) since
  -- the last check that DID contribute.
  (
    SELECT count(*)
    FROM public.market_brief_feed_health h
    WHERE h.stream = l.stream
      AND h.source = l.source
      AND h.item_count > 0
      AND h.items_after_cutoff = 0
      AND (c.last_contributed_date IS NULL OR h.checked_date > c.last_contributed_date)
  )::integer AS no_contribution_streak_checks
FROM latest l
LEFT JOIN last_contribution c USING (stream, source);

COMMENT ON VIEW public.v_market_brief_feed_health_no_contribution IS
  'MB2e: latest health row per (stream, source) plus no_contribution_streak_checks -- consecutive CHECKS (never calendar days) that parsed items (item_count > 0) but added none to the brief (items_after_cutoff = 0). Rows with items_after_cutoff IS NULL (pre-MB2b, or a writer not yet updated) never count toward the streak in either direction -- unmeasured is not zero (P180). Distinct from market_brief_feed_stale, which owns item_count = 0 (a dead feed); this view owns "answers, but the cutoff window starves it" (a mis-sized maxAgeHours).';

CREATE OR REPLACE FUNCTION public.lcc_check_market_brief_feed_no_contribution(p_stale_checks integer DEFAULT 3)
RETURNS TABLE(alerts_opened integer, alerts_resolved integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opened integer := 0;
  v_resolved integer := 0;
  v_row record;
  v_key text;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_market_brief_feed_health_no_contribution
    WHERE no_contribution_streak_checks >= p_stale_checks
  LOOP
    v_key := format('market_brief_feed_no_contribution:%s:%s', v_row.stream, v_row.source);
    IF NOT EXISTS (
      SELECT 1 FROM public.lcc_health_alerts
      WHERE alert_kind = 'market_brief_feed_no_contribution'
        AND source = v_key
        AND resolved_at IS NULL
    ) THEN
      INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
      VALUES (
        'market_brief_feed_no_contribution', v_key, 'warn',
        format('RSS feed "%s" (%s) parsed items but contributed 0 to the brief on %s consecutive checks (last item_count: %s, last checked: %s, last contributed: %s) -- likely a mis-sized maxAgeHours cutoff for this feed''s cadence, not a dead feed',
               v_row.source, v_row.stream, v_row.no_contribution_streak_checks, v_row.last_item_count,
               v_row.last_checked_date, COALESCE(v_row.last_contributed_date::text, 'never')),
        jsonb_build_object(
          'stream', v_row.stream, 'source', v_row.source,
          'feed_url', v_row.feed_url,
          'no_contribution_streak_checks', v_row.no_contribution_streak_checks,
          'last_item_count', v_row.last_item_count,
          'last_items_after_cutoff', v_row.last_items_after_cutoff,
          'last_contributed_date', v_row.last_contributed_date,
          'last_error', v_row.last_error
        )
      );
      v_opened := v_opened + 1;
    END IF;
  END LOOP;

  WITH still_contributing AS (
    SELECT format('market_brief_feed_no_contribution:%s:%s', s.stream, s.source) AS dedupe_key
    FROM public.v_market_brief_feed_health_no_contribution s
    WHERE s.no_contribution_streak_checks < p_stale_checks
  )
  UPDATE public.lcc_health_alerts a
  SET resolved_at = now(), resolved_note = 'mb2e-auto-resolve: feed contributed items again'
  FROM still_contributing h
  WHERE a.alert_kind = 'market_brief_feed_no_contribution'
    AND a.resolved_at IS NULL
    AND a.source = h.dedupe_key;
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN QUERY SELECT v_opened, v_resolved;
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_check_market_brief_feed_no_contribution(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_check_market_brief_feed_no_contribution(integer) TO service_role;

DO $assert$
BEGIN
  IF has_function_privilege('anon', 'public.lcc_check_market_brief_feed_no_contribution(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_check_market_brief_feed_no_contribution must not be anon-executable';
  END IF;
END
$assert$;

-- ----------------------------------------------------------------------------
-- Ride the SAME cron as lcc_check_market_brief_feed_health -- one health
-- check per day is enough for a day-granularity check, and this is the same
-- surface, not a new schedule to reason about.
-- ----------------------------------------------------------------------------

DO $cronblock$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-market-brief-feed-health') THEN
    PERFORM cron.unschedule('lcc-market-brief-feed-health');
  END IF;

  PERFORM cron.schedule(
    'lcc-market-brief-feed-health',
    '15 11 * * *',
    $$SELECT public.lcc_check_market_brief_feed_health(3); SELECT public.lcc_check_market_brief_feed_no_contribution(3);$$
  );
END
$cronblock$;
