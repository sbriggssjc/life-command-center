-- ============================================================================
-- Stage B Unit 1 — lease_ti_amortization unique-index fix (DIALYSIS)
-- 2026-06-13 · corrective; applied live (table empty, 0 rows)
--
-- dia.leases.lease_id is integer (fits the existing TI bigint lease_id — no type
-- change needed here). But the unique index was a COALESCE() expression index,
-- which PostgREST's `on_conflict=lease_id,property_id,schedule_year` upsert can't
-- infer (42P10) — so the TI insert would fail. Replace it with a plain unique
-- index on those exact columns, NULLS NOT DISTINCT (PG15+) so null lease_id /
-- schedule_year still dedupe. Idempotent.
-- ============================================================================

DROP INDEX IF EXISTS public.uq_lease_ti_lease_year;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_ti_lease_year
  ON public.lease_ti_amortization (lease_id, property_id, schedule_year) NULLS NOT DISTINCT;
