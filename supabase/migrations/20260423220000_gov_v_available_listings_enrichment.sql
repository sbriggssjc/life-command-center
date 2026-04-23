-- ============================================================================
-- Migration: enrich the gov.v_available_listings materialized view so the
--            Sales/Available tab surfaces OM artifacts, marketplace links, DOM,
--            year_built, land_acres, rba, and a COALESCE'd expense_structure.
--
-- Target:    government Supabase (GOV_SUPABASE_URL)
--
-- Context (2026-04-23): the Available tab on the gov dashboard reads
-- public.v_available_listings. That view is a MATERIALIZED view, so the
-- columns we added/populated on available_listings (intake_artifact_path,
-- source_url, tracked_urls) and on properties (year_built, land_acres that
-- were freshly promoted from the Plano OM) never reach the dashboard
-- unless we both:
--   (a) redefine the view to expose those columns, and
--   (b) REFRESH it (and schedule refresh hooks going forward).
--
-- Expense fallback: the old view pulled p.expenses, but gov.properties
-- rarely has that column populated — the real source of truth is
-- leases.expense_structure on the currently active lease. We COALESCE them
-- so the Available tab stops showing '—' for every row that has an active
-- lease with a populated expense_structure.
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS public.v_available_listings CASCADE;

CREATE MATERIALIZED VIEW public.v_available_listings AS
SELECT al.listing_id,
    al.property_id,
    p.lease_number,
    COALESCE(al.tenant_agency, p.agency) AS agency,
    COALESCE(p.agency_full_name, al.tenant_agency) AS agency_full,
    p.government_type,
    COALESCE(al.address, p.address) AS address,
    COALESCE(al.city, p.city) AS city,
    COALESCE(al.state, p.state) AS state,
    p.land_acres,
    p.year_built,
    COALESCE(al.square_feet, p.rba) AS rba,
    p.noi,
    p.noi_psf,
    p.gross_rent,
    p.gross_rent_psf,
    COALESCE(al.lease_expiration, p.lease_expiration) AS lease_expiration,
    COALESCE(al.firm_term_remaining, p.firm_term_remaining) AS firm_term_remaining,
    p.term_remaining,
    -- Expense fallback chain: property.expenses -> active lease's expense_structure.
    -- Prefer a lease that is NOT superseded/expired; pick the most recent by
    -- commencement_date. This stops the Available table from showing '—' on
    -- rows that have a fully populated lease row (e.g. Plano's AOC lease
    -- has expense_structure='FS').
    COALESCE(p.expenses, active_lease.expense_structure) AS expenses,
    esc.bumps_summary AS bumps,
    al.asking_price,
    al.asking_price_psf,
    al.asking_cap_rate,
    al.seller_name AS seller,
    al.listing_broker,
    al.listing_firm,
    al.days_on_market,
    al.listing_date,
    al.listing_status,
    al.annual_rent,
    al.is_northmarq,
    al.listing_source,
    -- Marketing-collateral columns — needed for the LCC dashboard's
    -- multi-icon Actions cell (📄 OM PDF, Crexi/LoopNet badges, 🌐 broker microsite).
    al.intake_artifact_path,
    al.intake_artifact_type,
    al.source_url,
    al.tracked_urls
   FROM available_listings al
     LEFT JOIN properties p ON al.property_id = p.property_id
     LEFT JOIN LATERAL ( SELECT string_agg(
                CASE
                    WHEN le.escalation_pct IS NOT NULL THEN (round(le.escalation_pct * 100::numeric, 2) || '% '::text) || COALESCE(le.escalation_type, ''::text)
                    ELSE le.escalation_type
                END, '; '::text ORDER BY le.effective_date DESC) AS bumps_summary
           FROM ( SELECT lease_escalations.escalation_pct,
                    lease_escalations.escalation_type,
                    lease_escalations.effective_date
                   FROM lease_escalations
                  WHERE lease_escalations.property_id = al.property_id
                  ORDER BY lease_escalations.effective_date DESC
                 LIMIT 3) le) esc ON true
     -- Pull the current lease's expense_structure as a fallback for p.expenses.
     -- "Current" = not superseded, with the latest commencement_date; if none
     -- are still open, fall back to the most recently commenced lease.
     LEFT JOIN LATERAL ( SELECT l.expense_structure
                         FROM leases l
                         WHERE l.property_id = al.property_id
                         ORDER BY (l.superseded_at IS NULL) DESC,
                                  l.commencement_date DESC NULLS LAST,
                                  l.created_at DESC NULLS LAST
                         LIMIT 1 ) active_lease ON true
  WHERE al.exclude_from_listing_metrics IS NOT TRUE
    AND NOT (EXISTS ( SELECT 1
           FROM sales_transactions s
          WHERE s.property_id = al.property_id AND s.sale_date IS NOT NULL))
  ORDER BY al.listing_date DESC NULLS LAST;

-- Unique index on listing_id — required so REFRESH MATERIALIZED VIEW
-- CONCURRENTLY works (non-blocking refreshes).
CREATE UNIQUE INDEX IF NOT EXISTS v_available_listings_listing_id_uniq
  ON public.v_available_listings (listing_id);

-- Refresh now to pick up Plano's year_built / land_acres / expenses / OM path.
REFRESH MATERIALIZED VIEW public.v_available_listings;

COMMENT ON MATERIALIZED VIEW public.v_available_listings IS
  'Active gov listings with property, lease, and marketing-collateral rollups. 2026-04-23 added intake_artifact_path/type, source_url, tracked_urls, and active-lease expense_structure fallback. Refresh after any OM promotion or property enrichment via REFRESH MATERIALIZED VIEW CONCURRENTLY public.v_available_listings.';
