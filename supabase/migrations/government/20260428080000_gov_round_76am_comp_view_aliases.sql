-- ============================================================================
-- Round 76am — add current_ask + original_ask aliases to gov.v_sale_comps
--
-- Standard Briggs CRE deliverable comp template uses 'Current Ask' and
-- 'Original Ask' column headers. The gov sale comp view had this data as
-- 'last_price' / 'initial_price' which required manual remapping.
--
-- Apply on government Supabase project (scknotsqkcheojiaewwh).
-- ============================================================================

DROP VIEW IF EXISTS public.v_sale_comps;
CREATE VIEW public.v_sale_comps AS
 SELECT sale_id, property_id, lease_number, agency, government_type, interest,
    address, city, state, land_acres, year_built, sf_leased, rba,
    gov_occupancy_pct, gross_rent, gross_rent_psf, noi, noi_psf,
    lease_commencement, lease_expiration, termination_date,
    total_term_years, firm_term_years, expenses, rent_escalations,
    renewal_options, sold_price, sold_price_psf, sold_cap_rate,
    zero_cash_flow_cap, sale_date, seller, buyer, buyer_state, buyer_type,
    listing_broker, purchasing_broker, developer,
    initial_price        AS original_ask,
    last_price           AS current_ask,
    initial_cap_rate     AS original_ask_cap,
    last_cap_rate        AS current_ask_cap,
    initial_price, initial_cap_rate, pct_of_initial, last_price, last_cap_rate,
    bid_ask_spread, had_price_change, on_market_date, days_on_market,
    is_northmarq, data_source, created_at, updated_at, loan_id, financing_type,
    loan_amount, lender_name, sales_record_classification, sales_exclusion_reason,
    exclude_from_property_linking, exclude_from_market_metrics, normalized_address,
    buyer_contact_id, seller_contact_id, needs_research, source_sf_id,
    guarantor, land_ownership_type, sale_conditions, comp_type, transaction_type,
    listing_broker_name_quality, purchasing_broker_name_quality,
    listing_broker_enriched, purchasing_broker_enriched,
    date_part('year'::text, sale_date) AS sale_year,
    date_part('quarter'::text, sale_date) AS sale_quarter,
    concat('Q', date_part('quarter'::text, sale_date), '-', date_part('year'::text, sale_date)) AS quarter_label,
    CASE WHEN firm_term_years > 10 THEN '10+ Years'
         WHEN firm_term_years > 5  THEN '6-10 Years'
         WHEN firm_term_years > 0  THEN '0-5 Years'
         ELSE 'Outside Firm Term' END AS term_bucket,
    CASE WHEN is_northmarq THEN 'Northmarq' ELSE 'Other' END AS broker_category
   FROM sales_transactions s;
