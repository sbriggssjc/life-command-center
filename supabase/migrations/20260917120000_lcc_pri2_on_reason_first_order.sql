-- PRI2-on (2026-09-17) -- reason-first order for the seller prospect queue.
--
-- Read: docs/audits/PRI2_SIDE_BY_SIDE_2026-09-16.md. V2's top 20, ordered by
-- rank_value alone, put 8 of 20 `reason_to_sell_unmeasured` rows ahead of
-- measured debt/developer rows -- big and unreasoned beats smaller and reasoned.
-- Cowork's read on Scott's delegation: order by MEASURED REASON first, then
-- value, then lease recency. Not a new score -- no predicate changes, no new
-- weight, the queue's membership is untouched.
--
-- PostgREST cannot order by a CASE/boolean expression over other columns in
-- the query string -- `order=` only takes real column names -- so the boolean
-- has to live on the view. `reason_measured` = the same condition the queue's
-- own WHERE clause already tests on `reason_to_sell` (line: "AND (newer_lease
-- IS TRUE OR reason_to_sell <> 'reason_to_sell_unmeasured')"), pulled out as a
-- named column so it can be an order key too. Never fabricated: NULL only
-- shares no state with false here -- reason_to_sell is never NULL (it always
-- resolves to a value, including the explicit 'reason_to_sell_unmeasured'
-- state), so reason_measured is boolean NOT NULL by construction.
--
-- CREATE OR REPLACE VIEW is append-only for columns (Postgres 42P16), so the
-- new column is appended at the END of v_lcc_seller_prospect_universe's
-- select list, after rank_value. v_lcc_seller_prospect_queue (`SELECT *`)
-- inherits it for free with no body change.
--
-- Reverse: re-apply 20261016120000_lcc_uxt1a_seller_prospect_queue.sql's
-- CREATE OR REPLACE VIEW bodies verbatim (drops the appended column; nothing
-- else reads it, no data is written by either view).

