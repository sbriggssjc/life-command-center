-- ============================================================================
-- GATED — APPLY ONLY AFTER gov_backfill.sql is COMMITted and re-audited.
-- Target: gov (scknotsqkcheojiaewwh) public.available_listings
-- Gives gov the recurrence guards dia already has, adapted to gov columns
-- (listing_status text; sale_transaction_id uuid; NO notes column;
--  sales link via sales_transactions.sale_id (uuid) — NOT property_sale_events,
--  whose sales_transaction_id is bigint and cannot populate the uuid FK).
-- The two functions/triggers run in a normal txn. The UNIQUE INDEX must be
-- created CONCURRENTLY OUTSIDE a transaction (see bottom).
-- ============================================================================
BEGIN;

-- (1) Close-on-sale trigger — mirrors dia fn_listing_close_if_sold, gov-shaped.
--     Gate Decision 3 sub-option: this DOES close listings that post-date a sale
--     within the window (dia's accepted behavior). To spare post-sale re-lists,
--     uncomment the `AND st.sale_date >= NEW.listing_date` guard below.
CREATE OR REPLACE FUNCTION public.fn_gov_listing_close_if_sold()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_sale_date date; v_sale_price numeric; v_sale_id uuid;
BEGIN
  IF COALESCE(NEW.is_active, TRUE) IS NOT TRUE
     AND lower(COALESCE(NEW.listing_status,'')) IN ('sold','closed','superseded','withdrawn','expired') THEN
    RETURN NEW;
  END IF;
  SELECT st.sale_date, st.sold_price, st.sale_id
    INTO v_sale_date, v_sale_price, v_sale_id
    FROM public.sales_transactions st
   WHERE st.property_id = NEW.property_id
     AND st.sale_date IS NOT NULL AND st.sale_date <= CURRENT_DATE
     AND COALESCE(st.exclude_from_market_metrics,false)=false
     AND (NEW.listing_date IS NULL OR st.sale_date >= NEW.listing_date - INTERVAL '90 days')
     -- AND (NEW.listing_date IS NULL OR st.sale_date >= NEW.listing_date)  -- spare post-sale re-lists (Decision 3)
     AND st.sale_date >= CURRENT_DATE - INTERVAL '12 months'
   ORDER BY st.sale_date DESC, st.sale_id DESC LIMIT 1;
  IF v_sale_date IS NOT NULL THEN
    -- gov is_active is GENERATED from listing_status — set status only.
    NEW.listing_status      := 'sold';
    NEW.off_market_date     := COALESCE(NEW.off_market_date, v_sale_date);
    NEW.off_market_reason   := COALESCE(NEW.off_market_reason, 'sold');
    NEW.sale_transaction_id := COALESCE(NEW.sale_transaction_id, v_sale_id);
    NEW.updated_at          := now();
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_gov_listing_close_if_sold ON public.available_listings;
CREATE TRIGGER trg_gov_listing_close_if_sold
  BEFORE INSERT OR UPDATE OF listing_date, is_active, listing_status, property_id
  ON public.available_listings FOR EACH ROW EXECUTE FUNCTION public.fn_gov_listing_close_if_sold();

-- (2) Supersede-prior-active trigger (Gate Decision 5 = DB-authoritative guard).
--     When a row becomes active for a property, retire any OTHER active row so the
--     one-active invariant holds regardless of writer correctness. Guarded against
--     recursion (only acts on OTHER rows; the supersede UPDATE sets is_active=false
--     so it cannot re-enter this branch).
CREATE OR REPLACE FUNCTION public.fn_gov_supersede_prior_active()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.is_active IS TRUE AND NEW.property_id IS NOT NULL
     AND COALESCE(NEW.exclude_from_market_metrics,false)=false THEN
    UPDATE public.available_listings o
       SET listing_status='superseded',   -- is_active follows (generated)
           off_market_date=COALESCE(o.off_market_date, COALESCE(NEW.listing_date, CURRENT_DATE)),
           off_market_reason=COALESCE(o.off_market_reason,'superseded'),
           updated_at=now()
     WHERE o.property_id = NEW.property_id
       AND o.listing_id IS DISTINCT FROM NEW.listing_id
       AND o.is_active IS TRUE
       AND COALESCE(o.exclude_from_market_metrics,false)=false;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_gov_supersede_prior_active ON public.available_listings;
CREATE TRIGGER trg_gov_supersede_prior_active
  AFTER INSERT OR UPDATE OF is_active, property_id
  ON public.available_listings FOR EACH ROW
  WHEN (NEW.is_active IS TRUE)
  EXECUTE FUNCTION public.fn_gov_supersede_prior_active();

-- (3) Forward/sane off_market_date (no future stamps; +1d clock-skew grace)
ALTER TABLE public.available_listings
  DROP CONSTRAINT IF EXISTS al_off_market_not_future;
ALTER TABLE public.available_listings
  ADD CONSTRAINT al_off_market_not_future
  CHECK (off_market_date IS NULL OR off_market_date <= CURRENT_DATE + 1) NOT VALID;
-- VALIDATE after confirming gov_backfill cleared the existing violators:
-- ALTER TABLE public.available_listings VALIDATE CONSTRAINT al_off_market_not_future;

COMMIT;

-- (4) Hard backstop — one active row per property (mirrors dia). MUST run
--     OUTSIDE a transaction and ONLY after gov_backfill collapsed the dups,
--     else the build fails on the existing 116 violators.
-- CREATE UNIQUE INDEX CONCURRENTLY available_listings_one_active_per_property
--   ON public.available_listings (property_id)
--   WHERE is_active IS TRUE AND property_id IS NOT NULL
--     AND COALESCE(exclude_from_market_metrics,false)=false;
