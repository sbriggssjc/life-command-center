-- ============================================================================
-- W4.4 (2026-07-31): make the resolver's link writers first-class provenance
-- CITIZENS.
--
-- The W4.3 SF-link run wrote provenance_event_log rows on the domain DBs with
-- source='splink_v1' (the batch model writer) and source='sf_link_review_human'
-- (the Decision-Center review-lane human verdict). The W2.5 flush
-- (lcc_flush_provenance_events) drains those into LCC Opps field_provenance but
-- COLLAPSES every event to source='domain_trigger' (original source kept only in
-- source_run_id as 'splink_v1:evt<id>'). So field_source_priority has never been
-- able to rank the model/human link writers, and v_field_provenance_unranked
-- cannot police them — they are invisible as sources.
--
-- Grounded live 2026-07-31 (LCC Opps xengecqvemvfknjvbvrq):
--   - field_source_priority rows for splink_v1 / sf_link_review_human: 0
--   - field_provenance rows under those sources: 0 (all 3,493 are 'domain_trigger'
--     with source_run_id lineage: gov.true_owners/sf_account_id 1424+33,
--     gov.recorded_owners/sf_account_id 1653+14, dia.true_owners/sf_company_id 365+4)
--   - domain provenance_event_log: gov splink_v1 3,077 + human 47; dia 365 + 4.
--
-- This migration:
--   1. Registers splink_v1 and sf_link_review_human in field_source_priority for
--      the SF-link fields they write (the provenance-flush-normalized target_table
--      names gov.true_owners / gov.recorded_owners / dia.true_owners{,recorded_owners}).
--      splink_v1 = the batch model, priority 50 (below costar_sidebar 55-70 = more
--      trust, above the human/records tiers), min_confidence 0.9 (the W4.3 band),
--      record_only. sf_link_review_human = manual-equivalent priority 1 (it IS a
--      human decision), record_only. Both record_only first per the rollout plan.
--   2. Upgrades lcc_flush_provenance_events to PRESERVE first-class registered
--      sources (splink_v1 / sf_link_review_human) as themselves going forward
--      instead of the domain_trigger collapse — self-maintaining and can never trip
--      v_field_provenance_unranked (only a source registered for THIS (table,field)
--      is preserved; everything else still collapses to domain_trigger, unchanged).
--   3. Re-attributes the 3,493 already-flushed historical rows from domain_trigger
--      back to their true source (read from source_run_id) so the ledger is honest
--      for the existing 3,442 SF links — bounded to the registered combos so the
--      unranked drift view stays 0.
--
-- Additive / idempotent / reversible. Apply on LCC Opps (xengecqvemvfknjvbvrq).
--
-- REVERSAL:
--   UPDATE public.field_provenance SET source='domain_trigger'
--    WHERE source IN ('splink_v1','sf_link_review_human');
--   DELETE FROM public.field_source_priority
--    WHERE source IN ('splink_v1','sf_link_review_human');
--   -- and restore lcc_flush_provenance_events to the W2.5 body (hardcode
--   -- 'domain_trigger' as p_source; drop the v_merge_source branch).
-- ============================================================================

BEGIN;

