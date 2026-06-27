-- =============================================================================
-- T9d FIX (2026-06-27, dia zqzrriwuavgrquhisnoa) — om_receipt was the IMPORT date.
--
-- The first T9d round recovered on_market_date for 242 held listings from the
-- artifact storage path `lcc-om-uploads/YYYY-MM-DD/…`. But for the mass-forwarded
-- historical batch that bucket-upload date IS the 2026 import date (all 242 landed
-- 2026-04-25 → 2026-06-23), so it re-created the very surge T9d set out to remove
-- (92 of them inflate the impending 2026-06-30 count). The TRUE original email
-- date is not recoverable: staged_intake_items.source_email_date is empty for the
-- historical batch (populated only for the 8 new-flow items).
--
-- This fix:
--   Unit 1 — reclassify the 242 `om_receipt` rows to `date_uncertain`
--            (on_market_date = NULL, kept as evidenced inventory but OFF the time
--            axis). The upload/path/capture_date_fallback date is NEVER a
--            market-entry date. Reversible (backup batch_tag='t9d_fix').
--   Unit 2b — surface the cap inference: split the active set into `confirmed`
--            (a recorded exit AFTER period_end → positively observed on-market)
--            vs `assumed_active` (no recorded exit → in the set by the no-exit
--            assumption, bounded only by the 1356d age-out cap). Reported on the
--            membership views + a new summary view so the cap-dependent rows are
--            visible, not hidden.
--
-- KEEP (unchanged from the first T9d round):
--   Unit 2 — the entry/exit/cap membership model (cm_dialysis_active_listings_m/_q).
--   Unit 4 — the close-on-sale fix (fn_listing_close_if_sold) + the pse 5701 repair.
--   The 270 existing `date_uncertain` rows, the 270 no-provenance `unestablished`
--   rows, and the `unestablished_historical` + `sf_on_market_date` real-dated rows.
--
-- The ingest path is fixed in the SAME change (api/_handlers/intake-promoter.js +
-- api/_shared/listing-date.js): buildDia/GovListingRow now derive on_market_date
-- from a genuine signal (staged_intake_items.source_email_date / snapshot
-- listing_date / DOM) and HOLD as `date_uncertain` otherwise — never the upload
-- path / capture clock / today — so the surge cannot re-form going forward.
--
-- Constructive, reversible, no fabricated dates, dia only. Idempotent.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- UNIT 1 FIX — reclassify om_receipt → date_uncertain (reversible).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1a) Reversible backup of the current (om_receipt) state of every row this fix
--     changes, under a distinct batch_tag so it never collides with the original
--     T9d backup (batch_tag='t9d'). Drop the table / delete the tag -> zero trace.
INSERT INTO public.t9d_listing_omd_backup
  (listing_id, change_kind, prior_on_market_date, prior_on_market_date_source,
   prior_on_market_date_confidence, prior_status, prior_is_active, prior_off_market_date,
   prior_off_market_reason, prior_sold_date, prior_sold_price, prior_sale_transaction_id,
   prior_notes, batch_tag)
SELECT al.listing_id, 'fix_om_receipt_to_date_uncertain',
       al.on_market_date, al.on_market_date_source, al.on_market_date_confidence,
       al.status, al.is_active, al.off_market_date, al.off_market_reason,
       al.sold_date, al.sold_price, al.sale_transaction_id, al.notes, 't9d_fix'
FROM public.available_listings al
WHERE al.on_market_date_source = 'om_receipt'
  AND NOT EXISTS (SELECT 1 FROM public.t9d_listing_omd_backup WHERE batch_tag = 't9d_fix');

-- 1b) THE RECLASSIFY — the path-derived date is the import date, not the market
--     entry date. NULL it; the listing is KEPT (we hold the OM) but drops off the
--     time axis as `date_uncertain` (provenance-backed, no recoverable date).
UPDATE public.available_listings
   SET on_market_date            = NULL,
       on_market_date_source     = 'date_uncertain',
       on_market_date_confidence = 'none'
 WHERE on_market_date_source = 'om_receipt';

