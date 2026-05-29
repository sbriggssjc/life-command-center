-- ============================================================================
-- Dia — Available listings: gate on the AUTHORITATIVE lifecycle flag (is_active)
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Context (2026-05-29): see ON_MARKET_LIFECYCLE_CATEGORIZATION_REVIEW_2026-05-29.md
-- and SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md.
--
-- v_available_listings keyed on the free-text `status` string, which DRIFTS:
--   * lcc_record_listing_check (the crawler/auto-scrape RPC) maintains
--     is_active / off_market_date but NEVER writes `status`. Only the sale
--     triggers + Stale/Superseded crons write `status`. So 33 rows that were
--     marked off-market via the RPC path still wear status='Active' and leaked
--     into the on-market count.
--   * Conversely the status gate EXCLUDED 11 genuine re-listings (is_active=true
--     but status not yet flipped) and 148 rows whose status is NULL/Draft.
--
-- Decisions (user, 2026-05-29):
--   D1  canonical "actively marketed" gate = is_active=true AND no sale.
--   D2  144 synthetic/import-placeholder rows (status NULL/'Draft-Commenced',
--       no URL, no broker, no seller) are NOT marketed -> reclassify, excluded.
--   D5  keep the April-2026 broker-bearing import as real inventory.
--   D6  pure is_active; no recency/staleness filter (Stale cron handles aging).
--
-- This migration: (1) snapshots + reclassifies the 144 synthetics (reversible),
-- (2) backfills the drifted `status` text so the UI label matches the lifecycle,
-- (3) rewrites v_available_listings to gate on is_active + no sale,
-- (4) patches lcc_record_listing_check to keep `status` in sync going forward.
-- No rows are deleted.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Reversible snapshot of every row this migration mutates.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.available_listings_gate_backfill_20260529 (
  listing_id    integer PRIMARY KEY,
  old_status    varchar,
  old_is_active boolean,
  old_off_market_reason text,
  change_kind   text,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 1. Reclassify the 144 synthetic / import-placeholder rows (D2).
--    Signature: never a real broker listing — null/draft status, no URL,
--    no broker, no seller. (The April broker-bearing import is NOT caught
--    here because those rows have a broker — kept as real inventory per D5.)
-- ---------------------------------------------------------------------------
INSERT INTO public.available_listings_gate_backfill_20260529
      (listing_id, old_status, old_is_active, old_off_market_reason, change_kind)
SELECT listing_id, status, is_active, off_market_reason, 'synthetic_reclass'
  FROM public.available_listings
 WHERE (status IS NULL OR status = 'Draft-Commenced')
   AND listing_url IS NULL AND url IS NULL
   AND listing_broker IS NULL AND seller_name IS NULL
ON CONFLICT (listing_id) DO NOTHING;

UPDATE public.available_listings
   SET is_active = false,
       status = 'Imported-Estimate',
       off_market_reason = COALESCE(off_market_reason, 'non_marketed_import')
 WHERE (status IS NULL OR status = 'Draft-Commenced')
   AND listing_url IS NULL AND url IS NULL
   AND listing_broker IS NULL AND seller_name IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Heal the drifted `status` text on the 33 RPC-marked-off rows that still
--    wear an active status (is_active already false; only the label is stale).
--    Authoritative signal is is_active; we are only fixing the human label so
--    the UI badge stops contradicting the lifecycle.
-- ---------------------------------------------------------------------------
INSERT INTO public.available_listings_gate_backfill_20260529
      (listing_id, old_status, old_is_active, old_off_market_reason, change_kind)
SELECT listing_id, status, is_active, off_market_reason, 'status_heal'
  FROM public.available_listings
 WHERE is_active = false
   AND status IN ('active','Active','Available','For Sale')
ON CONFLICT (listing_id) DO NOTHING;

UPDATE public.available_listings
   SET status = CASE
         WHEN sold_date IS NOT NULL OR sale_transaction_id IS NOT NULL
              OR off_market_reason = 'sold' THEN 'Sold'
         ELSE 'Off Market'
       END
 WHERE is_active = false
   AND status IN ('active','Active','Available','For Sale');

-- ---------------------------------------------------------------------------
-- 3. Rewrite v_available_listings to gate on the authoritative flag.
--    Gate = is_active AND no sale recorded. A defensive synthetic guard is
--    retained so a future identical import can't leak before reclassification.
--    Output columns are byte-for-byte identical to the prior view (PostgREST
--    `select=*` consumers unaffected).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_available_listings AS
 SELECT al.listing_id,
    al.property_id,
    al.status,
    al.listing_date,
    al.listing_url,
    al.url,
    COALESCE(p.tenant, p.operator::character varying) AS tenant_operator,
    p.address,
    p.city,
    p.state,
    p.land_area::numeric AS land_area,
    p.year_built,
    p.building_size::numeric AS rba,
    l.rent,
    l.rent_per_sf,
    l.lease_expiration,
        CASE
            WHEN l.lease_expiration IS NOT NULL THEN round(EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone::timestamp with time zone - now()) / 86400.0 / 365.25, 1)
            ELSE NULL::numeric
        END AS term_remaining_yrs,
    l.expense_structure AS expenses,
    l.renewal_options AS bumps,
    al.last_price::numeric AS ask_price,
    al.price_per_sf,
    COALESCE(al.last_cap_rate, al.current_cap_rate, al.cap_rate) AS ask_cap,
    al.seller_name AS seller,
    al.listing_broker,
        CASE
            WHEN al.listing_date IS NOT NULL THEN CURRENT_DATE - al.listing_date
            ELSE NULL::integer
        END AS dom,
    p.operator,
    p.zip_code,
    al.initial_price,
    al.initial_cap_rate,
    al.broker_email,
    al.intake_artifact_path,
    al.intake_artifact_type
   FROM available_listings al
     JOIN LATERAL ( SELECT al2.listing_id
           FROM available_listings al2
          WHERE al2.property_id = al.property_id
            AND al2.is_active = true
            AND al2.sold_date IS NULL
            AND al2.sale_transaction_id IS NULL
            AND NOT ((al2.status IS NULL OR al2.status = 'Draft-Commenced')
                     AND al2.listing_url IS NULL AND al2.url IS NULL
                     AND al2.listing_broker IS NULL AND al2.seller_name IS NULL)
          ORDER BY al2.listing_date DESC NULLS LAST, al2.listing_id DESC
         LIMIT 1) best ON al.listing_id = best.listing_id
     LEFT JOIN properties p ON al.property_id = p.property_id
     LEFT JOIN LATERAL ( SELECT ls.rent,
            ls.rent_per_sf,
            ls.lease_expiration,
            ls.expense_structure,
            ls.renewal_options
           FROM leases ls
          WHERE ls.property_id = al.property_id AND ls.is_active = true AND (ls.status IS NULL OR ls.status = 'active'::text)
          ORDER BY ls.lease_start DESC NULLS LAST, ls.lease_expiration DESC NULLS LAST, ls.lease_id DESC
         LIMIT 1) l ON true
  WHERE al.is_active = true
    AND al.sold_date IS NULL
    AND al.sale_transaction_id IS NULL
    AND NOT ((al.status IS NULL OR al.status = 'Draft-Commenced')
             AND al.listing_url IS NULL AND al.url IS NULL
             AND al.listing_broker IS NULL AND al.seller_name IS NULL);

