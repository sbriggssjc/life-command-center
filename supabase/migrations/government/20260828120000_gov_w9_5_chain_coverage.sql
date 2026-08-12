-- ============================================================================
-- W9.5 (Prompt 97, 2026-08-12) — gov chain-coverage view for the propagation-
-- integrity tick. gov counterpart of v_dia_w9_5_chain_coverage.
--
-- ⚠ SCHEMA DIFFERENCE (honest, documented): gov recorded_owners has NO direct
-- true_owner_id FK — the recorded↔true relationship is expressed on properties
-- (properties.recorded_owner_id + properties.true_owner_id). So gov's
-- 'recorded_to_true' is measured over recorded owners that sit on a live property
-- (the addressable set): total = distinct recorded owners on any property,
-- linked = those on a property that ALSO carries a true owner. This differs from
-- dia's direct-FK basis; the per-domain note records the divergence so the
-- unified report never conflates the two bases.
--
-- Read-only measure. Counts only (no PII). Additive/reversible. Grant to anon.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_gov_w9_5_chain_coverage AS
WITH links AS (
  SELECT 'recorded_to_true'::text AS link_name, 1 AS ord,
         (SELECT count(DISTINCT recorded_owner_id) FROM public.properties
           WHERE recorded_owner_id IS NOT NULL)                                                AS total,
         (SELECT count(DISTINCT recorded_owner_id) FROM public.properties
           WHERE recorded_owner_id IS NOT NULL AND true_owner_id IS NOT NULL)                  AS linked
  UNION ALL
  SELECT 'true_to_contact', 2,
         (SELECT count(*) FROM public.true_owners),
         (SELECT count(DISTINCT t.true_owner_id)
            FROM public.true_owners t JOIN public.contacts c ON c.true_owner_id = t.true_owner_id)
  UNION ALL
  SELECT 'contact_to_reachable', 3,
         (SELECT count(*) FROM public.contacts),
         (SELECT count(*) FROM public.contacts
           WHERE COALESCE(email,'') <> '' OR COALESCE(phone,'') <> '')
  UNION ALL
  SELECT 'true_to_sf', 4,
         (SELECT count(*) FROM public.true_owners),
         (SELECT count(*) FROM public.true_owners WHERE COALESCE(sf_account_id,'') <> '')
  UNION ALL
  SELECT 'contact_to_sf_contact_id', 5,
         (SELECT count(*) FROM public.contacts),
         (SELECT count(*) FROM public.contacts WHERE COALESCE(sf_contact_id,'') <> '')
)
SELECT link_name,
       total,
       linked,
       CASE WHEN total > 0 THEN round((linked::numeric / total::numeric) * 100, 1) ELSE NULL END AS pct
FROM links
ORDER BY ord;

GRANT SELECT ON public.v_gov_w9_5_chain_coverage TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_gov_w9_5_chain_coverage IS
  'W9.5 propagation-integrity: per-link (total,linked,pct) coverage for the gov chain. recorded_to_true measured over recorded owners on a live property (gov has no direct true_owner FK). Counts only, no PII. Read by the LCC link-coverage-tick.';
