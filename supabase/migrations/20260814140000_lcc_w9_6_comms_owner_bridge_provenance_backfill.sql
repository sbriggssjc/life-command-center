-- W9.6 (Prompt 108) — backfill field_provenance for the 22 already-confirmed
-- comms_owner_attribution bridges so the owner-attribution edges are observable
-- in the provenance ledger / Decision Center provenance lanes.
--
-- Root cause of the gap: the confirm writer (api/admin.js) stamped provenance via
-- rpc/lcc_merge_field but (a) swallowed the error and (b) double-encoded p_value
-- (JSON.stringify on a jsonb param). Both fixed in the JS. This migration recovers
-- the historical 22 that were confirmed before the fix.
--
-- Source of truth = comms_owner_attribution_apply_log.reversal (owner_entity_id)
-- joined to comms_owner_attribution_review.sample_activity_id (the SAME
-- representative activity_events pk the forward writer stamps: it uses
-- review.sample_activity_id || toPatch[0].id, and sample_activity_id is populated
-- on all 22). One provenance row per bridge, matching the writer's convention.
--
-- Discipline: additive · idempotent (skip if a comms_owner_bridge write row already
-- exists for that pk) · reversible (tagged source_run_id) · goes through
-- lcc_merge_field so the decision/priority ledger stays consistent.
-- The field_source_priority row
--   ('public.activity_events','linked_entity_ids','comms_owner_bridge',45,record_only)
-- already exists, so v_field_provenance_unranked stays 0 (no new drift).
--
-- REVERSAL:
--   DELETE FROM public.field_provenance
--    WHERE source = 'comms_owner_bridge'
--      AND source_run_id = 'w9_6_provenance_backfill:2026-08-14';

DO $$
DECLARE
  r            RECORD;
  v_pk         TEXT;
  v_run_id     TEXT := 'w9_6_provenance_backfill:2026-08-14';
  v_filled     INT  := 0;
  v_skipped    INT  := 0;
BEGIN
  FOR r IN
    SELECT l.review_id,
           (l.reversal->>'owner_entity_id')                       AS owner_eid,
           COALESCE(rv.sample_activity_id::text,
                    l.reversal->'activity_event_ids'->>0)          AS rep_pk,
           rv.confidence                                          AS confidence,
           rv.workspace_id                                        AS workspace_id
    FROM public.comms_owner_attribution_apply_log l
    JOIN public.comms_owner_attribution_review    rv ON rv.review_id = l.review_id
    WHERE l.status = 'applied'
      AND (l.reversal ? 'owner_entity_id')
  LOOP
    v_pk := r.rep_pk;
    IF v_pk IS NULL OR r.owner_eid IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Idempotent: don't double-insert if a comms_owner_bridge write row already
    -- exists for this representative record (forward writer or a prior run).
    IF EXISTS (
      SELECT 1 FROM public.field_provenance fp
      WHERE fp.target_table    = 'public.activity_events'
        AND fp.field_name      = 'linked_entity_ids'
        AND fp.record_pk_value = v_pk
        AND fp.source          = 'comms_owner_bridge'
        AND fp.decision        = 'write'
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    PERFORM public.lcc_merge_field(
      r.workspace_id,               -- p_workspace_id
      'lcc_opps',                   -- p_target_database (ops-local convention)
      'public.activity_events',     -- p_target_table
      v_pk,                         -- p_record_pk
      'linked_entity_ids',          -- p_field_name
      to_jsonb(r.owner_eid),        -- p_value (jsonb string, NOT double-encoded)
      'comms_owner_bridge',         -- p_source
      v_run_id,                     -- p_source_run_id
      r.confidence,                 -- p_confidence
      NULL                          -- p_recorded_by
    );
    v_filled := v_filled + 1;
  END LOOP;

  RAISE NOTICE 'W9.6 comms_owner_bridge provenance backfill: filled=%, skipped=%', v_filled, v_skipped;
END $$;
