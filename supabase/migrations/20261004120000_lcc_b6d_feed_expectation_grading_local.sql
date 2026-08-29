-- =====================================================================
-- B6d (LCC-local half) — grade the two LCC-OWN feed expectations
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-29.
-- =====================================================================
-- The B6d brief counted 23 feeds (gov 18 + dia 5) and omitted these two, which
-- are evaluated by the same lcc_check_feed_freshness through its `lcc_local`
-- arm. The real registered population is 25.
--
-- Companion migrations: government-lease sql/20260829_gov_b6d_feed_expectation_grading.sql
-- and Dialysis supabase/migrations/20260829_dia_b6d_feed_expectation_grading.sql.
--
-- REVERSAL: prior expectations are in _lcc_b6d_expectation_backup.

BEGIN;

CREATE TABLE IF NOT EXISTS _lcc_b6d_expectation_backup AS
SELECT feed_name, domain, expected_max_age_days, is_active, description, now() AS backed_up_at
  FROM feed_freshness_registry;

ALTER TABLE feed_freshness_registry
  ADD COLUMN IF NOT EXISTS cadence_class      text,
  ADD COLUMN IF NOT EXISTS expectation_basis  text,
  ADD COLUMN IF NOT EXISTS unwatched_reason   text,
  ADD COLUMN IF NOT EXISTS graded_at          timestamptz;

ALTER TABLE feed_freshness_registry
  ALTER COLUMN expected_max_age_days DROP NOT NULL;

COMMENT ON COLUMN feed_freshness_registry.expected_max_age_days IS
  'Staleness bound in days. NULL = DELIBERATELY UNWATCHED (unwatched_reason states why). NULL is not "unset": the row still emits from compute_feed_freshness so the retirement is legible and so an open alert can be auto-resolved against it (see lcc_check_feed_freshness).';

ALTER TABLE feed_freshness_registry DROP CONSTRAINT IF EXISTS chk_ffr_expectation_is_reasoned;
ALTER TABLE feed_freshness_registry
  ADD CONSTRAINT chk_ffr_expectation_is_reasoned CHECK (
    (expected_max_age_days IS NOT NULL AND expectation_basis IS NOT NULL)
    OR
    (expected_max_age_days IS NULL     AND unwatched_reason  IS NOT NULL)
  ) NOT VALID;

ALTER TABLE feed_freshness_registry DROP CONSTRAINT IF EXISTS chk_ffr_operator_driven_unwatched;
ALTER TABLE feed_freshness_registry
  ADD CONSTRAINT chk_ffr_operator_driven_unwatched CHECK (
    cadence_class IS DISTINCT FROM 'operator_driven' OR expected_max_age_days IS NULL
  ) NOT VALID;

ALTER TABLE feed_freshness_registry DROP CONSTRAINT IF EXISTS chk_ffr_cadence_class;
ALTER TABLE feed_freshness_registry
  ADD CONSTRAINT chk_ffr_cadence_class CHECK (
    cadence_class IS NULL OR cadence_class IN
      ('scheduled','continuous_capture','external_publication',
       'derived_external','operator_driven','producer_retired')
  ) NOT VALID;

UPDATE feed_freshness_registry SET
  expected_max_age_days = 7, cadence_class = 'continuous_capture', graded_at = now(),
  expectation_basis = 'B6d 2026-08-29. OM intake (email / sidebar / Copilot Studio) landing in staged_intake_items. Measured: 120 dates, p50 gap 1d, p90 1d, max 3d -- a daily feed. Was 14, which is ~5x the largest silence ever observed; 7 is above 2x the observed max and matches salesforce_sync, whose cadence is identical.'
 WHERE feed_name = 'om_intake';

UPDATE feed_freshness_registry SET
  expected_max_age_days = 7, cadence_class = 'continuous_capture', graded_at = now(),
  expectation_basis = 'B6d 2026-08-29. Salesforce sync log. Measured: 103 dates, p50 gap 1d, p90 1d, max 3d -- a daily feed. 7 is above 2x the observed max. Unchanged.'
 WHERE feed_name = 'salesforce_sync';

ALTER TABLE feed_freshness_registry VALIDATE CONSTRAINT chk_ffr_expectation_is_reasoned;
ALTER TABLE feed_freshness_registry VALIDATE CONSTRAINT chk_ffr_operator_driven_unwatched;
ALTER TABLE feed_freshness_registry VALIDATE CONSTRAINT chk_ffr_cadence_class;

-- An unwatched LCC-local feed EMITS too, with status = 'unwatched'. The
-- lcc_local arm of lcc_check_feed_freshness filters status = 'ok', so such a row
-- is excluded from staleness evaluation there; the check reads the registry
-- directly for the unwatched decision (see the companion migration).
CREATE OR REPLACE FUNCTION public.compute_feed_freshness()
 RETURNS TABLE(feed_name text, domain text, src_table text, ts_column text,
               latest timestamptz, age_days integer, expected_max_age_days integer,
               is_stale boolean, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; v_latest timestamptz;
BEGIN
  FOR r IN SELECT * FROM public.feed_freshness_registry WHERE is_active ORDER BY feed_name LOOP
    feed_name := r.feed_name; domain := r.domain; src_table := r.src_table;
    ts_column := r.ts_column; expected_max_age_days := r.expected_max_age_days;
    latest := NULL; age_days := NULL; is_stale := NULL; status := 'ok';
    BEGIN
      EXECUTE format('SELECT max(%I)::timestamptz FROM %I.%I', r.ts_column, r.src_schema, r.src_table)
        INTO v_latest;
      latest := v_latest;
      IF v_latest IS NULL THEN
        status := 'no_data';
      ELSE
        age_days := (now()::date - v_latest::date);
        IF r.expected_max_age_days IS NULL THEN
          status := 'unwatched';
          is_stale := NULL;
        ELSE
          is_stale := age_days > r.expected_max_age_days;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      status := 'error:' || left(SQLERRM, 80);
    END;
    RETURN NEXT;
  END LOOP;
END;
$function$;

COMMIT;
