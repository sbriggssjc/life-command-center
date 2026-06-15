-- ============================================================================
-- R19 — close the field-provenance drift (unranked sources → undefined
-- precedence). 2026-06-15.
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL) — both field_provenance and
-- field_source_priority live here.
--
-- Grounded live 2026-06-15: v_field_provenance_unranked = 42 (should be 0).
-- 42 (target_table, field_name, source) combos record provenance with no
-- matching field_source_priority rule, so their source precedence is
-- undefined. Three classes:
--
--   Class A — double-prefixed `gov.gov.leases` (8 combos). The WRITER is
--     already fixed (upsertGovernmentLeases emits bare 'leases'; R4-5
--     2026-05-20). Every malformed row's last_seen is <= 2026-05-20 — no
--     active writer. This migration BACKFILLS the stale ledger rows by
--     repointing them to the correct `gov.leases` name so they merge into the
--     real lease's history (they are older than the live gov.leases rows, so
--     "current authoritative" is unaffected) and become ranked by Class B.
--
--   Class B — ~20 genuine contested DATA fields with no priority rule.
--     Registered below on the established sidebar/aggregator ladder
--     (om_extraction 30, rca_sidebar 50, costar_sidebar 60, crexi_sidebar 65,
--     crexi_sidebar_description 70) mirroring sibling fields on the same
--     tables. ON CONFLICT DO NOTHING — never changes an existing ranking.
--
--   Class C — bookkeeping fields (property_id / sale_id / sale_role /
--     data_source on contacts). FK/link/metadata, NOT contested values.
--     Excluded at the writer going forward (recordFieldProvenance now skips
--     them — less ledger churn). For the rows ALREADY recorded, trivial
--     priority rules below keep the drift detector at 0 without a large delete
--     on the disk-pressure-sensitive ledger; they go inert once those rows
--     age out at the 90d prune.
--
-- Acceptance: v_field_provenance_unranked → 0.
-- Idempotent / additive — safe to re-apply.
-- ============================================================================

-- ── Class A — repoint stale double-prefixed lease provenance ────────────────
-- field_provenance is an append-only log (PK on id only; no unique natural
-- key) so this UPDATE cannot collide. The record_pk_value is the real
-- gov.leases lease_id — the writer wrote the right id under the wrong table
-- name — so these rows belong in gov.leases history.
UPDATE public.field_provenance
   SET target_table = 'gov.leases'
 WHERE target_table = 'gov.gov.leases';

-- ── Class B — register the genuine data fields on the sidebar ladder ────────
-- Cross-join the affected (table, field) set with the standard sidebar source
-- ladder so each field ranks consistently with its siblings AND is re-drift
-- proof (covers every sidebar source the capture path can emit, not just the
-- one observed in the 30d window).
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
SELECT tf.target_table, tf.field_name, s.source, s.priority, NULL,
       'R19 — register contested sidebar data field (was unranked).'
FROM (VALUES
    -- gov.leases (upsertGovernmentLeases provenance set; rca/crexi captures)
    ('gov.leases', 'tenant_agency'),
    ('gov.leases', 'tenant_agency_full'),
    ('gov.leases', 'government_type'),
    ('gov.leases', 'commencement_date'),
    ('gov.leases', 'expiration_date'),
    ('gov.leases', 'annual_rent'),
    ('gov.leases', 'rent_psf'),
    ('gov.leases', 'expense_structure'),
    ('gov.leases', 'renewal_options'),
    -- gov.properties
    ('gov.properties', 'assessed_value'),
    -- gov.sales_transactions
    ('gov.sales_transactions', 'financing_type'),
    ('gov.sales_transactions', 'gross_rent_psf'),
    -- dia.loans
    ('dia.loans', 'originator'),
    -- dia.ownership_history
    ('dia.ownership_history', 'end_date'),
    ('dia.ownership_history', 'notes'),
    -- contacts (website is a real contact data value; the FK/role/metadata
    -- columns are Class C, excluded at the writer)
    ('dia.contacts', 'website'),
    ('gov.contacts', 'website')
) AS tf(target_table, field_name)
CROSS JOIN (VALUES
    ('rca_sidebar', 50),
    ('costar_sidebar', 60),
    ('crexi_sidebar', 65),
    ('crexi_sidebar_description', 70)
) AS s(source, priority)
ON CONFLICT (target_table, field_name, source) DO NOTHING;

-- gov.properties.agency is written by the OM extractor — om_extraction ladder
-- (30, matching the existing gov.properties om_extraction band), not sidebar.
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  ('gov.properties', 'agency', 'om_extraction', 30, NULL,
   'R19 — register contested OM-extracted agency field (was unranked).')
ON CONFLICT (target_table, field_name, source) DO NOTHING;

-- ── Class C — silence the bookkeeping fields in the drift detector ──────────
-- property_id / sale_id / sale_role / data_source on contacts are FK/link/
-- metadata, never contested values. The WRITER (recordFieldProvenance) now
-- excludes them universally going forward (no new ledger rows). To take
-- v_field_provenance_unranked to 0 NOW — without a 71k-row DELETE on the 9.x GB
-- ledger (auth lives on this DB; a large delete adds dead-tuple bloat) — we
-- register trivial priority rules for the already-recorded rows. They age out
-- at the 90d prune; these rules then go inert. Additive, no ledger churn.
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
SELECT tf.target_table, bk.field_name, s.source, s.priority, NULL,
       'R19 — bookkeeping (FK/link/metadata) field; no longer recorded (writer excludes it). Rule keeps drift detector at 0 until existing rows prune.'
FROM (VALUES ('dia.contacts'), ('gov.contacts')) AS tf(target_table)
CROSS JOIN (VALUES ('property_id'), ('sale_id'), ('sale_role'), ('data_source')) AS bk(field_name)
CROSS JOIN (VALUES ('costar_sidebar', 60), ('rca_sidebar', 50)) AS s(source, priority)
ON CONFLICT (target_table, field_name, source) DO NOTHING;
