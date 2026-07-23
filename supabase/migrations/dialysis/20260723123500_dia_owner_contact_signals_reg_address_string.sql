-- ============================================================================
-- ORE Option A Unit 3 (dia) — expose the owner notice/agent ADDRESS STRING on
-- the anon signals view (previously reduced to a has_reg_address boolean). Same
-- Scott-approved posture as gov: adds ONE address string column at the END; no
-- RLS loosening on base tables (definer-privilege anon-readable view).
-- REVERSAL: re-create the prior body (migration 20260620120000) — drop reg_addr_str
-- + the reg_address column + the reg_addr_str widen of `owners`.
-- ============================================================================
CREATE OR REPLACE VIEW public.v_owner_contact_signals_portfolio AS
WITH cand AS (
  SELECT to2_1.true_owner_id,
    regexp_replace(btrim(to2_1.contact_1_name), '\s+', ' ', 'g') AS cand_name,
    'economic_owner_contact'::text AS cand_role, 3 AS authority,
    'true_owner_contact_1'::text AS src, NULL::bigint AS property_id
  FROM true_owners to2_1 WHERE NULLIF(btrim(to2_1.contact_1_name), '') IS NOT NULL
  UNION ALL
  SELECT to2_1.true_owner_id, regexp_replace(btrim(to2_1.contact_2_name), '\s+', ' ', 'g'),
    'economic_owner_contact'::text, 3, 'true_owner_contact_2'::text, NULL::bigint
  FROM true_owners to2_1 WHERE NULLIF(btrim(to2_1.contact_2_name), '') IS NOT NULL
  UNION ALL
  SELECT p.true_owner_id, regexp_replace(btrim(ro.manager_name), '\s+', ' ', 'g'),
    COALESCE(NULLIF(btrim(ro.manager_role), ''), 'manager'), 2, 'recorded_owner_manager'::text, p.property_id
  FROM properties p JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE p.true_owner_id IS NOT NULL AND NULLIF(btrim(ro.manager_name), '') IS NOT NULL
  UNION ALL
  SELECT p.true_owner_id, regexp_replace(btrim(ro.registered_agent_name), '\s+', ' ', 'g'),
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
  SELECT true_owner_id FROM true_owners
  WHERE NULLIF(btrim(notice_address_1), '') IS NOT NULL OR NULLIF(btrim(notice_address_2), '') IS NOT NULL
  UNION
  SELECT DISTINCT p.true_owner_id
  FROM properties p JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE p.true_owner_id IS NOT NULL AND NULLIF(btrim(ro.registered_agent_address), '') IS NOT NULL
),
-- OPTION A: best owner address STRING per true_owner. Prefer the owner's own
-- notice address, then the recorded-owner's registered-agent / mailing address.
reg_addr_str AS (
  SELECT DISTINCT ON (tid) tid AS true_owner_id, addr AS reg_address
  FROM (
    SELECT to2.true_owner_id AS tid,
      COALESCE(NULLIF(btrim(to2.notice_address_1), ''), NULLIF(btrim(to2.notice_address_2), '')) AS addr, 1 AS rk
    FROM true_owners to2
    WHERE COALESCE(NULLIF(btrim(to2.notice_address_1), ''), NULLIF(btrim(to2.notice_address_2), '')) IS NOT NULL
    UNION ALL
    SELECT p.true_owner_id,
      COALESCE(NULLIF(btrim(ro.registered_agent_address), ''), NULLIF(btrim(ro.address), '')) AS addr, 2 AS rk
    FROM properties p JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
    WHERE p.true_owner_id IS NOT NULL
      AND COALESCE(NULLIF(btrim(ro.registered_agent_address), ''), NULLIF(btrim(ro.address), '')) IS NOT NULL
  ) u
  ORDER BY tid, rk
),
owners AS (
  SELECT true_owner_id FROM cand_agg
  UNION SELECT true_owner_id FROM reg_addr
  UNION SELECT true_owner_id FROM reg_addr_str
)
SELECT o.true_owner_id,
  to2.name AS true_owner_name,
  COALESCE(ca.candidates, '[]'::jsonb) AS candidates,
  (EXISTS (SELECT 1 FROM reg_addr ra WHERE ra.true_owner_id = o.true_owner_id)) AS has_reg_address,
  NULLIF(btrim(ras.reg_address), '') AS reg_address
FROM owners o
  JOIN true_owners to2 ON to2.true_owner_id = o.true_owner_id
  LEFT JOIN cand_agg ca ON ca.true_owner_id = o.true_owner_id
  LEFT JOIN reg_addr_str ras ON ras.true_owner_id = o.true_owner_id;

GRANT SELECT ON public.v_owner_contact_signals_portfolio TO anon, authenticated;
