-- ============================================================================
-- W3.6b — bulk-refresh the OPEN gov cap_mismatch comp-review rows off the ENGINE
-- NOI, auto-resolve the reconciling set, and write-through confirmed-lease NOI to
-- properties for the high-confidence active-lease-anchored subset (id=1 shape).
-- Applied live to gov (scknotsqkcheojiaewwh) 2026-07-31.
-- ============================================================================
-- W3.6 fixed the reopened id=1 (property 9388) at source and documented the
-- SYSTEMIC pattern: 54/61 open cap_mismatch rows carry a stale estimated
-- properties.noi (@2026-03-31) as the implied-cap basis while gov_compute_cap_rate
-- already reconciles the deal to its reliable ingested cap. W3.6b is the durable
-- remediation:
--   (A) the comp PRODUCER now derives implied_cap from the engine NOI
--       (mcp/comps-tools.js + gov_engine_noi_batch) — so this class stops
--       recurring on every re-pull; and
--   (B) this one-time migration recomputes the currently-open rows off the engine
--       NOI, AUTO-RESOLVES the ones that now reconcile to reliable within the
--       75 bps tolerance (note 'w3_6b_noi_source_fix'), leaves genuine conflicts
--       and engine-null rows OPEN, and
--   (C) writes the confirmed-sale NOI THROUGH to properties.noi (confirmed_sale /
--       confirmed_document provenance) — but ONLY where a HIGH-confidence ACTIVE
--       LEASE anchors it (income_source lease_rent_minus_anchored_opex/lease_active/
--       gsa_lease_active AND income_confidence='high'), never overwriting a
--       confirmed/manual value and never writing from an estimate (id=1 fix shape).
--
-- Grounded live 2026-07-31 (before): 60 open cap_mismatch + 1 resolved (id=1).
-- Of the 60 open: 53 reconcile via the engine, 5 genuinely conflict, 2 engine-null.
--
-- Discipline: reversible (snapshot table `_gov_w3_6b_bulk_refresh_backup` for BOTH
-- queue rows and property values), idempotent (only touches status='open' rows /
-- estimate-sourced properties), provenance-tagged (confirmed_document),
-- conservative (write-through gated on a high-confidence active lease), no
-- fabrication (every value is engine-reconciled from a confirmed sale + active
-- lease). REVERSAL RUNBOOK at the foot.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._gov_w3_6b_bulk_refresh_backup (
  backup_id        bigserial PRIMARY KEY,
  taken_at         timestamptz NOT NULL DEFAULT now(),
  kind             text NOT NULL,           -- 'queue_row' | 'property_noi'
  queue_id         bigint,
  sale_id          text,
  property_id      bigint,
  -- queue snapshot
  q_status         text,
  q_implied_cap    numeric,
  q_detail         jsonb,
  q_resolved_at    timestamptz,
  q_resolution_note text,
  -- property snapshot
  p_noi            numeric,
  p_noi_source     text,
  p_noi_as_of_date date,
  p_gross_rent     numeric,
  p_gross_rent_psf numeric,
  note             text
);

-- ── Compute the engine NOI for every OPEN cap_mismatch row ───────────────────
CREATE TEMP TABLE _w3_6b_refresh ON COMMIT DROP AS
SELECT q.id AS queue_id,
       q.sale_id,
       CASE WHEN q.property_id ~ '^\d+$' THEN q.property_id::bigint END AS pid,
       q.reliable_cap,
       q.implied_cap AS old_implied,
       q.sale_price,
       q.sale_date,
       e.cap_rate         AS engine_cap,
       e.income_used      AS engine_noi,
       e.income_source,
       e.income_confidence,
       e.income_type,
       e.rent_gross
FROM public.gov_comp_review_queue q
LEFT JOIN LATERAL public.gov_compute_cap_rate(
           CASE WHEN q.property_id ~ '^\d+$' THEN q.property_id::bigint END,
           q.sale_price, q.sale_date) e ON true
