-- ============================================================================
-- 20260524100500_gov_A1_owner_merge_v2.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — A1 hotfix (gov)
--
-- First gov A1 run hit unique_violation on uq_recorded_owners_canonical
-- (canonical_name, COALESCE(state, '')). When survivor and loser share the
-- same canonical_name (which is the grouping basis), backfilling survivor.state
-- from loser.state would create a duplicate (canonical_name, state) pair while
-- the loser still occupies that slot.
--
-- Fix: drop state and canonical_name from the COALESCE field-merge. They're
-- not useful for survivor enrichment anyway — both rows share canonical_name
-- (by construction), and state is usually the address state already populated
-- on the survivor.
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

  WITH r AS (UPDATE public.ownership_history SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING ownership_id)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('ownership_history', v_n);

  SELECT EXISTS (SELECT 1 FROM public.llc_research_queue WHERE recorded_owner_id = p_survivor_id) INTO v_survivor_has_queue;
  IF v_survivor_has_queue THEN
    WITH r AS (DELETE FROM public.llc_research_queue WHERE recorded_owner_id = p_loser_id RETURNING queue_id)
    SELECT COUNT(*) INTO v_n FROM r;
    v_counts := v_counts || jsonb_build_object('llc_research_queue_deleted', v_n);
  ELSE
    WITH r AS (UPDATE public.llc_research_queue SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING queue_id)
    SELECT COUNT(*) INTO v_n FROM r;
    v_counts := v_counts || jsonb_build_object('llc_research_queue', v_n);
  END IF;

  WITH r AS (UPDATE public.contacts SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING contact_id)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('contacts', v_n);

  WITH r AS (UPDATE public.gsa_owner_backfill_log SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING ctid)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('gsa_owner_backfill_log', v_n);

  WITH r AS (UPDATE public.owner_unification_review_queue SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING ctid)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('owner_unification_review_queue', v_n);

  WITH r AS (UPDATE public.parcel_owner_xref SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING ctid)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('parcel_owner_xref', v_n);

  WITH r AS (UPDATE public.unified_contacts SET recorded_owner_id = p_survivor_id WHERE recorded_owner_id = p_loser_id RETURNING ctid)
  SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('unified_contacts', v_n);

  -- Field-merge excludes state and canonical_name (the UNIQUE constraint
  -- spans both). Both rows share canonical_name by construction; state
  -- is usually populated on survivor already.
  UPDATE public.recorded_owners s
     SET contact_info             = COALESCE(s.contact_info,             l.contact_info),
         sf_account_id            = COALESCE(s.sf_account_id,            l.sf_account_id),
         sf_last_synced           = COALESCE(s.sf_last_synced,           l.sf_last_synced),
         contact_id               = COALESCE(s.contact_id,               l.contact_id),
         entity_type              = COALESCE(s.entity_type,              l.entity_type),
         manager_name             = COALESCE(s.manager_name,             l.manager_name),
         manager_role             = COALESCE(s.manager_role,             l.manager_role),
         registered_agent_name    = COALESCE(s.registered_agent_name,    l.registered_agent_name),
         registered_agent_address = COALESCE(s.registered_agent_address, l.registered_agent_address),
         filing_state             = COALESCE(s.filing_state,             l.filing_state),
         filing_id                = COALESCE(s.filing_id,                l.filing_id),
         filing_date              = COALESCE(s.filing_date,              l.filing_date),
         filing_status            = COALESCE(s.filing_status,            l.filing_status),
         llc_research_at          = COALESCE(s.llc_research_at,          l.llc_research_at),
         llc_research_source      = COALESCE(s.llc_research_source,      l.llc_research_source)
    FROM public.recorded_owners l
   WHERE s.recorded_owner_id = p_survivor_id AND l.recorded_owner_id = p_loser_id;

  UPDATE public.recorded_owners
     SET merged_into_recorded_owner_id = p_survivor_id, updated_at = now()
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
  'A1 v2 (gov): drops state and canonical_name from the field-merge to avoid the uq_recorded_owners_canonical (canonical_name, state) UNIQUE constraint collision while the loser still occupies its slot.';
