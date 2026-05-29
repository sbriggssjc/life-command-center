-- ============================================================================
-- Gov — Available listings: align to the is_active authoritative-flag model
--
-- Target: government Supabase (GOV_SUPABASE_URL)
--
-- Context (2026-05-29): see ON_MARKET_LIFECYCLE_CATEGORIZATION_REVIEW_2026-05-29.md.
--
-- Unlike dia, the gov RPC (lcc_record_listing_check) DOES maintain
-- `listing_status` (active/under_contract/withdrawn/sold), so listing_status is
-- already a reliable lifecycle signal. The defect is that v_available_listings
-- ignored it and instead gated on "exclude_from_listing_metrics AND NOT EXISTS
-- (any sale on the property)". That:
--   * suppressed 23 GENUINE re-listings (property sold once, then re-listed
--     later — the old sale wrongly hid the new listing); and
--   * left 2 withdrawn-but-unsold rows visible (off_market_date set but
--     listing_status never flipped); under_contract handling was inconsistent.
--
-- Decisions (user, 2026-05-29):
--   D3  under_contract COUNTS as available.
--   D4  align gov to the is_active model.
--
-- Approach: (1) heal the 2 status-desync rows, (2) add a drift-proof
-- is_active GENERATED column derived from listing_status (active/under_contract
-- => true), (3) rewrite v_available_listings to gate on is_active, excluding
-- only true closes (a LIVE sale at/after the listing's own window) so old
-- unrelated sales no longer hide re-listings. No rows deleted.
-- Validated row count: 161 -> 191 (re-includes genuine re-listings).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Reversible snapshot + heal the 2 withdrawn-but-active desync rows.
--    (off_market_date set while listing_status still 'active' — the off-market
--    transition never reached listing_status. Authoritative intent = withdrawn.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.available_listings_gate_backfill_20260529 (
  listing_id    uuid PRIMARY KEY,
  old_listing_status text,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.available_listings_gate_backfill_20260529 (listing_id, old_listing_status)
SELECT listing_id, listing_status
  FROM public.available_listings
 WHERE listing_status = 'active' AND off_market_date IS NOT NULL
ON CONFLICT (listing_id) DO NOTHING;

UPDATE public.available_listings
   SET listing_status = 'withdrawn'
 WHERE listing_status = 'active' AND off_market_date IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1. Add the is_active flag, derived (drift-proof) from listing_status.
--    active + under_contract are "on market" (D3); orphan/sold/superseded/
--    withdrawn are not. Generated => the gov RPC's existing listing_status
--    writes keep it correct with zero extra maintenance.
-- ---------------------------------------------------------------------------
ALTER TABLE public.available_listings
  ADD COLUMN IF NOT EXISTS is_active boolean
  GENERATED ALWAYS AS (listing_status = ANY (ARRAY['active'::text, 'under_contract'::text])) STORED;

-- ---------------------------------------------------------------------------
-- 2. Rewrite v_available_listings to gate on is_active.
--    Output columns unchanged (PostgREST `select=*` consumers unaffected).
--    Closes are suppressed only when a LIVE sale falls on/after the listing's
--    own window (listing_date - 60d), so historical sales don't hide re-lists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_available_listings AS
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
    COALESCE(p.expenses, active_lease.expense_structure) AS expenses,
    esc.bumps_summary AS bumps,
    al.asking_price,
    al.asking_price_psf,
    al.asking_cap_rate,
    al.seller_name AS seller,
    al.listing_broker,
    al.listing_firm,
    COALESCE(al.days_on_market, CURRENT_DATE - al.listing_date) AS days_on_market,
    al.listing_date,
    al.listing_status,
    al.annual_rent,
    al.is_northmarq,
    al.listing_source,
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
     LEFT JOIN LATERAL ( SELECT l.expense_structure
           FROM leases l
          WHERE l.property_id = al.property_id
          ORDER BY (l.superseded_at IS NULL) DESC, l.commencement_date DESC NULLS LAST, l.created_at DESC NULLS LAST
         LIMIT 1) active_lease ON true
  WHERE al.is_active = true
    AND al.exclude_from_listing_metrics IS NOT TRUE
    AND NOT (EXISTS ( SELECT 1
           FROM sales_transactions s
          WHERE s.property_id = al.property_id
            AND s.sale_date IS NOT NULL
            AND COALESCE(s.transaction_state, 'live') = 'live'
            AND s.sale_date >= COALESCE(al.listing_date, s.sale_date) - INTERVAL '60 days'))
  ORDER BY al.listing_date DESC NULLS LAST;

COMMIT;

-- Rollback (manual): restore listing_status from
--   available_listings_gate_backfill_20260529, drop column is_active, and
--   re-create the prior v_available_listings definition.