WHERE q.status = 'open' AND 'cap_mismatch' = ANY(q.flags);

ALTER TABLE _w3_6b_refresh ADD COLUMN new_implied numeric;
ALTER TABLE _w3_6b_refresh ADD COLUMN reconciles boolean;
UPDATE _w3_6b_refresh
SET new_implied = CASE
      WHEN income_type='NOI' AND engine_noi IS NOT NULL AND sale_price > 0
        THEN round((engine_noi / sale_price)::numeric, 6)
      ELSE old_implied END;
UPDATE _w3_6b_refresh
SET reconciles = (income_type='NOI' AND engine_noi IS NOT NULL
                  AND reliable_cap IS NOT NULL
                  AND abs(new_implied - reliable_cap) <= 0.0075);

-- ── (C) WRITE-THROUGH: confirmed-sale NOI → properties, high-conf active lease ─
-- Per property, take the latest qualifying sale. Gate: engine reconciles, income
-- from an ACTIVE LEASE at HIGH confidence, current noi is an ESTIMATE (never a
-- confirmed/manual value). Value = confirmed-sale NOI (price × reliable ingested
-- cap) so implied == reliable exactly; gross_rent from the engine's validated
-- active-lease rent (id=1 shape).
CREATE TEMP TABLE _w3_6b_writethrough ON COMMIT DROP AS
SELECT DISTINCT ON (r.pid)
       r.pid,
       round((r.sale_price * r.reliable_cap)::numeric, 2) AS new_noi,
       r.rent_gross AS new_gross_rent,
       r.sale_date,
       p.sf_leased
FROM _w3_6b_refresh r
JOIN public.properties p ON p.property_id = r.pid
WHERE r.reconciles
  AND r.income_type = 'NOI'
  AND r.engine_noi IS NOT NULL
  AND r.income_confidence = 'high'
  AND r.income_source IN ('lease_rent_minus_anchored_opex','lease_active','gsa_lease_active')
  AND r.reliable_cap IS NOT NULL
  AND COALESCE(p.noi_source,'') NOT IN ('confirmed_sale','manual')
ORDER BY r.pid, r.sale_date DESC NULLS LAST;

-- snapshot the properties we are about to write
INSERT INTO public._gov_w3_6b_bulk_refresh_backup
  (kind, property_id, p_noi, p_noi_source, p_noi_as_of_date, p_gross_rent, p_gross_rent_psf, note)
SELECT 'property_noi', p.property_id, p.noi, p.noi_source, p.noi_as_of_date, p.gross_rent, p.gross_rent_psf,
       'W3.6b write-through pre-fix snapshot'
FROM public.properties p
JOIN _w3_6b_writethrough w ON w.pid = p.property_id
WHERE NOT EXISTS (SELECT 1 FROM public._gov_w3_6b_bulk_refresh_backup b
                  WHERE b.kind='property_noi' AND b.property_id = p.property_id);

UPDATE public.properties p
SET noi            = w.new_noi,
    noi_source     = 'confirmed_sale',
    noi_as_of_date = w.sale_date,
    gross_rent     = COALESCE(w.new_gross_rent, p.gross_rent),
    gross_rent_psf = CASE WHEN COALESCE(w.new_gross_rent, p.gross_rent) IS NOT NULL AND p.sf_leased > 0
                          THEN round((COALESCE(w.new_gross_rent, p.gross_rent) / p.sf_leased)::numeric, 2)
                          ELSE p.gross_rent_psf END
FROM _w3_6b_writethrough w
WHERE p.property_id = w.pid;

-- provenance: confirmed_document tier (mirrors the id=1 W3.6 fix)
INSERT INTO public.field_value_provenance
  (provenance_id, table_name, record_id, field_name, authority_source, authority_rank,
   last_confirmed_at, manual_override, created_at, updated_at)
SELECT gen_random_uuid(), 'properties', w.pid::text, f.field_name, 'confirmed_document', f.rank,
       now(), false, now(), now()
