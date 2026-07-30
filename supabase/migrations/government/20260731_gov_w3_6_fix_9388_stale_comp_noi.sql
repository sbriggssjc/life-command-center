-- ============================================================================
-- W3.6 fix 4 — gov_comp_review_queue id=1 (70 Commercial St, Concord NH):
-- fix the STALE NOI at source. Applied live to gov (scknotsqkcheojiaewwh)
-- 2026-07-31; this file records the exact change + the reversal runbook.
-- ============================================================================
--
-- FINDING (grounded live). Sale 6a20b2fb-0fe8-4de4-8b16-976b4d700d0f: property
-- 9388 sold $8,800,000 on 2026-06-23 with an ingested sold_cap_rate = 0.0371
-- (3.71% = the "reliable" cap). The comp-review producer computes the GOV
-- implied cap as properties.noi / sale_price (mcp/comps-tools.js
-- computeReviewSignals). properties.noi was 186,053.78 with
-- noi_source='estimated_comp_ratio', noi_as_of_date='2026-03-31' — a STALE batch
-- estimate derived from the equally-stale properties.gross_rent=264,898.88.
-- 186,053.78 / 8,800,000 = 0.021142 = the 2.11% "engine implied" the reviewer saw.
-- Scott's "rent-implied ~3.0%" = the stale gross_rent / price
-- (264,898.88 / 8,800,000 = 3.01%).
--
-- The authoritative gov cap engine already reconciles:
--   gov_compute_cap_rate(9388, 8800000, '2026-06-23')
--     -> 0.0371, NOI 326,480, lease_rent_minus_anchored_opex, HIGH confidence.
-- It uses the CURRENT active GSA lease (fc810def, commenced 2021-06-25,
-- annual_rent 326,838.39) minus the sale-anchored opex (~$358 => effectively
-- NNN). So the STALE INPUT is properties.noi (and the gross_rent it was
-- estimated from) — NOT the ingested cap and NOT the engine.
--
-- FIX AT SOURCE. Set the confirmed-sale NOI (price x ingested cap = 326,480,
-- noi_source='confirmed_sale', as-of the sale date) and refresh gross_rent from
-- the active lease (326,838.39). Both supersede the estimated_comp_ratio value.
-- After this, the producer's implied cap = 326,480 / 8,800,000 = 0.0371 = the
-- reliable cap, so the row no longer flags cap_mismatch on re-pull.
--
-- ⚠️ SYSTEMIC PATTERN (grounded live 2026-07-31 across the 61 OPEN cap_mismatch
-- rows). This is NOT a one-off: 55/61 carry an ESTIMATED NOI (estimated_comp_ratio
-- or estimated_sale_ratio, almost all as-of 2026-03-31), and 54/61 reconcile to
-- their reliable cap under gov_compute_cap_rate (within the 75 bps tolerance) —
-- 48/61 are exactly this row's shape (stale estimated NOI feeds implied_cap while
-- the engine already agrees with the reliable ingested cap). Only 2/61 have a
-- NULL engine cap (genuine out-of-band data). The durable remediation is to have
-- the comp-review producer divide price into the ENGINE'S NOI
-- (gov_compute_cap_rate) rather than the stale properties.noi, OR to refresh
-- properties.noi from the engine/confirmed sales in bulk — tracked as a
-- follow-up. This migration fixes only the reopened id=1 at source and documents
-- the pattern; it does NOT mass-mutate the other 53 (that is a separate,
-- value-gated remediation).
--
-- Discipline: reversible (snapshot table), idempotent (guarded on the stale
-- state), provenance-tagged (field_value_provenance, confirmed_document),
-- conservative (single property, unambiguous confirmed sale). No fabrication —
-- every number is a confirmed sale / active-lease fact.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._gov_w3_6_comp_source_fix_backup (
  backup_id       bigserial PRIMARY KEY,
  taken_at        timestamptz NOT NULL DEFAULT now(),
  property_id     bigint NOT NULL,
  noi             numeric,
  noi_source      text,
  noi_as_of_date  date,
  gross_rent      numeric,
  gross_rent_psf  numeric,
  note            text
);

INSERT INTO public._gov_w3_6_comp_source_fix_backup
  (property_id, noi, noi_source, noi_as_of_date, gross_rent, gross_rent_psf, note)
SELECT property_id, noi, noi_source, noi_as_of_date, gross_rent, gross_rent_psf,
       'W3.6 pre-fix snapshot: stale estimated_comp_ratio NOI @2026-03-31 vs confirmed 3.71% sale 6a20b2fb'
FROM public.properties
WHERE property_id = 9388
  AND NOT EXISTS (SELECT 1 FROM public._gov_w3_6_comp_source_fix_backup b WHERE b.property_id = 9388);

UPDATE public.properties
SET noi            = 326480,
    noi_source     = 'confirmed_sale',
    noi_as_of_date = DATE '2026-06-23',
    gross_rent     = 326838.39,
    gross_rent_psf = round(326838.39 / NULLIF(sf_leased, 0), 2)
WHERE property_id = 9388
  AND noi_source = 'estimated_comp_ratio';   -- guard: only from the stale state (idempotent)

INSERT INTO public.field_value_provenance
  (provenance_id, table_name, record_id, field_name, authority_source, authority_rank,
   last_confirmed_at, manual_override, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'properties', '9388', 'noi',        'confirmed_document', 3, now(), false, now(), now()),
  (gen_random_uuid(), 'properties', '9388', 'gross_rent', 'confirmed_document', 5, now(), false, now(), now())
ON CONFLICT (table_name, record_id, field_name)
DO UPDATE SET authority_source = EXCLUDED.authority_source, authority_rank = EXCLUDED.authority_rank,
             last_confirmed_at = EXCLUDED.last_confirmed_at, updated_at = now();

UPDATE public.gov_comp_review_queue
SET status = 'resolved', resolved_at = now(),
    resolution_note = 'W3.6 (2026-07-31): fixed at source. implied_cap 2.11% came from properties.noi=186,053.78 (estimated_comp_ratio @2026-03-31). Set noi=326,480 (confirmed sale 6a20b2fb @ ingested 3.71%) + gross_rent=326,838.39 (active lease fc810def). implied_cap now reconciles to reliable 3.71%. Reversible via _gov_w3_6_comp_source_fix_backup.'
WHERE id = 1 AND sale_id = '6a20b2fb-0fe8-4de4-8b16-976b4d700d0f';

COMMIT;

-- ── REVERSAL RUNBOOK ────────────────────────────────────────────────────────
-- Restore the pre-fix property values and reopen the queue row:
--
--   UPDATE public.properties p
--   SET noi = b.noi, noi_source = b.noi_source, noi_as_of_date = b.noi_as_of_date,
--       gross_rent = b.gross_rent, gross_rent_psf = b.gross_rent_psf
--   FROM public._gov_w3_6_comp_source_fix_backup b
--   WHERE p.property_id = b.property_id AND b.property_id = 9388;
--
--   DELETE FROM public.field_value_provenance
--    WHERE table_name='properties' AND record_id='9388' AND field_name IN ('noi','gross_rent');
--
--   UPDATE public.gov_comp_review_queue
--     SET status='open', resolved_at=NULL,
--         resolution_note='Reopened (W3.6 reversal)'
--    WHERE id=1;
-- ============================================================================
