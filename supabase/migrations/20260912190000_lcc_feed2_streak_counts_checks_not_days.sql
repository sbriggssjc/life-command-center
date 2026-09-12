-- ============================================================================
-- FEED2 — v_market_brief_feed_health_stale counted CALENDAR DAYS, not CHECKS.
--
-- Found 2026-09-12 (Cowork) reconciling FEED1, before the 11:15 UTC cron had
-- ever fired. Symptom, measured on live rows: EVERY feed read
-- `zero_item_streak_days = 9999`, including feeds that had just returned 15
-- items. Proven by simulation over synthetic weekday-only rows: a feed
-- returning 15 items on EVERY check still alerts on its first check (9999)
-- and again EVERY MONDAY (streak 3).
--
-- ROOT CAUSE — two independent bugs in one expression:
--
--   1. CALENDAR-DAY ARITHMETIC. The streak was `checked_date - (last date with
--      items)`. The producer (`lcc-briefing-intel-snapshot`) runs `0 10 * * 1-5`
--      — WEEKDAYS ONLY — while this check runs `15 11 * * *`, DAILY. So Monday
--      minus Friday is 3 calendar days and trips the `p_stale_days = 3`
--      threshold, even though the feed answered perfectly on both checks. The
--      view's own name and comment say "consecutive CHECKED days"; the SQL
--      measured something else. The monitor blamed the feed for days on which
--      NOBODY LOOKED — an I11 inversion: instead of staying silent about its
--      own blindness, it attributed that blindness to what it monitors.
--
--   2. A 9999 SENTINEL STANDING IN FOR "UNKNOWN". With no prior row, the
--      COALESCE fell back to `checked_date - 9999`, so a feed with no history
--      read as maximally stale rather than as not-yet-known. That made the
--      FIRST run of the monitor alert on all 16 feeds.
--
-- Also fixed: a RETIRED feed (removed from RSS_FEEDS — FEED1 removed GSA News,
-- Health Affairs and GlobeSt) keeps its last rows forever. Under the old
-- expression those sat at 9999 and could NEVER auto-resolve, because resolution
-- requires a new row below the threshold and no new rows ever arrive for a feed
-- that is no longer fetched. Counting CHECKS makes a retired feed stop accruing
-- the moment it stops being checked, which is the honest reading.
--
-- The column is renamed `zero_item_streak_days` -> `zero_item_streak_checks`
-- so the name states its unit. `lcc_check_market_brief_feed_health` is updated
-- in the same migration; its threshold argument keeps the same meaning it was
-- always documented to have ("N consecutive checks with zero items").
--
-- REVERSAL RUNBOOK:
--   Re-apply 20260912150000_lcc_mb2a_feed_health_and_redirect_citation.sql,
--   which recreates both objects in their prior form. No data is touched by
--   this migration - it changes only the derivation.
-- ============================================================================

DROP VIEW IF EXISTS public.v_market_brief_feed_health_stale;

CREATE VIEW public.v_market_brief_feed_health_stale AS
WITH latest AS (
  SELECT DISTINCT ON (stream, source)
    stream, source, feed_url, checked_date, ok, item_count, error
  FROM public.market_brief_feed_health
  ORDER BY stream, source, checked_date DESC
),
last_good AS (
  SELECT stream, source, MAX(checked_date) AS last_item_date
  FROM public.market_brief_feed_health
  WHERE item_count > 0
  GROUP BY stream, source
)
SELECT
  l.stream,
  l.source,
  l.feed_url,
  l.checked_date AS last_checked_date,
  l.ok           AS last_ok,
  l.item_count   AS last_item_count,
  l.error        AS last_error,
  g.last_item_date,
  -- Consecutive CHECKS (rows), not calendar days, with zero items since the
  -- last check that returned items. A feed that answered on its most recent
  -- check is 0 by construction, on any schedule, including across weekends.
  (
    SELECT count(*)
    FROM public.market_brief_feed_health h
    WHERE h.stream = l.stream
      AND h.source = l.source
      AND h.item_count = 0
      AND (g.last_item_date IS NULL OR h.checked_date > g.last_item_date)
  )::integer AS zero_item_streak_checks
FROM latest l
LEFT JOIN last_good g USING (stream, source);

COMMENT ON VIEW public.v_market_brief_feed_health_stale IS
  'FEED2: latest health row per (stream, source) plus zero_item_streak_checks — the number of consecutive CHECKS (never calendar days) that returned zero items since the last check that returned items. Counting days made every feed alert on the first run and again every Monday, because the producer runs weekdays and this check runs daily.';

CREATE OR REPLACE FUNCTION public.lcc_check_market_brief_feed_health(p_stale_days integer DEFAULT 3)
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
    SELECT * FROM public.v_market_brief_feed_health_stale
    WHERE zero_item_streak_checks >= p_stale_days
  LOOP
    v_key := format('market_brief_feed_stale:%s:%s', v_row.stream, v_row.source);
    IF NOT EXISTS (
      SELECT 1 FROM public.lcc_health_alerts
      WHERE alert_kind = 'market_brief_feed_stale'
        AND source = v_key
        AND resolved_at IS NULL
    ) THEN
      INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
      VALUES (
        'market_brief_feed_stale', v_key, 'warn',
        format('RSS feed "%s" (%s) has returned 0 items on %s consecutive checks (last checked: %s, last had items: %s, error: %s)',
               v_row.source, v_row.stream, v_row.zero_item_streak_checks, v_row.last_checked_date,
               COALESCE(v_row.last_item_date::text, 'never'), COALESCE(v_row.last_error, 'none')),
        jsonb_build_object(
          'stream', v_row.stream, 'source', v_row.source,
          'feed_url', v_row.feed_url,
          'zero_item_streak_checks', v_row.zero_item_streak_checks,
          'last_item_date', v_row.last_item_date,
          'last_error', v_row.last_error
        )
      );
      v_opened := v_opened + 1;
    END IF;
  END LOOP;

  WITH still_healthy AS (
    SELECT format('market_brief_feed_stale:%s:%s', s.stream, s.source) AS dedupe_key
    FROM public.v_market_brief_feed_health_stale s
    WHERE s.zero_item_streak_checks < p_stale_days
  )
  UPDATE public.lcc_health_alerts a
  SET resolved_at = now(), resolved_note = 'feed2-auto-resolve: feed returned items again'
  FROM still_healthy h
  WHERE a.alert_kind = 'market_brief_feed_stale'
    AND a.resolved_at IS NULL
    AND a.source = h.dedupe_key;
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN QUERY SELECT v_opened, v_resolved;
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_check_market_brief_feed_health(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_check_market_brief_feed_health(integer) TO service_role;

DO $assert$
BEGIN
  IF has_function_privilege('anon', 'public.lcc_check_market_brief_feed_health(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_check_market_brief_feed_health must not be anon-executable';
  END IF;
END
$assert$;
