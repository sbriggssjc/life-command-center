-- Migration: cap rate and rent anchor columns for dialysis DB
-- Adds stated vs calculated cap rate tracking on sales_transactions
-- and confirmed rent anchor + lease escalation metadata on properties.
-- Does not drop or alter any existing columns.

BEGIN;

-- sales_transactions: cap rate provenance
ALTER TABLE public.sales_transactions
    ADD COLUMN IF NOT EXISTS stated_cap_rate        NUMERIC(6,4),
    ADD COLUMN IF NOT EXISTS calculated_cap_rate    NUMERIC(6,4),
    ADD COLUMN IF NOT EXISTS rent_at_sale           NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS rent_source            TEXT,
    ADD COLUMN IF NOT EXISTS cap_rate_confidence    TEXT;

COMMENT ON COLUMN public.sales_transactions.stated_cap_rate
    IS 'Raw cap rate from CoStar, never recalculated.';
COMMENT ON COLUMN public.sales_transactions.calculated_cap_rate
    IS 'Cap rate derived from confirmed rent schedule.';
COMMENT ON COLUMN public.sales_transactions.rent_at_sale
    IS 'Projected rent used for cap rate calculation.';
COMMENT ON COLUMN public.sales_transactions.rent_source
    IS 'Source of rent_at_sale: costar_stated | om_confirmed | lease_confirmed | projected_from_om | projected_from_lease';
COMMENT ON COLUMN public.sales_transactions.cap_rate_confidence
    IS 'Confidence tier for the calculated cap rate: low | medium | high';

-- cap_rate_confidence domain check (guarded so re-runs are safe)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sales_transactions_cap_rate_confidence_check'
    ) THEN
        ALTER TABLE public.sales_transactions
            ADD CONSTRAINT sales_transactions_cap_rate_confidence_check
            CHECK (cap_rate_confidence IN ('low','medium','high'));
    END IF;
END
$$;

-- properties: rent anchor and lease escalation
ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS anchor_rent            NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS anchor_rent_date       DATE,
    ADD COLUMN IF NOT EXISTS anchor_rent_source     TEXT,
    ADD COLUMN IF NOT EXISTS lease_commencement     DATE,
    ADD COLUMN IF NOT EXISTS lease_bump_pct         NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS lease_bump_interval_mo INTEGER;

COMMENT ON COLUMN public.properties.anchor_rent
    IS 'Confirmed NOI anchor rent from OM or lease.';
COMMENT ON COLUMN public.properties.anchor_rent_date
    IS 'Effective date of the anchor rent.';
COMMENT ON COLUMN public.properties.anchor_rent_source
    IS 'Source of anchor rent: costar_stated | om_confirmed | lease_confirmed';
COMMENT ON COLUMN public.properties.lease_commencement
    IS 'Lease start date.';
COMMENT ON COLUMN public.properties.lease_bump_pct
    IS 'Escalation percentage as a decimal, e.g. 0.10 for 10%.';
COMMENT ON COLUMN public.properties.lease_bump_interval_mo
    IS 'Escalation interval in months, e.g. 60.';

COMMIT;
