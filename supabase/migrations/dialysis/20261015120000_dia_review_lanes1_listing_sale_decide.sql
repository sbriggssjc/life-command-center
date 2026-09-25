-- REVIEW-LANES1 (2026-09-25) — the dia listing↔sale review queue becomes a Decision Center lane.
--
-- LISTING-SALE-PARITY1 correctly sent ambiguous (listing, sale) pairs to dia_listing_sale_review
-- instead of guessing. Nothing could act on them: the table had a status column and no function
-- that set it. This adds the writer a human verdict (and the safe auto-resolver) goes through.
--
--   dia_listing_sale_close_one(listing, sale, verdict, batch)
--       Closes ONE listing as sold by ONE sale. Same SET list, same unique_violation → superseded
--       fallback, same close-log row and listing_change_events row as dia_reconcile_listing_sales.
--       Undo = dia_restore_listing_sale_close(batch, listing), the existing restore.
--   dia_decide_listing_sale_review(review_id, 'confirm_sold' | 'reject', decided_by)
--       confirm_sold → close_one with batch 'lsr_review_<id>', review → confirmed_sold.
--       reject       → review → rejected. dia_listing_best_sale_verdict already skips a rejected
--                      pair, so the pair is never re-proposed.
--   dia_undo_listing_sale_review(review_id, undone_by)
--       Restores the close (if any) and puts the review back to open. The restored close-log row
--       makes best_sale_verdict skip the pair, so reconcile cannot re-close it behind the human.
--   dia_autoresolve_listing_sale_reviews(dry_run default true)
--       Only classes where the question has already been answered by something else:
--         listing_gone / listing_no_longer_active — another path closed or removed the listing;
--         sale_gone / sale_no_longer_market      — the sale was deleted, quarantined or excluded;
--         later_sale_settles                     — the listing's CURRENT best verdict is a close_*
--                                                   verdict (a later sale proves it sold); closed
--                                                   through dia_reconcile_listing_sales, batch
--                                                   'lsr_auto_<id>'.
--       Every other open review is left for a human. Status 'superseded' is new; undo reopens it.
--   v_dia_listing_sale_review_open — the card: listing, sale, property, price ratio, dates.
--
-- Measured 2026-09-25: 8 open, all still 'review_*' under the current rule, 0 in any auto class.

BEGIN;

ALTER TABLE public.dia_listing_sale_review DROP CONSTRAINT IF EXISTS dia_listing_sale_review_status_check;
ALTER TABLE public.dia_listing_sale_review ADD CONSTRAINT dia_listing_sale_review_status_check
  CHECK (status IN ('open', 'confirmed_sold', 'rejected', 'superseded'));
ALTER TABLE public.dia_listing_sale_review ADD COLUMN IF NOT EXISTS decided_by text;
ALTER TABLE public.dia_listing_sale_review ADD COLUMN IF NOT EXISTS decision jsonb;

CREATE OR REPLACE FUNCTION public.dia_listing_sale_close_one(
  p_listing_id integer, p_sale_id integer, p_verdict text, p_batch text)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  al record; s record; v_action text := 'closed'; v_prior jsonb; v_twin boolean;
BEGIN
  SELECT * INTO al FROM public.available_listings WHERE listing_id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing % not found', p_listing_id; END IF;
  SELECT * INTO s FROM public.sales_transactions WHERE sale_id = p_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale % not found', p_sale_id; END IF;
  v_twin := s.property_id IS DISTINCT FROM al.property_id;
  v_prior := jsonb_build_object('status', al.status, 'is_active', al.is_active,
                                'off_market_date', al.off_market_date,
                                'off_market_reason', al.off_market_reason,
                                'sale_transaction_id', al.sale_transaction_id,
                                'sold_date', al.sold_date, 'sold_price', al.sold_price);
  BEGIN
    UPDATE public.available_listings l
       SET status              = 'sold',
           is_active           = false,
           off_market_date     = coalesce(l.off_market_date, s.sale_date),
           off_market_reason   = 'sold',
           sold_date           = coalesce(l.sold_date, s.sale_date),
           sold_price          = coalesce(l.sold_price, s.sold_price),
           sale_transaction_id = coalesce(l.sale_transaction_id, CASE WHEN NOT v_twin THEN s.sale_id END),
           notes               = coalesce(nullif(l.notes, '') || E'\n', '')
                                 || '[' || p_batch || ' ' || current_date || '] ' || p_verdict
                                 || ': sale ' || s.sale_id || ' on ' || s.sale_date
     WHERE l.listing_id = p_listing_id;
  EXCEPTION
    WHEN unique_violation THEN
      v_action := 'superseded_duplicate';
      UPDATE public.available_listings l
         SET status = 'superseded', is_active = false,
             off_market_date = coalesce(l.off_market_date, s.sale_date),
             off_market_reason = 'duplicate', exclude_from_listing_metrics = true
       WHERE l.listing_id = p_listing_id;
    WHEN OTHERS THEN
      v_action := 'closed_unlinked';
      UPDATE public.available_listings l
         SET status = 'sold', is_active = false,
             off_market_date = coalesce(l.off_market_date, s.sale_date),
             off_market_reason = 'sold'
       WHERE l.listing_id = p_listing_id;
  END;
  INSERT INTO public.dia_listing_sale_close_log (batch_tag, listing_id, sale_id, verdict, action, prior)
  VALUES (p_batch, p_listing_id, p_sale_id, p_verdict, v_action, v_prior);
  INSERT INTO public.listing_change_events (listing_id, property_id, event_type, priority,
                                            description, old_value, new_value, event_date, created_at)
  VALUES (p_listing_id, al.property_id, 'status_change', 'high',
          'Listing closed (' || p_verdict || ') - sale_id ' || p_sale_id || ', sale_date ' || s.sale_date,
          'active', 'sold', now(), now());
  RETURN v_action;
