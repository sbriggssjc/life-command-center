-- ============================================================================
-- 20260522190100_lcc_bd_opportunities.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 9 (SF Opportunity mirror schema)
--
-- Creates the local mirror of Salesforce Opportunity records. This is the
-- BD anchor object — per audit §2.6, the unit of BD tracking is
-- (canonical entity × open Opportunity), and the priority queue's P0/P0.5
-- bands depend on Opportunity state.
--
-- This migration creates the SCHEMA only. The actual SF sync (read-only
-- mirror via hourly pull) is a deferred follow-up. Schema-first lets the
-- priority queue (Topic 5) be built against the model now.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bd_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,                  -- LCC workspace (nullable until SF sync wired)
  entity_id UUID,                     -- canonical LCC entities.id (the prospect)
  sf_opp_id TEXT,                     -- Salesforce Opportunity Id (External)
  type TEXT CHECK (type IS NULL OR type IN ('prospect', 'buyer', 'other')),
  stage TEXT,                         -- SF stage name (e.g., 'Prospecting', 'Closed Won')
  is_open BOOLEAN GENERATED ALWAYS AS (closed_at IS NULL) STORED,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_won BOOLEAN,
  vertical TEXT,                      -- 'dia', 'gov', 'asc', etc.
  owner_user_id UUID,                 -- LCC user_id assigned (FK to users.id)
  amount NUMERIC,
  expected_close_date DATE,
  last_synced_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, sf_opp_id)
);

CREATE INDEX IF NOT EXISTS idx_bd_opportunities_entity
  ON public.bd_opportunities (entity_id) WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bd_opportunities_open_by_owner
  ON public.bd_opportunities (owner_user_id, is_open)
  WHERE is_open = TRUE;

CREATE INDEX IF NOT EXISTS idx_bd_opportunities_open_by_entity
  ON public.bd_opportunities (entity_id, is_open)
  WHERE is_open = TRUE;

CREATE INDEX IF NOT EXISTS idx_bd_opportunities_type_open
  ON public.bd_opportunities (type, is_open)
  WHERE is_open = TRUE;

COMMENT ON TABLE public.bd_opportunities IS
  'DEVELOPER_BD_AUDIT_v3 §2.6 Topic 9. Local mirror of Salesforce '
  'Opportunity records. The BD scoreboard anchor — the priority queue '
  '(Topic 5) gates BD touchpoints on (entity × open Prospect Opportunity).';

COMMENT ON COLUMN public.bd_opportunities.type IS
  'Per audit §2.6: ''prospect'' (counts toward BD scoreboard), ''buyer'' '
  '(showing-stream only, not BD scoreboard), ''other''.';

COMMENT ON COLUMN public.bd_opportunities.is_open IS
  'Derived: TRUE when closed_at IS NULL. Open Opportunities anchor the '
  'priority queue''s P0/P0.5 bands.';

-- Helper view: open Prospect Opps per entity
CREATE OR REPLACE VIEW public.v_bd_open_prospect_opportunities AS
SELECT
  entity_id,
  COUNT(*) AS open_prospect_opp_count,
  MIN(opened_at) AS oldest_open_at,
  MAX(opened_at) AS newest_open_at,
  array_agg(owner_user_id) FILTER (WHERE owner_user_id IS NOT NULL) AS owner_user_ids,
  array_agg(vertical) FILTER (WHERE vertical IS NOT NULL) AS verticals
FROM public.bd_opportunities
WHERE is_open = TRUE AND type = 'prospect'
GROUP BY entity_id;

ALTER VIEW public.v_bd_open_prospect_opportunities SET (security_invoker = true);

COMMENT ON VIEW public.v_bd_open_prospect_opportunities IS
  'DEVELOPER_BD_AUDIT_v3 §4 Topic 9 helper. Per-entity open Prospect '
  'Opportunity rollup. Used by the priority queue to gate BD-track items '
  'and surface ''Open BD Opportunity Needed'' tasks (P0.5 band) for '
  'developers without an open Opp.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.bd_opportunities_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bd_opportunities_updated_at ON public.bd_opportunities;
CREATE TRIGGER trg_bd_opportunities_updated_at
  BEFORE UPDATE ON public.bd_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.bd_opportunities_set_updated_at();