FROM _w3_6b_writethrough w
CROSS JOIN (VALUES ('noi', 3), ('gross_rent', 5)) AS f(field_name, rank)
ON CONFLICT (table_name, record_id, field_name)
DO UPDATE SET authority_source = EXCLUDED.authority_source, authority_rank = EXCLUDED.authority_rank,
             last_confirmed_at = EXCLUDED.last_confirmed_at, updated_at = now();

-- ── (B) snapshot + refresh the queue rows, auto-resolve the reconciling set ───
INSERT INTO public._gov_w3_6b_bulk_refresh_backup
  (kind, queue_id, sale_id, property_id, q_status, q_implied_cap, q_detail, q_resolved_at, q_resolution_note, note)
SELECT 'queue_row', q.id, q.sale_id, r.pid, q.status, q.implied_cap, q.detail, q.resolved_at, q.resolution_note,
       'W3.6b bulk-refresh pre-fix snapshot'
FROM public.gov_comp_review_queue q
JOIN _w3_6b_refresh r ON r.queue_id = q.id
WHERE r.income_type='NOI' AND r.engine_noi IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public._gov_w3_6b_bulk_refresh_backup b
                  WHERE b.kind='queue_row' AND b.queue_id = q.id);

UPDATE public.gov_comp_review_queue q
SET implied_cap = r.new_implied,
    detail = COALESCE(q.detail,'{}'::jsonb) || jsonb_build_object(
               'implied_cap', r.new_implied,
               'implied_basis', jsonb_build_object(
                  'value', r.engine_noi,
                  'kind', 'NOI',
                  'source', 'engine:' || COALESCE(r.income_source,'gov_compute_cap_rate')
                            || ' (' || COALESCE(r.income_confidence,'?') || ')',
                  'as_of', r.sale_date,
                  'engine_used', true)),
    status = CASE WHEN r.reconciles THEN 'resolved' ELSE q.status END,
    resolved_at = CASE WHEN r.reconciles THEN now() ELSE q.resolved_at END,
    resolution_note = CASE WHEN r.reconciles THEN
        'w3_6b_noi_source_fix: implied recomputed from engine NOI ('
        || COALESCE(r.income_source,'?') || '/' || COALESCE(r.income_confidence,'?') || ') = '
        || round(r.new_implied*100, 2) || '% reconciles to reliable '
        || round(r.reliable_cap*100, 2) || '%. Reversible via _gov_w3_6b_bulk_refresh_backup.'
      ELSE q.resolution_note END
FROM _w3_6b_refresh r
WHERE q.id = r.queue_id
  AND r.income_type='NOI' AND r.engine_noi IS NOT NULL;

COMMIT;

-- ── REVERSAL RUNBOOK ─────────────────────────────────────────────────────────
-- 1) Restore the written properties:
--   UPDATE public.properties p
--   SET noi=b.p_noi, noi_source=b.p_noi_source, noi_as_of_date=b.p_noi_as_of_date,
--       gross_rent=b.p_gross_rent, gross_rent_psf=b.p_gross_rent_psf
--   FROM public._gov_w3_6b_bulk_refresh_backup b
--   WHERE b.kind='property_noi' AND p.property_id=b.property_id;
--   DELETE FROM public.field_value_provenance fvp
--     USING public._gov_w3_6b_bulk_refresh_backup b
--    WHERE b.kind='property_noi' AND fvp.table_name='properties'
--      AND fvp.record_id=b.property_id::text AND fvp.field_name IN ('noi','gross_rent')
--      AND fvp.authority_source='confirmed_document';
-- 2) Restore the queue rows:
--   UPDATE public.gov_comp_review_queue q
--   SET implied_cap=b.q_implied_cap, detail=b.q_detail, status=b.q_status,
--       resolved_at=b.q_resolved_at, resolution_note=b.q_resolution_note
--   FROM public._gov_w3_6b_bulk_refresh_backup b
--   WHERE b.kind='queue_row' AND q.id=b.queue_id;
-- ============================================================================
