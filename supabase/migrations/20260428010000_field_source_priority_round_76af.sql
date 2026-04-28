-- ============================================================================
-- Round 76af — RCA source + recorded_deed source in field_source_priority
--
-- Two new sources enter the priority registry:
--
--   recorded_deed  (priority 3) — explicit deed document, regardless of how
--                                 it reached us. Beats om_extraction (45),
--                                 costar_sidebar (55-60), and rca_sidebar (50)
--                                 for ownership-relevant fields. Only outranked
--                                 by manual_edit (1) and county_records (5).
--
--   rca_sidebar    (priority 50) — RCA (Real Capital Analytics) sidebar capture.
--                                  Slightly higher trust than costar_sidebar
--                                  because RCA data is curated by analysts and
--                                  comes with confirmed cap rates / sale prices.
--                                  Lower than om_extraction (45) because the OM
--                                  is the broker's authoritative document for
--                                  the deal currently being marketed.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

-- ── recorded_deed: top-tier authority for ownership transfer fields ────────
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
VALUES
  ('dia.deed_records',     'grantor',          'recorded_deed', 3, 'record_only', 'Round 76af: recorded deed is the legal source of truth'),
  ('dia.deed_records',     'grantee',          'recorded_deed', 3, 'record_only', 'Round 76af: recorded deed is the legal source of truth'),
  ('dia.deed_records',     'recording_date',   'recorded_deed', 3, 'record_only', 'Round 76af: recorded deed is the legal source of truth'),
  ('dia.deed_records',     'document_number',  'recorded_deed', 3, 'record_only', 'Round 76af: recorded deed is the legal source of truth'),
  ('dia.deed_records',     'consideration',    'recorded_deed', 3, 'record_only', 'Round 76af: recorded deed is the legal source of truth'),
  ('dia.deed_records',     'deed_type',        'recorded_deed', 3, 'record_only', 'Round 76af: recorded deed is the legal source of truth'),
  ('gov.deed_records',     'grantor',          'recorded_deed', 3, 'record_only', 'Round 76af: recorded deed is the legal source of truth'),
  ('gov.deed_records',     'grantee',          'recorded_deed', 3, 'record_only', 'Round 76af: recorded deed is the legal source of truth'),
  ('gov.deed_records',     'recording_date',   'recorded_deed', 3, 'record_only', 'Round 76af: recorded deed is the legal source of truth'),
  ('gov.deed_records',     'document_number',  'recorded_deed', 3, 'record_only', 'Round 76af: recorded deed is the legal source of truth'),
  ('gov.deed_records',     'consideration',    'recorded_deed', 3, 'record_only', 'Round 76af: recorded deed is the legal source of truth'),
  ('gov.deed_records',     'deed_type',        'recorded_deed', 3, 'record_only', 'Round 76af: recorded deed is the legal source of truth'),
  ('dia.recorded_owners',  'name',             'recorded_deed', 3, 'record_only', 'Round 76af: a recorded deed beats OM and CoStar for owner identity'),
  ('dia.recorded_owners',  'normalized_name',  'recorded_deed', 3, 'record_only', 'Round 76af'),
  ('gov.recorded_owners',  'name',             'recorded_deed', 3, 'record_only', 'Round 76af'),
  ('gov.recorded_owners',  'canonical_name',   'recorded_deed', 3, 'record_only', 'Round 76af'),
  ('dia.ownership_history','ownership_start',  'recorded_deed', 3, 'record_only', 'Round 76af: deed recording_date drives ownership_start authoritatively'),
  ('dia.ownership_history','ownership_end',    'recorded_deed', 3, 'record_only', 'Round 76af'),
  ('dia.ownership_history','sold_price',       'recorded_deed', 3, 'record_only', 'Round 76af'),
  ('gov.ownership_history','prior_owner',      'recorded_deed', 3, 'record_only', 'Round 76af'),
  ('gov.ownership_history','new_owner',        'recorded_deed', 3, 'record_only', 'Round 76af'),
  ('gov.ownership_history','transfer_date',    'recorded_deed', 3, 'record_only', 'Round 76af'),
  ('gov.ownership_history','transfer_price',   'recorded_deed', 3, 'record_only', 'Round 76af')
ON CONFLICT (target_table, field_name, source) DO NOTHING;

-- ── rca_sidebar: mirror costar_sidebar but with priority 50 ────────────────
-- Generate by copying every existing costar_sidebar rule with the same
-- (target_table, field_name) shape but changing source + priority.
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
SELECT
  target_table,
  field_name,
  'rca_sidebar' AS source,
  50            AS priority,
  'record_only' AS enforce_mode,
  'Round 76af: RCA sidebar capture' AS notes
FROM public.field_source_priority
WHERE source = 'costar_sidebar'
ON CONFLICT (target_table, field_name, source) DO NOTHING;

-- ── Audit notice ────────────────────────────────────────────────────────────
DO $$
DECLARE
  rd_rules integer;
  rca_rules integer;
BEGIN
  SELECT COUNT(*) INTO rd_rules  FROM public.field_source_priority WHERE source = 'recorded_deed';
  SELECT COUNT(*) INTO rca_rules FROM public.field_source_priority WHERE source = 'rca_sidebar';
  RAISE NOTICE 'recorded_deed rules: %, rca_sidebar rules: %', rd_rules, rca_rules;
END $$;
