-- ============================================================================
-- Stage B Unit 1 — lease TI-amortization store (DIALYSIS)
-- 2026-06-11 · written, NOT applied
--
-- dia.leases ALREADY carries `guarantor` (+ guarantor_id), so no column add here
-- — the extractor writes the existing column and mints the guarantor entity.
-- This adds only the TI-amortization schedule store (mirror of the gov table,
-- modeled on the existing dia.lease_rent_schedule). Additive + idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lease_ti_amortization (
  id               bigserial PRIMARY KEY,
  lease_id         bigint,
  property_id      bigint NOT NULL,
  schedule_year    integer,
  period_start     date,
  period_end       date,
  ti_excess_amount numeric,
  cumulative_ti    numeric,
  burn_off_date    date,
  source           text NOT NULL DEFAULT 'folder_feed_lease',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lease_ti_property ON public.lease_ti_amortization(property_id);
CREATE INDEX IF NOT EXISTS ix_lease_ti_lease ON public.lease_ti_amortization(lease_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_ti_lease_year
  ON public.lease_ti_amortization(COALESCE(lease_id, 0), property_id, COALESCE(schedule_year, 0));

COMMENT ON TABLE public.lease_ti_amortization IS
  'Stage B Unit 1 — per-year TI excess amortization schedule from lease docs (mirror of gov). Lease-keyed; modeled on the existing dia.lease_rent_schedule.';