-- ─────────────────────────────────────────────────────────────────────────────
-- UNIT 2b — currency_basis (confirmed vs assumed_active) on the membership views.
--   The entry/exit/cap model is UNCHANGED; this only APPENDS one classifier
--   column (and the inner CTE carries off_market_date/sold_date to compute it).
--     confirmed      = a recorded exit AFTER period_end (off_market_date /
--                      sold_date > period_end) -> we positively observed it
--                      on-market at period_end (entered <= pe, left > pe). The
--                      cap is irrelevant to these.
--     assumed_active = no recorded exit -> membership rests on "we never saw it
--                      leave," bounded solely by the 1356d age-out cap. These are
--                      the cap-dependent rows the report now makes visible.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_m AS
 WITH month_anchors AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2010-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), active_pairs AS (
   SELECT q.period_end,
      al.listing_id, al.property_id, al.listing_date, al.last_price,
      COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) AS last_cap_rate,
      al.initial_price, al.seller_name,
      al.off_market_date, al.sold_date,
      p.operator, p.tenant, p.building_name, p.true_owner_name,
      q.period_end - al.on_market_date AS days_on_market,
      (al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price) AS had_price_change,
      COALESCE(
        CASE WHEN s.firm_term_years_at_sale IS NOT NULL AND s.sale_date >= q.period_end
             THEN s.firm_term_years_at_sale + (s.sale_date - q.period_end)::numeric / 365.0
             ELSE NULL::numeric END,
        ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
            FROM leases l
           WHERE l.property_id = al.property_id AND l.is_active = true
             AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text,'superseded_duplicate'::text,'expired'::text,'terminated'::text,'placeholder'::text,'closed'::text,'closed but obligated'::text]))
             AND l.lease_expiration IS NOT NULL AND l.lease_expiration >= q.period_end
             AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
           ORDER BY l.lease_expiration DESC
          LIMIT 1)) AS firm_term_years
     FROM month_anchors q
       JOIN available_listings al ON
              al.on_market_date IS NOT NULL
          AND al.on_market_date <= q.period_end
          AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text
          AND COALESCE(al.listing_date_source, ''::text) !~~ 'sale_anchor%'::text
          AND COALESCE(al.on_market_date_source, ''::text) !~~ 'synth%'::text
          AND (al.sold_date IS NULL OR al.sold_date > q.period_end)
          AND (al.off_market_date IS NULL OR al.off_market_date > q.period_end)
          AND (q.period_end - al.on_market_date) <= 1356
       LEFT JOIN properties p ON p.property_id = al.property_id
       LEFT JOIN sales_transactions s ON s.sale_id = al.sale_transaction_id
 )
 SELECT active_pairs.period_end,
    'all'::text AS subspecialty,
    active_pairs.listing_id, active_pairs.property_id, active_pairs.listing_date,
    active_pairs.days_on_market, active_pairs.last_price, active_pairs.last_cap_rate,
    active_pairs.initial_price, active_pairs.had_price_change, active_pairs.firm_term_years,
    active_pairs.firm_term_years >= 10::numeric AS is_core_10plus,
    true AS is_observed,
    CASE WHEN active_pairs.off_market_date > active_pairs.period_end
           OR active_pairs.sold_date > active_pairs.period_end
         THEN 'confirmed'::text ELSE 'assumed_active'::text END AS currency_basis
   FROM active_pairs;

CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_q AS
 WITH quarter_anchors AS (
   SELECT (date_trunc('quarter', g.d) + '3 mons -1 days'::interval)::date AS period_end
   FROM generate_series('2013-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '3 mons'::interval) g(d)
 ), active_pairs AS (
   SELECT q.period_end,
      al.listing_id, al.property_id, al.listing_date, al.last_price,
      COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) AS last_cap_rate,
      al.initial_price, al.seller_name,
      al.off_market_date, al.sold_date,
      p.operator, p.tenant, p.building_name, p.true_owner_name,
      q.period_end - al.on_market_date AS days_on_market,
      (al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price) AS had_price_change,
      COALESCE(
        ( SELECT st.firm_term_years_at_sale + (st.sale_date - q.period_end)::numeric / 365.0
            FROM sales_transactions st
           WHERE st.sale_id = al.sale_transaction_id AND st.firm_term_years_at_sale IS NOT NULL AND st.sale_date >= q.period_end),
        ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
            FROM leases l
           WHERE l.property_id = al.property_id
             AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text,'superseded_duplicate'::text,'terminated'::text]))
             AND l.lease_expiration IS NOT NULL AND l.lease_expiration >= q.period_end
             AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
           ORDER BY (COALESCE(l.is_active, false)) DESC, l.lease_expiration DESC
          LIMIT 1)) AS firm_term_years
     FROM quarter_anchors q
       JOIN available_listings al ON
              al.on_market_date IS NOT NULL
          AND al.on_market_date <= q.period_end
          AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text
          AND COALESCE(al.listing_date_source, ''::text) !~~ 'sale_anchor%'::text
          AND COALESCE(al.on_market_date_source, ''::text) !~~ 'synth%'::text
          AND (al.sold_date IS NULL OR al.sold_date > q.period_end)
          AND (al.off_market_date IS NULL OR al.off_market_date > q.period_end)
          AND (q.period_end - al.on_market_date) <= 1356
       LEFT JOIN properties p ON p.property_id = al.property_id
 )
 SELECT active_pairs.period_end,
    'all'::text AS subspecialty,
    active_pairs.listing_id, active_pairs.property_id, active_pairs.listing_date,
    active_pairs.days_on_market, active_pairs.last_price, active_pairs.last_cap_rate,
    active_pairs.initial_price, active_pairs.had_price_change, active_pairs.firm_term_years,
    active_pairs.firm_term_years >= 10::numeric AS is_core_10plus,
    CASE
        WHEN active_pairs.operator ~~* '%davita%'::text THEN 'DaVita'::text
        WHEN active_pairs.operator ~~* '%fresenius%'::text OR active_pairs.operator ~~* '%fmc%'::text OR active_pairs.operator ~~* '%fkc%'::text THEN 'FMC'::text
        WHEN active_pairs.operator ~~* '%u.s. renal%'::text OR active_pairs.operator ~~* '%us renal%'::text OR active_pairs.operator ~~* '%usrc%'::text THEN 'US Renal'::text
        WHEN active_pairs.operator IS NOT NULL AND TRIM(BOTH FROM active_pairs.operator) <> ''::text THEN 'Other'::text
        WHEN active_pairs.seller_name ~~* '%davita%'::text THEN 'DaVita'::text
        WHEN active_pairs.seller_name ~~* '%fresenius%'::text OR active_pairs.seller_name ~~* '%fmc%'::text OR active_pairs.seller_name ~~* '%fkc%'::text THEN 'FMC'::text
        WHEN active_pairs.seller_name ~~* '%u.s. renal%'::text OR active_pairs.seller_name ~~* '%us renal%'::text OR active_pairs.seller_name ~~* '%usrc%'::text THEN 'US Renal'::text
        WHEN active_pairs.tenant::text ~~* '%davita%'::text THEN 'DaVita'::text
        WHEN active_pairs.tenant::text ~~* '%fresenius%'::text OR active_pairs.tenant::text ~~* '%fmc%'::text OR active_pairs.tenant::text ~~* '%fkc%'::text THEN 'FMC'::text
        WHEN active_pairs.tenant::text ~~* '%u.s. renal%'::text OR active_pairs.tenant::text ~~* '%us renal%'::text OR active_pairs.tenant::text ~~* '%usrc%'::text THEN 'US Renal'::text
        WHEN active_pairs.building_name ~~* '%davita%'::text THEN 'DaVita'::text
        WHEN active_pairs.building_name ~~* '%fresenius%'::text OR active_pairs.building_name ~~* '%fmc%'::text OR active_pairs.building_name ~~* '%fkc%'::text THEN 'FMC'::text
        WHEN active_pairs.building_name ~~* '%u.s. renal%'::text OR active_pairs.building_name ~~* '%us renal%'::text OR active_pairs.building_name ~~* '%usrc%'::text THEN 'US Renal'::text
        WHEN active_pairs.true_owner_name ~~* '%davita%'::text THEN 'DaVita'::text
        WHEN active_pairs.true_owner_name ~~* '%fresenius%'::text OR active_pairs.true_owner_name ~~* '%fmc%'::text OR active_pairs.true_owner_name ~~* '%fkc%'::text THEN 'FMC'::text
        WHEN active_pairs.true_owner_name ~~* '%u.s. renal%'::text OR active_pairs.true_owner_name ~~* '%us renal%'::text OR active_pairs.true_owner_name ~~* '%usrc%'::text THEN 'US Renal'::text
        WHEN (active_pairs.seller_name IS NULL OR TRIM(BOTH FROM active_pairs.seller_name) = ''::text) AND (active_pairs.tenant IS NULL OR TRIM(BOTH FROM active_pairs.tenant) = ''::text) AND (active_pairs.building_name IS NULL OR TRIM(BOTH FROM active_pairs.building_name) = ''::text) AND (active_pairs.true_owner_name IS NULL OR TRIM(BOTH FROM active_pairs.true_owner_name) = ''::text) THEN 'Unknown'::text
        ELSE 'Other'::text
    END AS tenant_bucket,
    active_pairs.operator,
    true AS is_observed,
    CASE WHEN active_pairs.off_market_date > active_pairs.period_end
           OR active_pairs.sold_date > active_pairs.period_end
         THEN 'confirmed'::text ELSE 'assumed_active'::text END AS currency_basis
   FROM active_pairs;

