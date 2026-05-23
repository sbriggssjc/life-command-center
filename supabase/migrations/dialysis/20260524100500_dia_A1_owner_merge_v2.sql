-- ============================================================================
-- 20260524100500_dia_A1_owner_merge_v2.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — A1 hotfix
--
-- First A1-dia run hit unique_violation on llc_research_queue:
--   llc_research_queue.recorded_owner_id has a UNIQUE constraint, so
--   when the survivor already has a queue row, UPDATE-ing the loser's
--   recorded_owner_id to survivor's value collides.
--
-- Fix: when the survivor already has a queue row, DELETE the loser's
-- queue row instead of trying to repoint it. Queue rows are per-owner
-- (one row at a time, awaiting SOS enrichment), so consolidation is
-- safe — the survivor's queue row stays, the loser's queue row is
-- dropped (its work is covered by the survivor's row).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_owner_merge(
  p_survivor_id   UUID,
  p_loser_id      UUID,
  p_canonical_key TEXT DEFAULT NULL,
  p_run_id        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_survivor_name TEXT;
  v_loser_name    TEXT;
  v_counts        JSONB := '{}'::jsonb;
  v_n             BIGINT;
  v_survivor_has_queue BOOLEAN;
BEGIN
  IF p_survivor_id = p_loser_id THEN
    RAISE EXCEPTION '[apply_owner_merge] survivor and loser must differ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recorded_owners WHERE recorded_owner_id = p_survivor_id) THEN
    RAISE EXCEPTION '[apply_owner_merge] survivor % does not exist', p_survivor_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recorded_owners WHERE recorded_owner_id = p_loser_id) THEN
    RAISE EXCEPTION '[apply_owner_merge] loser % does not exist', p_loser_id;
  END IF;

  SELECT name INTO v_survivor_name FROM public.recorded_owners WHERE recorded_owner_id = p_survivor_id;
  SELECT name INTO v_loser_name    FROM public.recorded_owners WHERE recorded_owner_id = p_loser_id;

  WITH r AS (UPDATE public.properties SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING property_id)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('properties', v_n);

  WITH r AS (UPDATE public.sales_transactions SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING sale_id)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('sales_transactions', v_n);

  WITH r AS (UPDATE public.available_listings SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING listing_id)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('available_listings', v_n);

  WITH r AS (UPDATE public.medicare_clinics SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING medicare_id)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('medicare_clinics', v_n);

  WITH r AS (UPDATE public.ownership_history SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING ownership_id)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('ownership_history', v_n);

  WITH r AS (UPDATE public.loans SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING loan_id)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('loans', v_n);

  WITH r AS (UPDATE public.registered_entities SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING entity_id)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('registered_entities', v_n);

  -- llc_research_queue.recorded_owner_id has a UNIQUE constraint. If the
  -- survivor already has a queue row, DELETE the loser's queue row instead
  -- of trying to repoint it. The survivor's queue row (which is older or
  -- equivalent) takes precedence.
  SELECT EXISTS (
    SELECT 1 FROM public.llc_research_queue WHERE recorded_owner_id = p_survivor_id
  ) INTO v_survivor_has_queue;

  IF v_survivor_has_queue THEN
    WITH r AS (
      DELETE FROM public.llc_research_queue
       WHERE recorded_owner_id = p_loser_id RETURNING queue_id
    ) SELECT COUNT(*) INTO v_n FROM r;
    v_counts := v_counts || jsonb_build_object('llc_research_queue_deleted', v_n);
  ELSE
    WITH r AS (
      UPDATE public.llc_research_queue SET recorded_owner_id = p_survivor_id
       WHERE recorded_owner_id = p_loser_id RETURNING queue_id
    ) SELECT COUNT(*) INTO v_n FROM r;
    v_counts := v_counts || jsonb_build_object('llc_research_queue', v_n);
  END IF;

  WITH r AS (UPDATE public.contacts SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING contact_id)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('contacts', v_n);

  UPDATE public.recorded_owners s
     SET address                  = COALESCE(s.address,                  l.address),
         city                     = COALESCE(s.city,                     l.city),
         state                    = COALESCE(s.state,                    l.state),
         normalized_address       = COALESCE(s.normalized_address,       l.normalized_address),
         state_of_incorporation   = COALESCE(s.state_of_incorporation,   l.state_of_incorporation),
         registered_agent_name    = COALESCE(s.registered_agent_name,    l.registered_agent_name),
         registered_agent_address = COALESCE(s.registered_agent_address, l.registered_agent_address),
         entity_type              = COALESCE(s.entity_type,              l.entity_type),
         manager_name             = COALESCE(s.manager_name,             l.manager_name),
         manager_role             = COALESCE(s.manager_role,             l.manager_role),
         filing_id                = COALESCE(s.filing_id,                l.filing_id),
         filing_date              = COALESCE(s.filing_date,              l.filing_date),
         filing_status            = COALESCE(s.filing_status,            l.filing_status),
         llc_research_at          = COALESCE(s.llc_research_at,          l.llc_research_at),
         llc_research_source      = COALESCE(s.llc_research_source,      l.llc_research_source)
    FROM public.recorded_owners l
   WHERE s.recorded_owner_id = p_survivor_id AND l.recorded_owner_id = p_loser_id;

  UPDATE public.recorded_owners
     SET merged_into_recorded_owner_id = p_survivor_id,
         updated_at                    = now()
   WHERE recorded_owner_id = p_loser_id;

  INSERT INTO public.dq5_owner_merge_map (canonical_key, survivor_id, duplicate_id, survivor_name, duplicate_name)
  VALUES (COALESCE(p_canonical_key, v_survivor_name), p_survivor_id, p_loser_id, v_survivor_name, v_loser_name)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.dq5_owner_merge_log (table_name, fk_column, row_pk, old_owner_id, new_owner_id)
  VALUES ('A1_run', 'recorded_owner_id', COALESCE(p_run_id, 'manual'), p_loser_id, p_survivor_id);

  RETURN v_counts;
END;
$$;

COMMENT ON FUNCTION public.apply_owner_merge IS
  'A1 v2: merge a duplicate recorded_owner into a survivor. v2 handles llc_research_queue.recorded_owner_id UNIQUE constraint by deleting the loser queue row when the survivor already has one.';
