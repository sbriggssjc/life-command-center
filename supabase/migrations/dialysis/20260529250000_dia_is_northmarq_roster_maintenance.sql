-- ============================================================================
-- Dia — Northmarq flag maintenance: canonical roster + write-time triggers
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- 2026-05-29 NM attribution audit follow-up. is_northmarq is the canonical NM
-- signal (used by dashboards, detail.js, and the cm_* views), but NO writer set
-- it on sidebar-captured sales — it was only ever a one-time backfill, so it was
-- drifting incomplete. Audit found 58 live dia sales with a team broker (mostly
-- "scott briggs" co-brokering via sale_brokers alongside a third party) that
-- were NOT flagged.
--
-- Canonical NM roster (union of the two prior in-production definitions —
-- gov.js regex + dia NM_TEAM — made precise to avoid the historical
-- unrelated-surname false positives; tune by editing lcc_is_nm_broker):
--   brand:  northmarq | north marq | nm capital
--   team:   sjc[;:] | sbriggs | scott briggs | kelly largent | sarah martin |
--           nathanael berwaldt | hellwig | corriston   (word-bounded surnames)
--
-- Maintenance (set-true-only; never unsets, so manual/intake flags are safe):
--   * BEFORE I/U on sales_transactions (listing_broker/procuring_broker)
--   * AFTER I/U on sale_brokers (co-broker case → flag parent sale)
--   * one-time backfill (cols + sale_brokers), reversible via snapshot.
-- Applied live 2026-05-29: 58 backfilled (live NM 258 -> 316; TTM share ~9.6%).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_is_nm_broker(p_text text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_text IS NOT NULL AND p_text ~* '(northmarq|north marq|nm capital|sjc[;:]|sbriggs|scott briggs|kelly largent|sarah martin|nathanael berwaldt|\yhellwig\y|\ycorriston\y)'
$$;

CREATE OR REPLACE FUNCTION public.sales_set_is_northmarq()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF public.lcc_is_nm_broker(NEW.listing_broker) OR public.lcc_is_nm_broker(NEW.procuring_broker) THEN
    NEW.is_northmarq := true;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_sales_set_is_northmarq ON public.sales_transactions;
CREATE TRIGGER trg_sales_set_is_northmarq
  BEFORE INSERT OR UPDATE OF listing_broker, procuring_broker ON public.sales_transactions
  FOR EACH ROW EXECUTE FUNCTION public.sales_set_is_northmarq();

CREATE OR REPLACE FUNCTION public.sale_brokers_set_is_northmarq()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_name text;
BEGIN
  SELECT broker_name INTO v_name FROM public.brokers WHERE broker_id = NEW.broker_id;
  IF public.lcc_is_nm_broker(v_name) THEN
    UPDATE public.sales_transactions SET is_northmarq = true
     WHERE sale_id = NEW.sale_id AND is_northmarq IS NOT TRUE;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_sale_brokers_set_is_northmarq ON public.sale_brokers;
CREATE TRIGGER trg_sale_brokers_set_is_northmarq
  AFTER INSERT OR UPDATE OF broker_id ON public.sale_brokers
  FOR EACH ROW EXECUTE FUNCTION public.sale_brokers_set_is_northmarq();

-- One-time backfill (reversible via snapshot table).
CREATE TABLE IF NOT EXISTS public.sales_is_northmarq_backfill_20260529 (sale_id integer PRIMARY KEY, changed_at timestamptz DEFAULT now());
WITH match AS (
  SELECT s.sale_id FROM public.sales_transactions s
  WHERE s.is_northmarq IS NOT TRUE AND (
    public.lcc_is_nm_broker(s.listing_broker) OR public.lcc_is_nm_broker(s.procuring_broker)
    OR EXISTS (SELECT 1 FROM public.sale_brokers sb JOIN public.brokers b ON b.broker_id=sb.broker_id
               WHERE sb.sale_id=s.sale_id AND public.lcc_is_nm_broker(b.broker_name)))
),
snap AS (INSERT INTO public.sales_is_northmarq_backfill_20260529 (sale_id) SELECT sale_id FROM match ON CONFLICT DO NOTHING RETURNING 1)
UPDATE public.sales_transactions s SET is_northmarq = true FROM match WHERE s.sale_id = match.sale_id;
