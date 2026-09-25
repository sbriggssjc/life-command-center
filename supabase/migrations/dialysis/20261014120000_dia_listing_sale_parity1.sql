-- LISTING-SALE-PARITY1 (2026-09-24): make listing<->sale reconciliation identical in dia and gov.
--
-- Dia already closed listings on a sale (close_listing_on_sale, fn_sale_event_mark_listings_sold)
-- and had a reverse check (fn_listing_close_if_sold). Measured live, each disagreed with the other:
--   * close_listing_on_sale closed every open listing with on_market_date NULL or <= sale + 90d,
--     so a HISTORICAL sale inserted today closed a current relisting with no on-market date;
--   * fn_listing_close_if_sold matched any sale after COALESCE(on_market_date, listing_date), so
--     a stale 2017 SF on-market date on a 2026 OM closed it against a 2021 sale; it also never saw
--     a sold deal's OM captured AFTER the sale (the Pipkin shape), and it read property_sale_events
--     with no market-sale guard;
--   * lcc_data_hygiene_sweep closed any active listing when ANY sale (market or not) postdated
--     its listing_date.
-- All four now call ONE judgement, lcc_listing_sale_verdict, byte-identical with gov
-- (government-lease sql/20260924_gov_listing_sale_parity1.sql), through one writer,
-- dia_reconcile_listing_sales: logged and reversible (dia_restore_listing_sale_close), ambiguous
-- cases to dia_listing_sale_review, a twin's sale review-only, a daily read-only guard
-- (dia_check_listing_sale_parity) and stale listings routed to the verification lane.
-- Dia has no reliable first-seen timestamp (created_at is set on 2 of 5,515 rows), so the capture
-- date is the earliest of last_seen, a capture-fallback listing_date and created_at.

