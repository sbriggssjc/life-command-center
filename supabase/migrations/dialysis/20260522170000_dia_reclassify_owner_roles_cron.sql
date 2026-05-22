-- ============================================================================
-- 20260522170000_dia_reclassify_owner_roles_cron.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1.8 (scheduled reclassification, dia)
--
-- Creates a nightly pg_cron job that re-runs the v5 classification against
-- current data. As ingestion populates new ownership_history, sales,
-- leases, the classification view auto-incorporates that data on read;
-- this cron applies the resulting classification to true_owners so
-- broker-facing queries see fresh data without manual re-runs.
--
-- Schedule: 02:30 UTC daily (after typical ingest windows).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dia_reclassify_owner_roles()
RETURNS TABLE (rows_updated INTEGER, rows_reset INTEGER)
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_updated INTEGER := 0;
  v_reset   INTEGER := 0;
BEGIN
  -- 1) Reset duplicate rows so the canonical's classification is authoritative
  WITH r AS (
    UPDATE public.true_owners
    SET owner_role            = NULL,
        owner_role_source     = NULL,
        owner_role_confidence = NULL,
        owner_role_updated_at = NOW(),
        developer_flag_sources = '[]'::jsonb
    WHERE merged_into_true_owner_id IS NOT NULL
      AND (owner_role IS NOT NULL OR developer_flag_sources <> '[]'::jsonb)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_reset FROM r;

  -- 2) Apply classification to canonical rows (skip overrides + manual)
  WITH u AS (
    UPDATE public.true_owners t
    SET owner_role            = c.owner_role,
        owner_role_source     = c.owner_role_source,
        owner_role_confidence = c.owner_role_confidence,
        owner_role_updated_at = NOW(),
        developer_flag_sources = c.evidence_jsonb
    FROM public.v_dia_owner_role_classification c
    WHERE t.true_owner_id = c.true_owner_id
      AND t.merged_into_true_owner_id IS NULL
      AND t.behavioral_override IS NULL
      AND COALESCE(t.owner_role_source, '') NOT IN ('manual', 'behavioral_override')
      AND (t.owner_role            IS DISTINCT FROM c.owner_role
           OR t.owner_role_confidence IS DISTINCT FROM c.owner_role_confidence
           OR (c.evidence_jsonb IS NOT NULL AND c.evidence_jsonb <> '[]'::jsonb
               AND t.developer_flag_sources IS DISTINCT FROM c.evidence_jsonb))
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM u;

  RETURN QUERY SELECT v_updated, v_reset;
END;
$$;

COMMENT ON FUNCTION public.dia_reclassify_owner_roles IS
  'DEVELOPER_BD_AUDIT_v3 §11.8 Topic 1.8. Nightly re-classifier — refreshes '
  'true_owners.owner_role from v_dia_owner_role_classification. Honors '
  'behavioral_override and manual classification. Returns (rows_updated, '
  'rows_reset).';

-- Schedule the cron job (idempotent: unschedule first if exists)
SELECT cron.unschedule('dia-reclassify-owner-roles-nightly')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'dia-reclassify-owner-roles-nightly'
);

SELECT cron.schedule(
  'dia-reclassify-owner-roles-nightly',
  '30 2 * * *',  -- 02:30 UTC daily
  $$SELECT public.dia_reclassify_owner_roles();$$
);
