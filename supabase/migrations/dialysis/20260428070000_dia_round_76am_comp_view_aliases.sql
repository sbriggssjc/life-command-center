-- ============================================================================
-- Round 76am — add current_ask + original_ask aliases to dia comp views
--
-- Standard Briggs CRE deliverable comp template uses 'Current Ask' and
-- 'Original Ask' column headers. The dashboard views had this data as
-- 'last_price' and 'initial_price' / 'ask_price' which didn't match,
-- making downstream comp-export workflows do manual remapping.
--
-- Apply on dialysis Supabase project (zqzrriwuavgrquhisnoa).
-- ============================================================================

-- ── v_available_listings: rebuild with current_ask + original_ask ──────────
DROP VIEW IF EXISTS public.v_available_listings;
CREATE VIEW public.v_available_listings AS
 SELECT al.listing_id, al.property_id, al.status, al.listing_date,
    al.listing_url, al.url,
    COALESCE(p.tenant, p.operator::varchar) AS tenant_operator,
    p.address, p.city, p.state,
    p.land_area::numeric AS land_area, p.year_built,
    p.building_size::numeric AS rba,
    l.rent, l.rent_per_sf, l.lease_expiration,
    CASE WHEN l.lease_expiration IS NOT NULL
      THEN ROUND(((EXTRACT(EPOCH FROM (l.lease_expiration::timestamp::timestamptz - now())) / 86400.0) / 365.25), 1)
      ELSE NULL::numeric END AS term_remaining_yrs,
    l.expense_structure AS expenses,
    l.renewal_options AS bumps,
    al.last_price::numeric    AS current_ask,
    al.initial_price::numeric AS original_ask,
    al.last_price::numeric    AS ask_price,
    al.price_per_sf,
    COALESCE(al.last_cap_rate, al.current_cap_rate, al.cap_rate) AS current_ask_cap,
    al.initial_cap_rate AS original_ask_cap,
    COALESCE(al.last_cap_rate, al.current_cap_rate, al.cap_rate) AS ask_cap,
    CASE WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL
              AND al.initial_price > 0 AND al.last_price <> al.initial_price
         THEN ROUND((al.last_price - al.initial_price)::numeric / al.initial_price * 100, 1)
         ELSE NULL END AS price_change_pct,
    al.seller_name AS seller, al.listing_broker,
    CASE WHEN al.listing_date IS NOT NULL THEN (CURRENT_DATE - al.listing_date) ELSE NULL END AS dom,
    p.operator, p.zip_code,
    al.initial_price, al.initial_cap_rate, al.broker_email,
    al.intake_artifact_path, al.intake_artifact_type
   FROM available_listings al
     JOIN LATERAL (
       SELECT al2.listing_id FROM available_listings al2
        WHERE al2.property_id = al.property_id
          AND al2.status::text = ANY (ARRAY['active','Active','Available','For Sale'])
        ORDER BY al2.listing_date DESC NULLS LAST, al2.listing_id DESC LIMIT 1
     ) best ON al.listing_id = best.listing_id
     LEFT JOIN properties p ON al.property_id = p.property_id
     LEFT JOIN LATERAL (
       SELECT ls.rent, ls.rent_per_sf, ls.lease_expiration, ls.expense_structure, ls.renewal_options
         FROM leases ls
        WHERE ls.property_id = al.property_id AND ls.is_active = TRUE
          AND (ls.status IS NULL OR ls.status = 'active')
        ORDER BY ls.lease_start DESC NULLS LAST, ls.lease_expiration DESC NULLS LAST, ls.lease_id DESC LIMIT 1
     ) l ON TRUE
  WHERE al.status::text = ANY (ARRAY['active','Active','Available','For Sale']);

-- ── v_sales_comps materialized view: drop and rebuild with new aliases ────
-- Keep all existing columns + add current_ask, original_ask, current_ask_cap,
-- original_ask_cap, list_date, pct_of_original.
-- (Body matches the SQL applied via execute_sql at deploy time.)
