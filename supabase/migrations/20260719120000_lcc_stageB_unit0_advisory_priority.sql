-- ============================================================================
-- Stage B Unit 0 — advisory-source registry exclusions (LCC Opps)
-- 2026-06-11 · written, NOT applied
--
-- Guard #2 of the 4-part advisory boundary: the field-source registry gives the
-- advisory sources (folder_feed_bov / folder_feed_master) NO usable rank on the
-- REPORTED listing/asking/sale fields, so the lcc_merge_field arbiter can never
-- select an advisory value for a reported field even if one reached it. Encoded
-- as an explicit rule at sentinel priority 9999 (lowest trust) + enforce_mode
-- 'strict' — and an explicit rule means these (table, field, source) triples
-- never show up as drift in v_field_provenance_unranked.
--
-- The PRIMARY enforcement is the write-path guard (api/_shared/extraction-field-
-- policy.js): the extractor rejects an advisory/internal value targeting a
-- reported field BEFORE any merge_field call. This registry rule is the
-- belt-and-suspenders. Idempotent upsert on (target_table, field_name, source).
-- ============================================================================

INSERT INTO public.field_source_priority (target_table, field_name, source, priority, enforce_mode, notes)
SELECT t.target_table, f.field_name, s.source, 9999, 'strict',
       'Stage B Unit 0: advisory source BARRED from reported field (price/cap is a client recommendation, never reported market data).'
FROM   (VALUES
          ('gov.available_listings'), ('dia.available_listings'),
          ('gov.sales_transactions'), ('dia.sales_transactions')
       ) AS t(target_table)
CROSS  JOIN (VALUES
          ('listing_price'), ('asking_price'), ('asking_cap'), ('original_price'),
          ('last_price'), ('last_price_change'), ('sold_price'), ('sold_cap_rate')
       ) AS f(field_name)
CROSS  JOIN (VALUES ('folder_feed_bov'), ('folder_feed_master')) AS s(source)
ON CONFLICT (target_table, field_name, source) DO UPDATE
  SET priority = EXCLUDED.priority,
      enforce_mode = EXCLUDED.enforce_mode,
      notes = EXCLUDED.notes,
      updated_at = now();
