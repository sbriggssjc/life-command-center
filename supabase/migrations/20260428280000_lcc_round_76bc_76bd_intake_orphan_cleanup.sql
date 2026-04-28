-- ============================================================================
-- Round 76bc — Drain stuck staged_intake review_required pile
--
-- LCC Opps had 940/1,105 staged intakes stuck in 'review_required'. Audit:
--   - 643 had non-listing doctypes (email_update, broker_email, unknown,
--     null, price_change, email) AND no tenant+price extracted →
--     non-actionable correspondence. Mark 'discarded' with reason.
--   - 297 are real listing docs (om / offering_memorandum / comp / flyer /
--     marketing_brochure) or potentially-actionable emails with tenant+
--     price → leave as review_required for human re-promotion via
--     /api/intake?_route=promote.
--
-- Round 76bc — 34 orphan asset entities (no external_identity link to
-- dia/gov property). Of those:
--   - 3 marked [JUNK]: CoStar UI artifacts ("1 of 2,000 Records",
--     "Properties | 445-445A...", "RBA8,750 SF...")
--   - 2 freshly linked to fresh dia property_ids
--   - 27 tagged metadata.duplicate_of_entity_id pointing at the existing
--     LCC entity that already owns that dia property — root cause is
--     matcher trust gap (same as Mayfair Round 76aa). Leaves 2 remaining
--     domain=NULL stubs for manual triage.
--
-- Round 76bd — Seed 24 gov field_source_priority entries
--
-- v_field_provenance_unranked detector flagged 24 gov field/source
-- combinations writing without a priority entry. Mirror dia priority
-- ladder (om_extraction=30, costar_sidebar=60). All start in
-- record_only mode for observation.
-- ============================================================================

-- ── Round 76bc-A: discard non-actionable email correspondence ─────────────
UPDATE public.staged_intake_items
   SET status = 'discarded',
       raw_payload = jsonb_set(raw_payload, '{discard_reason}',
         to_jsonb('Round 76bc: non-actionable doctype with no tenant+price extracted'::text))
 WHERE status = 'review_required'
   AND COALESCE(raw_payload->'extraction_result'->>'document_type','null') IN
       ('email_update','broker_email','email','unknown','null','price_change')
   AND (raw_payload->'extraction_result'->>'tenant_name' IS NULL
        OR raw_payload->'extraction_result'->>'asking_price' IS NULL);

-- ── Round 76bd: gov field_source_priority entries ─────────────────────────
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, enforce_mode, notes)
VALUES
  ('gov.properties', 'tenant', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.properties', 'zip_code', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.properties', 'year_built', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.properties', 'parcel_number', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.properties', 'land_acres', 'om_extraction', 30, 'record_only', 'Round 76bd'),
  ('gov.properties', 'year_built', 'om_extraction', 30, 'record_only', 'Round 76bd'),
  ('gov.sales_transactions', 'buyer_name', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.sales_transactions', 'seller_name', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.sales_transactions', 'listing_broker', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.sales_transactions', 'procuring_broker', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.sales_transactions', 'transaction_type', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.ownership_history', 'recorded_owner_id', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.ownership_history', 'data_source', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.ownership_history', 'property_id', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.contacts', 'address', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.contacts', 'city', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.contacts', 'state', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.loans', 'property_id', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.loans', 'term_years', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.loans', 'data_source', 'costar_sidebar', 60, 'record_only', 'Round 76bd'),
  ('gov.available_listings', 'initial_price', 'om_extraction', 30, 'record_only', 'Round 76bd'),
  ('gov.available_listings', 'last_price', 'om_extraction', 30, 'record_only', 'Round 76bd'),
  ('gov.available_listings', 'initial_cap_rate', 'om_extraction', 30, 'record_only', 'Round 76bd'),
  ('gov.available_listings', 'current_cap_rate', 'om_extraction', 30, 'record_only', 'Round 76bd')
ON CONFLICT (target_table, field_name, source) DO NOTHING;