CREATE OR REPLACE VIEW public.v_lcc_seller_prospect_universe AS
WITH owners AS (
  -- ⚠️ PERFORMANCE, AND IT IS ALSO CORRECTNESS. Restricting `links` to entities that
  -- actually hold something takes it 17,508 -> 1,506 rows and the ranked read
  -- 118,559 -> 47,447 buffers. It changes no answer this view gives: person_link over
  -- the whole graph is 10,796 owners, over CURRENT holders it is 847 -- which is the
  -- audit's own §6a figure, and the only one the queue can act on.
  SELECT DISTINCT entity_id FROM public.lcc_entity_portfolio_facts WHERE is_current
),
links AS (
  SELECT r.from_entity_id AS owner_id, r.to_entity_id AS person_id
    FROM public.entity_relationships r
    JOIN owners o ON o.entity_id = r.from_entity_id
    JOIN public.entities pe ON pe.id = r.to_entity_id
     AND pe.entity_type = 'person' AND pe.merged_into_entity_id IS NULL
  UNION
  -- This arm returns 0 rows today (no current owner sits on the TO side of a person
  -- edge). It stays because that is a property of the data, not of the model, and a
  -- reach gate that can only see one edge direction is a false floor waiting to happen.
  SELECT r.to_entity_id, r.from_entity_id
    FROM public.entity_relationships r
    JOIN owners o ON o.entity_id = r.to_entity_id
    JOIN public.entities pe ON pe.id = r.from_entity_id
     AND pe.entity_type = 'person' AND pe.merged_into_entity_id IS NULL
),
reach AS (
  -- ONE pass over links produces both facts. EXISTS, not a join to activity_events: the
  -- join form materialises 509,153 intermediate rows to answer a 33-row question.
  SELECT l.owner_id,
         bool_or(EXISTS (SELECT 1 FROM public.activity_events ae
                          WHERE ae.entity_id = l.person_id
                          -- Human categories ONLY. A machine event is not a touch.
                            AND ae.category IN ('email','call','meeting'))) AS is_touched
    FROM links l
   GROUP BY l.owner_id
),
in_pipeline AS (
  SELECT entity_id FROM public.touchpoint_cadence WHERE entity_id IS NOT NULL
  UNION
  SELECT entity_id FROM public.bd_opportunities WHERE is_open AND entity_id IS NOT NULL
),
dev AS (
  -- v_lcc_entity_roles is MULTI-LABEL (C13b): aggregate to the owner before joining or
  -- the row fans out once per role.
  SELECT DISTINCT rr.entity_id
    FROM public.v_lcc_entity_roles rr
    JOIN owners o ON o.entity_id = rr.entity_id
   WHERE rr.role = 'developer'
),
debt AS (
  -- ⚠️ KEYED ON (owner, DOMAIN, PROPERTY), NOT ON THE OWNER. A loan is secured by a
  -- specific asset, so a maturity is a reason to sell THAT building -- not every other
  -- building the same owner holds. Owner-scoping it admits 615 rows instead of 520:
  -- 95 rows that ride in on a loan against a different property.
  SELECT entity_id, source_domain, source_property_id,
         min(months_to_maturity) AS months_to_maturity,
         bool_or(is_distressed)  AS is_distressed
    FROM public.v_lcc_loan_maturity_worklist
   GROUP BY 1, 2, 3
),
base AS (
  SELECT f.entity_id,
         e.workspace_id,
         e.name AS owner_name,
         f.source_domain,
         f.source_property_id,
         f.cap_rate AS asset_cap_rate,
         pa.noi, pa.annual_rent,
         pa.lease_commencement, pa.lease_expiration,
         pa.firm_term_remaining, pa.initial_term_years, pa.lease_source,
         pa.address, pa.city, pa.state,
         count(*) OVER (PARTITION BY f.source_domain, f.source_property_id) AS owners_on_asset
    FROM public.lcc_entity_portfolio_facts f
    JOIN public.entities e
      ON e.id = f.entity_id
     -- P175: existence is not liveness. A merged-away entity satisfies a plain join.
     AND e.merged_into_entity_id IS NULL
    LEFT JOIN public.lcc_property_attributes pa
      ON pa.source_domain = f.source_domain
     AND pa.source_property_id = f.source_property_id
   WHERE f.is_current
     AND NOT public.lcc_owner_name_is_brokerage(e.name)
     AND NOT public.lcc_is_placeholder_owner_name(e.name)
     AND NOT public.lcc_owner_name_is_not_prospected(e.name)
),
valued AS (
  SELECT b.*,
         CASE WHEN b.asset_cap_rate BETWEEN 0.03 AND 0.15 THEN b.asset_cap_rate
              WHEN b.source_domain = 'dia' THEN 0.0632 ELSE 0.0755 END AS cap_used,
         CASE WHEN b.asset_cap_rate BETWEEN 0.03 AND 0.15 THEN 'asset_cap_rate'
              ELSE 'domain_median_cap_rate' END AS cap_basis,
         CASE WHEN b.source_domain = 'gov' AND b.noi > 0 THEN 'noi_div_cap'
              WHEN b.source_domain = 'dia' AND b.annual_rent > 0 THEN 'net_rent_div_cap'
              WHEN b.source_domain = 'gov' AND b.annual_rent > 0 THEN 'gross_rent_haircut_div_cap'
              ELSE 'value_unknown' END AS value_basis
    FROM base b
),
gated AS (
  SELECT v.*,
         CASE v.value_basis
           WHEN 'noi_div_cap'                 THEN v.noi / v.cap_used
           WHEN 'net_rent_div_cap'            THEN v.annual_rent / v.cap_used
           WHEN 'gross_rent_haircut_div_cap'  THEN v.annual_rent * 0.703 / v.cap_used
         END AS value,
         CASE
           WHEN v.source_domain = 'gov' AND v.lease_commencement IS NULL
                AND COALESCE(v.firm_term_remaining, 0) <= 0 THEN 'term_unknown'
           WHEN v.source_domain = 'dia' AND v.lease_commencement IS NULL
                AND v.lease_expiration IS NULL THEN 'term_unknown'
           WHEN v.source_domain = 'gov'
                AND v.lease_commencement > CURRENT_DATE - interval '3 years'
                AND COALESCE(v.firm_term_remaining, 0) > 0 THEN 'gov_within_first_3y_firm'
           WHEN v.source_domain = 'dia'
                AND v.lease_expiration >= CURRENT_DATE + interval '12 years'
                THEN 'dia_ge_12y_remaining'
           WHEN v.source_domain = 'dia'
                AND v.lease_commencement > CURRENT_DATE - interval '3 years'
                THEN 'dia_within_first_3y'
           ELSE 'older_lease'
         END AS newer_lease_basis
    FROM valued v
)
SELECT g.entity_id,
       g.workspace_id,
       g.owner_name,
       g.source_domain,
       g.source_property_id,
       g.address, g.city, g.state,
       g.owners_on_asset,

       -- VALUE. NULL, never 0, when the basis is value_unknown (P180).
       round(g.value)::numeric AS value,
       g.value_basis,
       g.cap_used,
       g.cap_basis,
       -- in_band is NULL, never false, when the value cannot be sized. "We cannot price
       -- this" and "this is out of band" are different facts and must not share a state.
       CASE WHEN g.value IS NULL THEN NULL
            ELSE g.value BETWEEN 2500000 AND 25000000 END AS in_band,

       -- NEWER LEASE. NULL, never false, on term_unknown.
       CASE WHEN g.newer_lease_basis = 'term_unknown' THEN NULL
            ELSE g.newer_lease_basis <> 'older_lease' END AS newer_lease,
       g.newer_lease_basis,
       g.lease_commencement, g.lease_expiration, g.firm_term_remaining,
       g.initial_term_years, g.lease_source,
       -- Years into the term -- the doctrine's own "first 2-3 years" measure, and the
       -- secondary sort key. NULL when there is no commencement to measure from.
       round(((CURRENT_DATE - g.lease_commencement) / 365.25)::numeric, 1) AS years_into_term,

       -- REASON TO SELL. Recorded signals only.
       (dbt.entity_id IS NOT NULL) AS reason_debt,
       (dev.entity_id IS NOT NULL) AS reason_value_creation_developer,
       dbt.months_to_maturity,
       COALESCE(dbt.is_distressed, false) AS is_distressed,
       CASE WHEN dbt.entity_id IS NOT NULL AND dev.entity_id IS NOT NULL THEN 'debt+value_creation_developer'
            WHEN dbt.entity_id IS NOT NULL THEN 'debt'
            WHEN dev.entity_id IS NOT NULL THEN 'value_creation_developer'
            -- NOT `none`. Death and divorce are not measurable from anything we hold;
            -- saying "no reason to sell" would assert an absence we never tested.
            ELSE 'reason_to_sell_unmeasured' END AS reason_to_sell,

       -- REACH.
       CASE WHEN rc.is_touched THEN 'touched'
            WHEN rc.owner_id IS NULL THEN 'no_linked_person'
            WHEN ip.entity_id IS NOT NULL THEN 'in_pipeline_untouched'
            ELSE 'never_touched' END AS reach_state,
       (rc.owner_id IS NOT NULL) AS has_linked_person,

       -- RANK. Client value first, then lease recency (years into term ASC). NULL, never
       -- 0, when unpriced -- so a surface can render an em-dash rather than "$0" (P180).
       round(g.value)::numeric AS rank_value,

       -- PRI2-on: whether a RECORDED reason to sell (debt maturity or a developer role)
       -- is on file, as its own boolean -- the ordering key. `reason_to_sell` is never
       -- NULL (it always resolves, including to the explicit 'reason_to_sell_unmeasured'
       -- state), so this is boolean NOT NULL, never a third state.
       (CASE WHEN dbt.entity_id IS NOT NULL AND dev.entity_id IS NOT NULL THEN 'debt+value_creation_developer'
             WHEN dbt.entity_id IS NOT NULL THEN 'debt'
             WHEN dev.entity_id IS NOT NULL THEN 'value_creation_developer'
             ELSE 'reason_to_sell_unmeasured' END) <> 'reason_to_sell_unmeasured' AS reason_measured
  FROM gated g
  LEFT JOIN debt dbt ON dbt.entity_id = g.entity_id
                    AND dbt.source_domain = g.source_domain
                    AND dbt.source_property_id = g.source_property_id
  LEFT JOIN dev  ON dev.entity_id = g.entity_id
  LEFT JOIN reach rc ON rc.owner_id = g.entity_id
  LEFT JOIN in_pipeline ip ON ip.entity_id = g.entity_id;

