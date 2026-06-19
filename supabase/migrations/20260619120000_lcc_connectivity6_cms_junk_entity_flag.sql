-- CONNECTIVITY #6 (LCC Opps) — soft-flag the 3 cms writer-bug junk entities (reversible).
--
-- Background (R35 surfaced this, left it for a separate cleanup): the bridgeLogActivity writer bug
-- minted a handful of ASSET entities from captured UI status strings, and R35 retyped 345 dia
-- Medicare CCN identities onto them as (cms, medicare_ccn). Grounded live 2026-06-19, the 345 valid
-- CCN ids hang off exactly 3 placeholder entities, each with ZERO other footprint (no non-cms
-- external_identities, no relationships, no portfolio edges, no cadence):
--   * "property link approved"        — 343 cms ids
--   * "clinic lead outcome recorded"  —   1 cms id
--   * "research outcome saved"        —   1 cms id
--
-- Action: soft-flag the 3 entities into the junk-name review path (metadata.junk_name_flagged +
-- junk_name_reviewed so they don't re-surface), reversibly. The 345 (cms, medicare_ccn) identities
-- are VALID Medicare clinic ids and are LEFT PARKED (NOT deleted) — re-homing each CCN onto its real
-- clinic/property entity is a DISTINCT follow-up job (documented), not this pass. The R35 forward
-- guard (ensureEntityLink resolveOnly on bridgeLogActivity) already stops new ones.
--
-- ZERO hard-deletes. Idempotent (jsonb key-merge). Reversible by metadata tag (see REVERT below).

UPDATE public.entities e
SET metadata = COALESCE(e.metadata, '{}'::jsonb) || jsonb_build_object(
      'junk_name_flagged', true,
      'junk_name_reviewed', true,
      'junk_name_source', 'connectivity6_cms_writer_artifact',
      'junk_name_flagged_at', now()
    )
WHERE e.canonical_name IN ('property link approved','clinic lead outcome recorded','research outcome saved')
  AND EXISTS (
    SELECT 1 FROM public.external_identities ei
    WHERE ei.entity_id = e.id AND ei.source_system = 'cms' AND ei.source_type = 'medicare_ccn'
  )
  -- safety: only the pure cms-junk holders (no other identity / relationship / portfolio footprint)
  AND NOT EXISTS (
    SELECT 1 FROM public.external_identities ei2
    WHERE ei2.entity_id = e.id AND NOT (ei2.source_system = 'cms' AND ei2.source_type = 'medicare_ccn')
  )
  AND NOT EXISTS (SELECT 1 FROM public.entity_relationships er WHERE er.from_entity_id = e.id OR er.to_entity_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM public.lcc_entity_portfolio_facts pf WHERE pf.entity_id = e.id)
  AND COALESCE(e.metadata->>'junk_name_source','') <> 'connectivity6_cms_writer_artifact';

-- REVERT (fully reversible):
--   UPDATE public.entities
--     SET metadata = metadata - 'junk_name_flagged' - 'junk_name_reviewed'
--                            - 'junk_name_source'   - 'junk_name_flagged_at'
--   WHERE metadata->>'junk_name_source' = 'connectivity6_cms_writer_artifact';
--
-- FOLLOW-UP (documented, NOT done here): re-home the 345 (cms, medicare_ccn) identities onto the
-- real clinic/property entity for each CCN (dia.medicare_clinics.medicare_id -> the property's asset
-- entity), then the 3 placeholder entities can be merged away. A distinct, separately-grounded job.
