-- ============================================================================
-- Gov — Northmarq flag maintenance: canonical roster + write-time trigger
--
-- Target: government Supabase (GOV_SUPABASE_URL)
-- Gov mirror of the dia migration of the same date. Gov has no sale_brokers
-- table (broker attribution is column-based: listing_broker / purchasing_broker),
-- so only the column trigger is needed. Same canonical roster (lcc_is_nm_broker).
-- Applied live 2026-05-29: backfill 0 (gov flag already complete via columns);
-- the trigger keeps new captures flagged. Set-true-only (never unsets).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_is_nm_broker(p_text text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_text IS NOT NULL AND p_text ~* '(northmarq|north marq|nm capital|sjc[;:]|sbriggs|scott briggs|kelly largent|sarah martin|nathanael berwaldt|\yhellwig\y|\ycorriston\y)'
$$;

CREATE OR REPLACE FUNCTION public.sales_set_is_northmarq()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF public.lcc_is_nm_broker(NEW.listing_broker) OR public.lcc_is_nm_broker(NEW.purchasing_broker) THEN
    NEW.is_northmarq := true;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_sales_set_is_northmarq ON public.sales_transactions;
CREATE TRIGGER trg_sales_set_is_northmarq
  BEFORE INSERT OR UPDATE OF listing_broker, purchasing_broker ON public.sales_transactions
  FOR EACH ROW EXECUTE FUNCTION public.sales_set_is_northmarq();

CREATE TABLE IF NOT EXISTS public.sales_is_northmarq_backfill_20260529 (sale_id uuid PRIMARY KEY, changed_at timestamptz DEFAULT now());
WITH match AS (
  SELECT s.sale_id FROM public.sales_transactions s
  WHERE s.is_northmarq IS NOT TRUE AND (public.lcc_is_nm_broker(s.listing_broker) OR public.lcc_is_nm_broker(s.purchasing_broker))
),
snap AS (INSERT INTO public.sales_is_northmarq_backfill_20260529 (sale_id) SELECT sale_id FROM match ON CONFLICT DO NOTHING RETURNING 1)
UPDATE public.sales_transactions s SET is_northmarq = true FROM match WHERE s.sale_id = match.sale_id;
