-- ============================================================================
-- ORE Option A Unit 3 (gov) — expose the owner registered/notice/mailing ADDRESS
-- STRING on the anon signals view (previously reduced to a has_reg_address
-- boolean, the Slice-1 PII posture). Scott-approved (2026-07-22): surface the
-- owner notice-address string into LCC (one workspace, service-role pull) so the
-- 302 domain-address owners become reconcilable. Names-only posture is retained
-- for everything else; this adds ONE address string column at the END (append
-- rule) and does NOT loosen RLS on the base tables (the view stays definer-
-- privilege / anon-readable, base tables stay RLS-protected).
-- REVERSAL: re-create the prior body (migration 20260620120000) — drop the
-- reg_addr_str CTE + the reg_address column + the reg_addr_str widen of `owners`.
-- ============================================================================
CREATE OR REPLACE VIEW public.v_owner_contact_signals_portfolio AS
WITH cand AS (
  SELECT p.true_owner_id,
    regexp_replace(btrim(ro.manager_name), '\s+', ' ', 'g') AS cand_name,
    COALESCE(NULLIF(btrim(ro.manager_role), ''), 'manager') AS cand_role,
    2 AS authority, 'recorded_owner_manager'::text AS src, p.property_id
  FROM properties p JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE p.true_owner_id IS NOT NULL AND NULLIF(btrim(ro.manager_name), '') IS NOT NULL
  UNION ALL
  SELECT p.true_owner_id,
    regexp_replace(btrim(ro.registered_agent_name), '\s+', ' ', 'g'),
    'registered_agent'::text, 4, 'recorded_owner_agent'::text, p.property_id
  FROM properties p JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE p.true_owner_id IS NOT NULL AND NULLIF(btrim(ro.registered_agent_name), '') IS NOT NULL
),
cand_rolled AS (
  SELECT true_owner_id, cand_name, min(cand_role) AS cand_role, min(authority) AS authority,
    min(src) AS src, count(DISTINCT property_id) AS n_props
  FROM cand GROUP BY true_owner_id, cand_name
),
cand_agg AS (
  SELECT true_owner_id,
    jsonb_agg(jsonb_build_object('name', cand_name, 'role', cand_role, 'authority', authority,
      'source', src, 'n_props', n_props) ORDER BY authority, n_props DESC, cand_name) AS candidates
  FROM cand_rolled GROUP BY true_owner_id
),
reg_addr AS (
  SELECT DISTINCT p.true_owner_id
  FROM properties p JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE p.true_owner_id IS NOT NULL AND NULLIF(btrim(ro.registered_agent_address), '') IS NOT NULL
),
-- OPTION A: the best available owner address STRING per true_owner. Prefer the
-- owner's mailing address (ORE A1) then the registered-agent address.
reg_addr_str AS (
  SELECT DISTINCT ON (p.true_owner_id) p.true_owner_id,
    COALESCE(NULLIF(btrim(ro.mailing_address), ''), NULLIF(btrim(ro.registered_agent_address), '')) AS reg_address
  FROM properties p JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE p.true_owner_id IS NOT NULL
    AND COALESCE(NULLIF(btrim(ro.mailing_address), ''), NULLIF(btrim(ro.registered_agent_address), '')) IS NOT NULL
  ORDER BY p.true_owner_id, (NULLIF(btrim(ro.mailing_address), '') IS NOT NULL) DESC
),
owners AS (
  SELECT true_owner_id FROM cand_agg
  UNION SELECT true_owner_id FROM reg_addr
  UNION SELECT true_owner_id FROM reg_addr_str
)
SELECT o.true_owner_id,
  to2.name AS true_owner_name,
  COALESCE(ca.candidates, '[]'::jsonb) AS candidates,
  ra.true_owner_id IS NOT NULL AS has_reg_address,
  NULLIF(btrim(ras.reg_address), '') AS reg_address
FROM owners o
  JOIN true_owners to2 ON to2.true_owner_id = o.true_owner_id
  LEFT JOIN cand_agg ca ON ca.true_owner_id = o.true_owner_id
  LEFT JOIN reg_addr ra ON ra.true_owner_id = o.true_owner_id
  LEFT JOIN reg_addr_str ras ON ras.true_owner_id = o.true_owner_id;

GRANT SELECT ON public.v_owner_contact_signals_portfolio TO anon, authenticated;
