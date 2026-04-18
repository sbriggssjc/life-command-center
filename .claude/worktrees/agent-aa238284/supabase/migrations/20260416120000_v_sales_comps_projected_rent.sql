-- ============================================================================
-- Migration: v_sales_comps — project rent to CURRENT_DATE
-- Target: Dialysis domain Supabase (DIA_SUPABASE_URL)
-- Life Command Center
--
-- Problem:
--   v_sales_comps returned leases.annual_rent as the `rent` column. annual_rent
--   is the Year-1 base rent on the lease, so every escalated lease displayed
--   a rent lower than what the tenant is actually paying today. Cap-rate math
--   downstream of that column was off by the cumulative escalations.
--
-- Fix:
--   Replace the `rent` column with a projection of the anchor rent to
--   CURRENT_DATE using the property's escalation metadata (lease_bump_pct,
--   lease_bump_interval_mo). Projection rules mirror the JS/Python helpers
--   already used by the cap-rate recalc pipeline:
--     - api/_shared/rent-projection.js — projectRentAtDate()
--     - pipeline/cap_rate_recalc.py    — project_rent_at_date()
--     - supabase/migrations/20260414192825_cap_rate_rent_anchor.sql
--
--   anchor            = p.anchor_rent            when p.anchor_rent IS NOT NULL
--                       AND p.anchor_rent_source IN ('lease_confirmed',
--                                                    'om_confirmed')
--                     ELSE l.annual_rent
--   anchor_date       = COALESCE(p.anchor_rent_date, l.lease_start,
--                                p.lease_commencement)
--   bump_pct          = COALESCE(p.lease_bump_pct, 0)
--   bump_interval_mo  = COALESCE(p.lease_bump_interval_mo, 12) when bump_pct<>0
--                     ELSE 0
--   target            = CURRENT_DATE
--
--   A new `base_rent` column exposes the raw Y1 figure so callers can still
--   render it as a secondary value.
--
-- View consumers (checked for column-shape assumptions before shipping):
--   - detail.js:7787 / 7795 — filters on buyer_name / seller_name, orders by
--     sale_date.desc (both preserved below).
--   - dialysis.js — the current Sales Comps table bypasses the view and
--     queries sales_transactions directly (see loadDiaSalesCompsFromTxns),
--     so the UI does not regress on this change. A follow-up can switch
--     that loader to the view to pick up the projection.
--   - office-addins/excel/taskpane.html + office-addins/word/taskpane.html —
--     read comparable_sales from lcc.assembleContext (not PostgREST directly)
--     and only reference address / sale_price / cap_rate. Neither column
--     shape is affected.
--   - app.js:exportCompsToXlsx() — reads price_psf / cap_rate / rba / etc.
--     but does NOT reference rent or rent_per_sf from the view, so the xlsx
--     export is unaffected by the semantic change.
--
-- This migration is safe to re-run: the helper function uses OR REPLACE and
-- the view is dropped + recreated. No other DB objects depend on v_sales_comps
-- (it is a leaf read view exposed only to the PostgREST allowlist).
-- ============================================================================

BEGIN;

-- ── Helper: projection function ─────────────────────────────────────────────
-- Straight-line step-escalation schedule. Bumps fall on lease-commencement
-- anniversaries (true lease bump dates) when available, otherwise the anchor
-- date. Forward projection multiplies, backward divides; pct=0 or a zero
-- bump interval produces a flat schedule. Returns NULL if any required input
-- (anchor_rent, anchor_date, target_date) is missing.

