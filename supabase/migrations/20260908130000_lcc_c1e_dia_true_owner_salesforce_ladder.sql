-- ============================================================================
-- C1e — register the missing provenance rung: dia.true_owners.salesforce_id
--       2026-09-08 (executing C1 §5 / docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md)
--
-- `field_source_priority` carries ladders for BOTH gov SF-link fields
-- (sf_link_review_human@1, splink_v1@50 — see 20260819120000_lcc_w4_4_*)
-- but `dia.true_owners.salesforce_id` has none. That is pre-existing
-- `v_field_provenance_unranked` drift, and it is what C1d's new writeback unit
-- would otherwise widen.
--
-- ⚠️ DEPLOY ORDER (CLAUDE.md "additive schema before writer deploy"): this
-- migration's timestamp (130000) MUST precede the writer change (C1d, shipped
-- in the same PR as the JS Unit 4 in api/_handlers/sf-link-reconcile.js).
-- Applying the ladder first means the writer never goes live unranked.
--
-- ⚠️ THE SOURCE STRING IS PART OF THE CONTRACT (CONTACT1b, 2026-09-06) — the
-- exact literal registered here, 'sf_link_reconcile_writeback', is the exact
-- literal the JS writer stamps into provenance_event_log.source. Grep both
-- sides before changing either.
--
-- Priority 45: this writer only ever fires fill-blanks (never overwrites an
-- existing dia.true_owners.salesforce_id — see the JS guard) on an
-- UNAMBIGUOUS bridge (exactly one resolved SF Account identity on the LCC
-- entity, entity not merged-away, owner not flagged operator). It sits below
-- the human review lane (sf_link_review_human@1) and the batch model
-- (splink_v1@50, min_confidence 0.9) — an automated-but-deterministic copy of
-- an already-established identity, not a probabilistic match. record_only
-- first, matching the W4.4 rollout discipline for every other SF-link rung.
--
-- REVERSAL:
--   DELETE FROM public.field_source_priority
--    WHERE target_table = 'dia.true_owners' AND field_name = 'salesforce_id'
--      AND source = 'sf_link_reconcile_writeback';
-- ============================================================================

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
VALUES
  ('dia.true_owners', 'salesforce_id', 'sf_link_reconcile_writeback', 45, 0, 'record_only',
   'C1e/C1d: sf-link-reconcile.js Unit 4 (LCC->domain writeback). Fills a NULL '
   'dia.true_owners.salesforce_id from an already-resolved, unambiguous LCC-side '
   'external_identities(salesforce,Account) link on the bridged owner entity. '
   'Fill-blanks only (never overwrites); entity resolved through '
   'lcc_entity_survivor() before writing; reversible by batch tag in '
   'provenance_event_log.metadata->batch_tag. record_only first.')
ON CONFLICT (target_table, field_name, source) DO UPDATE
  SET priority = EXCLUDED.priority,
      min_confidence = EXCLUDED.min_confidence,
      enforce_mode = EXCLUDED.enforce_mode,
      notes = EXCLUDED.notes,
      updated_at = now();