-- ===== BEGIN lcc_listing_sale_verdict (LISTING-SALE-PARITY1) — byte-identical on dia and gov =====
-- One judgement for "does this market sale mean this open listing has sold?", shared by the
-- sale-side trigger (a sale lands), the listing-side trigger (a listing is created or re-seen),
-- the backfill, and the daily guard. Pure: it sees only dates and prices, never a table.
--   p_on_market_date / p_on_market_conf : the listing's on-market date and its confidence.
--       Only 'high'/'medium' count as a REAL market-entry date, and only when it falls within
--       730 days before the capture date (older = an earlier listing cycle, e.g. a 2017 SF date
--       on a 2026 OM).
--   p_capture_date : when WE first saw the listing (gov first_seen_at; dia's best proxy).
--   p_sale_is_market : live and not excluded from market metrics. Anything else never closes.
-- Sale dates are often month-truncated (day 1), so "on or after X" compares against X's month.
-- Price ratio r = asking / sold. A wildly different price (r outside 0.5..2.0) is never closed.
CREATE OR REPLACE FUNCTION public.lcc_listing_sale_verdict(
  p_on_market_date date, p_on_market_conf text, p_capture_date date, p_asking numeric,
  p_sale_date date, p_sold_price numeric, p_sale_is_market boolean)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_entry date;
  v_r numeric;
BEGIN
  IF p_sale_date IS NULL OR NOT coalesce(p_sale_is_market, false) THEN
    RETURN 'not_market_sale';
  END IF;
  IF p_capture_date IS NULL THEN
    RETURN 'keep_undated';
  END IF;
  IF lower(coalesce(p_on_market_conf, '')) IN ('high', 'medium')
     AND p_on_market_date IS NOT NULL
     AND p_on_market_date >= p_capture_date - 730 THEN
    v_entry := p_on_market_date;
  END IF;
  IF p_asking > 0 AND p_sold_price > 0 THEN
    v_r := p_asking / p_sold_price;
  END IF;

  -- A real market entry more than 90 days after the sale is a genuine re-listing.
  IF v_entry IS NOT NULL AND v_entry > p_sale_date + 90 THEN
    RETURN 'keep_relisted_after_sale';
  END IF;

  -- Sold after we saw it listed, or after its real market entry.
  IF p_sale_date >= date_trunc('month', p_capture_date)::date
     OR (v_entry IS NOT NULL AND p_sale_date >= date_trunc('month', v_entry)::date) THEN
    IF v_r IS NOT NULL AND (v_r < 0.5 OR v_r > 2.0) THEN
      RETURN 'review_price_mismatch';
    END IF;
    IF p_sale_date >= date_trunc('month', p_capture_date)::date THEN
      RETURN 'close_sold_after_seen';
    END IF;
    RETURN 'close_sold_after_entry';
  END IF;

  -- Sale up to 90 days before a real entry: the same deal when the prices agree.
  IF v_entry IS NOT NULL THEN
    IF v_r BETWEEN 0.7 AND 1.3 THEN
      RETURN 'close_sold_near_entry';
    END IF;
    RETURN 'review_sold_near_entry';
  END IF;

  -- No real entry date. A capture shortly after a sale at a matching price is the sold deal's OM.
  IF p_sale_date >= p_capture_date - 365 AND v_r BETWEEN 0.85 AND 1.15 THEN
    RETURN 'close_sold_shortly_before_capture';
  END IF;
  IF p_sale_date >= p_capture_date - 730 THEN
    RETURN 'review_sold_before_capture';
  END IF;
  IF v_r IS NOT NULL AND abs(v_r - 1) <= 0.005 AND p_sale_date >= p_capture_date - 1461 THEN
    RETURN 'review_same_price';
  END IF;
  RETURN 'keep_prior_sale';
END
$fn$;
REVOKE ALL ON FUNCTION public.lcc_listing_sale_verdict(date, text, date, numeric, date, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_listing_sale_verdict(date, text, date, numeric, date, numeric, boolean) TO service_role;
-- ===== END lcc_listing_sale_verdict =====

CREATE TABLE IF NOT EXISTS public.dia_listing_sale_close_log (
  log_id        bigserial PRIMARY KEY,
  batch_tag     text NOT NULL,
  listing_id    integer NOT NULL,
  sale_id       integer,
  verdict       text NOT NULL,
  action        text NOT NULL CHECK (action IN ('closed', 'closed_unlinked', 'superseded_duplicate', 'stale_verify')),
  prior         jsonb NOT NULL,
  applied_at    timestamptz NOT NULL DEFAULT now(),
  restored_at   timestamptz
);
CREATE INDEX IF NOT EXISTS dia_listing_sale_close_log_listing_idx ON public.dia_listing_sale_close_log (listing_id);
CREATE INDEX IF NOT EXISTS dia_listing_sale_close_log_batch_idx ON public.dia_listing_sale_close_log (batch_tag);

CREATE TABLE IF NOT EXISTS public.dia_listing_sale_review (
  review_id     bigserial PRIMARY KEY,
  listing_id    integer NOT NULL,
  sale_id       integer NOT NULL,
  verdict       text NOT NULL,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed_sold', 'rejected')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  UNIQUE (listing_id, sale_id)
);

ALTER TABLE public.dia_listing_sale_close_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dia_listing_sale_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dia_listing_sale_close_log, public.dia_listing_sale_review FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.dia_listing_sale_close_log_log_id_seq, public.dia_listing_sale_review_review_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dia_listing_sale_close_log, public.dia_listing_sale_review TO service_role;
GRANT ALL ON SEQUENCE public.dia_listing_sale_close_log_log_id_seq, public.dia_listing_sale_review_review_id_seq TO service_role;
DROP POLICY IF EXISTS service_role_all_dia_listing_sale_close_log ON public.dia_listing_sale_close_log;
CREATE POLICY service_role_all_dia_listing_sale_close_log ON public.dia_listing_sale_close_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_all_dia_listing_sale_review ON public.dia_listing_sale_review;
CREATE POLICY service_role_all_dia_listing_sale_review ON public.dia_listing_sale_review
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Dia's best proxy for "when we first saw this listing".
CREATE OR REPLACE FUNCTION public.dia_listing_capture_date(
  p_last_seen date, p_listing_date_source text, p_listing_date date, p_created_at timestamptz)
RETURNS date
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT coalesce(
    nullif(least(coalesce(p_last_seen, 'infinity'::date),
                 coalesce(CASE WHEN p_listing_date_source = 'capture_date_fallback' THEN p_listing_date END, 'infinity'::date),
                 coalesce(p_created_at::date, 'infinity'::date)), 'infinity'::date),
    p_listing_date)
$fn$;

CREATE OR REPLACE FUNCTION public.dia_listing_twin_property_ids(p_property_id integer)
RETURNS integer[]
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT coalesce(array_agg(DISTINCT q.property_id), ARRAY[p_property_id])
    FROM (
      SELECT p_property_id AS property_id
      UNION
      SELECT t.property_id
        FROM public.properties p
        JOIN public.properties t
          ON dia_normalize_state((t.state)::text) = dia_normalize_state((p.state)::text)
         AND dia_normalize_address(t.address) = dia_normalize_address(p.address)
         AND substring(t.address, '^\s*(\d+)') = substring(p.address, '^\s*(\d+)')
       WHERE p.property_id = p_property_id
         AND substring(p.address, '^\s*(\d+)') IS NOT NULL
         AND nullif(dia_normalize_address(p.address), '') IS NOT NULL
    ) q
$fn$;

CREATE OR REPLACE FUNCTION public.dia_listing_best_sale_verdict(
  p_listing_id integer, p_property_id integer, p_on_market_date date, p_on_market_conf text,
  p_capture_date date, p_asking numeric)
RETURNS TABLE(sale_id integer, sale_property_id integer, sale_date date, sold_price numeric,
              verdict text, via_twin boolean)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH c AS (
    SELECT s.sale_id, s.property_id AS sale_property_id, s.sale_date, s.sold_price,
           (s.property_id <> p_property_id) AS via_twin,
           lcc_listing_sale_verdict(p_on_market_date, p_on_market_conf, p_capture_date, p_asking,
             s.sale_date, s.sold_price,
             coalesce(s.transaction_state, 'live') = 'live'
               AND NOT coalesce(s.exclude_from_market_metrics, false)) AS base
      FROM public.sales_transactions s
     WHERE s.property_id = ANY (dia_listing_twin_property_ids(p_property_id))
       AND s.sale_date IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.dia_listing_sale_review r
                        WHERE r.listing_id = p_listing_id AND r.sale_id = s.sale_id
                          AND r.status = 'rejected')
       AND NOT EXISTS (SELECT 1 FROM public.dia_listing_sale_close_log l
                        WHERE l.listing_id = p_listing_id AND l.sale_id = s.sale_id
                          AND l.restored_at IS NOT NULL)
  ), v AS (
    SELECT c.*, CASE WHEN c.via_twin AND c.base LIKE 'close_%' THEN 'review_twin_' || c.base
                     WHEN c.via_twin THEN 'not_market_sale'
                     ELSE c.base END AS verdict
      FROM c
  )
  SELECT v.sale_id, v.sale_property_id, v.sale_date, v.sold_price, v.verdict, v.via_twin
    FROM v
   ORDER BY CASE WHEN v.verdict LIKE 'close_%' THEN 1 WHEN v.verdict LIKE 'review_%' THEN 2 ELSE 3 END,
            v.sale_date DESC, v.sale_id
   LIMIT 1
$fn$;

CREATE OR REPLACE FUNCTION public.dia_reconcile_listing_sales(
  p_property_ids integer[] DEFAULT NULL, p_dry_run boolean DEFAULT true,
  p_batch text DEFAULT NULL)
RETURNS TABLE(listing_id integer, sale_id integer, verdict text, action text)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
#variable_conflict use_column
DECLARE
  r record;
  v_batch text := coalesce(p_batch, 'listing_sale_parity_' || to_char(now(), 'YYYYMMDD'));
  v_action text;
  v_prior jsonb;
BEGIN
  IF current_setting('lcc.listing_sale_reconcile_off', true) = 'on' THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT al.listing_id AS lid, al.property_id AS lpid, al.status, al.is_active, al.off_market_date,
           al.off_market_reason, al.sale_transaction_id, al.sold_date AS l_sold_date,
           al.sold_price AS l_sold_price, b.*
      FROM public.available_listings al
      CROSS JOIN LATERAL public.dia_listing_best_sale_verdict(
             al.listing_id, al.property_id, al.on_market_date, al.on_market_date_confidence,
             dia_listing_capture_date(al.last_seen, al.listing_date_source, al.listing_date, al.created_at),
             coalesce(al.last_price, al.initial_price)) b
     WHERE al.property_id IS NOT NULL
       AND al.is_active IS TRUE
       AND (p_property_ids IS NULL OR al.property_id = ANY (p_property_ids))
       AND (b.verdict LIKE 'close_%' OR b.verdict LIKE 'review_%')
  LOOP
    listing_id := r.lid; sale_id := r.sale_id; verdict := r.verdict;
    IF r.verdict LIKE 'review_%' THEN
      action := 'review';
      IF NOT p_dry_run THEN
        INSERT INTO public.dia_listing_sale_review (listing_id, sale_id, verdict, details)
        VALUES (r.lid, r.sale_id, r.verdict,
                jsonb_build_object('sale_date', r.sale_date, 'sold_price', r.sold_price,
                                   'sale_property_id', r.sale_property_id, 'via_twin', r.via_twin,
                                   'batch', v_batch))
        ON CONFLICT (listing_id, sale_id) DO UPDATE SET verdict = EXCLUDED.verdict
          WHERE public.dia_listing_sale_review.status = 'open';
      END IF;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_prior := jsonb_build_object('status', r.status, 'is_active', r.is_active,
                                  'off_market_date', r.off_market_date,
                                  'off_market_reason', r.off_market_reason,
                                  'sale_transaction_id', r.sale_transaction_id,
                                  'sold_date', r.l_sold_date, 'sold_price', r.l_sold_price);
    v_action := 'closed';
    IF NOT p_dry_run THEN
      BEGIN
        UPDATE public.available_listings al
           SET status              = 'sold',
               is_active           = false,
               off_market_date     = coalesce(al.off_market_date, r.sale_date),
               off_market_reason   = 'sold',
               sold_date           = coalesce(al.sold_date, r.sale_date),
               sold_price          = coalesce(al.sold_price, r.sold_price),
               sale_transaction_id = coalesce(al.sale_transaction_id, CASE WHEN NOT r.via_twin THEN r.sale_id END),
               notes               = coalesce(nullif(al.notes, '') || E'\n', '')
                                     || '[' || v_batch || ' ' || current_date || '] ' || r.verdict
                                     || ': sale ' || r.sale_id || ' on ' || r.sale_date
         WHERE al.listing_id = r.lid;
      EXCEPTION
        WHEN unique_violation THEN
          v_action := 'superseded_duplicate';
          UPDATE public.available_listings al
             SET status = 'superseded', is_active = false,
                 off_market_date = coalesce(al.off_market_date, r.sale_date),
                 off_market_reason = 'duplicate', exclude_from_listing_metrics = true
           WHERE al.listing_id = r.lid;
        WHEN OTHERS THEN
          v_action := 'closed_unlinked';
          UPDATE public.available_listings al
             SET status = 'sold', is_active = false,
                 off_market_date = coalesce(al.off_market_date, r.sale_date),
                 off_market_reason = 'sold'
           WHERE al.listing_id = r.lid;
      END;
      INSERT INTO public.dia_listing_sale_close_log (batch_tag, listing_id, sale_id, verdict, action, prior)
      VALUES (v_batch, r.lid, r.sale_id, r.verdict, v_action, v_prior);
      INSERT INTO public.listing_change_events (listing_id, property_id, event_type, priority,
                                                description, old_value, new_value, event_date, created_at)
      VALUES (r.lid, r.lpid, 'status_change', 'high',
              'Listing closed (' || r.verdict || ') - sale_id ' || r.sale_id || ', sale_date ' || r.sale_date,
              'active', 'sold', now(), now());
    END IF;
    action := v_action;
    RETURN NEXT;
  END LOOP;
END
$fn$;

CREATE OR REPLACE FUNCTION public.dia_restore_listing_sale_close(p_batch text, p_listing_id integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE r record; n integer := 0;
BEGIN
  PERFORM set_config('lcc.listing_sale_reconcile_off', 'on', true);
  FOR r IN SELECT * FROM public.dia_listing_sale_close_log
            WHERE batch_tag = p_batch AND restored_at IS NULL
              AND (p_listing_id IS NULL OR listing_id = p_listing_id)
            ORDER BY log_id DESC
  LOOP
    IF r.action = 'stale_verify' THEN
      UPDATE public.available_listings al
         SET verification_due_at = (r.prior->>'verification_due_at')::timestamptz,
             verification_priority = coalesce(r.prior->>'verification_priority', al.verification_priority)
       WHERE al.listing_id = r.listing_id;
    ELSE
      UPDATE public.available_listings al
         SET status = r.prior->>'status',
             is_active = (r.prior->>'is_active')::boolean,
             off_market_date = (r.prior->>'off_market_date')::date,
             off_market_reason = r.prior->>'off_market_reason',
             sale_transaction_id = (r.prior->>'sale_transaction_id')::integer,
             sold_date = (r.prior->>'sold_date')::date,
             sold_price = (r.prior->>'sold_price')::numeric
       WHERE al.listing_id = r.listing_id;
    END IF;
    UPDATE public.dia_listing_sale_close_log SET restored_at = now() WHERE log_id = r.log_id;
    n := n + 1;
  END LOOP;
  PERFORM set_config('lcc.listing_sale_reconcile_off', 'off', true);
  RETURN n;
END
$fn$;

-- Sale side (was: close every open listing with on_market NULL or <= sale + 90d).
CREATE OR REPLACE FUNCTION public.close_listing_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.sale_date IS NULL OR NEW.property_id IS NULL
     OR coalesce(NEW.transaction_state, 'live') <> 'live'
     OR coalesce(NEW.exclude_from_market_metrics, false) THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.dia_reconcile_listing_sales(
    public.dia_listing_twin_property_ids(NEW.property_id), false, 'sale_trigger');
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_close_listing_on_sale ON public.sales_transactions;
CREATE TRIGGER trg_close_listing_on_sale
  AFTER INSERT OR UPDATE OF sale_date, property_id, transaction_state, exclude_from_market_metrics, sold_price
  ON public.sales_transactions FOR EACH ROW EXECUTE FUNCTION public.close_listing_on_sale();

-- Sale-event side (was: mark sold with no market-sale guard). Sale events link to the spine.
CREATE OR REPLACE FUNCTION public.fn_sale_event_mark_listings_sold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.sale_date IS NULL OR NEW.property_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.dia_reconcile_listing_sales(
    public.dia_listing_twin_property_ids(NEW.property_id), false, 'sale_event_trigger');
  RETURN NEW;
END
$fn$;

-- Listing side (was: any sale after COALESCE(on_market_date, listing_date)).
CREATE OR REPLACE FUNCTION public.fn_listing_close_if_sold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE b record;
BEGIN
  IF current_setting('lcc.listing_sale_reconcile_off', true) = 'on'
     OR NEW.property_id IS NULL
     OR NEW.is_active IS FALSE
     OR coalesce(dia_norm_listing_status(NEW.status), 'active') NOT IN ('active', 'under_contract') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO b FROM public.dia_listing_best_sale_verdict(
    NEW.listing_id, NEW.property_id, NEW.on_market_date, NEW.on_market_date_confidence,
    coalesce(dia_listing_capture_date(NEW.last_seen, NEW.listing_date_source, NEW.listing_date, NEW.created_at), current_date),
    coalesce(NEW.last_price, NEW.initial_price));
  IF b.verdict LIKE 'close_%' THEN
    INSERT INTO public.dia_listing_sale_close_log (batch_tag, listing_id, sale_id, verdict, action, prior)
    VALUES ('listing_trigger', NEW.listing_id, b.sale_id, b.verdict, 'closed',
            jsonb_build_object('status', coalesce(NEW.status, 'active'), 'is_active', coalesce(NEW.is_active, true),
                               'off_market_date', NEW.off_market_date,
                               'off_market_reason', NEW.off_market_reason,
                               'sale_transaction_id', NEW.sale_transaction_id,
                               'sold_date', NEW.sold_date, 'sold_price', NEW.sold_price));
    NEW.status              := 'sold';
    NEW.is_active           := false;
    NEW.sold_date           := coalesce(NEW.sold_date, b.sale_date);
    NEW.sold_price          := coalesce(NEW.sold_price, b.sold_price);
    NEW.off_market_date     := coalesce(NEW.off_market_date, b.sale_date);
    NEW.off_market_reason   := coalesce(NEW.off_market_reason, 'sold');
    NEW.sale_transaction_id := coalesce(NEW.sale_transaction_id, b.sale_id);
    NEW.notes               := coalesce(nullif(NEW.notes, '') || E'\n', '')
                               || '[fn_listing_close_if_sold ' || current_date || '] ' || b.verdict
                               || ': sale ' || b.sale_id || ' on ' || b.sale_date;
  ELSIF b.verdict LIKE 'review_%' THEN
    INSERT INTO public.dia_listing_sale_review (listing_id, sale_id, verdict, details)
    VALUES (NEW.listing_id, b.sale_id, b.verdict,
            jsonb_build_object('sale_date', b.sale_date, 'sold_price', b.sold_price,
                               'sale_property_id', b.sale_property_id, 'via_twin', b.via_twin,
                               'batch', 'listing_trigger'))
    ON CONFLICT (listing_id, sale_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_listing_close_if_sold ON public.available_listings;
CREATE TRIGGER trg_listing_close_if_sold
  BEFORE INSERT OR UPDATE OF listing_date, is_active, status, property_id, last_verified_at,
                             verification_due_at, on_market_date, on_market_date_confidence,
                             last_seen, last_price
  ON public.available_listings FOR EACH ROW EXECUTE FUNCTION public.fn_listing_close_if_sold();

CREATE OR REPLACE VIEW public.v_dia_listing_sale_verdicts
WITH (security_invoker = on) AS
SELECT al.listing_id, al.property_id, p.address, p.city, p.state, al.status,
       al.on_market_date, al.on_market_date_confidence,
       dia_listing_capture_date(al.last_seen, al.listing_date_source, al.listing_date, al.created_at) AS capture_date,
       coalesce(al.last_price, al.initial_price) AS asking_price,
       b.sale_id, b.sale_property_id, b.sale_date, b.sold_price, b.verdict, b.via_twin
  FROM public.available_listings al
  LEFT JOIN public.properties p ON p.property_id = al.property_id
  CROSS JOIN LATERAL public.dia_listing_best_sale_verdict(
         al.listing_id, al.property_id, al.on_market_date, al.on_market_date_confidence,
         dia_listing_capture_date(al.last_seen, al.listing_date_source, al.listing_date, al.created_at),
         coalesce(al.last_price, al.initial_price)) b
 WHERE al.property_id IS NOT NULL AND al.is_active IS TRUE;
REVOKE ALL ON public.v_dia_listing_sale_verdicts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_dia_listing_sale_verdicts TO service_role;

CREATE OR REPLACE FUNCTION public.dia_check_listing_sale_parity()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_sold_active integer; v_open_review integer; v jsonb;
BEGIN
  SELECT count(*) FILTER (WHERE verdict LIKE 'close_%') INTO v_sold_active FROM public.v_dia_listing_sale_verdicts;
  SELECT count(*) INTO v_open_review FROM public.dia_listing_sale_review WHERE status = 'open';
  v := jsonb_build_object('active_listings_with_sale', v_sold_active, 'open_reviews', v_open_review,
                          'checked_at', now());
  IF v_sold_active > 0 THEN
    UPDATE public.lcc_health_alerts SET details = v, summary = format('dia: %s active listings have a market sale on or after their market entry', v_sold_active)
     WHERE alert_kind = 'listing_sold_still_active' AND source = 'dia' AND resolved_at IS NULL;
    IF NOT FOUND THEN
      INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
      VALUES ('listing_sold_still_active', 'dia', 'warn',
              format('dia: %s active listings have a market sale on or after their market entry', v_sold_active), v);
    END IF;
  ELSE
    UPDATE public.lcc_health_alerts SET resolved_at = now(), resolved_note = 'count back to 0'
     WHERE alert_kind = 'listing_sold_still_active' AND source = 'dia' AND resolved_at IS NULL;
  END IF;
  RETURN v;
END
$fn$;

CREATE OR REPLACE FUNCTION public.dia_route_stale_listings_to_verification(
  p_dry_run boolean DEFAULT true, p_batch text DEFAULT NULL)
RETURNS TABLE(listing_id integer, reason text)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
#variable_conflict use_column
DECLARE r record; v_batch text := coalesce(p_batch, 'listing_stale_verify_' || to_char(now(), 'YYYYMMDD'));
BEGIN
  FOR r IN
    SELECT al.listing_id AS lid, al.verification_due_at, al.verification_priority,
           CASE WHEN al.last_seen < current_date - 180 THEN 'not_seen_180d'
                ELSE 'listed_over_2y' END AS why
      FROM public.available_listings al
     WHERE al.is_active IS TRUE
       AND (al.last_seen < current_date - 180
            OR coalesce(al.on_market_date, al.listing_date) < current_date - 730)
       AND (al.verification_due_at IS NULL OR al.verification_due_at > now()
            OR coalesce(al.verification_priority, '') <> 'high')
  LOOP
    listing_id := r.lid; reason := r.why;
    IF NOT p_dry_run THEN
      INSERT INTO public.dia_listing_sale_close_log (batch_tag, listing_id, sale_id, verdict, action, prior)
      VALUES (v_batch, r.lid, NULL, r.why, 'stale_verify',
              jsonb_build_object('verification_due_at', r.verification_due_at,
                                 'verification_priority', r.verification_priority));
      UPDATE public.available_listings al
         SET verification_due_at = least(coalesce(al.verification_due_at, now()), now()),
             verification_priority = 'high'
       WHERE al.listing_id = r.lid;
    END IF;
    RETURN NEXT;
  END LOOP;
END
$fn$;

REVOKE ALL ON FUNCTION public.dia_listing_capture_date(date, text, date, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dia_listing_twin_property_ids(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dia_listing_best_sale_verdict(integer, integer, date, text, date, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dia_reconcile_listing_sales(integer[], boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dia_restore_listing_sale_close(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dia_check_listing_sale_parity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dia_route_stale_listings_to_verification(boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dia_listing_capture_date(date, text, date, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.dia_listing_twin_property_ids(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.dia_listing_best_sale_verdict(integer, integer, date, text, date, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.dia_reconcile_listing_sales(integer[], boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dia_restore_listing_sale_close(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.dia_check_listing_sale_parity() TO service_role;
GRANT EXECUTE ON FUNCTION public.dia_route_stale_listings_to_verification(boolean, text) TO service_role;

-- The hygiene sweep's own closer (any sale after listing_date, market or not) now calls the writer.
-- Patched in place; raises if the live body has drifted from the text it expects.
DO $patch$
DECLARE d text; i int; j int;
  v_new text := 'SELECT count(*) INTO n_close_listings FROM public.dia_reconcile_listing_sales(NULL, false, ''hygiene_sweep'') WHERE action <> ''review'';';
BEGIN
  d := pg_get_functiondef('public.lcc_data_hygiene_sweep()'::regprocedure);
  IF position('dia_reconcile_listing_sales(NULL, false, ''hygiene_sweep'')' IN d) > 0 THEN
    RETURN;
  END IF;
  i := position('UPDATE public.available_listings al' || E'\n' || '     SET status = ''Sold'', is_active = FALSE,' IN d);
  j := position('GET DIAGNOSTICS n_close_listings = ROW_COUNT;' IN d);
  IF i = 0 OR j = 0 OR j < i THEN
    RAISE EXCEPTION 'lcc_data_hygiene_sweep drifted: close_listings step text not found';
  END IF;
  d := substr(d, 1, i - 1) || v_new || substr(d, j + length('GET DIAGNOSTICS n_close_listings = ROW_COUNT;'));
  EXECUTE d;
END
$patch$;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dia-listing-sale-parity-check';
    PERFORM cron.schedule('dia-listing-sale-parity-check', '37 4 * * *',
                          'select public.dia_check_listing_sale_parity()');
  END IF;
END
$cron$;

DO $assert$
BEGIN
  IF has_table_privilege('anon', 'public.dia_listing_sale_close_log', 'INSERT')
     OR has_table_privilege('authenticated', 'public.dia_listing_sale_review', 'INSERT') THEN
    RAISE EXCEPTION 'listing-sale ledgers are client-writable';
  END IF;
  IF has_function_privilege('anon', 'public.dia_reconcile_listing_sales(integer[], boolean, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'dia_reconcile_listing_sales is anon-executable';
  END IF;
  IF lcc_listing_sale_verdict('2026-01-01', 'high', '2026-02-01', 100, '2026-03-01', 100, true) <> 'close_sold_after_seen' THEN
    RAISE EXCEPTION 'lcc_listing_sale_verdict self-check failed';
  END IF;
END
$assert$;
