-- ============================================================================
-- W9.5 (Prompt 97, 2026-08-12) — Propagation-integrity: the LCC-Opps side of the
-- cross-DB link-coverage measure + the month-over-month snapshot store.
--
-- The standing measure that "full propagation" stays true. A deterministic,
-- read-only, cross-DB link-coverage audit (NO LLM anywhere). Every link in the
-- campaign chain is measured; drift in ANY of them surfaces in the U4 monthly
-- report as a Connectedness section with a delta. The alarm this unit exists for:
-- a link whose pct DROPS month-over-month = propagation regressing.
--
-- This migration adds ONLY:
--   1. v_lcc_w9_5_link_coverage  — the LCC-Opps-measurable links (mirror
--      consistency + correspondence attribution + canonical-scheme conformance),
--      one row per link (link_name, domain, group_name, total, linked, pct).
--      Counts only, no PII. The tick UNIFIES this with the dia/gov chain-coverage
--      views (v_{dia,gov}_w9_5_chain_coverage) into the full report.
--   2. lcc_w9_5_link_coverage_snapshot — per-period snapshot (delta source),
--      written by the U4 cron POST path (no second cron; read-only tick otherwise).
--
-- NO feature flag (read-only measure — nothing to gate). NO new review lane (the
-- U4 report IS the consumer). Additive + reversible (DROP VIEW / DROP TABLE).
-- ============================================================================

-- ── 1. Snapshot store (month-over-month delta source; mirrors the U4 pattern) ──
CREATE TABLE IF NOT EXISTS public.lcc_w9_5_link_coverage_snapshot (
  snapshot_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period           text NOT NULL UNIQUE,                 -- 'YYYY-MM'
  computed_at      timestamptz NOT NULL DEFAULT now(),
  source_run_id    text,
  links            jsonb NOT NULL DEFAULT '[]'::jsonb,    -- unified per-link rows (delta source)
  totals           jsonb NOT NULL DEFAULT '{}'::jsonb,
  research_task_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lcc_w9_5_link_coverage_snapshot IS
  'W9.5 propagation-integrity: per-period unified link-coverage snapshot. The links jsonb is the month-over-month delta source read by the next period''s tick.';

GRANT SELECT ON public.lcc_w9_5_link_coverage_snapshot TO anon, authenticated, service_role;

-- ── 2. LCC-Opps link-coverage view (mirror consistency + correspondence) ───────
-- Every link here is measurable ENTIRELY within LCC Opps. group_name buckets the
-- rows for the report. domain='lcc' (these are cross-DB/ops links, not a single
-- domain's chain). The banned-spelling set is the external_identities canonical
-- doctrine (chk_external_identities_source_system); a non-zero unconformant count
-- is the dia/gov alias footgun re-appearing.
CREATE OR REPLACE VIEW public.v_lcc_w9_5_link_coverage AS
WITH corr AS (
  SELECT id, entity_id
  FROM public.activity_events
  WHERE source_type ILIKE 'outlook%' OR source_type = 'email_intake'
),
corr_entities AS (
  SELECT DISTINCT entity_id FROM corr WHERE entity_id IS NOT NULL
),
rows AS (
  -- Mirror: a domain-owner identity must resolve to an ops entity (no dangling).
  SELECT 'domain_owner_identity_entity_bound'::text AS link_name, 'mirror'::text AS group_name, 1 AS ord,
         (SELECT count(*) FROM public.external_identities
           WHERE source_type = 'true_owner' AND source_system IN ('dia','gov'))                AS total,
         (SELECT count(*) FROM public.external_identities
           WHERE source_type = 'true_owner' AND source_system IN ('dia','gov')
             AND entity_id IS NOT NULL)                                                        AS linked
  UNION ALL
  -- Mirror: external_identities canonical-scheme conformance (banned spellings = drift).
  SELECT 'external_identity_canonical_conformance', 'mirror', 2,
         (SELECT count(*) FROM public.external_identities),
         (SELECT count(*) FROM public.external_identities
           WHERE source_system NOT IN
             ('dia_db','dia_supabase','dialysis','gov_db','gov_supabase','government'))
  UNION ALL
  -- Mirror: cross_domain_contacts coverage (a row that resolves BOTH a gov and a
  -- dia contact id = a genuinely bridged cross-domain contact).
  SELECT 'cross_domain_contacts_resolved', 'mirror', 3,
         (SELECT count(*) FROM public.cross_domain_contacts),
         (SELECT count(*) FROM public.cross_domain_contacts
           WHERE gov_contact_id IS NOT NULL AND dia_contact_id IS NOT NULL)
  UNION ALL
  -- Correspondence: an attributed correspondence event carries an entity_id.
  SELECT 'correspondence_to_entity', 'correspondence', 4,
         (SELECT count(*) FROM corr),
         (SELECT count(*) FROM corr WHERE entity_id IS NOT NULL)
  UNION ALL
  -- Correspondence: the prompt-96 split — of the entities correspondence attributes
  -- to, how many are OWNER LLCs (map to a true_owner identity) vs parties/deals.
  -- The baseline the correspondence↔owner linkage follow-on unit works from.
  SELECT 'correspondence_entity_owner_llc', 'correspondence', 5,
         (SELECT count(*) FROM corr_entities),
         (SELECT count(*) FROM corr_entities ce
           WHERE EXISTS (SELECT 1 FROM public.external_identities ei
                          WHERE ei.entity_id = ce.entity_id AND ei.source_type = 'true_owner'))
)
SELECT link_name, 'lcc'::text AS domain, group_name, total, linked,
       CASE WHEN total > 0 THEN round((linked::numeric / total::numeric) * 100, 1) ELSE NULL END AS pct
FROM rows
ORDER BY ord;

GRANT SELECT ON public.v_lcc_w9_5_link_coverage TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_lcc_w9_5_link_coverage IS
  'W9.5 propagation-integrity: the LCC-Opps-measurable links (mirror consistency + correspondence attribution + canonical conformance), one row per link (total,linked,pct). Counts only, no PII. Unified with v_{dia,gov}_w9_5_chain_coverage by the link-coverage-tick.';
