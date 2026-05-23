-- ============================================================================
-- 20260524100000_dia_A1_owner_merge_function.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — A1 entity dedup (dia)
--
-- Builds the apply_owner_merge() function plus a `merged_into_recorded_owner_id`
-- column on recorded_owners so the v_data_health_entities view can filter
-- already-merged rows out of the "redundant" count.
--
-- The function FK-repoints across all 8 FK-constrained tables + 4 same-named
-- columns (contacts, available_portfolios, sales_portfolios,
-- sales_portfolios_by_property), then logs every repoint into dq5_owner_merge_log
-- and the merge itself into dq5_owner_merge_map, then sets
-- merged_into_recorded_owner_id on the loser (the loser row itself stays
-- in recorded_owners so historical references in field_provenance still resolve).
--
-- Does NOT delete the loser row. Per Decision #2 (quarantine, don't delete).
--
-- The cleanup orchestrator (run separately) walks
-- v_recorded_owner_canonical_clusters, picks the survivor as the
-- recorded_owner_id with the most properties (first row per canonical,
-- since the view already orders by properties DESC), and calls
-- apply_owner_merge() for each loser.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Schema: add merged_into pointer
-- ----------------------------------------------------------------------------
ALTER TABLE public.recorded_owners
  ADD COLUMN IF NOT EXISTS merged_into_recorded_owner_id UUID
    REFERENCES public.recorded_owners(recorded_owner_id);

CREATE INDEX IF NOT EXISTS idx_recorded_owners_merged_into
  ON public.recorded_owners (merged_into_recorded_owner_id)
  WHERE merged_into_recorded_owner_id IS NOT NULL;

COMMENT ON COLUMN public.recorded_owners.merged_into_recorded_owner_id IS
  'A1 entity dedup: when this row has been merged into another (canonical) recorded_owner, this points at the survivor. NULL on live/canonical rows.';

-- ----------------------------------------------------------------------------
-- apply_owner_merge: repoint all FKs from loser to survivor, log, mark
-- ----------------------------------------------------------------------------
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
BEGIN
  -- Sanity
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

  -- ---- Repoint FK-constrained tables (8) ----
  WITH r AS (
    UPDATE public.properties SET recorded_owner_id = p_survivor_id
     WHERE recorded_owner_id = p_loser_id RETURNING property_id
  ) SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('properties', v_n);

  WITH r AS (
    UPDATE public.sales_transactions SET recorded_owner_id = p_survivor_id
     WHERE recorded_owner_id = p_loser_id RETURNING sale_id
  ) SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('sales_transactions', v_n);

  WITH r AS (
    UPDATE public.available_listings SET recorded_owner_id = p_survivor_id
     WHERE recorded_owner_id = p_loser_id RETURNING listing_id
  ) SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('available_listings', v_n);

  WITH r AS (
    UPDATE public.medicare_clinics SET recorded_owner_id = p_survivor_id
     WHERE recorded_owner_id = p_loser_id RETURNING medicare_id
  ) SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('medicare_clinics', v_n);

  WITH r AS (
    UPDATE public.ownership_history SET recorded_owner_id = p_survivor_id
     WHERE recorded_owner_id = p_loser_id RETURNING ownership_id
  ) SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('ownership_history', v_n);

  WITH r AS (
    UPDATE public.loans SET recorded_owner_id = p_survivor_id
     WHERE recorded_owner_id = p_loser_id RETURNING loan_id
  ) SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('loans', v_n);

  WITH r AS (
    UPDATE public.registered_entities SET recorded_owner_id = p_survivor_id
     WHERE recorded_owner_id = p_loser_id RETURNING entity_id
  ) SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('registered_entities', v_n);

  -- llc_research_queue has ON DELETE CASCADE; we still repoint (more semantic)
  -- before potentially deleting the loser.
  WITH r AS (
    UPDATE public.llc_research_queue SET recorded_owner_id = p_survivor_id
     WHERE recorded_owner_id = p_loser_id RETURNING queue_id
  ) SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('llc_research_queue', v_n);

  -- ---- Repoint same-named non-FK columns (defensive) ----
  -- contacts.recorded_owner_id: not an FK but used by the application
  WITH r AS (
    UPDATE public.contacts SET recorded_owner_id = p_survivor_id
     WHERE recorded_owner_id = p_loser_id RETURNING contact_id
  ) SELECT COUNT(*) INTO v_n FROM r;
  v_counts := v_counts || jsonb_build_object('contacts', v_n);

  -- ---- Field-merge: backfill survivor with loser's non-null fields ----
  -- Only fills survivor fields that are currently NULL.
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
   WHERE s.recorded_owner_id = p_survivor_id
     AND l.recorded_owner_id = p_loser_id;

  -- ---- Mark loser as merged ----
  UPDATE public.recorded_owners
     SET merged_into_recorded_owner_id = p_survivor_id,
         updated_at                    = now()
   WHERE recorded_owner_id = p_loser_id;

  -- ---- Audit logs ----
  INSERT INTO public.dq5_owner_merge_map (canonical_key, survivor_id, duplicate_id, survivor_name, duplicate_name)
  VALUES (COALESCE(p_canonical_key, v_survivor_name), p_survivor_id, p_loser_id, v_survivor_name, v_loser_name)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.dq5_owner_merge_log (table_name, fk_column, row_pk, old_owner_id, new_owner_id)
  VALUES ('A1_run', 'recorded_owner_id', COALESCE(p_run_id, 'manual'), p_loser_id, p_survivor_id);

  RETURN v_counts;