-- ── 1. Register the model + human SF-link writers in field_source_priority ───
--   splink_v1              → the W4.3 batch model (Fellegi-Sunter link scorer)
--   sf_link_review_human   → the Decision-Center SF-link review verdict (human)
-- Lower priority = higher trust. Only splink_v1 and sf_link_review_human ever
-- write these SF-id fields, so the load-bearing fact is human(1) outranks model(50).
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
VALUES
  -- The human review verdict — manual-equivalent (a human decision).
  ('gov.true_owners',      'sf_account_id', 'sf_link_review_human', 1, 0,   'record_only',
     'W4.4: Decision-Center SF-link review verdict (human). Manual-equivalent trust.'),
  ('gov.recorded_owners',  'sf_account_id', 'sf_link_review_human', 1, 0,   'record_only',
     'W4.4: Decision-Center SF-link review verdict (human). Manual-equivalent trust.'),
  ('dia.true_owners',      'sf_company_id', 'sf_link_review_human', 1, 0,   'record_only',
     'W4.4: Decision-Center SF-link review verdict (human). Manual-equivalent trust.'),
  ('dia.recorded_owners',  'sf_company_id', 'sf_link_review_human', 1, 0,   'record_only',
     'W4.4: Decision-Center SF-link review verdict (human). Manual-equivalent trust. (defensive — dia recorded_owners route)'),
  -- The batch model writer — below the aggregators (more trust), above records/human.
  ('gov.true_owners',      'sf_account_id', 'splink_v1', 50, 0.9, 'record_only',
     'W4.4: W4.3 splink Fellegi-Sunter SF-link batch (owner_sf model). record_only first.'),
  ('gov.recorded_owners',  'sf_account_id', 'splink_v1', 50, 0.9, 'record_only',
     'W4.4: W4.3 splink Fellegi-Sunter SF-link batch (owner_sf model). record_only first.'),
  ('dia.true_owners',      'sf_company_id', 'splink_v1', 50, 0.9, 'record_only',
     'W4.4: W4.3 splink Fellegi-Sunter SF-link batch (owner_sf model). record_only first.'),
  ('dia.recorded_owners',  'sf_company_id', 'splink_v1', 50, 0.9, 'record_only',
     'W4.4: W4.3 splink Fellegi-Sunter SF-link batch (owner_sf model). record_only first. (defensive — dia recorded_owners route)')
ON CONFLICT (target_table, field_name, source) DO UPDATE
  SET priority = EXCLUDED.priority,
      min_confidence = EXCLUDED.min_confidence,
      enforce_mode = EXCLUDED.enforce_mode,
      notes = EXCLUDED.notes,
      updated_at = now();

