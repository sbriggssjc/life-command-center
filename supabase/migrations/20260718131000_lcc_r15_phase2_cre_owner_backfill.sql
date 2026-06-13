-- ============================================================================
-- R15 Phase 2 — CRE owner backfill: cross-asset overlap view + cron  ·  LCC Opps
--
-- Phase 1 stood up the generic CRE registry (lcc_cre_properties +
-- lcc_cre_property_documents) and mints the owner only on the OM/master-sheet
-- ENRICH path; the light-attach path registers by path anchor and leaves
-- owner_entity_id NULL. Phase 2 backfills those owners from the property's best
-- owner-bearing doc (the xlsx master sheet, dominant in the CRE universe).
--
-- This migration is the DB half:
--   (1) v_lcc_cre_cross_asset_owners — the payoff. Owners who appear BOTH as a
--       CRE owner (lcc_cre_properties.owner_entity_id) AND as a dia/gov owner
--       (lcc_entity_portfolio_facts.entity_id) — the unified cross-asset-class
--       footprint that justified the registry. Read-only, SECURITY INVOKER.
--   (2) cron lcc-cre-owner-backfill — gentle */15 drain of the worker endpoint.
--
-- Additive + idempotent. Drop the view + unschedule the cron → zero trace.
-- The /api/cre-owner-backfill route ships on the Railway redeploy; the cron is
-- a no-op (graceful) until then and when the null-owner queue is empty —
-- endpoint-before-cron, the standing rule (apply this AFTER the deploy).
-- ============================================================================

-- ---- Unit 4: the cross-asset overlap view ----------------------------------
CREATE OR REPLACE VIEW public.v_lcc_cre_cross_asset_owners
WITH (security_invoker = true) AS
WITH cre AS (
  SELECT
    owner_entity_id                      AS entity_id,
    count(*)                             AS cre_property_count,
    array_agg(DISTINCT asset_class)      AS cre_asset_classes
  FROM public.lcc_cre_properties
  WHERE owner_entity_id IS NOT NULL
  GROUP BY owner_entity_id
),
dom AS (
  SELECT
    entity_id,
    count(*)                                                       AS domain_property_count,
    count(*) FILTER (WHERE is_current)                             AS current_domain_property_count,
    count(*) FILTER (WHERE source_domain = 'dia')                  AS dia_property_count,
    count(*) FILTER (WHERE source_domain = 'gov')                  AS gov_property_count,
    COALESCE(sum(annual_rent) FILTER (WHERE is_current), 0)        AS domain_annual_rent
  FROM public.lcc_entity_portfolio_facts
  GROUP BY entity_id
)
SELECT
  e.id                                                            AS entity_id,
  e.name                                                          AS entity_name,
  e.domain                                                        AS primary_domain,
  cre.cre_property_count,
  cre.cre_asset_classes,
  dom.domain_property_count,
  dom.current_domain_property_count,
  dom.dia_property_count,
  dom.gov_property_count,
  dom.domain_annual_rent,
  (cre.cre_property_count + dom.domain_property_count)            AS total_relationship_footprint
FROM cre
JOIN dom            ON dom.entity_id = cre.entity_id
JOIN public.entities e ON e.id = cre.entity_id
ORDER BY dom.domain_annual_rent DESC NULLS LAST, total_relationship_footprint DESC;

GRANT SELECT ON public.v_lcc_cre_cross_asset_owners TO authenticated;

COMMENT ON VIEW public.v_lcc_cre_cross_asset_owners IS
  'R15 Phase 2: owners present BOTH as a CRE owner (lcc_cre_properties.owner_entity_id) AND as a dia/gov portfolio owner — the unified cross-asset-class footprint. Read-only.';

-- ---- Unit 3: the gentle backfill cron --------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Idempotent: unschedule-then-schedule. Gentle */15 cadence (artifact-offload
    -- lesson), limit=15 per tick. No-op safe when the null-owner queue is empty
    -- and graceful when SHAREPOINT_FETCH_URL is unset (worker returns cleanly).
    begin perform cron.unschedule('lcc-cre-owner-backfill'); exception when others then null; end;
    perform cron.schedule(
      'lcc-cre-owner-backfill',
      '7-59/15 * * * *',
      $cmd$select public.lcc_cron_post('/api/cre-owner-backfill?limit=15', '{}'::jsonb, 'vercel')$cmd$
    );
  end if;
end $$;