CREATE OR REPLACE FUNCTION public.dia_project_rent_at_date(
    anchor_rent          NUMERIC,
    anchor_date          DATE,
    target_date          DATE,
    bump_pct             NUMERIC,
    bump_interval_mo     INTEGER,
    lease_commencement   DATE DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    base_d          DATE    := COALESCE(lease_commencement, anchor_date);
    pct             NUMERIC := COALESCE(bump_pct, 0);
    interval_mo     INTEGER := COALESCE(bump_interval_mo, 0);
    months_anchor   INTEGER;
    months_target   INTEGER;
    bumps_anchor    INTEGER;
    bumps_target    INTEGER;
    delta           INTEGER;
BEGIN
    IF anchor_rent IS NULL OR anchor_date IS NULL OR target_date IS NULL THEN
        RETURN NULL;
    END IF;

    -- Flat schedule when no escalation is defined.
    IF pct = 0 OR interval_mo <= 0 THEN
        RETURN anchor_rent;
    END IF;

    -- Whole-month diff with day-of-month adjustment, matching monthsBetween()
    -- in api/_shared/rent-projection.js. AGE() already subtracts a month when
    -- later.day < earlier.day, so years*12 + months is the correct count.
    months_anchor := EXTRACT(YEAR  FROM AGE(anchor_date, base_d))::INT * 12
                   + EXTRACT(MONTH FROM AGE(anchor_date, base_d))::INT;
    months_target := EXTRACT(YEAR  FROM AGE(target_date, base_d))::INT * 12
                   + EXTRACT(MONTH FROM AGE(target_date, base_d))::INT;

    bumps_anchor := CASE WHEN months_anchor <= 0 THEN 0
                         ELSE months_anchor / interval_mo END;
    bumps_target := CASE WHEN months_target <= 0 THEN 0
                         ELSE months_target / interval_mo END;

    delta := bumps_target - bumps_anchor;

    IF delta = 0 THEN
        RETURN anchor_rent;
    ELSIF delta > 0 THEN
        RETURN anchor_rent * POWER(1 + pct, delta);
    ELSE
        RETURN anchor_rent / POWER(1 + pct, -delta);
    END IF;
END;
$$;

COMMENT ON FUNCTION public.dia_project_rent_at_date(
    NUMERIC, DATE, DATE, NUMERIC, INTEGER, DATE
) IS
'Step-escalation rent projection from an anchor rent to an arbitrary target '
'date. Mirrors api/_shared/rent-projection.js::projectRentAtDate and '
'pipeline/cap_rate_recalc.py::project_rent_at_date. Used by v_sales_comps to '
'expose current-date rent instead of Year-1 annual_rent.';

-- ── Recreate v_sales_comps with projected rent ──────────────────────────────
-- A CREATE OR REPLACE VIEW would refuse this change: `rent` keeps its type
-- but we are adding `base_rent` and re-declaring the whole select list, and
-- the existing column order is not guaranteed to match. DROP + CREATE is
-- safe because no DB objects depend on this view (it is a read-only surface
-- for PostgREST).

-- The live dialysis DB currently holds v_sales_comps as a MATERIALIZED VIEW
-- (converted out-of-band by an earlier fix). Drop both shapes so this
-- migration is idempotent regardless of which form the target DB has.
DROP MATERIALIZED VIEW IF EXISTS public.v_sales_comps;
DROP VIEW IF EXISTS public.v_sales_comps;

CREATE VIEW public.v_sales_comps AS
WITH current_lease AS (
    -- One lease per property, ranked active-first, then latest lease_start,
    -- then highest lease_id. Mirrors pickCurrentLease() in dialysis.js.
    SELECT DISTINCT ON (l.property_id)
        l.property_id,
        l.lease_id,
        l.tenant              AS lease_tenant,
        l.leased_area,
        l.lease_start,
        l.lease_expiration,
        l.expense_structure,
        l.annual_rent,
        l.rent_per_sf         AS lease_rent_per_sf
    FROM public.leases l
    ORDER BY
        l.property_id,
        CASE WHEN l.is_active IS TRUE OR l.status = 'active' THEN 0 ELSE 1 END,
        l.lease_start DESC NULLS LAST,
        l.lease_id    DESC
),
projected AS (
    SELECT
        s.sale_id,
        s.property_id,
        s.sale_date,
        s.recorded_date,
        s.sold_price,
        s.buyer_name,
        s.seller_name,
        s.listing_broker,
        s.procuring_broker,
        s.cap_rate,
        s.stated_cap_rate,
        s.calculated_cap_rate,
        s.cap_rate_confidence,
        s.rent_at_sale,
        s.rent_source,
        s.transaction_type,
        s.exclude_from_market_metrics,
        s.notes,
        s.data_source,

        p.address,
        p.city,
        p.state,
        p.zip_code,
        p.county,
        p.building_size,
        p.land_area,
        p.lot_sf,
        p.year_built,
        p.year_renovated,
        p.building_type,
        p.zoning,
        p.latitude,
        p.longitude,
        p.tenant              AS property_tenant,
        p.lease_commencement,
        p.lease_bump_pct,
        p.lease_bump_interval_mo,
        p.anchor_rent,
        p.anchor_rent_date,
        p.anchor_rent_source,

        cl.lease_id,
        cl.lease_tenant,
        cl.leased_area,
        cl.lease_start,
        cl.lease_expiration,
        cl.expense_structure,
        cl.annual_rent,
        cl.lease_rent_per_sf,

        -- Anchor selection (property anchor wins when confirmed).
        CASE
            WHEN p.anchor_rent IS NOT NULL
             AND p.anchor_rent_source IN ('lease_confirmed', 'om_confirmed')
                THEN p.anchor_rent
            ELSE cl.annual_rent
        END AS _anchor_rent,

        COALESCE(p.anchor_rent_date, cl.lease_start, p.lease_commencement)
            AS _anchor_date,

        COALESCE(p.lease_bump_pct, 0)::NUMERIC AS _bump_pct,

        CASE
            WHEN COALESCE(p.lease_bump_pct, 0) <> 0
                THEN COALESCE(p.lease_bump_interval_mo, 12)
            ELSE COALESCE(p.lease_bump_interval_mo, 0)
        END AS _bump_interval_mo

    FROM public.sales_transactions s
    JOIN public.properties p ON p.property_id = s.property_id
    LEFT JOIN current_lease cl ON cl.property_id = s.property_id
)
SELECT
    pr.sale_id,
    pr.property_id,

    -- Tenant: prefer lease tenant over property-level default.
    COALESCE(pr.lease_tenant, pr.property_tenant) AS tenant_operator,

    pr.address,
    pr.city,
    pr.state,
    pr.zip_code,
    pr.county,
    pr.land_area,
    pr.lot_sf,
    pr.year_built,
    pr.year_renovated,
    pr.building_type,
    pr.zoning,
    pr.latitude,
    pr.longitude,
    pr.building_size AS rba,

    -- NEW SEMANTICS: rent is now the projected current rent.
    public.dia_project_rent_at_date(
        pr._anchor_rent,
        pr._anchor_date,
        CURRENT_DATE,
        pr._bump_pct,
        pr._bump_interval_mo,
        pr.lease_commencement
    ) AS rent,

    -- Y1 base rent preserved for callers that still want to show it.
    pr.annual_rent AS base_rent,

    -- rent_per_sf = projected rent / leased_area.
    CASE
        WHEN pr.leased_area IS NOT NULL AND pr.leased_area > 0 THEN
            public.dia_project_rent_at_date(
                pr._anchor_rent,
                pr._anchor_date,
                CURRENT_DATE,
                pr._bump_pct,
                pr._bump_interval_mo,
                pr.lease_commencement
            ) / pr.leased_area
        ELSE NULL
    END AS rent_per_sf,

    pr.lease_id,
    pr.leased_area,
    pr.lease_start,
    pr.lease_expiration,
    pr.expense_structure     AS expenses,
    pr.lease_commencement,
    pr.lease_bump_pct,
    pr.lease_bump_interval_mo,

    -- Pricing + cap rate.
    pr.sold_price            AS price,
    CASE
        WHEN pr.sold_price IS NOT NULL AND pr.sold_price > 0
         AND pr.building_size IS NOT NULL AND pr.building_size > 0
            THEN pr.sold_price / pr.building_size
        ELSE NULL
    END                      AS price_per_sf,
    -- Cap rate preference: explicit cap_rate → calculated → stated. This
    -- matches normalizeSalesTxnRow() in dialysis.js.
    COALESCE(pr.cap_rate, pr.calculated_cap_rate, pr.stated_cap_rate)
                             AS cap_rate,
    pr.stated_cap_rate,
    pr.calculated_cap_rate,
    pr.cap_rate_confidence,
    pr.rent_at_sale,
    pr.rent_source,

    -- Date aliases. Consumers variously expect `sale_date` (detail.js) or
    -- `sold_date` (legacy dialysis.js.backup). Expose both.
    pr.sale_date,
    pr.sale_date             AS sold_date,
    pr.recorded_date,

    -- Counterparty aliases for the same reason.
    pr.buyer_name,
    pr.seller_name,
    pr.buyer_name            AS buyer,
    pr.seller_name           AS seller,
    pr.listing_broker,
    pr.procuring_broker,

    pr.transaction_type,
    pr.exclude_from_market_metrics,
    pr.notes,
    pr.data_source,

    -- Surface the anchor inputs so the UI can explain a surprising projection
    -- without a second round-trip.
    pr.anchor_rent,
    pr.anchor_rent_date,
    pr.anchor_rent_source
FROM projected pr;

COMMENT ON VIEW public.v_sales_comps IS
'Sales-comp read surface for the dialysis domain. `rent` is the rent '
'projected to CURRENT_DATE using the property''s escalation metadata '
'(see dia_project_rent_at_date). `base_rent` preserves the Year-1 '
'annual_rent for callers that want to show it as a secondary value. '
'`rent_per_sf` is projected rent / leased_area.';

COMMENT ON COLUMN public.v_sales_comps.rent IS
'Rent projected to CURRENT_DATE from the anchor (property.anchor_rent when '
'confirmed, else lease.annual_rent) using the property''s lease_bump_pct / '
'lease_bump_interval_mo.';

COMMENT ON COLUMN public.v_sales_comps.base_rent IS
'Year-1 base rent (leases.annual_rent). Was formerly exposed as `rent`; '
'retained here for callers that need the unescalated figure.';

COMMENT ON COLUMN public.v_sales_comps.rent_per_sf IS
'Projected current rent / leases.leased_area. Not the Y1 figure.';

-- Restore the PostgREST read grants that existed on the prior matview/view
-- and poke PostgREST so the new view shape is picked up immediately.
GRANT SELECT ON public.v_sales_comps TO anon, authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
