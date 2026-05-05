-- ============================================================================
-- Migration: drift-cleanup sweep for field_source_priority
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Round 76ej.l follow-up (2026-05-05). Audit during the
-- crexi_sidebar_description rollout surfaced 19 (target_table, field_name,
-- source) triples in v_field_provenance_unranked — writers actively
-- populating fields that never got registered in field_source_priority.
-- All pre-existed this round; none are new writer paths.
--
-- Each new rule slots into the priority band that source already uses on
-- the same table (the mode of that table×source's existing rules), so no
-- existing winner/loser ordering changes:
--
--   dia.leases.costar_sidebar  → 65 (table mode)
--   dia.leases.email_intake    → 35 (uniform)
--   dia.loans.costar_sidebar   → 60 (table mode; matches gov.loans pattern)
--   gov.available_listings.om_extraction → 30 (uniform — mirrors dia.available_listings)
--   gov.contacts.om_extraction → 35/40 (mirrors dia.contacts: email 35, name 40)
--
-- Default enforce_mode = 'record_only' (observation-only). ON CONFLICT DO
-- NOTHING is implemented via NOT EXISTS so re-running this migration is
-- idempotent.
--
-- Acceptance: after apply, v_field_provenance_unranked drops to 0 rows.
-- ============================================================================

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
SELECT v.target_table, v.field_name, v.source, v.priority, NULL, v.notes
FROM (VALUES
  -- dia.leases ← costar_sidebar (lifecycle/audit fields the sidebar writer fills)
  ('dia.leases',             'data_source',          'costar_sidebar', 65, 'Round 76ej.l drift sweep — sidebar lease writer.'),
  ('dia.leases',             'is_active',            'costar_sidebar', 65, 'Round 76ej.l drift sweep — sidebar lease writer.'),
  ('dia.leases',             'source_confidence',    'costar_sidebar', 65, 'Round 76ej.l drift sweep — sidebar lease writer.'),
  ('dia.leases',             'status',               'costar_sidebar', 65, 'Round 76ej.l drift sweep — sidebar lease writer.'),

  -- dia.leases ← email_intake (OM-from-email promoter back-fills these)
  ('dia.leases',             'data_source',          'email_intake',   35, 'Round 76ej.l drift sweep — email-intake OM promoter.'),
  ('dia.leases',             'is_active',            'email_intake',   35, 'Round 76ej.l drift sweep — email-intake OM promoter.'),
  ('dia.leases',             'source_confidence',    'email_intake',   35, 'Round 76ej.l drift sweep — email-intake OM promoter.'),
  ('dia.leases',             'status',               'email_intake',   35, 'Round 76ej.l drift sweep — email-intake OM promoter.'),

  -- dia.loans ← costar_sidebar (sidebar loan writer)
  ('dia.loans',              'data_source',          'costar_sidebar', 60, 'Round 76ej.l drift sweep — sidebar loans writer.'),
  ('dia.loans',              'loan_term',            'costar_sidebar', 60, 'Round 76ej.l drift sweep — sidebar loans writer.'),
  ('dia.loans',              'property_id',          'costar_sidebar', 60, 'Round 76ej.l drift sweep — sidebar loans writer (FK).'),
  ('dia.loans',              'updated_at',           'costar_sidebar', 60, 'Round 76ej.l drift sweep — sidebar loans writer.'),

  -- gov.available_listings ← om_extraction (OM intake promoter — mirrors dia.available_listings)
  ('gov.available_listings', 'current_cap_rate',     'om_extraction',  30, 'Round 76ej.l drift sweep — OM promoter, mirrors dia.available_listings.'),
  ('gov.available_listings', 'initial_cap_rate',     'om_extraction',  30, 'Round 76ej.l drift sweep — OM promoter, mirrors dia.available_listings.'),
  ('gov.available_listings', 'initial_price',        'om_extraction',  30, 'Round 76ej.l drift sweep — OM promoter, mirrors dia.available_listings.'),
  ('gov.available_listings', 'last_price',           'om_extraction',  30, 'Round 76ej.l drift sweep — OM promoter, mirrors dia.available_listings.'),
  ('gov.available_listings', 'price_per_sf',         'om_extraction',  30, 'Round 76ej.l drift sweep — OM promoter, mirrors dia.available_listings.'),

  -- gov.contacts ← om_extraction (mirrors dia.contacts band: email 35, name 40)
  ('gov.contacts',           'contact_email',        'om_extraction',  35, 'Round 76ej.l drift sweep — OM promoter, mirrors dia.contacts.'),
  ('gov.contacts',           'contact_name',         'om_extraction',  40, 'Round 76ej.l drift sweep — OM promoter, mirrors dia.contacts.')
) AS v(target_table, field_name, source, priority, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.field_source_priority existing
  WHERE existing.target_table = v.target_table
    AND existing.field_name   = v.field_name
    AND existing.source       = v.source
);
