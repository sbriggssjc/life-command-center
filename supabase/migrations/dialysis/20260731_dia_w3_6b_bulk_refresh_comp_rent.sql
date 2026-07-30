-- ============================================================================
-- W3.6b — bulk-refresh the OPEN dia cap_mismatch comp-review rows off the ENGINE
-- net rent and auto-resolve the reconciling set. Applied live to dia
-- (zqzrriwuavgrquhisnoa) 2026-07-31.
-- ============================================================================
-- dia parallel of the gov W3.6b bulk refresh. The shared comps producer divides
-- PRICE into the comp's annual_rent (a stale properties-derived figure) while
-- dia_compute_cap_rate already reconciles the deal to its reliable cap_rate_final
-- from the same active-lease net rent (dia cap = net rent, NNN — not NOI). The
-- producer now derives implied_cap from the engine (mcp/comps-tools.js +
-- dia_engine_rent_batch); this one-time migration recomputes the currently-open
-- rows off the engine net rent and AUTO-RESOLVES the ones that now reconcile to
-- reliable within the 75 bps tolerance (note 'w3_6b_noi_source_fix'), leaving
-- genuine conflicts and engine-null rows OPEN.
--
-- Grounded live 2026-07-31 (before): 50 open cap_mismatch; of those 27 reconcile
-- via dia_compute_cap_rate, 18 genuinely conflict, 5 engine-null.
--
-- NO properties write-through on dia (unlike gov's confirmed-lease NOI): dia has
-- no field_value_provenance ledger and its properties census carries a write
-- guard (census_plausibility) — the conservative choice is to fix the queue's
-- basis only. The producer change is what stops the class recurring.
--
-- Discipline: reversible (snapshot table `_dia_w3_6b_bulk_refresh_backup`),
-- idempotent (only status='open' rows), conservative, no fabrication. REVERSAL
-- RUNBOOK at the foot.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._dia_w3_6b_bulk_refresh_backup (
  backup_id        bigserial PRIMARY KEY,
  taken_at         timestamptz NOT NULL DEFAULT now(),
  queue_id         bigint,
  sale_id          text,
  property_id      bigint,
  q_status         text,
  q_implied_cap    numeric,
  q_detail         jsonb,
  q_resolved_at    timestamptz,
  q_resolution_note text,
  note             text
);

CREATE TEMP TABLE _w3_6b_refresh ON COMMIT DROP AS
SELECT q.id AS queue_id, q.sale_id,
       CASE WHEN q.property_id ~ '^\d+$' THEN q.property_id::bigint END AS pid,
       q.reliable_cap, q.implied_cap AS old_implied, q.sale_price, q.sale_date,
       e.cap_rate AS engine_cap, e.rent_used AS engine_rent, e.rent_source, e.rent_confidence
FROM public.dia_comp_review_queue q
LEFT JOIN LATERAL public.dia_compute_cap_rate(
           CASE WHEN q.property_id ~ '^\d+$' THEN q.property_id::bigint END,
           q.sale_price, q.sale_date) e ON true
WHERE q.status = 'open' AND 'cap_mismatch' = ANY(q.flags);

ALTER TABLE _w3_6b_refresh ADD COLUMN new_implied numeric;
ALTER TABLE _w3_6b_refresh ADD COLUMN reconciles boolean;
UPDATE _w3_6b_refresh
SET new_implied = CASE WHEN engine_rent IS NOT NULL AND sale_price > 0
        THEN round((engine_rent / sale_price)::numeric, 6) ELSE old_implied END;
UPDATE _w3_6b_refresh
SET reconciles = (engine_rent IS NOT NULL AND reliable_cap IS NOT NULL
                  AND abs(new_implied - reliable_cap) <= 0.0075);

INSERT INTO public._dia_w3_6b_bulk_refresh_backup
  (queue_id, sale_id, property_id, q_status, q_implied_cap, q_detail, q_resolved_at, q_resolution_note, note)
SELECT q.id, q.sale_id, r.pid, q.status, q.implied_cap, q.detail, q.resolved_at, q.resolution_note,
       'W3.6b bulk-refresh pre-fix snapshot'
FROM public.dia_comp_review_queue q JOIN _w3_6b_refresh r ON r.queue_id = q.id
WHERE r.engine_rent IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public._dia_w3_6b_bulk_refresh_backup b WHERE b.queue_id = q.id);

UPDATE public.dia_comp_review_queue q
SET implied_cap = r.new_implied,
    detail = COALESCE(q.detail,'{}'::jsonb) || jsonb_build_object(
               'implied_cap', r.new_implied,
               'implied_basis', jsonb_build_object(
                  'value', r.engine_rent, 'kind', 'RENT',
                  'source', 'engine:' || COALESCE(r.rent_source,'dia_compute_cap_rate')
                            || ' (' || COALESCE(r.rent_confidence,'?') || ')',
                  'as_of', r.sale_date, 'engine_used', true)),
    status = CASE WHEN r.reconciles THEN 'resolved' ELSE q.status END,
    resolved_at = CASE WHEN r.reconciles THEN now() ELSE q.resolved_at END,
    resolution_note = CASE WHEN r.reconciles THEN
        'w3_6b_noi_source_fix: implied recomputed from engine net rent ('
        || COALESCE(r.rent_source,'?') || '/' || COALESCE(r.rent_confidence,'?') || ') = '
        || round(r.new_implied*100, 2) || '% reconciles to reliable ' || round(r.reliable_cap*100, 2)
        || '%. Reversible via _dia_w3_6b_bulk_refresh_backup.'
      ELSE q.resolution_note END
FROM _w3_6b_refresh r
WHERE q.id = r.queue_id AND r.engine_rent IS NOT NULL;

COMMIT;

-- ── REVERSAL RUNBOOK ─────────────────────────────────────────────────────────
--   UPDATE public.dia_comp_review_queue q
--   SET implied_cap=b.q_implied_cap, detail=b.q_detail, status=b.q_status,
--       resolved_at=b.q_resolved_at, resolution_note=b.q_resolution_note
--   FROM public._dia_w3_6b_bulk_refresh_backup b WHERE q.id=b.queue_id;
-- ============================================================================
