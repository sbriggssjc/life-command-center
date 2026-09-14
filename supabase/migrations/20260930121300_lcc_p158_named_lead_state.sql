-- ============================================================================
-- P158 / P158a — "NAMED LEAD — find their line": we know WHO to call.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-20. Scott's call.
-- ----------------------------------------------------------------------------
-- MEASURED FIRST. Of 3,608 owners filed as "needs a contact first", 108 already
-- carried a NAMED contact in owner_contact_pivot, 63 of those names were
-- person-shaped ($122.1M) -- and ZERO of them had an email or phone. The
-- pipeline was therefore hiding:
--     USAA Real Estate        -> Joseph Capra      $62.0M
--     Brandywine Realty Trust -> Jeffrey A. Scott  $34.9M
--
-- For a broker "Joseph Capra at USAA Real Estate" is a workable lead -- you call
-- the company and ask for him. Filing that beside a blank LLC understates
-- readiness and buries it. The bottleneck was never NAMES; it is DIRECT LINES,
-- and neither the SOS registry nor the SAM public extract will ever supply one.
--
-- ⚠️ DELIBERATELY NOT MARKED REACHABLE, which is the whole point. The tempting
-- move -- count a named person as reachable so they flow into the normal pursuit
-- machinery -- would re-create exactly the failure P112 fixed: a cadence seeded
-- for a party with no contact method can never advance and only ages into
-- "overdue". lcc_entity_cadence_reachable is UNTOUCHED, so nothing auto-seeds.
-- This is a THIRD state that surfaces the work without polluting cadence.
--
-- The person test REUSES lcc_owner_name_is_credible_person (P148) rather than
-- re-implementing "looks like a person" -- that function already carries the
-- gated definition (>=2 tokens, final token >=2 chars so a truncated "Adel B" is
-- refused, no digits, the TrafficMetrix street-vocabulary guard, not a
-- brokerage, not an agent, no org marker). One definition, not two that drift.
--
-- Consumption-Layer compliance:
--   consumer      a human working v_lcc_named_lead_worklist
--   value gate    ranked by annual rent, actionable-only
--   auto-retire   inherent -- the moment the contact gains an email or phone the
--                 owner becomes READY and leaves the lane by itself
--   honest counts the lane names what it is and does not inflate "reachable"
--
-- ⚠️ APPEND-ONLY: named_lead is added at the END of the SELECT. Inserting a
-- column mid-list raises 42P16 (CLAUDE.md) -- which it duly did on my first try.
--
-- ── P158a: org-marker gaps found by READING the lane, not its count ─────────
-- Firm names were passing as people:
--   The Graham Companies -- the list has `company` and \M is a word boundary, so
--                           the PLURAL slipped straight through
--   Tienda Health        -- no business-noun coverage at all
--
-- ⚠️ AND THE MEASUREMENT KILLED MY BEST IDEA. The obvious third arm was `&` --
-- surely no person's name has an ampersand. Measured before applying: it would
-- have flagged 1,305 entities, retyped 119 people and touched 66 RESOLVED
-- OWNERS, and the population is dominated by MARRIED COUPLES and joint
-- individual owners:
--     Amy & Richard Gonzalez · Anil M & Rajeshkumar K Khatri
--     Adel B & Gihan M Bareh · A.R. Venugopala & Padma V. Reddy
--     Amit, Kishor & Damini Mehta
-- Exactly the individual owners Scott's 2026-08-19 doctrine admits. The single
-- firm it would have caught is not worth misclassifying dozens of real couples.
-- ARM DROPPED. Only the unambiguous half ships.
--
-- THE RETYPE IS PART OF THE SAME CHANGE: 57 newly-flagged entities were typed
-- 'person'. lcc_supersede_property_owner admits an owner that is typed
-- organization OR passes credible_person -- and credible_person EXCLUDES org
-- markers. Adding a marker without retyping would make those 57 fail BOTH arms
-- and silently lose owner eligibility. Gated against exactly that.
--
-- KNOWN RESIDUE, stated rather than forced: `Grey Harbor` and
-- `Rutherford & Strickland` remain in the lane. No safe marker catches them and
-- inventing one would repeat the `&` mistake.
--
-- LIVE: named-lead lane 61 owners / $121.5M; needs-a-contact 3,608 -> 3,547;
-- reachable unchanged at 3; nothing promoted to READY.
--
-- REVERSAL: drop the third CASE arm and the named_lead column; drop
--   v_lcc_named_lead_worklist; restore the prior org-marker body; and
--   update entities set entity_type=(metadata->>'p158a_prior_entity_type')::entity_type
--    where metadata ? 'p158a_prior_entity_type';
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_owner_name_has_org_marker(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  select coalesce(p_name,'') ~* '(\m(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co|lp|llp|ltd|limited|trust|dst|reit|holdings|properties|property|partners|partnership|realty|capital|group|ventures|associates|enterprises|investments|investment|fund|bank|assn|association|church|center|centre|university|hospital|authority|district|management|equities|estates|development|developers)\M)'
      or coalesce(p_name,'') ~* '(\m(l\.p|l\.l\.p|p\.c|p\.a|s\.a|n\.a)\.?\M|\mco\.|\minc\.)'
      or coalesce(p_name,'') ~* '\m(investors|builders|realty|real estate|healthcare|health plan|mental health|revocable|living trust|living|JV|family t)\M'
      or coalesce(p_name,'') ~* '\m(city|county|town|village|borough|parish|municipal|school district|retirement system|tax collector|state of)\M'
      -- P158a: plural forms and business nouns. NOTE: `&` is deliberately absent --
      -- it is dominated by married couples and joint individual owners.
      or coalesce(p_name,'') ~* '\m(companies|health|medical|clinic|services|solutions|systems|industries)\M'
      or coalesce(p_name,'') ~ '[0-9]';
$$;

UPDATE public.entities e
   SET entity_type = 'organization',
       metadata = coalesce(e.metadata,'{}'::jsonb)
                || jsonb_build_object('p158a_prior_entity_type', e.entity_type::text,
                                      'p158a_reason','plural/business-noun org marker (P158a)')
 WHERE e.entity_type = 'person'
   AND public.lcc_owner_name_has_org_marker(e.name)
   AND NOT public.lcc_owner_name_is_agent(e.name)
   AND e.name !~* '\mOBO\M|\mas trustee\M|\mbk\s*&\s*tr\M|\mbank\M.*\mtr(ust)?\M';

CREATE OR REPLACE VIEW public.v_lcc_top_seller_prospects AS
 WITH portfolio AS (
         SELECT f.entity_id,
            sum(f.annual_rent) AS annual_rent,
            count(*) AS asset_count,
            string_agg(DISTINCT f.source_domain, '/'::text ORDER BY f.source_domain) AS domains
           FROM lcc_entity_portfolio_facts f
          WHERE f.is_current
          GROUP BY f.entity_id
        )
 SELECT e.id AS entity_id,
    e.name AS owner_name,
    p.annual_rent,
    p.asset_count,
    p.domains,
    lcc_entity_cadence_reachable(e.id) AS reachable,
    COALESCE(e.email, ( SELECT x.email
           FROM entities x
             JOIN entity_relationships r ON r.to_entity_id = x.id
          WHERE r.from_entity_id = e.id AND x.email IS NOT NULL
         LIMIT 1)) AS contact_route,
    (EXISTS ( SELECT 1 FROM touchpoint_cadence t WHERE t.entity_id = e.id)) AS on_cadence,
    ( SELECT t.sf_contact_id FROM touchpoint_cadence t
       WHERE t.entity_id = e.id AND t.sf_contact_id IS NOT NULL LIMIT 1) AS sf_contact_id,
    ( SELECT count(*) AS count FROM lcc_property_owner o
       WHERE o.owner_entity_id = e.id) AS owned_assets_resolved,
        CASE
            WHEN (EXISTS ( SELECT 1 FROM touchpoint_cadence t WHERE t.entity_id = e.id)) THEN 'pursuing'::text
            WHEN lcc_entity_cadence_reachable(e.id) THEN 'READY — reachable, not pursued'::text
            WHEN EXISTS ( SELECT 1 FROM owner_contact_pivot pv
                           WHERE pv.entity_id = e.id
                             AND pv.active_contact_name IS NOT NULL
                             AND lcc_owner_name_is_credible_person(pv.active_contact_name))
                 THEN 'NAMED LEAD — find their line'::text
            ELSE 'needs a contact first'::text
        END AS pursuit_status,
    -- P158 (appended LAST -- CREATE OR REPLACE VIEW is append-only for columns)
    ( SELECT pv.active_contact_name FROM owner_contact_pivot pv
       WHERE pv.entity_id = e.id
         AND pv.active_contact_name IS NOT NULL
         AND lcc_owner_name_is_credible_person(pv.active_contact_name)
       LIMIT 1) AS named_lead
   FROM portfolio p
     JOIN entities e ON e.id = p.entity_id
  WHERE p.annual_rent > 0::numeric
    AND e.merged_into_entity_id IS NULL
    AND NOT lcc_owner_name_is_brokerage(e.name)
    AND NOT lcc_is_operator_owner_name(e.name)
    AND NOT lcc_owner_name_is_public_body(e.name)
    AND COALESCE(e.metadata ->> 'junk_name_flagged'::text, ''::text) <> 'true'::text;

CREATE OR REPLACE VIEW public.v_lcc_named_lead_worklist AS
SELECT p.entity_id,
       p.owner_name,
       p.named_lead,
       p.annual_rent,
       p.asset_count,
       p.domains,
       pv.active_contact_role   AS lead_role,
       pv.active_source         AS lead_source,
       pv.active_contact_entity_id IS NOT NULL AS lead_is_an_entity,
       ( SELECT count(*) FROM lcc_property_owner o WHERE o.owner_entity_id = p.entity_id) AS owned_assets,
       row_number() OVER (ORDER BY p.annual_rent DESC NULLS LAST, p.owner_name) AS rank
  FROM public.v_lcc_top_seller_prospects p
  LEFT JOIN owner_contact_pivot pv ON pv.entity_id = p.entity_id
 WHERE p.pursuit_status = 'NAMED LEAD — find their line';

COMMENT ON VIEW public.v_lcc_named_lead_worklist IS
  'P158. Owners where we know the decision-maker BY NAME but have no email or '
  'phone -- "find their line", not "find a contact". Value-ranked, actionable '
  'only. Deliberately NOT counted as reachable and NOT cadence-seeded: P112 '
  'established that a cadence for a party with no contact method can never '
  'advance and only ages into overdue. A row leaves this lane automatically the '
  'moment its contact gains an email or phone.';

DO $$
DECLARE n_couples int; n_removed int; n_lost int; n_lane int; has_usaa boolean;
BEGIN
  SELECT count(*) INTO n_couples FROM public.entities
   WHERE name IN ('Amy & Richard Gonzalez','Anil M & Rajeshkumar K Khatri',
                  'Adel B & Gihan M Bareh','A.R. Venugopala & Padma V. Reddy')
     AND public.lcc_owner_name_has_org_marker(name);
  IF n_couples > 0 THEN
    RAISE EXCEPTION 'P158a gate: % married-couple names flagged as organisations', n_couples;
  END IF;

  SELECT count(*) INTO n_removed FROM public.v_lcc_named_lead_worklist
   WHERE named_lead IN ('Tienda Health','The Graham Companies');
  IF n_removed > 0 THEN
    RAISE EXCEPTION 'P158a gate: % firm names still present as named leads', n_removed;
  END IF;

  SELECT count(*) INTO n_lost FROM public.lcc_property_owner o
    JOIN public.entities e ON e.id = o.owner_entity_id
   WHERE e.entity_type = 'person'
     AND public.lcc_owner_name_has_org_marker(e.name)
     AND NOT public.lcc_owner_name_is_credible_person(e.name);
  IF n_lost > 0 THEN
    RAISE EXCEPTION 'P158a gate: % resolved owners now fail BOTH eligibility arms', n_lost;
  END IF;

  SELECT exists(SELECT 1 FROM public.v_lcc_named_lead_worklist
                 WHERE owner_name = 'USAA Real Estate') INTO has_usaa;
  IF NOT has_usaa THEN
    RAISE EXCEPTION 'P158 gate: USAA Real Estate (the $62M case) is not in the lane';
  END IF;

  IF EXISTS (SELECT 1 FROM public.v_lcc_top_seller_prospects
              WHERE pursuit_status = 'READY — reachable, not pursued'
                AND named_lead IS NOT NULL AND NOT reachable) THEN
    RAISE EXCEPTION 'P158 gate: a named lead was wrongly counted as reachable';
  END IF;

  SELECT count(*) INTO n_lane FROM public.v_lcc_named_lead_worklist;
  RAISE NOTICE 'P158/P158a ok: named-lead lane % rows', n_lane;
END $$;
