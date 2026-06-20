-- CONTACT-SELECTION Slice 1 (2026-06-20): expose a slim, anon-readable
-- per-OWNER contact-signal view so LCC's contact-selection bench can rank the
-- right decision-maker for each gov owner (true_owner).
--
-- Mirrors the v_property_owner_facts_portfolio posture (NAMES ONLY, no PII
-- address VALUES — only a has_reg_address BOOLEAN for enrichment routing).
-- Owner-grained: one row per true_owner that carries at least one candidate
-- human/firm OR a registered-agent address (so the mirror stays bounded — it is
-- NOT a per-property fanout).
--
-- Candidate sources, mapped to the CONTACT_SELECTION_STANDARD authority ladder:
--   * recorded_owners.manager_name      -> authority 2 (controlling role)
--   * recorded_owners.registered_agent_name -> authority 4 (registered agent)
--
-- DELIBERATELY EXCLUDED: loans.cmbs_sponsor. Grounded live 2026-06-20 — the gov
-- cmbs_sponsor values are CMBS securitization SHELF codes (BBCMS / CGCMT / COMM
-- / CSAIL / DBJPM / GS / CITI ...), i.e. the bond trust, NOT the owner's
-- signatory/principal. Surfacing them as "the person to call" would violate the
-- standard (and the existing isImplausiblePersonName guard already treats these
-- as junk). So gov authority-1 (signatory) is genuinely NOT in structured data
-- -> it is enrichment (parse_deed_signatory) territory, handled in LCC Slice 3.
--
-- PII posture: names are public-record (same exposure as the existing
-- true_owners / v_property_owner_facts_portfolio anon views). Addresses are
-- exposed only as a boolean.
--
-- DEPLOY ORDERING: apply BEFORE the LCC owner-contact-signal sync, which selects
-- these columns over PostgREST. If the LCC sync runs first the page 404s
-- gracefully and the mirror stays empty (no error, no regression).

BEGIN;

DROP VIEW IF EXISTS public.v_owner_contact_signals_portfolio;

CREATE VIEW public.v_owner_contact_signals_portfolio AS
WITH cand AS (
  -- controlling role: recorded_owner manager (authority 2)
  SELECT p.true_owner_id,
         regexp_replace(btrim(ro.manager_name), '\s+', ' ', 'g')   AS cand_name,
         COALESCE(NULLIF(btrim(ro.manager_role), ''), 'manager')   AS cand_role,
         2                                                         AS authority,
         'recorded_owner_manager'                                  AS src,
         p.property_id
  FROM public.properties p
  JOIN public.recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE p.true_owner_id IS NOT NULL
    AND NULLIF(btrim(ro.manager_name), '') IS NOT NULL
  UNION ALL
  -- registered agent (authority 4 — lowest before fallback; often a commercial
  -- RA service, but an individual RA can be the principal)
  SELECT p.true_owner_id,
         regexp_replace(btrim(ro.registered_agent_name), '\s+', ' ', 'g'),
         'registered_agent',
         4,
         'recorded_owner_agent',
         p.property_id
  FROM public.properties p
  JOIN public.recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE p.true_owner_id IS NOT NULL
    AND NULLIF(btrim(ro.registered_agent_name), '') IS NOT NULL
),
cand_rolled AS (
  -- collapse per (owner, name, role, source); n_props = cross-property recurrence
  SELECT true_owner_id, cand_name,
         min(cand_role)  AS cand_role,
         min(authority)  AS authority,
         min(src)        AS src,
         count(DISTINCT property_id) AS n_props
  FROM cand
  GROUP BY true_owner_id, cand_name
),
cand_agg AS (
  SELECT true_owner_id,
         jsonb_agg(jsonb_build_object(
           'name', cand_name, 'role', cand_role,
           'authority', authority, 'source', src, 'n_props', n_props)
           ORDER BY authority, n_props DESC, cand_name) AS candidates
  FROM cand_rolled
  GROUP BY true_owner_id
),
reg_addr AS (
  SELECT DISTINCT p.true_owner_id
  FROM public.properties p
  JOIN public.recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE p.true_owner_id IS NOT NULL
    AND NULLIF(btrim(ro.registered_agent_address), '') IS NOT NULL
),
owners AS (
  SELECT true_owner_id FROM cand_agg
  UNION
  SELECT true_owner_id FROM reg_addr
)
SELECT
  o.true_owner_id,
  to2.name                                   AS true_owner_name,
  COALESCE(ca.candidates, '[]'::jsonb)        AS candidates,
  (ra.true_owner_id IS NOT NULL)             AS has_reg_address
FROM owners o
JOIN public.true_owners to2 ON to2.true_owner_id = o.true_owner_id
LEFT JOIN cand_agg  ca ON ca.true_owner_id = o.true_owner_id
LEFT JOIN reg_addr  ra ON ra.true_owner_id = o.true_owner_id;

GRANT SELECT ON public.v_owner_contact_signals_portfolio TO anon, authenticated;

COMMENT ON VIEW public.v_owner_contact_signals_portfolio IS
  'CONTACT-SELECTION Slice 1: per-true_owner contact-signal bench for LCC. '
  'candidates jsonb = [{name,role,authority,source,n_props}] from '
  'recorded_owner manager (authority 2) + registered_agent (authority 4). '
  'has_reg_address = a registered-agent address exists (address_reverse_lookup '
  'enrichment hint). Names only; no PII address values. cmbs_sponsor is '
  'EXCLUDED (CMBS shelf codes, not principals). SECURITY DEFINER so anon reads '
  'while base tables stay RLS-protected.';

COMMIT;
