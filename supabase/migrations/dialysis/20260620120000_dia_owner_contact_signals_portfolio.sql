-- CONTACT-SELECTION Slice 1 (2026-06-20): dia leg of the per-OWNER contact-signal
-- view (mirror of the gov v_owner_contact_signals_portfolio). NAMES ONLY; address
-- exposed only as a boolean (enrichment routing).
--
-- Candidate sources -> CONTACT_SELECTION_STANDARD authority ladder:
--   * true_owners.contact_1_name / contact_2_name -> authority 3 (economic owner)
--   * recorded_owners.manager_name                -> authority 2 (controlling role)
--   * recorded_owners.registered_agent_name       -> authority 4 (registered agent)
-- (dia loans.sponsor is empty -> no authority-1 tier; deed-parse is Slice 3.)
--
-- has_reg_address = true_owners notice address OR recorded_owner registered-agent
-- address exists -> address_reverse_lookup enrichment hint.
--
-- DEPLOY ORDERING: apply BEFORE the LCC owner-contact-signal sync (graceful 404 /
-- empty mirror if applied after).

BEGIN;

DROP VIEW IF EXISTS public.v_owner_contact_signals_portfolio;

CREATE VIEW public.v_owner_contact_signals_portfolio AS
WITH cand AS (
  -- economic owner contacts (authority 3) — live directly on true_owners
  SELECT to2.true_owner_id,
         regexp_replace(btrim(to2.contact_1_name), '\s+', ' ', 'g') AS cand_name,
         'economic_owner_contact' AS cand_role, 3 AS authority,
         'true_owner_contact_1' AS src, NULL::bigint AS property_id
  FROM public.true_owners to2
  WHERE NULLIF(btrim(to2.contact_1_name), '') IS NOT NULL
  UNION ALL
  SELECT to2.true_owner_id,
         regexp_replace(btrim(to2.contact_2_name), '\s+', ' ', 'g'),
         'economic_owner_contact', 3, 'true_owner_contact_2', NULL
  FROM public.true_owners to2
  WHERE NULLIF(btrim(to2.contact_2_name), '') IS NOT NULL
  UNION ALL
  -- controlling role: recorded_owner manager (authority 2)
  SELECT p.true_owner_id,
         regexp_replace(btrim(ro.manager_name), '\s+', ' ', 'g'),
         COALESCE(NULLIF(btrim(ro.manager_role), ''), 'manager'), 2,
         'recorded_owner_manager', p.property_id
  FROM public.properties p
  JOIN public.recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE p.true_owner_id IS NOT NULL AND NULLIF(btrim(ro.manager_name), '') IS NOT NULL
  UNION ALL
  -- registered agent (authority 4)
  SELECT p.true_owner_id,
         regexp_replace(btrim(ro.registered_agent_name), '\s+', ' ', 'g'),
         'registered_agent', 4, 'recorded_owner_agent', p.property_id
  FROM public.properties p
  JOIN public.recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE p.true_owner_id IS NOT NULL AND NULLIF(btrim(ro.registered_agent_name), '') IS NOT NULL
),
cand_rolled AS (
  SELECT true_owner_id, cand_name, min(cand_role) AS cand_role, min(authority) AS authority,
         min(src) AS src, count(DISTINCT property_id) AS n_props
  FROM cand GROUP BY true_owner_id, cand_name
),
cand_agg AS (
  SELECT true_owner_id,
         jsonb_agg(jsonb_build_object('name', cand_name, 'role', cand_role,
           'authority', authority, 'source', src, 'n_props', n_props)
           ORDER BY authority, n_props DESC, cand_name) AS candidates
  FROM cand_rolled GROUP BY true_owner_id
),
reg_addr AS (
  SELECT true_owner_id FROM public.true_owners
  WHERE NULLIF(btrim(notice_address_1), '') IS NOT NULL
     OR NULLIF(btrim(notice_address_2), '') IS NOT NULL
  UNION
  SELECT DISTINCT p.true_owner_id
  FROM public.properties p
  JOIN public.recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE p.true_owner_id IS NOT NULL AND NULLIF(btrim(ro.registered_agent_address), '') IS NOT NULL
),
owners AS (
  SELECT true_owner_id FROM cand_agg
  UNION
  SELECT true_owner_id FROM reg_addr
)
SELECT o.true_owner_id, to2.name AS true_owner_name,
       COALESCE(ca.candidates, '[]'::jsonb) AS candidates,
       (EXISTS (SELECT 1 FROM reg_addr ra WHERE ra.true_owner_id = o.true_owner_id)) AS has_reg_address
FROM owners o
JOIN public.true_owners to2 ON to2.true_owner_id = o.true_owner_id
LEFT JOIN cand_agg ca ON ca.true_owner_id = o.true_owner_id;

GRANT SELECT ON public.v_owner_contact_signals_portfolio TO anon, authenticated;

COMMENT ON VIEW public.v_owner_contact_signals_portfolio IS
  'CONTACT-SELECTION Slice 1 (dia): per-true_owner contact-signal bench. candidates = true_owner economic contacts (authority 3) + recorded_owner manager (2) + registered_agent (4). has_reg_address = notice/agent address exists. Names only.';

COMMIT;
