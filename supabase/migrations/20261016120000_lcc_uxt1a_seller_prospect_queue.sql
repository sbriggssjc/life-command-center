-- UX-T1a-queue -- the doctrine's seller queue as ONE view, gates as NAMED COLUMNS.
--
-- Doctrine: docs/os/canon/blocks/operator-doctrine.md 1.8.0 ("The queue, quantified").
-- Part A measurement: docs/audits/UX_T1a_SELLER_QUEUE_MEASUREMENT_2026-09.md.
-- Both coverage gates were closed by UX-T1a-gates (dia lease dates mirrored; loan
-- maturity owner-attributed), which is what unblocked this view.
--
-- THREE OBJECTS, one definition of every gate:
--   v_lcc_seller_prospect_universe  -- all 8,858 current holdings, every gate as a column
--   v_lcc_seller_prospect_queue     -- variant F: in band AND (newer lease OR reason) AND not touched
--   v_lcc_seller_prospect_queue_summary -- the funnel, each count equal to rows a filter would show
--
-- ============================ WHAT THIS VIEW REFUSES ============================
-- reason_to_sell carries ONLY RECORDED signals: `debt` (a mirrored loan maturing
-- within 24 months) and `value_creation_developer` (the recorded `developer` role).
-- Death and divorce are reachable today only through NEW LEXICAL RULES, and the
-- audit's own measurement regex false-positived at 42% on first contact (§5c: 111 of
-- 265 matched on the phrase "REAL ESTATE"). This repo has measured comparable lexical
-- arms at 25% (P189), 7% (P198) and 4-of-6 (P196) and refused all of them. An owner
-- with neither recorded signal reads `reason_to_sell_unmeasured` -- an explicit STATE,
-- never `false` and never an empty inference. UX-T1a-regex stays refused until graded.
--
-- ============================ THE STATES THAT ARE NOT ZERO ============================
-- value_unknown  (1,608 rows / 18.2%) -- `value` is NULL and `in_band` is NULL, never
--                0 and never false. P180: a value nobody can size is not a worthless one.
-- term_unknown   -- gov with no commencement and no firm term; dia with no lease dates
--                at all (2,127 -> 1,252 after UX-T1a-gates). `newer_lease` is NULL here,
--                never false: "we cannot tell" is not "the lease is old".
-- no_linked_person -- its own reach_state. 847 of 6,480 owners have a linked person, so
--                the binding constraint is missing LINKS, not missing touches (C11).
--                Folding it into `never_touched` would report a prospecting gap where
--                the real gap is a data gap.
--
-- ============================ THE VALUE LADDER (audit §2) ============================
-- Domain-aware BY MEASUREMENT, not by taste: dia carries ZERO noi (noi_p50 null on all
-- 2,127 dia current facts), and gov's NOI/rent ratio is 0.703 -- the documented FS
-- haircut (gov CLAUDE.md §12). One expression across both domains would be wrong for one.
--   gov  noi / cap                      (6,002 rows)
--   dia  annual_rent / cap              (1,203) -- dia rent is net NNN (dia CLAUDE.md)
--   gov  annual_rent * 0.703 / cap      (45) -- gov without an NOI
--   else value_unknown                  (1,608)
-- cap: the asset's own cap_rate when in [0.03,0.15], else the measured domain median
-- (dia 0.0632 n=96 / gov 0.0755 n=727).
--
-- ⚠️ `lcc_entity_portfolio_facts.sale_price` IS DELIBERATELY NOT THE BAND VALUE. It is
-- a PORTFOLIO trade price attributed to each property individually: the derived/actual
-- ratio p50 runs 0.949 where one property carries the price and 0.164 where 5+ share it
-- (audit §2b). The literal reading of "the individual property sale price" would admit
-- large portfolio assets as if they were band deals.
-- ⚠️ AND DO NOT VALIDATE THIS LADDER AGAINST sale_price WITHOUT EXCLUDING ROWS THAT
-- CARRY THEIR OWN cap_rate -- gov derives noi = price x cap, so dividing back is a
-- tautology that reads as a clean p75 of exactly 1.000 (audit §2a, Class 11).
--
-- ============================ NEWER LEASE (canon §0b.1) ============================
-- Relative to the SWIMLANE's standard initial term, not an absolute number of years.
--   gov_within_first_3y_firm -- commencement within 3 years AND firm term remaining > 0.
--        gov's measure is FIRM term (the years free of the government's termination
--        right); "within the first 2-3 years of it" is elapsed-since-commencement while
--        firm term is still running.
--   dia_ge_12y_remaining     -- >= 12 years remaining against the measured 15-year
--        new-build standard (initial_term_years p50 14.9 / p90 15.1 over the 1,747
--        live-lease properties -- Scott's stated standard, reproduced).
--   dia_within_first_3y      -- the primary §0b.1 wording, applied directly.
-- ⚠️ dia's new-build / retrofit lane split has NO RECORDED FACT (dia `properties` has no
-- is_build_to_suit -- that is gov-only) and the year_built-vs-lease-start proxy was
-- measured and DOES NOT DISCRIMINATE (median initial term 15.0 in all three buckets,
-- audit §4c). The uniform measured standard is applied; no classifier is invented.
--
-- ============================ REACH (canon §0b.4, audit §6a) ============================
-- Both obvious definitions are wrong, in opposite directions:
--   owner-entity events only            -> 19 owners. A FALSE FLOOR: touches land on the
--                                          PERSON, not the owner (C11/P188).
--   any linked entity's events          -> 1,024. A FALSE CEILING: it imports ASSET-entity
--                                          events, which are machine-written
--                                          (rca_deed_record 4,687, intake_om 4,164,
--                                          copilot_action 3,547). ~990 of those owners were
--                                          "reached" only by a system event on a building.
-- Used here: a linked PERSON entity, and only human categories (email/call/meeting) --
-- 33 owners. Reach is a CATEGORY question as well as an entity-type one.
-- `in_pipeline_untouched` is NOT touched: §0b.4 says "no touchpoint ever attempted by
-- anyone on the team, OR not in the LCC BD pipeline at all" -- the first clause stands on
-- its own, so a cadence row with no touch still qualifies.
--
-- ============================ GRAIN ============================
-- ONE ROW PER (owner entity, property). Rows != assets != owners, and the gap is
-- structural: 756 properties carry more than one current owner (OWN-T0's sponsor<->SPE
-- class), so one asset can legitimately emit two rows. `owners_on_asset` rides on the row
-- so a surface can say so instead of the operator meeting the same building twice.
-- Live 2026-09-03: 615 rows / 461 owners / 550 properties.
--
-- Guards positive-controlled (a guard that catches nothing is indistinguishable from one
-- that does not work): tombstone / brokerage / placeholder / not-prospected fire on
-- 0 / 2 / 0 / 3 of the 620 unguarded queue rows here, and on 813 / 100 / 629 of 66,941
-- live entities fleet-wide. The near-zero is this population's property.
--
-- Reverse: DROP VIEW v_lcc_seller_prospect_queue_summary, v_lcc_seller_prospect_queue,
--          v_lcc_seller_prospect_universe;  (nothing else reads them; no data is written)

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
       round(g.value)::numeric AS rank_value
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
  'reason_to_sell carries recorded signals only -- death and divorce are unmeasured, not absent.';