END
$fn$;

CREATE OR REPLACE FUNCTION public.dia_decide_listing_sale_review(
  p_review_id bigint, p_decision text, p_decided_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record; al record; v_batch text := 'lsr_review_' || p_review_id; v_action text;
BEGIN
  SELECT * INTO r FROM public.dia_listing_sale_review WHERE review_id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'review_not_found'); END IF;
  IF r.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'review_not_open', 'status', r.status);
  END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.dia_listing_sale_review
       SET status = 'rejected', resolved_at = now(), decided_by = p_decided_by,
           decision = jsonb_build_object('decision', 'reject', 'at', now())
     WHERE review_id = p_review_id;
    RETURN jsonb_build_object('ok', true, 'decision', 'reject', 'review_id', p_review_id);
  ELSIF p_decision = 'confirm_sold' THEN
    SELECT listing_id, is_active INTO al FROM public.available_listings WHERE listing_id = r.listing_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'listing_not_found'); END IF;
    IF al.is_active IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'error', 'listing_not_active');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sales_transactions WHERE sale_id = r.sale_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'sale_not_found');
    END IF;
    v_action := public.dia_listing_sale_close_one(r.listing_id, r.sale_id, 'human_' || r.verdict, v_batch);
    UPDATE public.dia_listing_sale_review
       SET status = 'confirmed_sold', resolved_at = now(), decided_by = p_decided_by,
           decision = jsonb_build_object('decision', 'confirm_sold', 'at', now(),
                                         'batch', v_batch, 'action', v_action)
     WHERE review_id = p_review_id;
    RETURN jsonb_build_object('ok', true, 'decision', 'confirm_sold', 'review_id', p_review_id,
                              'batch', v_batch, 'action', v_action);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'unknown_decision', 'decision', p_decision);
END
$fn$;

CREATE OR REPLACE FUNCTION public.dia_undo_listing_sale_review(
  p_review_id bigint, p_undone_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE r record; v_restored integer := 0;
BEGIN
  SELECT * INTO r FROM public.dia_listing_sale_review WHERE review_id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'review_not_found'); END IF;
  IF r.status = 'open' THEN RETURN jsonb_build_object('ok', false, 'error', 'review_not_decided'); END IF;
  IF r.decision ? 'batch' THEN
    v_restored := public.dia_restore_listing_sale_close(r.decision->>'batch', r.listing_id);
    IF r.status = 'confirmed_sold' AND v_restored = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_restore', 'batch', r.decision->>'batch');
    END IF;
  END IF;
  UPDATE public.dia_listing_sale_review
     SET status = 'open', resolved_at = NULL, decided_by = NULL,
         decision = coalesce(r.decision, '{}'::jsonb)
                    || jsonb_build_object('undone_at', now(), 'undone_by', p_undone_by,
                                          'undone_from_status', r.status, 'restored', v_restored)
   WHERE review_id = p_review_id;
  RETURN jsonb_build_object('ok', true, 'review_id', p_review_id, 'from_status', r.status,
                            'restored', v_restored);
END
$fn$;

