-- Topic A3 (audit §11.23): cross-vertical entity portfolio facts table +
-- per-entity rollup view.
--
-- Per-(entity_id, source_domain, source_property_id) row recording each
-- ownership edge pulled from dia/gov ownership_history. Source property
-- ids are text-typed so dia integer ids and gov bigint ids coexist
-- without conversion friction.
--
-- v_entity_portfolio_all rolls these up per entity into the counts/lists
-- the priority queue and BD console need: total properties, current vs
-- former, cross-vertical flag, earliest/latest acquisition.
--
-- The companion migration 20260522230100 adds the recurring pg_net sync
-- (lcc_sync_entity_portfolios / lcc_finalize_entity_portfolios) plus the
-- enriched v_priority_queue_enriched view.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lcc_entity_portfolio_facts (
  entity_id            uuid NOT NULL,
  source_domain        text NOT NULL CHECK (source_domain IN ('dia','gov')),
  source_property_id   text NOT NULL,
  ownership_start_date date,
  ownership_end_date   date,
  is_current           boolean GENERATED ALWAYS AS (ownership_end_date IS NULL) STORED,
  annual_rent          numeric,
  sale_price           numeric,
  cap_rate             numeric,
  ownership_source     text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, source_domain, source_property_id)
);

CREATE INDEX IF NOT EXISTS idx_lcc_portfolio_facts_entity
  ON public.lcc_entity_portfolio_facts(entity_id);

CREATE INDEX IF NOT EXISTS idx_lcc_portfolio_facts_domain_property
  ON public.lcc_entity_portfolio_facts(source_domain, source_property_id);

CREATE INDEX IF NOT EXISTS idx_lcc_portfolio_facts_current
  ON public.lcc_entity_portfolio_facts(entity_id)
  WHERE is_current = true;

COMMENT ON TABLE public.lcc_entity_portfolio_facts IS
  'Cross-vertical owner→property edges, populated from dia/gov '
  'ownership_history via lcc_sync_entity_portfolios()/lcc_finalize_entity'
  '_portfolios(). One row per distinct (entity, domain, property); when '
  'multiple ownership periods exist for the same edge, the earliest '
  'start and latest end win.';

CREATE OR REPLACE VIEW public.v_entity_portfolio_all
WITH (security_invoker = true) AS
SELECT
  e.id                                                                AS entity_id,
  e.workspace_id,
  e.name,
  e.owner_role,
  e.owner_role_source,
  e.domain                                                            AS primary_domain,
  COALESCE(COUNT(f.source_property_id), 0)                            AS total_property_count,
  COALESCE(COUNT(f.source_property_id) FILTER (WHERE f.is_current), 0) AS current_property_count,
  COALESCE(COUNT(f.source_property_id) FILTER (WHERE f.source_domain = 'dia'), 0) AS dia_property_count,
  COALESCE(COUNT(f.source_property_id) FILTER (WHERE f.source_domain = 'gov'), 0) AS gov_property_count,
  COALESCE(
    ARRAY_AGG(f.source_property_id) FILTER (WHERE f.source_domain = 'dia'),
    ARRAY[]::text[]
  ) AS dia_property_ids,
  COALESCE(
    ARRAY_AGG(f.source_property_id) FILTER (WHERE f.source_domain = 'gov'),
    ARRAY[]::text[]
  ) AS gov_property_ids,
  MIN(f.ownership_start_date)                                         AS earliest_acquisition_date,
  MAX(f.ownership_start_date)                                         AS latest_acquisition_date,
  MAX(f.ownership_end_date)                                           AS latest_disposition_date,
  COUNT(DISTINCT f.source_domain) >= 2                                AS is_cross_vertical,
  COALESCE(SUM(f.annual_rent) FILTER (WHERE f.is_current), 0)         AS current_annual_rent_total,
  COALESCE(AVG(f.cap_rate) FILTER (WHERE f.cap_rate IS NOT NULL), 0)  AS avg_cap_rate
FROM public.entities e
LEFT JOIN public.lcc_entity_portfolio_facts f
  ON f.entity_id = e.id
WHERE e.entity_type = 'organization'
GROUP BY e.id, e.workspace_id, e.name, e.owner_role, e.owner_role_source, e.domain;

GRANT SELECT ON public.v_entity_portfolio_all TO authenticated;

COMMIT;
