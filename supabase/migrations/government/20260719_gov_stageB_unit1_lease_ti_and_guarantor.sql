-- ============================================================================
-- Stage B Unit 1 — lease TI-amortization store + guarantor column (GOVERNMENT)
-- 2026-06-11 · written, NOT applied
--
-- The lease extractor produces FACTUAL lease enrichment. Two net-new artifacts:
--   • lease_ti_amortization — the TI excess schedule (the gov-engine bifurcation
--     input, #64). Modeled on dia.lease_rent_schedule (lease-keyed, per-year).
--     Shape coordinated with #64 so the gov engine reads it directly.
--   • leases.guarantor — gov.leases has tenant_agency but no guarantor column.
--     dia.leases ALREADY carries `guarantor`, so we add the SAME column name to
--     gov (not guarantor_name) to keep the two domains' writer path identical.
--     The guarantor is ALSO minted as a first-class entity + guaranteed_by edge
--     (in JS via ensureEntityLink) so the cross-deal search resolves.
-- Additive + idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lease_ti_amortization (
  id               bigserial PRIMARY KEY,
  lease_id         bigint,                 -- → leases.lease_id (nullable: pre-link)
  property_id      bigint NOT NULL,
  schedule_year    integer,
  period_start     date,
  period_end       date,
  ti_excess_amount numeric,                -- annual above-standard TI amount
  cumulative_ti    numeric,
  burn_off_date    date,                   -- when the TI amortization burns off
  source           text NOT NULL DEFAULT 'folder_feed_lease',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lease_ti_property ON public.lease_ti_amortization(property_id);
CREATE INDEX IF NOT EXISTS ix_lease_ti_lease ON public.lease_ti_amortization(lease_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_ti_lease_year
  ON public.lease_ti_amortization(COALESCE(lease_id, 0), property_id, COALESCE(schedule_year, 0));

COMMENT ON TABLE public.lease_ti_amortization IS
  'Stage B Unit 1 — per-year TI excess (above-standard) amortization schedule from lease docs. Lease-keyed; the gov-engine (#64) bifurcation / NOI input. Modeled on dia.lease_rent_schedule.';

ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS guarantor text;
COMMENT ON COLUMN public.leases.guarantor IS
  'Stage B Unit 1 — lease guarantor (credit parent, e.g. Total Renal Care guarantees DaVita leases). Also minted as a first-class entity + guaranteed_by edge for cross-deal search. Mirrors dia.leases.guarantor.';
