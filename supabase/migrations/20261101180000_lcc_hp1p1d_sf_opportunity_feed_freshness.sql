-- ============================================================================
-- HP1-P1d — a freshness assertion on the Salesforce opportunity FEED, never
-- on the bd_opportunities TABLE.
-- ----------------------------------------------------------------------------
-- HP1-P1a-fix closed the 36-day outage (every write 502'd on a duplicate key
-- while PA read HTTP 200). Nothing was watching whether it happens again.
-- This is that watch, plus the honest producer-run record.
--
-- INVESTIGATION (2026-09-12, before writing a line of this migration):
--   1. feed_freshness_registry has exactly 2 active rows: om_intake,
--      salesforce_sync. CONFIRMED.
--   2. salesforce_sync watches sf_sync_log (src_table), a DIFFERENT
--      Salesforce pipe (object_intake / crawl_run activity) than opportunity
--      ingest. sf_sync_log logged rows through the whole outage window, so
--      salesforce_sync was correctly green while the opportunity feed was
--      fully broken. Opportunity ingest writes NOTHING to sf_sync_log.
--      CONFIRMED — this row is untouched by this migration.
--   3. bd_opportunities has (at least) two producers: 619 rows against the
--      feed's 608 sf_opp_id-linked rows; the 7 non-SF rows all carry
--      metadata->>'source' IN ('priority_queue', NULL) and last_synced_at IS
--      NULL. CONFIRMED (see HP1-P1a-nullsf — NOT resolved here, deliberately;
--      the predicate below is written so that producer's writes can never
--      satisfy it, which is the point).
--   4. producer_runs exists, is producer-keyed (columns: run_id, producer,
--      lane, started_at, finished_at, duration_ms, status, skip_reason,
--      trigger_source, facts_written, facts_superseded, facts_expired,
--      cost_usd, error_count, detail) and holds 2 rows (EB1's market-brief
--      p_sql/p_rss skip records — built for exec-briefs, unused elsewhere).
--      CONFIRMED. Grep for readers: `git grep -n producer_runs api/ mcp/`
--      shows three WRITERS (operator-triage-tick.js, market-brief-psql-tick.js,
--      market-brief-rss-tick.js) and ONE reader (v_market_brief_staleness,
--      lane-scoped). No reader depends on the full row set or on `lane`
--      being non-NULL, so a lane-less sf_opportunity_sync row is additive
--      and changes nothing that reads this table today.
--
-- HOME FOR THE ASSERTION: extend producer_runs (option a), not a new
-- feed_freshness_registry row (option b) or a table-keyed one. Reasons:
--   * producer_runs is already producer-keyed and already built for exactly
--     this shape (open-before-work / close-on-exit, facts_written /
--     skip_reason), per the EB1 comment header. Building a second producer
--     lifecycle table would be the normaliser-drift class this repo warns
--     about repeatedly.
--   * feed_freshness_registry is TABLE-keyed (src_table, ts_column) with no
--     WHERE-filter column, so it cannot express "only sf_opp_id IS NOT NULL
--     rows count" — a registry row there would go GREEN on the priority_queue
--     producer's writes over a dead Salesforce pipe, the exact B6a/C1 trap
--     this prompt names. The task explicitly says: do not register
--     bd_opportunities table-keyed "for now".
--
-- THE PREDICATE (mandatory, from investigation #3):
--     max(last_synced_at) FILTER (WHERE sf_opp_id IS NOT NULL)
--   NEVER bare max(last_synced_at) (the priority_queue producer would hide an
--   outage the moment it ever sets last_synced_at) and NEVER max(updated_at)
--   (an LCC-side write moves updated_at on every row regardless of source —
--   this is verbatim the mechanism that hid the 36-day outage per HP1-P1a).
--
-- THRESHOLD, MEASURED: the PA flow posts every 30 minutes (HP1-P1a). Sized in
-- HOURS, not days: p_stale_hours default 3 (6x the 30-min cadence) — enough to
-- absorb one missed run without a false alarm, far short of the days-long gaps
-- a real outage produces. Re-derive if the PA schedule ever changes; do not
-- widen it to "days" the way B6d found 10 of 23 domain-feed bounds had been.
--
-- ⚠️ A KNOWN, STATED LIMITATION OF A MAX-BASED PREDICATE OVER A MIXED
-- POPULATION (measured, not theoretical): during the actual 36-day outage,
-- max(last_synced_at) FILTER (WHERE sf_opp_id IS NOT NULL) did NOT stay frozen
-- at one instant — it crept forward sporadically, because a genuinely NEW
-- sf_opp_id still INSERTs cleanly (no ON CONFLICT collision on a row that
-- doesn't exist yet) even while every UPDATE of an EXISTING row was 502ing.
-- Measured distribution of bd_opportunities.created_at for sf_opp_id-linked
-- rows: 2026-07-28 (590, the bulk seed), then isolated singleton/pair inserts
-- on 2026-08-04, 2026-08-20, 2026-09-03, 2026-09-07 (x2), 2026-09-09 — days
-- apart, never within the 3h threshold of each other. So the check would have
-- fired RED for the large majority of the outage and briefly, honestly,
-- GREEN for a few hours around each of those six dates (a genuinely new deal
-- really was synced that hour) before going red again. That flicker is not a
-- defect to paper over — it is the predicate correctly reporting a true fact
-- (SOME sf-linked row really is fresh) while the bulk-update path stayed
-- broken for days at a time either side of it. See positive control #3 below
-- and the response doc for the full six-date table.
--
-- RECONCILE WITH THE HTTP-LAYER DETECTOR (HP1-P1a-fix Unit 3, already
-- shipped): ingestBatch returns non-2xx when total > 0 && succeeded === 0.
-- That catches a RUN THAT FAILS (PA gets a loud 502 the instant it happens).
-- This freshness check catches a RUN THAT NEVER HAPPENS AT ALL (PA stops
-- firing, the Railway route 404s, the LCC_API_KEY rotates and every call
-- 401s silently from PA's perspective, etc.) — none of which produces a
-- failed HTTP response for Unit 3 to see, because there is no response.
-- NEITHER COVERS THE OTHER. Both are needed; this migration adds the second.
--
-- REVERSAL: drop function public.lcc_check_sf_opportunity_freshness(numeric);
--           select cron.unschedule('lcc-sf-opportunity-freshness-check');
--           delete from public.lcc_health_alerts where alert_kind =
--             'sf_opportunity_feed_stale';
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_check_sf_opportunity_freshness(p_stale_hours numeric DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_max_synced timestamptz;
  v_age_hours  numeric;
  v_sf_linked  int;
  v_stale      boolean;
  v_opened     int := 0;
  v_resolved   int := 0;
BEGIN
  SELECT
    max(last_synced_at) FILTER (WHERE sf_opp_id IS NOT NULL),
    count(*) FILTER (WHERE sf_opp_id IS NOT NULL)
  INTO v_max_synced, v_sf_linked
  FROM public.bd_opportunities;

  v_age_hours := CASE WHEN v_max_synced IS NULL THEN NULL
                      ELSE round(EXTRACT(EPOCH FROM (now() - v_max_synced)) / 3600.0, 2)
                 END;
  v_stale := (v_age_hours IS NULL OR v_age_hours > p_stale_hours);

  IF v_stale THEN
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT
      'sf_opportunity_feed_stale', 'bd_opportunities.sf_opp_id', 'warn',
      'Salesforce opportunity feed stale: newest SF-linked sync is '
        || COALESCE(round(v_age_hours, 1)::text || 'h ago', 'never')
        || ' (threshold ' || p_stale_hours || 'h). '
        || 'The PA -> ingest-opportunities path may have stopped, be erroring '
        || 'silently, or LCC_API_KEY may have rotated without the flow updating.',
      jsonb_build_object(
        'max_last_synced_at', v_max_synced,
        'age_hours', v_age_hours,
        'stale_hours_threshold', p_stale_hours,
        'sf_linked_rows', v_sf_linked
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lcc_health_alerts a
      WHERE a.alert_kind = 'sf_opportunity_feed_stale'
        AND a.source = 'bd_opportunities.sf_opp_id'
        AND a.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_opened = ROW_COUNT;
  ELSE
    UPDATE public.lcc_health_alerts a SET
      resolved_at = now(),
      resolved_note = 'Auto-resolved: newest SF-linked sync is ' || round(v_age_hours, 1) || 'h ago'
    WHERE a.alert_kind = 'sf_opportunity_feed_stale'
      AND a.source = 'bd_opportunities.sf_opp_id'
      AND a.resolved_at IS NULL;
    GET DIAGNOSTICS v_resolved = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'stale', v_stale,
    'max_last_synced_at', v_max_synced,
    'age_hours', v_age_hours,
    'stale_hours_threshold', p_stale_hours,
    'sf_linked_rows', v_sf_linked,
    'alerts_opened', v_opened,
    'alerts_resolved', v_resolved
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.lcc_check_sf_opportunity_freshness(numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_check_sf_opportunity_freshness(numeric) TO service_role;

DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.lcc_check_sf_opportunity_freshness(numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_check_sf_opportunity_freshness: service_role EXECUTE grant did not take';
  END IF;
  IF has_function_privilege('anon', 'public.lcc_check_sf_opportunity_freshness(numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_check_sf_opportunity_freshness: anon must NOT be able to execute this';
  END IF;
  IF has_function_privilege('authenticated', 'public.lcc_check_sf_opportunity_freshness(numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_check_sf_opportunity_freshness: authenticated must NOT be able to execute this';
  END IF;
END $$;

COMMENT ON FUNCTION public.lcc_check_sf_opportunity_freshness(numeric) IS
  'HP1-P1d — alerts on max(bd_opportunities.last_synced_at) FILTER (WHERE '
  'sf_opp_id IS NOT NULL) going stale past p_stale_hours (default 3, from the '
  'measured 30-min PA cadence). Deliberately ignores rows with sf_opp_id IS '
  'NULL (a second, non-Salesforce producer, HP1-P1a-nullsf) and never reads '
  'updated_at. Wires into lcc_health_alerts (alert_kind '
  'sf_opportunity_feed_stale) -- the existing v_lcc_health_alerts_open / '
  'Teams-push surface, no new dashboard.';

-- Runs hourly; a pure-SQL check, no Railway hop needed (mirrors
-- lcc-a2-ownership-chain-apply's direct `select public.<fn>()` schedule).
SELECT cron.schedule(
  'lcc-sf-opportunity-freshness-check',
  '20 * * * *',
  $j$SELECT public.lcc_check_sf_opportunity_freshness()$j$
);
