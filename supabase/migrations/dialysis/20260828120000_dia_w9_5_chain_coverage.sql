-- ============================================================================
-- W9.5 (Prompt 97, 2026-08-12) — dia chain-coverage view for the propagation-
-- integrity tick.
--
-- The standing measure of "full propagation": one row per link in the
-- recorded → true → contact → reachable → SF chain, exposing (total, linked, pct)
-- ONLY (no PII), so LCC's anon pull can UNIFY it with the gov view and the
-- LCC-Opps mirror-consistency view into v_lcc_w9_5_link_coverage at tick time.
--
-- Read-only measure. Writes nothing. Pure counts (no LLM anywhere in W9.5).
-- Additive + reversible (DROP VIEW). Grant to anon/service_role — counts expose
-- no owner/contact identity, matching the Gov/dia anon-readable-slice doctrine.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_dia_w9_5_chain_coverage AS
WITH links AS (
  -- recorded_owner → true_owner: dia recorded_owners carries a direct true_owner_id FK.
  SELECT 'recorded_to_true'::text AS link_name, 1 AS ord,
         (SELECT count(*) FROM public.recorded_owners)                                         AS total,
         (SELECT count(*) FROM public.recorded_owners WHERE true_owner_id IS NOT NULL)         AS linked
  UNION ALL
  -- true_owner → ANY contact: a true owner with at least one contact row.
  SELECT 'true_to_contact', 2,
         (SELECT count(*) FROM public.true_owners),
         (SELECT count(DISTINCT t.true_owner_id)
            FROM public.true_owners t JOIN public.contacts c ON c.true_owner_id = t.true_owner_id)
  UNION ALL
  -- contact → reachable: a contact with an email OR phone (a shell has neither).
  SELECT 'contact_to_reachable', 3,
         (SELECT count(*) FROM public.contacts),
         (SELECT count(*) FROM public.contacts
           WHERE COALESCE(contact_email,'') <> '' OR COALESCE(contact_phone,'') <> '')
  UNION ALL
  -- true_owner → SF key: an owner carrying a Salesforce account/company id.
  SELECT 'true_to_sf', 4,
         (SELECT count(*) FROM public.true_owners),
         (SELECT count(*) FROM public.true_owners
           WHERE COALESCE(salesforce_id,'') <> '' OR COALESCE(sf_company_id,'') <> '')
  UNION ALL
  -- contact → sf_contact_id: a contact carrying a person-level SF id (W9.2's key).
  SELECT 'contact_to_sf_contact_id', 5,
         (SELECT count(*) FROM public.contacts),
         (SELECT count(*) FROM public.contacts
           WHERE COALESCE(sf_contact_id,'') <> '' OR COALESCE(salesforce_id,'') <> '')
)
SELECT link_name,
       total,
       linked,
       CASE WHEN total > 0 THEN round((linked::numeric / total::numeric) * 100, 1) ELSE NULL END AS pct
FROM links
ORDER BY ord;

GRANT SELECT ON public.v_dia_w9_5_chain_coverage TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_dia_w9_5_chain_coverage IS
  'W9.5 propagation-integrity: per-link (total,linked,pct) coverage for the dia recorded→true→contact→reachable→SF chain. Counts only, no PII. Read by the LCC link-coverage-tick.';
