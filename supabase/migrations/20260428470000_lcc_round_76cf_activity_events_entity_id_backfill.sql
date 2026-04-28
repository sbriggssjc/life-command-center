-- ============================================================================
-- Round 76cf — backfill activity_events.entity_id for historical
--              copilot_action rows
--
-- Pairs with Round 76ce (forward fix). Round 76ce wired stageOmIntake to
-- bridge matcher property_id -> LCC entities.id via ensureEntityLink, so
-- new copilot_action events carry entity_id. This round backfills the
-- historical rows where the data is recoverable.
--
-- Pre-state audit:
--   1,117 copilot_action events, 0 with entity_id (0% coverage)
--    341 of those (31%) join to a staged_intake_items row that has
--        extraction_result.match_property_id + match_domain populated
--    168 of those 341 (49%) already have an external_identities row
--        for that (source_system, property_id) — backfill via SQL
--    173 of those 341 don't have an external_identities link yet —
--        will get one organically when the user next interacts with
--        that property via the sidebar (ensureEntityLink upsert path)
--    776 of 1,117 have no resolvable property_id at all (extraction
--        failed, matcher returned no match, etc.) — entity_id stays
--        NULL, which is correct for those rows
--
-- Net delta from this round: 0% -> 15% coverage. Future events from
-- Round 76ce onward will bring this up.
-- ============================================================================

WITH resolvable AS (
  SELECT
    ae.id AS event_id,
    ei.entity_id
  FROM public.activity_events ae
  JOIN public.staged_intake_items si ON si.intake_id = ae.inbox_item_id
  JOIN public.external_identities ei
    ON ei.source_system = CASE si.raw_payload->'extraction_result'->>'match_domain'
                            WHEN 'government' THEN 'gov_db'
                            ELSE 'dia_db'
                          END
   AND ei.source_type   = 'property'
   AND ei.external_id   = si.raw_payload->'extraction_result'->>'match_property_id'
  WHERE ae.entity_id IS NULL
    AND ae.category = 'copilot_action'
    AND si.raw_payload->'extraction_result'->>'match_property_id' IS NOT NULL
    AND si.raw_payload->'extraction_result'->>'match_domain' IS NOT NULL
)
UPDATE public.activity_events ae
   SET entity_id = r.entity_id
  FROM resolvable r
 WHERE ae.id = r.event_id;