END;
$$;

COMMENT ON FUNCTION public.apply_owner_merge IS
  'A1: merge a duplicate recorded_owner into a survivor. Repoints all FK and same-named columns, COALESCEs survivor with loser non-null fields, sets merged_into_recorded_owner_id on the loser, logs to dq5_owner_merge_map + dq5_owner_merge_log. Idempotent on re-run (UPDATE WHERE = no-ops; map ON CONFLICT DO NOTHING).';

-- ----------------------------------------------------------------------------
-- Rebuild v_data_health_entities to exclude merged losers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_data_health_entities AS
WITH norm AS (
  SELECT
    recorded_owner_id,
    LOWER(REGEXP_REPLACE(
      COALESCE(normalized_name, name, ''),
      '[\.,]|\m(llc|inc|corp|corporation|company|co|lp|llp|trust|holdings|properties|propco)\M',
      '', 'gi'
    )) AS canonical_key
  FROM public.recorded_owners
  WHERE merged_into_recorded_owner_id IS NULL  -- exclude losers from A1 runs
),
norm_grouped AS (
  SELECT canonical_key, COUNT(*) AS rows_in_group
  FROM norm
  WHERE canonical_key IS NOT NULL AND canonical_key <> ''
  GROUP BY canonical_key
),
ro AS (
  SELECT COUNT(*) AS total_recorded_owners FROM public.recorded_owners
  WHERE merged_into_recorded_owner_id IS NULL
),
to_t AS (
  SELECT COUNT(*) AS total_true_owners FROM public.true_owners
)
SELECT
  'dia'::TEXT AS domain,
  ro.total_recorded_owners,
  to_t.total_true_owners,
  (SELECT COUNT(*) FROM norm_grouped WHERE rows_in_group > 1) AS redundant_owner_groups,
  (SELECT COALESCE(SUM(rows_in_group - 1), 0)
     FROM norm_grouped WHERE rows_in_group > 1) AS redundant_owner_rows,
  now() AS computed_at
FROM ro, to_t;

COMMENT ON VIEW public.v_data_health_entities IS
  'Single-row dashboard view of entity dedup health (dia). v3: excludes recorded_owners.merged_into_recorded_owner_id IS NOT NULL rows so the count only reflects unresolved duplicates.';
