-- ============================================================================
-- Round 76ec — NPPES live API lookup: audit table + review queue
--
-- Phase 1 of "load NPI registry data" sequence. Approach: query NPPES live
-- API per-clinic for the 621 active rows where medicare_clinics.npi='', score
-- the match, auto-write when high confidence, log all attempts, and surface
-- ambiguous results for a human to triage.
--
-- See edge function supabase/functions/npi-lookup/index.ts for the
-- query+score+write flow that populates this table.
-- ============================================================================

-- ── 0. Audit table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.npi_registry_lookups (
  id                bigserial PRIMARY KEY,
  queried_at        timestamptz NOT NULL DEFAULT now(),
  clinic_id         text        NOT NULL,
  query_org_name    text,
  query_city        text,
  query_state       text,
  query_zip         text,
  result_count      integer     NOT NULL DEFAULT 0,
  best_match_npi    text,
  best_match_score  numeric(4,3),
  best_match_org    text,
  applied           boolean     NOT NULL DEFAULT false,
  apply_decision    text,        -- 'auto_applied' | 'too_ambiguous' | 'no_match' | 'low_confidence' | 'dry_run'
  raw_response      jsonb,
  notes             text
);

CREATE INDEX IF NOT EXISTS npi_registry_lookups_clinic_idx
  ON public.npi_registry_lookups (clinic_id, queried_at DESC);
CREATE INDEX IF NOT EXISTS npi_registry_lookups_decision_idx
  ON public.npi_registry_lookups (apply_decision, queried_at DESC);
CREATE INDEX IF NOT EXISTS npi_registry_lookups_applied_idx
  ON public.npi_registry_lookups (applied) WHERE applied = true;

GRANT SELECT ON public.npi_registry_lookups TO anon;

-- ── 1. Review queue: medium-confidence matches needing a human ────────────
-- Surfaces the latest lookup result per clinic where confidence was in the
-- 0.6-0.85 band: a strong-enough match that a human can usually confirm it
-- in seconds, but not strong enough for auto-write.
CREATE OR REPLACE VIEW public.v_npi_lookup_review_queue AS
WITH latest AS (
  SELECT DISTINCT ON (clinic_id)
    clinic_id, queried_at, result_count, best_match_npi, best_match_score,
    best_match_org, applied, apply_decision, raw_response, notes
  FROM public.npi_registry_lookups
  ORDER BY clinic_id, queried_at DESC
)
SELECT
  l.clinic_id,
  mc.facility_name,
  mc.address,
  mc.city,
  mc.state,
  mc.owner_name AS operator_name,
  mc.latest_estimated_patients,
  l.queried_at AS last_lookup_at,
  l.result_count,
  l.best_match_npi,
  l.best_match_score,
  l.best_match_org,
  l.apply_decision,
  l.notes
FROM latest l
JOIN public.medicare_clinics mc ON mc.medicare_id = l.clinic_id
WHERE l.applied = false
  AND l.apply_decision IN ('too_ambiguous','low_confidence')
  AND l.best_match_score >= 0.6
  AND COALESCE(mc.npi,'') = ''   -- still missing (user didn't fix manually)
  AND mc.is_active = true
ORDER BY l.best_match_score DESC, mc.latest_estimated_patients DESC NULLS LAST;

GRANT SELECT ON public.v_npi_lookup_review_queue TO anon;

-- ── 2. Summary view for dashboard ─────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_npi_lookup_summary AS
WITH latest AS (
  SELECT DISTINCT ON (clinic_id)
    clinic_id, apply_decision, applied, queried_at
  FROM public.npi_registry_lookups
  ORDER BY clinic_id, queried_at DESC
)
SELECT
  COUNT(*) FILTER (WHERE applied)                                          AS auto_applied,
  COUNT(*) FILTER (WHERE NOT applied AND apply_decision='too_ambiguous')   AS needs_review_ambiguous,
  COUNT(*) FILTER (WHERE NOT applied AND apply_decision='low_confidence')  AS needs_review_low_confidence,
  COUNT(*) FILTER (WHERE NOT applied AND apply_decision='no_match')        AS no_match,
  MAX(queried_at)                                                          AS last_run_at
FROM latest;

GRANT SELECT ON public.v_npi_lookup_summary TO anon;
