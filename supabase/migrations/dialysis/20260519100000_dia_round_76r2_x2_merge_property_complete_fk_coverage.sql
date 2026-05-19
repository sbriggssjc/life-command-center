-- ============================================================================
-- Round 76r2-x2 (dia, 2026-05-19) — port runtime FK-discovery pattern into
--                                    dia_merge_property; add MV refresh.
--
-- Background (from Round 2 audit, finding R2-X-2):
-- ----------------------------------------------------------------------------
-- The hand-coded UPDATE list inside dia_merge_property
-- (`supabase/migrations/20260425240000_dia_property_merge_candidates_and_helper.sql`)
-- repoints 9 child tables: leases, available_listings, sales_transactions,
-- contacts, ownership_history, parcel_records, tax_records,
-- listing_change_events, property_public_records.
--
-- Since that helper was authored (April 2026), Round 76ek (May 8) added the
-- CMBS loan-history + financials schema, and Round 76ek.j Phase 1 added the
-- LLC research enrichment queue. Several of those tables carry a property_id
-- FK that the merge function never sees:
--
--   • loans                  — FK to properties; loan-history root
--   • property_financials    — FK to properties (ON DELETE CASCADE) → silent
--                              row LOSS if the merge fires before this loop
--   • llc_research_queue     — FK to properties (ON DELETE SET NULL) → value
--                              anchor (linked_property_id) silently nulled
--   • cap_rate_history       — write-trigger ledger keyed on property_id
--   • property_sale_events   — Round 76r property_sale_events table
--   • property_intel         — pipeline-stage table
--   • property_cms_link / property_cms_link_history
--   • staged_intake_matches  — matcher audit
--   • lease_extensions / lease_rent_schedule — extensions to leases
--   • cm_features            — cross-vertical capital markets keys
--
-- The gov mirror (gov_merge_property, Round 76be, 2026-04-28) already uses a
-- runtime pg_constraint loop that automatically picks up every property_id FK
-- regardless of when the child table was added. We port that pattern to dia,
-- preserving the same return-shape and audit-JSONB conventions.
--
-- Plus: dia has one materialized view that derives from properties
-- (mv_property_value_signal, QA-06 / 2026-05-18). We REFRESH it CONCURRENTLY
-- at the end of the merge so the dashboard's "value signal" rail picks up
-- the merge immediately rather than waiting for the next 5-min mv_work_counts
-- tick.
--
-- Safety: every per-table UPDATE is wrapped in its own BEGIN/EXCEPTION block so
-- a single missing column or RLS denial cannot abort the whole merge. The
-- exception SQLERRM is recorded in the audit JSONB under the key
-- "<schema>.<table>.<col>_error" — making partial-merge investigation trivial.
--
-- Forward-compatibility: any future table that adds a property_id FK to
-- public.properties is automatically picked up by the loop on the next merge
-- run. No follow-up migration needed when, e.g., a maintenance_events or
-- npi_signal_audit table lands with its own property_id FK.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.dia_merge_property(
  p_keep_id INTEGER, p_drop_id INTEGER
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rewired   jsonb := '{}'::jsonb;
  v_n         integer;
  v_record    record;
  v_mv_exists boolean;
BEGIN
  IF p_keep_id IS NULL OR p_drop_id IS NULL THEN
    RAISE EXCEPTION 'dia_merge_property: keep_id and drop_id must both be non-null';
  END IF;
  IF p_keep_id = p_drop_id THEN
    RAISE EXCEPTION 'dia_merge_property: keep_id and drop_id must differ (got %)', p_keep_id;
  END IF;

  -- Verify both rows exist before we start UPDATEing children, otherwise
  -- a typo at the call site silently moves nothing.
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE property_id = p_keep_id) THEN
    RAISE EXCEPTION 'dia_merge_property: keep_id % not found in properties', p_keep_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE property_id = p_drop_id) THEN
    RAISE EXCEPTION 'dia_merge_property: drop_id % not found in properties', p_drop_id;
  END IF;

  -- ── Runtime FK discovery loop ──────────────────────────────────────────
  -- For every FOREIGN KEY in public.* whose target is
  -- public.properties.property_id, UPDATE the child column to p_keep_id where
  -- it currently points to p_drop_id. Each child handled in its own savepoint
  -- so one failure doesn't roll back the whole merge.
  FOR v_record IN
    SELECT n.nspname AS schemaname,
           t.relname AS tablename,
           a.attname AS colname
      FROM pg_constraint c
      JOIN pg_class      t ON t.oid = c.conrelid
      JOIN pg_namespace  n ON n.oid = t.relnamespace
      JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.contype   = 'f'
       AND c.confrelid = 'public.properties'::regclass
       AND n.nspname   = 'public'
     ORDER BY t.relname, a.attname
  LOOP
    BEGIN
      EXECUTE format(
        'UPDATE %I.%I SET %I = $1 WHERE %I = $2',
        v_record.schemaname, v_record.tablename, v_record.colname, v_record.colname
      ) USING p_keep_id, p_drop_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN
        v_rewired := v_rewired || jsonb_build_object(
          v_record.tablename || '.' || v_record.colname, v_n
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_rewired := v_rewired || jsonb_build_object(
        v_record.tablename || '.' || v_record.colname || '_error', SQLERRM
      );
    END;
  END LOOP;

  -- ── Refresh property-derived materialized views ───────────────────────
  -- mv_property_value_signal (QA-06) drives the dia "value signal" rail; if
  -- we skip this, the dashboard keeps reporting the deleted property until
  -- the next scheduled refresh (or never, if no refresh job exists).
  SELECT EXISTS (
    SELECT 1 FROM pg_matviews
     WHERE schemaname = 'public' AND matviewname = 'mv_property_value_signal'
  ) INTO v_mv_exists;
  IF v_mv_exists THEN
    BEGIN
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_property_value_signal;
      v_rewired := v_rewired || jsonb_build_object('mv_property_value_signal_refreshed', true);
    EXCEPTION WHEN OTHERS THEN
      -- CONCURRENTLY requires a unique index; if it's not built yet, fall
      -- back to a non-concurrent refresh.
      BEGIN
        REFRESH MATERIALIZED VIEW public.mv_property_value_signal;
        v_rewired := v_rewired || jsonb_build_object('mv_property_value_signal_refreshed', 'non_concurrent');
      EXCEPTION WHEN OTHERS THEN
        v_rewired := v_rewired || jsonb_build_object('mv_property_value_signal_error', SQLERRM);
      END;
    END;
  END IF;

  -- ── Finally drop the merged-away property ─────────────────────────────
  DELETE FROM public.properties WHERE property_id = p_drop_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rewired := v_rewired || jsonb_build_object('properties_deleted', v_n);

  RETURN jsonb_build_object(
    'keep_id', p_keep_id,
    'drop_id', p_drop_id,
    'rewired', v_rewired,
    'merge_function_version', 'r2_x2_runtime_fk_discovery_2026_05_19'
  );
END;
$$;

COMMENT ON FUNCTION public.dia_merge_property(INTEGER, INTEGER) IS
  'Round 76r2-x2 (2026-05-19): merge p_drop_id INTO p_keep_id by walking every
   FOREIGN KEY whose target is public.properties.property_id and re-pointing it
   to p_keep_id, then refreshing mv_property_value_signal, then deleting the
   p_drop_id row. Returns a JSONB audit log of per-child UPDATE counts. Mirrors
   the gov_merge_property pattern (Round 76be). Replaces the prior hand-coded
   9-table UPDATE list which silently stranded loans / property_financials /
   llc_research_queue / cap_rate_history / property_sale_events / property_intel
   / property_cms_link rows for every merge. SECURITY DEFINER.';

GRANT EXECUTE ON FUNCTION public.dia_merge_property(INTEGER, INTEGER)
  TO authenticated, service_role;

COMMIT;
