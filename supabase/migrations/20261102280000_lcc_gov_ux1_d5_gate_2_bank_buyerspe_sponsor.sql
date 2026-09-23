-- ============================================================================
-- GOV-UX1-D5-gate-2 (2026-09-23) — close the three gaps behind the seller-lead
-- lane's ~50% graded precision, before Scott grades it.
--
--   bank      a plain bank owner ("Truist Bank", "... Bank, N.A.", "... Bancorp")
--             passed lcc_owner_name_is_bank_or_trustee, which matched trustee
--             shapes only. Scott 2026-09-14 excluded BANKS and CMBS trustees
--             from prospecting; the guard now matches what the decision said.
--   buyerspe  an owner whose decision-maker also decides for an entity that
--             lcc_resolve_buyer_parent resolves to a repeat buyer is that
--             buyer's sibling SPE (PASADENA SSA LLC <- Kiljuana Crawford <- UIRC).
--             The view now reports, per decision-maker, which repeat buyer they
--             also decide for; seller-lead-gate.js keeps the owner in the lane
--             with a "likely SPE of <parent>" note and keeps it OFF the auto path.
--   sponsor   five ARC GS... SPEs share one AR Global contact. The lane collapses
--             owners that share a decision-maker into one card (JS); the sibling
--             owners are recorded with decided_via = 'cluster', which the
--             precision meter does not count (it reads 'lane' only), so one
--             conversation is one graded decision.
--
-- Measured live before building (LCC Opps, 2026-09-23):
--   bank arm: 32 of 42 '\mban(k|c)' owner names in v_lcc_seller_prospect_universe
--     match, every one a bank; the 10 non-matches are real-estate SPEs named for
--     a bank building (BANK BUILDING INVESTORS, LIMITED; First Bank Building LLC;
--     BANCORP PLAZA LLC; Bank of Louisville,LLC), persons (Gregory M Bancroft),
--     and junk. Fleet-wide 621 of 935 bank-ish entity names match; the only
--     false positive found (Food Bank of Delaware) is excluded by name shape.
--     Seller queue rows it removes: exactly 4, all "Truist Bank" (dia 26404,
--     24148, 24142, 25401; $27.6M combined value; reason value_creation_developer).
--   buyerspe: of the 20 gated owners, 1 (PASADENA SSA LLC) has a decision-maker
--     who is also a decision-maker on 3 UIRC entities that resolve to
--     "UIRC, Urban Investment Research Corp.".
--   sponsor: Karen Massey is the sole decision-maker on 5 gated owners
--     (ARC GSIFLMN001 / GSFFDME001 / GSRNGME001 / GSDALTX001 / GSGTNPA001);
--     no other gated owners share a person. Her employer (Global Net Lease,
--     works_at) does not resolve as a repeat buyer, so (2) does not catch them.
--
-- Does not touch the precision view, the flag, the cron, or bridgeCreateLead.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. bank — a named arm, OR-ed into the existing single choke point
--    (lcc_owner_name_is_not_prospected → 7 consuming views). Separate function
--    so it can be gated off alone if Scott starts prospecting lenders.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_owner_name_is_plain_bank(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT
    -- a real-estate SPE named for a bank building/plaza is an owner we prospect
    coalesce(p_name, '') !~* '\m(llc|l\.l\.c|lp|l\.p|llp|limited|investors|building|plaza|properties|realty|holdings|partners|executives|members|court)\M'
    -- charitable "banks" are not lenders
    AND coalesce(p_name, '') !~* '\m(food|blood|tissue|eye|milk|seed|sperm)\s+bank\M'
    AND (
         coalesce(p_name, '') ~* '\mbank\M[\s,]*(the|n\.?\s*a\.?|inc\.?|corp\.?|corporation)?[\s.]*$'
      OR coalesce(p_name, '') ~* '^\s*(the\s+)?bank of\s+\w'
      OR coalesce(p_name, '') ~* '\mbank of\s+\w+\s*$'
      OR coalesce(p_name, '') ~* '\mbank\M.*\mn\.\s*a\.?\s*$'
      OR coalesce(p_name, '') ~* '\mbancorp(oration)?\M[\s,]*(inc\.?|corp\.?)?[\s.]*$'
      OR coalesce(p_name, '') ~* '\mbanc ?shares\M'
      OR coalesce(p_name, '') ~* '\mbanking (corporation|corp\.?|company|co\.?)\s*$'
      OR coalesce(p_name, '') ~* '\mbank(ing)? (and|&) trust\M'
    );
$function$;

COMMENT ON FUNCTION public.lcc_owner_name_is_plain_bank(text) IS
  'GOV-UX1-D5-gate-2: a plain bank as owner (Truist Bank, ... Bank N.A., ... Bancorp, Bank of X). '
  'OR-ed into lcc_owner_name_is_bank_or_trustee (Scott 2026-09-14: banks and CMBS trustees are not prospected). '
  'Names carrying an SPE/real-estate suffix (LLC, LP, Limited, Building, Plaza, ...) never match.';

CREATE OR REPLACE FUNCTION public.lcc_owner_name_is_bank_or_trustee(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  select coalesce(p_name,'') ~* '\mnational association\M'
      or coalesce(p_name,'') ~* '\mbank\M.*\mas trustee\M'
      or coalesce(p_name,'') ~* '\mtrustee\M.*\mbank\M'
      or coalesce(p_name,'') ~* 'commercial mortgage.*(trust|pass[- ]?through|certificates)'
      or coalesce(p_name,'') ~* '(trust|pass[- ]?through|certificates).*commercial mortgage'
      or coalesce(p_name,'') ~* 'mortgage (pass[- ]?through|backed) (certificates|securities)'
      or coalesce(p_name,'') ~* 'savings bank'
      or public.lcc_owner_name_is_plain_bank(p_name);
$function$;

-- ----------------------------------------------------------------------------
-- 2. sponsor — the sibling owners of a collapsed card get their own ledger rows
--    (so they leave the lane) under decided_via = 'cluster'. The precision meter
--    reads decided_via = 'lane' only, so they are never counted twice.
-- ----------------------------------------------------------------------------
ALTER TABLE public.lcc_seller_lead_gate_decision
  DROP CONSTRAINT IF EXISTS lcc_seller_lead_gate_decision_decided_via_check;
ALTER TABLE public.lcc_seller_lead_gate_decision
  ADD CONSTRAINT lcc_seller_lead_gate_decision_decided_via_check
  CHECK (decided_via IN ('lane', 'auto', 'cluster'));

-- ----------------------------------------------------------------------------
-- 3. buyerspe — the gate candidates view, unchanged except that each dm_people
--    element now carries the repeat buyer that person ALSO decides for
--    (shared_buyer_parent / shared_buyer_parent_id), resolved through the same
--    lcc_resolve_buyer_parent bridgeCreateLead refuses on. The view still decides
--    nothing; seller-lead-gate.js combines it. Column list unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_seller_lead_gate_candidates
WITH (security_invoker = on) AS
WITH q AS (
  SELECT * FROM public.v_lcc_seller_prospect_queue WHERE reason_measured
),
top_prop AS (
  SELECT DISTINCT ON (q.entity_id)
         q.entity_id, q.workspace_id, q.owner_name, q.source_domain, q.source_property_id,
         q.address, q.city, q.state, q.reason_to_sell, q.reason_measured
    FROM q
   ORDER BY q.entity_id, q.rank_value DESC NULLS LAST, q.source_property_id
),
agg AS (
  SELECT q.entity_id, count(*) AS property_count, max(q.rank_value) AS rank_value
    FROM q GROUP BY q.entity_id
),
people AS (
  SELECT o.entity_id,
         pe.id   AS person_id,
         pe.name AS person_name,
         lower(btrim(coalesce(r.metadata->>'role', ''))) AS role
    FROM top_prop o
    JOIN public.entity_relationships r
      ON (r.from_entity_id = o.entity_id OR r.to_entity_id = o.entity_id)
    JOIN public.entities pe
      ON pe.id = CASE WHEN r.from_entity_id = o.entity_id THEN r.to_entity_id ELSE r.from_entity_id END
     AND pe.entity_type = 'person'
     AND pe.merged_into_entity_id IS NULL
),
dm_person AS (
  SELECT DISTINCT entity_id, person_id, person_name, role
    FROM people
   WHERE public.lcc_is_seller_lead_decision_role(role)
     AND NOT public.lcc_owner_name_is_junk(person_name)
),
-- The repeat buyer each decision-maker ALSO decides for, on any OTHER live
-- organisation (through a decision-maker role — a works_at edge is not
-- authority, P161).
shared_buyer AS (
  SELECT dp.entity_id, dp.person_id,
         min(bp.parent_name)                  AS shared_buyer_parent,
         (min(bp.parent_entity_id::text))::uuid AS shared_buyer_parent_id
    FROM (SELECT DISTINCT entity_id, person_id FROM dm_person) dp
    JOIN public.entity_relationships r2
      ON (r2.from_entity_id = dp.person_id OR r2.to_entity_id = dp.person_id)
    JOIN public.entities oe
      ON oe.id = CASE WHEN r2.from_entity_id = dp.person_id THEN r2.to_entity_id ELSE r2.from_entity_id END
     AND oe.id <> dp.entity_id
     AND oe.entity_type <> 'person'
     AND oe.merged_into_entity_id IS NULL
    CROSS JOIN LATERAL (SELECT parent_entity_id, parent_name
                          FROM public.lcc_resolve_buyer_parent(oe.id) LIMIT 1) bp
   WHERE public.lcc_is_seller_lead_decision_role(lower(btrim(coalesce(r2.metadata->>'role', ''))))
   GROUP BY dp.entity_id, dp.person_id
),
dm AS (
  SELECT d.entity_id,
         jsonb_agg(DISTINCT jsonb_build_object(
           'person_id', d.person_id, 'name', d.person_name, 'role', d.role,
           'shared_buyer_parent', sb.shared_buyer_parent,
           'shared_buyer_parent_id', sb.shared_buyer_parent_id)) AS dm_people
    FROM dm_person d
    LEFT JOIN shared_buyer sb ON sb.entity_id = d.entity_id AND sb.person_id = d.person_id
   GROUP BY d.entity_id
),
roles AS (
  SELECT entity_id, string_agg(DISTINCT nullif(role, ''), ',' ORDER BY nullif(role, '')) AS linked_roles
    FROM people GROUP BY entity_id
),
dec AS (
  SELECT DISTINCT ON (d.entity_id) d.entity_id, d.decision, d.decided_via, d.reason
    FROM public.lcc_seller_lead_gate_decision d
   WHERE d.reversed_at IS NULL
      -- a REVERSED auto-create is itself a "no": the operator undid it.
      OR (d.decided_via = 'auto' AND d.decision = 'create')
   ORDER BY d.entity_id, d.created_at DESC
)
SELECT t.entity_id,
       t.workspace_id,
       t.owner_name,
       t.source_domain,
       t.source_property_id,
       t.address,
       t.city,
       t.state,
       a.property_count,
       a.rank_value,
       t.reason_to_sell,
       t.reason_measured,
       coalesce(dm.dm_people, '[]'::jsonb)                               AS dm_people,
       ro.linked_roles,
       public.lcc_owner_name_is_junk(t.owner_name)                       AS owner_name_sql_junk,
       bp.parent_name                                                    AS repeat_buyer_parent,
       EXISTS (SELECT 1 FROM public.bd_opportunities b
                WHERE b.entity_id = t.entity_id AND b.is_open)            AS has_open_opportunity,
       public.lcc_cadence_point_person(t.entity_id)                      AS point_person_user_id,
       dec.decision                                                      AS prior_decision,
       dec.decided_via                                                   AS prior_decided_via,
       dec.reason                                                        AS prior_reason
  FROM top_prop t
  JOIN agg a USING (entity_id)
  LEFT JOIN dm USING (entity_id)
  LEFT JOIN roles ro USING (entity_id)
  LEFT JOIN dec USING (entity_id)
  LEFT JOIN LATERAL (SELECT parent_name FROM public.lcc_resolve_buyer_parent(t.entity_id) LIMIT 1) bp ON true;

REVOKE ALL ON public.v_lcc_seller_lead_gate_candidates FROM public, anon, authenticated;
GRANT SELECT ON public.v_lcc_seller_lead_gate_candidates TO service_role;