CREATE OR REPLACE FUNCTION public.dia_autoresolve_listing_sale_reviews(p_dry_run boolean DEFAULT true)
RETURNS TABLE(review_id bigint, listing_id integer, sale_id integer, auto_class text, action text)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
#variable_conflict use_column
DECLARE r record; v_class text; v_batch text; v_best text;
BEGIN
  FOR r IN
    SELECT q.review_id AS rid, q.listing_id AS lid, q.sale_id AS sid, q.verdict,
           al.listing_id AS al_id, al.property_id, al.is_active, al.on_market_date, al.on_market_date_confidence,
           al.last_seen, al.listing_date_source, al.listing_date, al.created_at, al.last_price, al.initial_price,
           s.sale_id AS s_id, s.transaction_state, s.exclude_from_market_metrics
      FROM public.dia_listing_sale_review q
      LEFT JOIN public.available_listings al ON al.listing_id = q.listing_id
      LEFT JOIN public.sales_transactions s ON s.sale_id = q.sale_id
     WHERE q.status = 'open'
     ORDER BY q.review_id
  LOOP
    v_class := NULL; v_best := NULL;
    IF r.al_id IS NULL THEN v_class := 'listing_gone';
    ELSIF r.is_active IS NOT TRUE THEN v_class := 'listing_no_longer_active';
    -- The sale-based classes only apply to reviews the shared listing↔sale rule raised. Other
    -- producers queue reviews ABOUT a non-market sale or a mis-attached listing
    -- (SALE-PROMOTER1: review_non_market_sale, review_listing_on_wrong_property); for those the
    -- sale being non-market is the question, not an answer.
    ELSIF NOT (r.verdict IN ('review_price_mismatch', 'review_sold_near_entry', 'review_sold_before_capture',
                             'review_same_price') OR r.verdict LIKE 'review\_twin\_close\_%') THEN
      v_class := NULL;
    ELSIF r.s_id IS NULL THEN v_class := 'sale_gone';
    ELSIF coalesce(r.transaction_state, 'live') <> 'live' OR coalesce(r.exclude_from_market_metrics, false) THEN
      v_class := 'sale_no_longer_market';
    ELSE
      SELECT b.verdict INTO v_best
        FROM public.dia_listing_best_sale_verdict(
               r.lid, r.property_id, r.on_market_date, r.on_market_date_confidence,
               dia_listing_capture_date(r.last_seen, r.listing_date_source, r.listing_date, r.created_at),
               coalesce(r.last_price, r.initial_price)) b;
      IF v_best LIKE 'close_%' THEN v_class := 'later_sale_settles'; END IF;
    END IF;
    CONTINUE WHEN v_class IS NULL;

    review_id := r.rid; listing_id := r.lid; sale_id := r.sid; auto_class := v_class;
    action := CASE WHEN p_dry_run THEN 'would_supersede' ELSE 'superseded' END;
    IF NOT p_dry_run THEN
      v_batch := NULL;
      IF v_class = 'later_sale_settles' THEN
        v_batch := 'lsr_auto_' || r.rid;
        PERFORM 1 FROM public.dia_reconcile_listing_sales(ARRAY[r.property_id], false, v_batch);
      END IF;
      UPDATE public.dia_listing_sale_review q
         SET status = 'superseded', resolved_at = now(), decided_by = 'auto:review_lanes1',
             decision = jsonb_strip_nulls(jsonb_build_object('decision', 'auto_supersede', 'at', now(),
                          'auto_class', v_class, 'best_verdict', v_best, 'batch', v_batch))
       WHERE q.review_id = r.rid;
    END IF;
    RETURN NEXT;
  END LOOP;
END
$fn$;

-- The card. Evidence the round already gathered, one row per open review.
CREATE OR REPLACE VIEW public.v_dia_listing_sale_review_open
WITH (security_invoker = on) AS
SELECT q.review_id, q.listing_id, q.sale_id, q.verdict, q.created_at, q.details,
       al.property_id, p.address, p.city, p.state,
       al.status AS listing_status, al.is_active,
       coalesce(al.last_price, al.initial_price) AS asking_price,
       al.on_market_date, al.on_market_date_confidence,
       dia_listing_capture_date(al.last_seen, al.listing_date_source, al.listing_date, al.created_at) AS capture_date,
       s.property_id AS sale_property_id, sp.address AS sale_property_address,
       s.sale_date, s.sold_price, s.transaction_state,
       CASE WHEN coalesce(al.last_price, al.initial_price) > 0 AND s.sold_price > 0
            THEN round(coalesce(al.last_price, al.initial_price) / s.sold_price, 3) END AS ask_to_sold_ratio,
       (s.property_id IS DISTINCT FROM al.property_id) AS via_twin
  FROM public.dia_listing_sale_review q
  JOIN public.available_listings al ON al.listing_id = q.listing_id
  LEFT JOIN public.properties p ON p.property_id = al.property_id
  LEFT JOIN public.sales_transactions s ON s.sale_id = q.sale_id
  LEFT JOIN public.properties sp ON sp.property_id = s.property_id
 WHERE q.status = 'open';

REVOKE ALL ON public.v_dia_listing_sale_review_open FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_dia_listing_sale_review_open TO service_role;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.dia_listing_sale_close_one(integer,integer,text,text)',
    'public.dia_decide_listing_sale_review(bigint,text,text)',
    'public.dia_undo_listing_sale_review(bigint,text)',
    'public.dia_autoresolve_listing_sale_reviews(boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    IF has_function_privilege('anon', f, 'execute') OR has_function_privilege('authenticated', f, 'execute') THEN
      RAISE EXCEPTION 'REVIEW-LANES1: % still executable by anon/authenticated', f;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.v_dia_listing_sale_review_open', 'SELECT') THEN
    RAISE EXCEPTION 'REVIEW-LANES1: v_dia_listing_sale_review_open readable by anon';
  END IF;
END $$;

COMMIT;