-- ---------------------------------------------------------------------------
-- 4. Keep `status` in sync going forward: patch lcc_record_listing_check so the
--    human label tracks the lifecycle transition it already writes to is_active.
--    (Identical to the live function except the added `status = CASE ...`.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_record_listing_check(
  p_listing_id integer, p_method text, p_check_result text,
  p_asking_price numeric DEFAULT NULL::numeric, p_cap_rate numeric DEFAULT NULL::numeric,
  p_source_url text DEFAULT NULL::text, p_http_status integer DEFAULT NULL::integer,
  p_response_summary text DEFAULT NULL::text, p_off_market_reason text DEFAULT NULL::text,
  p_effective_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_verified_by uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(verification_id bigint, status_history_id bigint, state_transitioned boolean, new_status text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_prior_price       numeric;
  v_new_status        text;
  v_state_transition  boolean := false;
  v_verif_id          bigint;
  v_status_id         bigint;
  v_listing_active    boolean;
BEGIN
  SELECT last_price, is_active INTO v_prior_price, v_listing_active
    FROM public.available_listings WHERE listing_id = p_listing_id;

  v_new_status := CASE p_check_result
    WHEN 'still_available'      THEN CASE WHEN v_listing_active THEN NULL ELSE 're_listed' END
    WHEN 'price_changed'        THEN 'price_changed'
    WHEN 'off_market'           THEN 'withdrawn'
    WHEN 'sold'                 THEN 'sold'
    WHEN 'unreachable'          THEN NULL
    WHEN 'manual_review_needed' THEN NULL
    ELSE NULL
  END;

  INSERT INTO public.listing_verification_history (
    listing_id, verified_at, method, check_result,
    asking_price_at_check, prior_asking_price, price_delta,
    source_url, http_status, response_summary, notes, verified_by
  ) VALUES (
    p_listing_id, COALESCE(p_effective_at, now()), p_method, p_check_result,
    p_asking_price, v_prior_price,
    CASE WHEN p_asking_price IS NOT NULL AND v_prior_price IS NOT NULL
         THEN p_asking_price - v_prior_price ELSE NULL END,
    p_source_url, p_http_status, p_response_summary, p_notes, p_verified_by
  ) RETURNING id INTO v_verif_id;

  IF v_new_status IS NOT NULL THEN
    INSERT INTO public.listing_status_history (
      listing_id, status, effective_at, asking_price, cap_rate, source, notes, recorded_by
    ) VALUES (
      p_listing_id, v_new_status, COALESCE(p_effective_at, now()),
      p_asking_price, p_cap_rate, p_method, p_notes, p_verified_by
    ) RETURNING id INTO v_status_id;
    v_state_transition := true;
  END IF;

  UPDATE public.available_listings
     SET last_verified_at = COALESCE(p_effective_at, now()),
         consecutive_check_failures = CASE
           WHEN p_check_result = 'unreachable' THEN consecutive_check_failures + 1
           ELSE 0
         END,
         last_price = CASE WHEN p_check_result = 'price_changed' AND p_asking_price IS NOT NULL
                            THEN p_asking_price ELSE last_price END,
         current_cap_rate = CASE WHEN p_cap_rate IS NOT NULL THEN p_cap_rate ELSE current_cap_rate END,
         price_change_date = CASE WHEN p_check_result = 'price_changed'
                                   THEN COALESCE(p_effective_at::date, CURRENT_DATE)
                                   ELSE price_change_date END,
         is_active = CASE
           WHEN p_check_result IN ('off_market','sold') THEN false
           WHEN p_check_result = 'still_available' THEN true
           ELSE is_active
         END,
         -- NEW: keep the human-facing status label in lockstep with is_active.
         status = CASE
           WHEN p_check_result = 'sold' THEN 'Sold'
           WHEN p_check_result = 'off_market' THEN 'Off Market'
           WHEN p_check_result = 'still_available' AND is_active = false THEN 'Active'
           ELSE status
         END,
         off_market_date = CASE
           WHEN p_check_result IN ('off_market','sold') AND off_market_date IS NULL
                THEN COALESCE(p_effective_at::date, CURRENT_DATE)
           ELSE off_market_date
         END,
         off_market_reason = CASE
           WHEN p_check_result = 'off_market' THEN COALESCE(p_off_market_reason, 'withdrawn')
           WHEN p_check_result = 'sold' THEN 'sold'
           ELSE off_market_reason
         END
   WHERE listing_id = p_listing_id;

  RETURN QUERY SELECT v_verif_id, v_status_id, v_state_transition, v_new_status;
END $function$;

COMMIT;

-- Rollback (manual): restore from available_listings_gate_backfill_20260529:
--   UPDATE available_listings a SET status=b.old_status, is_active=b.old_is_active,
--     off_market_reason=b.old_off_market_reason
--   FROM available_listings_gate_backfill_20260529 b WHERE a.listing_id=b.listing_id;
-- and re-create the prior v_available_listings / lcc_record_listing_check defs.