-- ---------------------------------------------------------------------------
-- The operator population: VARIANT F (audit §1).
-- (newer lease OR a reason to sell), not both -- §0.3 lists them as characteristics of
-- the sweet spot, and a maturing loan on a MID-TERM lease is a strong prospect that the
-- both-required variant A excludes. F is also the only variant an operator can work down
-- over a quarter (variant A is 23 rows; D is 2,830).
-- `newer_lease` NULL (term_unknown) does not admit a row -- an unknown gate is not a
-- passing gate -- but such a row still enters on a recorded reason to sell.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_seller_prospect_queue AS
SELECT *
  FROM public.v_lcc_seller_prospect_universe
 WHERE in_band IS TRUE
   AND (newer_lease IS TRUE OR reason_to_sell <> 'reason_to_sell_unmeasured')
   AND reach_state <> 'touched';

COMMENT ON VIEW public.v_lcc_seller_prospect_queue IS
  'UX-T1a-queue variant F: in band AND (newer lease OR a recorded reason to sell) AND not '
  'yet reached. 615 rows / 461 owners / 550 properties on 2026-09-03. Grain is (owner, '
  'property): 756 properties carry >1 current owner (OWN-T0), so one asset can emit two rows.';

-- ---------------------------------------------------------------------------
-- The funnel, so the excluded populations stay visible rather than silently vanishing.
-- Every count here equals the rows a filter over the universe would show -- an honest
-- badge, not a producer tally.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_seller_prospect_queue_summary AS
SELECT 'universe'              AS bucket, count(*) AS rows, count(DISTINCT entity_id) AS owners FROM public.v_lcc_seller_prospect_universe
UNION ALL SELECT 'value_unknown',        count(*), count(DISTINCT entity_id) FROM public.v_lcc_seller_prospect_universe WHERE value_basis = 'value_unknown'
UNION ALL SELECT 'in_band',              count(*), count(DISTINCT entity_id) FROM public.v_lcc_seller_prospect_universe WHERE in_band IS TRUE
UNION ALL SELECT 'in_band_term_unknown', count(*), count(DISTINCT entity_id) FROM public.v_lcc_seller_prospect_universe WHERE in_band IS TRUE AND newer_lease IS NULL
UNION ALL SELECT 'in_band_older_lease',  count(*), count(DISTINCT entity_id) FROM public.v_lcc_seller_prospect_universe WHERE in_band IS TRUE AND newer_lease IS FALSE
UNION ALL SELECT 'in_band_newer_lease',  count(*), count(DISTINCT entity_id) FROM public.v_lcc_seller_prospect_universe WHERE in_band IS TRUE AND newer_lease IS TRUE
UNION ALL SELECT 'in_band_reason_debt',  count(*), count(DISTINCT entity_id) FROM public.v_lcc_seller_prospect_universe WHERE in_band IS TRUE AND reason_debt
UNION ALL SELECT 'in_band_reason_developer', count(*), count(DISTINCT entity_id) FROM public.v_lcc_seller_prospect_universe WHERE in_band IS TRUE AND reason_value_creation_developer
UNION ALL SELECT 'variant_f_before_reach', count(*), count(DISTINCT entity_id) FROM public.v_lcc_seller_prospect_universe WHERE in_band IS TRUE AND (newer_lease IS TRUE OR reason_to_sell <> 'reason_to_sell_unmeasured')
UNION ALL SELECT 'excluded_touched',     count(*), count(DISTINCT entity_id) FROM public.v_lcc_seller_prospect_universe WHERE in_band IS TRUE AND (newer_lease IS TRUE OR reason_to_sell <> 'reason_to_sell_unmeasured') AND reach_state = 'touched'
UNION ALL SELECT 'queue',                count(*), count(DISTINCT entity_id) FROM public.v_lcc_seller_prospect_queue;

COMMENT ON VIEW public.v_lcc_seller_prospect_queue_summary IS
  'UX-T1a-queue funnel. Each count equals the rows a filter over the universe would show.';

GRANT SELECT ON public.v_lcc_seller_prospect_universe,
                public.v_lcc_seller_prospect_queue,
                public.v_lcc_seller_prospect_queue_summary
   TO authenticated, service_role;