-- Summary view — confirmed vs assumed_active per month, both as a listing count
-- AND the canonical distinct-property count (the Round-74 reconciled metric). The
-- cap-dependent (assumed_active) rows are now a first-class, visible number.
CREATE OR REPLACE VIEW public.cm_dialysis_currency_basis_m AS
 SELECT period_end,
    'all'::text AS subspecialty,
    count(DISTINCT listing_id) AS total_active_listings,
    count(DISTINCT listing_id) FILTER (WHERE currency_basis = 'confirmed') AS confirmed_listings,
    count(DISTINCT listing_id) FILTER (WHERE currency_basis = 'assumed_active') AS assumed_active_listings,
    count(DISTINCT property_id) AS total_active_properties,
    count(DISTINCT property_id) FILTER (WHERE currency_basis = 'confirmed') AS confirmed_properties,
    count(DISTINCT property_id) FILTER (WHERE currency_basis = 'assumed_active') AS assumed_active_properties
 FROM public.cm_dialysis_active_listings_m
 GROUP BY period_end
 ORDER BY period_end;

COMMENT ON VIEW public.cm_dialysis_currency_basis_m IS
  'T9d FIX: confirmed (recorded exit after period_end = positively observed '
  'on-market) vs assumed_active (no recorded exit, in the set by the no-exit '
  'assumption bounded only by the 1356d cap) per month. Surfaces the cap-dependent '
  'rows so the active count is honest, not hidden.';

-- ── REVERSAL RUNBOOK (run only to undo this FIX) ─────────────────────────────
-- 1) Restore the 242 rows to their om_receipt state:
--    UPDATE public.available_listings al SET
--      on_market_date            = b.prior_on_market_date,
--      on_market_date_source     = b.prior_on_market_date_source,
--      on_market_date_confidence = b.prior_on_market_date_confidence
--    FROM public.t9d_listing_omd_backup b
--    WHERE al.listing_id = b.listing_id AND b.batch_tag = 't9d_fix';
--    DELETE FROM public.t9d_listing_omd_backup WHERE batch_tag = 't9d_fix';
-- 2) DROP VIEW public.cm_dialysis_currency_basis_m; and re-create the two
--    membership views from 20260627_dia_t9d_provenance_first_listing_currency.sql
--    (without the currency_basis column).
