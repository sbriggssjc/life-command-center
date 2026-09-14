-- ============================================================================
-- Prompt 194 — make a FOREIGN WRITER on staged_intake_extractions loud.
--
-- WHAT HAPPENED (docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md §3)
-- ---------------------------------------------------------------------------
-- The Chrome extension posted every sidebar OM to a hardcoded fallback host,
-- `https://life-command-center-nine.vercel.app`. Vercel was retired 2026-07-20
-- and every /api/* route moved to Railway (server.js) — but the Vercel
-- deployment kept SERVING a frozen pre-retirement build that still holds the
-- LCC Opps service key. So the posts did not fail. They succeeded, against a
-- months-old copy of the intake pipeline, into this very table.
--
-- Measured: 0 of 350 sidebar rows in 30 days carried the Prompt-61 schema, and
-- 0 carried an organic `_provider` stamp (the 67 stamped ones are all from the
-- 2026-08-08..11 backfill, `final_provider:'none'`, 0 hardened). Email and
-- folder_feed rows written from Railway IN THE SAME HOUR were 100% both.
-- Correlated 25/25 by PostgREST writer IP: Railway 152.55.x / 162.220.232.x
-- vs a rotating pool of ephemeral AWS us-east-1 lambda IPs.
--
-- WHY THIS MIGRATION EXISTS
-- ---------------------------------------------------------------------------
-- The producer fix is client-side (extension/background.js now resolves the
-- Railway host) and only takes effect when the unpacked extension is reloaded.
-- A repair that depends on someone reloading a browser extension is exactly
-- the "one-shot repair of a recurring producer" this codebase keeps paying for
-- (P176) — and it was invisible for six weeks precisely because nothing here
-- could see it.
--
-- So this adds the DETECTOR, not a backfill:
--
--   `_provider` has been stamped UNCONDITIONALLY at the single write site
--   (intake-extractor.js) since Prompt 82. Therefore a channel that writes
--   rows with ZERO `_provider` coverage did not come through this codebase's
--   write site at all. That is a provenance invariant, not a quality metric —
--   it fires for any stale host, any forked build, any second writer, without
--   knowing anything about prompts or field coverage.
--
-- HONEST COUNTS: everything below is a NEW-ROW RATE over a trailing window.
-- Never a cumulative percentage — the post-P93 "stamp coverage is now 100%"
-- reading was a backfill, and the daily rate decayed straight back to zero
-- underneath it (08-10: 64/64; 08-26: 0 of 21).
--
-- Additive, reversible (DROP the two objects + unschedule the cron), idempotent,
-- dry-run-default. Reads only; the sole write is a deduped health alert.
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The instrument: per-channel NEW-ROW provenance coverage, 7-day window.
-- ---------------------------------------------------------------------------
-- `schema_hardened` = the snapshot carries at least one of the seven keys
-- Prompt 61 ADDED to EXTRACTION_SCHEMA_KEYS. Any one of them is enough: the
-- model does not emit every key on every document (agency_full_name lands on
-- 68/261 email rows, financial_projections on 225), so requiring a specific
-- key would measure the document, not the prompt. Measured discrimination over
-- 30 days: email 226/261 (87%), folder_feed 9/9 (100%), sidebar 2/350 (0.6%).
CREATE OR REPLACE VIEW public.v_lcc_intake_extraction_provenance AS
WITH windowed AS (
  SELECT
    COALESCE(NULLIF(si.raw_payload->>'channel', ''), '(unknown)') AS channel,
    (e.extraction_snapshot ? '_provider')                          AS stamped,
    (e.extraction_snapshot ?| ARRAY[
       'agency_full_name','government_type','government_type_evidence',
       'credit_tier','financial_projections','sold_price','sold_cap_rate'
     ])                                                            AS schema_hardened,
    e.extraction_snapshot->'_provider'->>'final_provider'          AS final_provider,
    e.created_at
  FROM public.staged_intake_extractions e
  JOIN public.staged_intake_items       si ON si.intake_id = e.intake_id
  WHERE e.created_at >= now() - interval '7 days'
)
SELECT
  channel,
  count(*)                                                            AS new_rows_7d,
  count(*) FILTER (WHERE stamped)                                     AS stamped_7d,
  round(100.0 * count(*) FILTER (WHERE stamped) / count(*), 1)        AS stamp_pct_7d,
  count(*) FILTER (WHERE schema_hardened)                             AS schema_hardened_7d,
  round(100.0 * count(*) FILTER (WHERE schema_hardened) / count(*), 1) AS schema_hardened_pct_7d,
  count(DISTINCT final_provider) FILTER (WHERE final_provider IS NOT NULL) AS distinct_providers_7d,
  min(created_at)                                                     AS first_row_at,
  max(created_at)                                                     AS last_row_at
FROM windowed
GROUP BY channel;

COMMENT ON VIEW public.v_lcc_intake_extraction_provenance IS
  'Prompt 194. Per-channel NEW-ROW provenance coverage on staged_intake_extractions '
  'over a trailing 7 days. Read stamp_pct_7d, never a cumulative percentage — a '
  'backfill can carry a cumulative number while the writer stays broken. '
  'stamp_pct_7d = 0 with new_rows_7d > 0 means a writer OUTSIDE this codebase.';

GRANT SELECT ON public.v_lcc_intake_extraction_provenance TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The sweep: open / auto-resolve one alert per channel.
-- ---------------------------------------------------------------------------
-- p_min_rows exists so a channel that happens to write one row in a week
-- cannot open an alert on a sample of one. Deduped on (kind, source, open) in
-- the shape lcc_record_availability_botblock established.
CREATE OR REPLACE FUNCTION public.lcc_check_intake_extraction_provenance(
  p_dry_run  boolean DEFAULT true,
  p_min_rows integer DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row      record;
  v_source   text;
  v_opened   int := 0;
  v_resolved int := 0;
  v_dup      int := 0;
  v_hit      int := 0;
  v_report   jsonb := '[]'::jsonb;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_lcc_intake_extraction_provenance ORDER BY new_rows_7d DESC
  LOOP
    v_source := 'intake_channel:' || v_row.channel;

    IF v_row.new_rows_7d >= p_min_rows AND v_row.stamped_7d = 0 THEN
      -- A whole channel wrote nothing stamped. `_provider` is stamped
      -- unconditionally at the single write site, so these rows are not ours.
      IF EXISTS (
        SELECT 1 FROM public.lcc_health_alerts
         WHERE alert_kind = 'intake_extraction_foreign_writer'
           AND source     = v_source
           AND resolved_at IS NULL
      ) THEN
        v_dup := v_dup + 1;
      ELSIF NOT p_dry_run THEN
        INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
        VALUES (
          'intake_extraction_foreign_writer',
          v_source,
          'error',
          format(
            'intake channel "%s": %s new staged_intake_extractions rows in 7d, ZERO carry a _provider stamp '
            '(%s%% carry the Prompt-61 schema). The single write site stamps unconditionally, so these rows '
            'were written by a build outside this codebase — check which HOST the channel is posting to.',
            v_row.channel, v_row.new_rows_7d, v_row.schema_hardened_pct_7d
          ),
          jsonb_build_object(
            'channel',                v_row.channel,
            'new_rows_7d',            v_row.new_rows_7d,
            'stamped_7d',             v_row.stamped_7d,
            'schema_hardened_7d',     v_row.schema_hardened_7d,
            'schema_hardened_pct_7d', v_row.schema_hardened_pct_7d,
            'last_row_at',            v_row.last_row_at,
            'runbook',                'docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md',
            'observed_at',            now()
          )
        );
        v_opened := v_opened + 1;
      END IF;

    ELSIF v_row.stamped_7d > 0 THEN
      -- Premise cleared: the channel is stamping again. Auto-resolve.
      IF NOT p_dry_run THEN
        UPDATE public.lcc_health_alerts
           SET resolved_at   = now(),
               resolved_note = format(
                 'p194-auto-resolve: channel "%s" stamp coverage recovered to %s%% (%s/%s new rows in 7d)',
                 v_row.channel, v_row.stamp_pct_7d, v_row.stamped_7d, v_row.new_rows_7d)
         WHERE alert_kind = 'intake_extraction_foreign_writer'
           AND source     = v_source
           AND resolved_at IS NULL;
        GET DIAGNOSTICS v_hit = ROW_COUNT;
        v_resolved := v_resolved + v_hit;
      END IF;
    END IF;

    v_report := v_report || jsonb_build_object(
      'channel', v_row.channel,
      'new_rows_7d', v_row.new_rows_7d,
      'stamp_pct_7d', v_row.stamp_pct_7d,
      'schema_hardened_pct_7d', v_row.schema_hardened_pct_7d
    );
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run, 'min_rows', p_min_rows,
    'alerts_opened', v_opened, 'alerts_resolved', v_resolved, 'already_open', v_dup,
    'channels', v_report
  );
END;
$fn$;

COMMENT ON FUNCTION public.lcc_check_intake_extraction_provenance(boolean, integer) IS
  'Prompt 194. Opens a deduped lcc_health_alerts(intake_extraction_foreign_writer) for any '
  'intake channel whose trailing-7d NEW rows are 0% _provider-stamped; auto-resolves when '
  'coverage returns. Read alerts_opened/alerts_resolved — already_open is a re-discovery tally.';

-- ---------------------------------------------------------------------------
-- 3. Schedule it. 06:58 UTC — the only free minute after the nightly 06:xx
--    block (06:20/25/30/35/40/45/50/55 are all taken) and before 07:00.
-- ---------------------------------------------------------------------------
DO $blk$
BEGIN
  PERFORM cron.unschedule('lcc-intake-extraction-provenance');
EXCEPTION WHEN OTHERS THEN NULL;
END $blk$;

SELECT cron.schedule(
  'lcc-intake-extraction-provenance',
  '58 6 * * *',
  $cron$SELECT public.lcc_check_intake_extraction_provenance(false, 5);$cron$
);

-- ============================================================================
-- REVERSAL RUNBOOK
--   SELECT cron.unschedule('lcc-intake-extraction-provenance');
--   DROP FUNCTION IF EXISTS public.lcc_check_intake_extraction_provenance(boolean, integer);
--   DROP VIEW     IF EXISTS public.v_lcc_intake_extraction_provenance;
--   UPDATE public.lcc_health_alerts SET resolved_at = now(),
--          resolved_note = 'p194 reverted'
--    WHERE alert_kind = 'intake_extraction_foreign_writer' AND resolved_at IS NULL;
-- ============================================================================