COMMENT ON VIEW public.v_lcc_seller_prospect_universe IS
  'UX-T1a-queue: every current (owner, property) holding with the doctrine gates as named '
  'columns. value_unknown / term_unknown / no_linked_person are STATES, never 0 or false. '
  'reason_to_sell carries recorded signals only -- death and divorce are unmeasured, not '
  'absent. reason_measured (PRI2-on) is the same condition as a boolean, for ordering.';

-- ---------------------------------------------------------------------------
-- The operator population: VARIANT F (audit §1). Unchanged predicate -- PRI2-on
-- reorders, it does not re-select. `SELECT *` picks up reason_measured for free.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_seller_prospect_queue AS
SELECT *
  FROM public.v_lcc_seller_prospect_universe
 WHERE in_band IS TRUE
   AND (newer_lease IS TRUE OR reason_to_sell <> 'reason_to_sell_unmeasured')
   AND reach_state <> 'touched';

COMMENT ON VIEW public.v_lcc_seller_prospect_queue IS
  'UX-T1a-queue variant F: in band AND (newer lease OR a recorded reason to sell) AND not '
  'yet reached. Grain is (owner, property): 756 properties carry >1 current owner (OWN-T0), '
  'so one asset can emit two rows. Default order (PRI2-on): reason_measured DESC, '
  'rank_value DESC, years_into_term ASC -- see api/_shared/seller-prospect-queue.js.';

GRANT SELECT ON public.v_lcc_seller_prospect_universe,
                public.v_lcc_seller_prospect_queue
   TO authenticated, service_role;
