-- ===========================================================================
-- P127 -- the top seller prospects in the space, and whether we pursue them
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- ===========================================================================
-- Objective (Scott): "get to pursuit of ALL of the top seller prospects in the
-- space (government and dialysis today) ... push all our efforts toward the top
-- prospects REGARDLESS of what's in Salesforce yet or not."
--
-- That reframes the work away from importing Salesforce. SF holds one slice of
-- the book and measurably not the best slice: of the 71 contacts Scott actively
-- pursues there, 63 are unknown to LCC entirely, while LCC runs 1,948 cadences
-- largely on people he is NOT pursuing. Neither list is the target list. The
-- target list is "who owns the most rent in gov + dia."
--
-- Today's work made that computable for the first time:
--   P117  bridged lcc_property_owner -> lcc_entity_portfolio_facts so owners
--         finally carry portfolio rent (1,929 rows)
--   P117a guarded that feeder against brokerages, operators, junk placeholders
--         and federal agencies -- the four things that are not principals
--   P126  linked cadences to their SF contact, so "are we pursuing them" is
--         answerable at all
--
-- MEASURED THE MOMENT IT COULD BE ASKED:
--   owners carrying portfolio rent ............. 4,417
--   ... real (not brokerage/operator/junk) ..... 4,393
--   pursuing ...................................   198   $1.09B
--   READY - reachable, NOT pursued .............   312   $97,571,892
--   needs a contact first ...................... 3,883   $2.72B
--
-- Top of the READY list: CIM Group $5.3M, JBG Smith $5.3M, AEI Capital $4.0M
-- (25 dia assets), Woodbranch $1.7M, Blue Onyx $1.6M -- every one with a live
-- contact route and no cadence.
--
-- The $2.72B "needs a contact first" bucket is the honest headline: the ranking
-- is not contact-limited by accident, it is contact-limited by fact. That bucket
-- is what the ownership-resolution and contact-acquisition work exists to drain,
-- and this view makes its value visible for the first time.
--
-- GATES reuse the existing single definitions, never re-implemented:
--   lcc_owner_name_is_brokerage  (agent, never principal -- P116)
--   lcc_is_operator_owner_name   (tenant, never landlord -- P113)
--   junk_name_flagged            (capture placeholders -- P119/P120)
--   lcc_entity_cadence_reachable (surfaced as a COLUMN, not a filter, so a
--                                 valuable-but-unreachable owner stays visible
--                                 as a research target instead of vanishing)
--
-- ORDERING ONLY. Creates nothing, seeds no cadence, writes to no table.
-- REVERSAL: DROP VIEW v_lcc_top_seller_prospects;
-- ===========================================================================

CREATE OR REPLACE VIEW v_lcc_top_seller_prospects AS
WITH portfolio AS (
  SELECT f.entity_id,
         sum(f.annual_rent)                    AS annual_rent,
         count(*)                              AS asset_count,
         string_agg(DISTINCT f.source_domain, '/' ORDER BY f.source_domain) AS domains
  FROM public.lcc_entity_portfolio_facts f
  WHERE f.is_current
  GROUP BY f.entity_id
)
SELECT
  e.id                                        AS entity_id,
  e.name                                      AS owner_name,
  p.annual_rent,
  p.asset_count,
  p.domains,
  public.lcc_entity_cadence_reachable(e.id)   AS reachable,
  COALESCE(e.email, (
    SELECT x.email FROM public.entities x
    JOIN public.entity_relationships r ON r.to_entity_id = x.id
    WHERE r.from_entity_id = e.id AND x.email IS NOT NULL
    LIMIT 1))                                 AS contact_route,
  EXISTS (SELECT 1 FROM public.touchpoint_cadence t WHERE t.entity_id = e.id) AS on_cadence,
  (SELECT t.sf_contact_id FROM public.touchpoint_cadence t
    WHERE t.entity_id = e.id AND t.sf_contact_id IS NOT NULL LIMIT 1)         AS sf_contact_id,
  (SELECT count(*) FROM public.lcc_property_owner o WHERE o.owner_entity_id = e.id) AS owned_assets_resolved,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.touchpoint_cadence t WHERE t.entity_id = e.id)
      THEN 'pursuing'
    WHEN public.lcc_entity_cadence_reachable(e.id)
      THEN 'READY — reachable, not pursued'
    ELSE 'needs a contact first'
  END                                          AS pursuit_status
FROM portfolio p
JOIN public.entities e ON e.id = p.entity_id
WHERE p.annual_rent > 0
  AND NOT public.lcc_owner_name_is_brokerage(e.name)
  AND NOT public.lcc_is_operator_owner_name(e.name)
  AND COALESCE(e.metadata->>'junk_name_flagged','') <> 'true';

COMMENT ON VIEW v_lcc_top_seller_prospects IS
  'P127: top seller prospects in gov + dia ranked by portfolio annual rent, with pursuit status. pursuit_status READY = reachable and not on a cadence (the actionable set). Brokerages, operators and junk placeholders excluded by the same single definitions the feeders use. Read-only.';

GRANT SELECT ON v_lcc_top_seller_prospects TO anon, authenticated, service_role;
