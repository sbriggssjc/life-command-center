-- ============================================================================
-- MB2a — replace the dead-on-arrival `dialysis` RSS feeds (all three
-- 403/404, backlog MB2/MB2a) and make a dead feed impossible to ship
-- undetected again.
--
-- Two additive pieces, both reversible:
--   1. `market_brief_feed_health` — one row per (stream, source, day),
--      written by `supabase/functions/briefing-intel-snapshot`'s
--      `fetchSectorNews()` on every run. `lcc_check_market_brief_feed_health`
--      opens a deduped `lcc_health_alerts` row when a feed has returned zero
--      items for `p_stale_days` consecutive checked days, and auto-resolves
--      it the moment the feed answers again — the I11 pattern ("a monitor
--      must alert on its own blindness") applied to a feed URL rather than
--      a domain table.
--   2. `market_brief_facts.source_publisher` / `.source_url_is_redirect` —
--      MB2a's Google News replacement feed emits redirect URLs
--      (news.google.com/rss/articles/...), never the publisher's own page.
--      These columns let a citation say WHO published it even though the
--      link cannot go straight there. Appended at the END of the table per
--      the "CREATE OR REPLACE VIEW is append-only" convention this repo
--      applies to ALTER TABLE too, to keep any positional consumer safe.
--
-- REVERSAL RUNBOOK:
--   drop function if exists public.lcc_check_market_brief_feed_health(int);
--   drop view if exists public.v_market_brief_feed_health_stale;
--   drop table if exists public.market_brief_feed_health;
--   alter table public.market_brief_facts
--     drop column if exists source_publisher,
--     drop column if exists source_url_is_redirect;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.market_brief_feed_health (
  id            bigserial   PRIMARY KEY,
  stream        text        NOT NULL,   -- RSS_FEEDS key, e.g. 'dialysis'
  source        text        NOT NULL,   -- feed label, e.g. 'Federal Register (ESRD)'
  feed_url      text        NOT NULL,
  checked_date  date        NOT NULL,
  ok            boolean     NOT NULL,   -- did the fetch return a non-empty body at all
  item_count    integer     NOT NULL DEFAULT 0,  -- parsed <item>/<entry> count (0 is a real, checkable outcome)
  error         text,                    -- named reason when ok=false or item_count=0
  checked_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_mbfh_stream_source_date UNIQUE (stream, source, checked_date)
);

COMMENT ON TABLE public.market_brief_feed_health IS
  'MB2a: one row per (RSS stream, feed source, day) written by briefing-intel-snapshot''s fetchSectorNews(). item_count=0 for N consecutive days is a named gap via lcc_check_market_brief_feed_health, never silent.';

-- SECURITY DEFINER default privileges are irrelevant here (a plain table,
-- not a function) but the writer is the edge function's service-role key,
-- so no anon/authenticated grant is added.
REVOKE ALL ON public.market_brief_feed_health FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.market_brief_feed_health TO service_role;

CREATE INDEX IF NOT EXISTS idx_mbfh_stream_source_date
  ON public.market_brief_feed_health (stream, source, checked_date DESC);

-- ----------------------------------------------------------------------------
-- v_market_brief_feed_health_stale — per-feed rolling zero-item streak.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_market_brief_feed_health_stale AS
WITH recent AS (
  SELECT
    stream, source, feed_url, checked_date, ok, item_count, error,
    -- Consecutive run of zero-item days ending at the most recent check,
    -- computed as "days since the last day this feed had a real item".
    checked_date - COALESCE(
      MAX(checked_date) FILTER (WHERE item_count > 0)
        OVER (PARTITION BY stream, source ORDER BY checked_date
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),
      checked_date - 9999
    ) AS days_since_last_item_asof_row,
    ROW_NUMBER() OVER (PARTITION BY stream, source ORDER BY checked_date DESC) AS rn
  FROM public.market_brief_feed_health
)
SELECT
  stream, source, feed_url, checked_date AS last_checked_date, ok AS last_ok,
  item_count AS last_item_count, error AS last_error,
  GREATEST(days_since_last_item_asof_row, 0) AS zero_item_streak_days
FROM recent
WHERE rn = 1;

COMMENT ON VIEW public.v_market_brief_feed_health_stale IS
  'MB2a: latest health row per (stream, source) plus zero_item_streak_days — the number lcc_check_market_brief_feed_health alerts on.';

-- ----------------------------------------------------------------------------
-- lcc_check_market_brief_feed_health — I11-style alert-on-your-own-blindness.
-- ----------------------------------------------------------------------------

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
    WHERE zero_item_streak_days >= p_stale_days
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
        format('RSS feed "%s" (%s) has returned 0 items for %s consecutive checked days (last: %s, error: %s)',
               v_row.source, v_row.stream, v_row.zero_item_streak_days, v_row.last_checked_date, COALESCE(v_row.last_error, 'none')),
        jsonb_build_object(
          'stream', v_row.stream, 'source', v_row.source,
          'feed_url', v_row.feed_url, 'zero_item_streak_days', v_row.zero_item_streak_days,
          'last_error', v_row.last_error
        )
      );
      v_opened := v_opened + 1;
    END IF;
  END LOOP;

  -- Auto-resolve: a feed with an OPEN alert that is no longer stale (fresh
  -- item within the window) is a positive statement of health, never an
  -- absence — matches the B6d doctrine ("the resolve arm keys on that
  -- positive statement, never on ABSENCE").
  WITH still_healthy AS (
    SELECT format('market_brief_feed_stale:%s:%s', s.stream, s.source) AS dedupe_key
    FROM public.v_market_brief_feed_health_stale s
    WHERE s.zero_item_streak_days < p_stale_days
  )
  UPDATE public.lcc_health_alerts a
  SET resolved_at = now(), resolved_note = 'mb2a-auto-resolve: feed returned items again'
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

-- ----------------------------------------------------------------------------
-- market_brief_facts — redirect-citation columns (MB2a §1 caveat 1).
-- ----------------------------------------------------------------------------

ALTER TABLE public.market_brief_facts
  ADD COLUMN IF NOT EXISTS source_publisher       text,
  ADD COLUMN IF NOT EXISTS source_url_is_redirect boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.market_brief_facts.source_publisher IS
  'MB2a: the real outlet name when source_url is a redirect (e.g. Google News rss/articles/... links) — parsed from the item title''s " - Publisher" suffix. NULL for a direct-link feed.';
COMMENT ON COLUMN public.market_brief_facts.source_url_is_redirect IS
  'MB2a: true when source_url does not resolve straight to the publisher (currently: Google News). A renderer must not present the link as a direct citation without saying so.';

-- ----------------------------------------------------------------------------
-- Schedule the health check alongside the existing rss tick (06:15 UTC,
-- clear of the 06:xx block already carrying several jobs per CLAUDE.md's
-- notes on picking a free minute).
-- ----------------------------------------------------------------------------

DO $cronblock$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-market-brief-feed-health') THEN
    PERFORM cron.unschedule('lcc-market-brief-feed-health');
  END IF;

  PERFORM cron.schedule(
    'lcc-market-brief-feed-health',
    '15 11 * * *',  -- after the 10:10 RSS tick and the 10:00 snapshot, once a day is enough for a day-granularity check
    $$SELECT public.lcc_check_market_brief_feed_health(3);$$
  );
END
$cronblock$;