-- ── 2. Flush preserves first-class registered sources going forward ──────────
-- Identical to the W2.5 body except p_source is v_merge_source: the originating
-- source is kept when it is a registered first-class source for THIS (table,
-- field); otherwise it collapses to 'domain_trigger' exactly as before. This is
-- self-maintaining (register a source row → the flush preserves it) and can never
-- trip v_field_provenance_unranked, because a preserved source is by construction
-- registered for that (table, field).
CREATE OR REPLACE FUNCTION public.lcc_flush_provenance_events(
  p_domain              text,
  p_events              jsonb,
  p_default_confidence  numeric DEFAULT 0.9
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_db     text;
  v_e             jsonb;
  v_id            bigint;
  v_raw_table     text;
  v_table         text;
  v_pk            text;
  v_field         text;
  v_newval        jsonb;
  v_src           text;
  v_merge_source  text;
  v_conf          numeric;
  v_kind          text;
  v_runid         text;
  v_decision      text;
  v_is_marker     boolean;
  v_merged        bigint[] := ARRAY[]::bigint[];
  v_skipped       bigint[] := ARRAY[]::bigint[];
  v_errors        jsonb    := '[]'::jsonb;
  v_decisions     jsonb    := '{}'::jsonb;
  v_max_id        bigint   := 0;
  -- W4.4: sources allowed to keep their own identity in the ledger (rest collapse
  -- to domain_trigger). Must ALSO be registered for the (table, field) to be kept.
  v_first_class   text[] := ARRAY['splink_v1','sf_link_review_human'];
BEGIN
  IF p_domain NOT IN ('dia','gov') THEN
    RAISE EXCEPTION 'p_domain must be dia or gov, got %', p_domain;
  END IF;
  v_target_db := CASE p_domain WHEN 'dia' THEN 'dia_db' ELSE 'gov_db' END;

  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_events, '[]'::jsonb))
  LOOP
    v_id        := NULLIF(v_e->>'id','')::bigint;
    IF v_id IS NULL THEN CONTINUE; END IF;
    IF v_id > v_max_id THEN v_max_id := v_id; END IF;

    v_raw_table := v_e->>'target_table';
    v_pk        := v_e->>'record_pk_value';
    v_field     := v_e->>'field_name';
    v_newval    := v_e->'new_value';
    v_src       := COALESCE(v_e->>'source','domain_trigger');
    v_conf      := COALESCE(NULLIF(v_e->>'confidence','')::numeric, p_default_confidence);
    v_kind      := v_e->'metadata'->>'kind';

    -- Marker / non-write rows: acknowledge (drain) but never merge.
    v_is_marker := (v_pk IS NULL)
                OR (v_pk LIKE '<%>')
                OR (v_kind = 'historical_bulk_update_marker')
                OR (v_newval IS NULL)
                OR (v_newval = 'null'::jsonb);
    IF v_is_marker THEN
      v_skipped := v_skipped || v_id;
      CONTINUE;
    END IF;

    -- Normalize target_table to the field_provenance domain-prefixed convention.
    v_table := CASE WHEN position('.' IN COALESCE(v_raw_table,'')) > 0
                    THEN v_raw_table
                    ELSE p_domain || '.' || v_raw_table END;

    -- W4.4: preserve a first-class source as itself when it is registered for this
    -- (table, field); otherwise collapse to domain_trigger (W2.5 behavior).
    v_merge_source := 'domain_trigger';
    IF v_src <> 'domain_trigger'
       AND v_src = ANY(v_first_class)
       AND EXISTS (
         SELECT 1 FROM public.field_source_priority fsp
          WHERE fsp.target_table = v_table
            AND fsp.field_name = v_field
            AND fsp.source = v_src
       ) THEN
      v_merge_source := v_src;
    END IF;

    -- Preserve the originating source lineage in the run id regardless.
    v_runid := v_src || ':evt' || v_id;

    BEGIN
      SELECT lmf.decision INTO v_decision
      FROM public.lcc_merge_field(
        NULL,                 -- p_workspace_id
        v_target_db,          -- p_target_database
        v_table,              -- p_target_table
        v_pk,                 -- p_record_pk
        v_field,              -- p_field_name
        v_newval,             -- p_value (jsonb)
        v_merge_source,       -- p_source (first-class preserved, else domain_trigger)
        v_runid,              -- p_source_run_id (original source + event id)
        v_conf,               -- p_confidence
        NULL                  -- p_recorded_by
      ) lmf;

      v_merged    := v_merged || v_id;
      v_decisions := jsonb_set(
                       v_decisions,
                       ARRAY[COALESCE(v_decision,'unknown')],
                       to_jsonb(COALESCE((v_decisions->>COALESCE(v_decision,'unknown'))::int,0) + 1),
                       true);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('id', v_id, 'error', left(SQLERRM, 400));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'merged_ids',   to_jsonb(v_merged),
    'skipped_ids',  to_jsonb(v_skipped),
    'errors',       v_errors,
    'decisions',    v_decisions,
    'max_event_id', v_max_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_flush_provenance_events(text, jsonb, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.lcc_flush_provenance_events(text, jsonb, numeric) TO service_role;

COMMENT ON FUNCTION public.lcc_flush_provenance_events(text, jsonb, numeric) IS
  'W2.5 + W4.4: transform domain provenance_event_log rows into lcc_merge_field()
   calls. Normalizes bare table names to the domain-prefixed ledger convention,
   skips historical bulk markers, and preserves the originating source in
   source_run_id (src:evt<id>). W4.4: a first-class source (splink_v1 /
   sf_link_review_human) that is registered in field_source_priority for the
   (table, field) is written under its OWN source; every other source collapses to
   domain_trigger. Returns {merged_ids, skipped_ids, errors, decisions,
   max_event_id}. Keep chunks modest (<=500): each lcc_merge_field takes a per-key
   advisory xact lock held until this RPC commits.';

-- ── 3. Re-attribute the historical SF-link rows to their true source ─────────
-- The 3,493 already-flushed rows carry source='domain_trigger' with source_run_id
-- 'splink_v1:evt<id>' / 'sf_link_review_human:evt<id>'. Re-attribute them to the
-- true source so the ledger is honest for the existing 3,442 links. Bounded to the
-- combos just registered so v_field_provenance_unranked stays 0.
UPDATE public.field_provenance fp
   SET source = split_part(fp.source_run_id, ':', 1)
 WHERE fp.source = 'domain_trigger'
   AND fp.source_run_id ~ '^(splink_v1|sf_link_review_human):evt'
   AND EXISTS (
     SELECT 1 FROM public.field_source_priority fsp
      WHERE fsp.target_table = fp.target_table
        AND fsp.field_name   = fp.field_name
        AND fsp.source        = split_part(fp.source_run_id, ':', 1)
   );

COMMIT;
