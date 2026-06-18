-- R42.1 (2026-06-18): scope the cap-rate backfill (confidence + sanity band) +
-- flag bad rent (dia). Mirror of the gov R42.1 scoping, adapted for dia's NNN
-- compute (rent == NOI) and the calculated_cap_rate + rent_at_sale -> cap_rate_final
-- of-record path.
--
-- Auto-APPLY only when ALL hold: rent_confidence='high'; recomputed cap in
-- [p_band_lo,p_band_hi] (dia default 0.045..0.11 -- live high-conf distribution
-- p02 4.98% / p50 7.79% / p98 13.0%); implied yield rent_used/price <= p_max_yield
-- (0.25). Excluded movers -> public.caprate_recompute_review (bad_rent tag for
-- implausible yield). Forward Unit-1 (recompute-on-rent-change) + the loader
-- (Unit 3) stay as shipped; only this one-time BACKFILL is scoped.
--
-- Grounded live 2026-06-18: of 532 drifting dia events, ~288 auto-apply
-- (high-conf, in-band); the rest -> review (227 med-conf, 17 out-of-band).
-- Reversible via cap_recompute_backup.

CREATE TABLE IF NOT EXISTS public.caprate_recompute_review (
  id                bigserial PRIMARY KEY,
  property_id       bigint,
  event_type        text,
  event_date        date,
  price             numeric,
  old_cap           numeric,
  recomputed_cap    numeric,
  rent_used         numeric,
  gross_yield       numeric,
  income_confidence text,
  reason            text,
  tag               text,
  run_tag           text,
  first_seen        timestamptz DEFAULT now(),
  last_seen         timestamptz DEFAULT now(),
  resolved_at       timestamptz,
  resolution        text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_caprate_review_event
  ON public.caprate_recompute_review(property_id, event_type, event_date, (COALESCE(price,-1)));
CREATE INDEX IF NOT EXISTS idx_caprate_review_open
  ON public.caprate_recompute_review(reason) WHERE resolved_at IS NULL;

DROP FUNCTION IF EXISTS public.dia_recompute_caps_backfill(boolean, numeric, int);

CREATE OR REPLACE FUNCTION public.dia_recompute_caps_backfill(
  p_dry_run    boolean DEFAULT true,
  p_min_drift  numeric DEFAULT 0.005,
  p_band_lo    numeric DEFAULT 0.045,
  p_band_hi    numeric DEFAULT 0.11,
  p_max_yield  numeric DEFAULT 0.25,
  p_max_props  int     DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_tag text := 'r42_backfill_' || to_char(now(),'YYYYMMDDHH24MISS');
  v_ledger int := 0;
  v_sales  int := 0;
  v_review int := 0;
BEGIN
  CREATE TEMP TABLE _r421 ON COMMIT DROP AS
  WITH sale_ev AS (
    SELECT s.sale_id, s.property_id, s.sale_date AS evdate, s.sold_price AS price, 'sale'::text AS et,
           s.cap_rate_source, s.calculated_cap_rate AS old_calc, s.rent_at_sale AS old_rent
    FROM public.sales_transactions s
    WHERE COALESCE(s.exclude_from_market_metrics,false)=false AND s.property_id IS NOT NULL AND s.sold_price>0 AND s.sale_date IS NOT NULL
  ),
  list_ev AS (
    SELECT NULL::bigint AS sale_id, al.property_id, COALESCE(al.price_change_date, CURRENT_DATE) AS evdate,
           COALESCE(al.last_price, al.initial_price) AS price, 'listing'::text AS et,
           NULL::text AS cap_rate_source, NULL::numeric AS old_calc, NULL::numeric AS old_rent
    FROM public.available_listings al
    WHERE al.property_id IS NOT NULL AND COALESCE(al.is_active,true)=true AND COALESCE(al.last_price, al.initial_price)>0
  ),
  ev AS (SELECT * FROM sale_ev UNION ALL SELECT * FROM list_ev),
  cand AS (
    SELECT DISTINCT ON (h.id, COALESCE(ev.sale_id,-1))
      ev.sale_id, ev.property_id, ev.et AS event_type, ev.evdate AS event_date, ev.price,
      ev.cap_rate_source, ev.old_calc, ev.old_rent,
      h.id AS ledger_id, h.cap_rate AS old_cap, fc.cap_rate AS new_cap, fc.rent_confidence AS conf,
      fc.rent_used, fc.rent_used / NULLIF(ev.price,0) AS yield
    FROM ev
    JOIN public.cap_rate_history h ON h.property_id=ev.property_id AND h.event_type::text=ev.et
       AND h.event_date=ev.evdate AND COALESCE(h.price_at_event,-1)=COALESCE(ev.price,-1) AND h.cap_rate IS NOT NULL
    JOIN LATERAL public.dia_compute_cap_rate(ev.property_id, ev.price, ev.evdate) fc ON true
    WHERE fc.cap_rate IS NOT NULL AND fc.cap_rate BETWEEN 0.01 AND 0.25 AND abs(fc.cap_rate - h.cap_rate) >= p_min_drift
    ORDER BY h.id, COALESCE(ev.sale_id,-1)
  )
  SELECT c.*,
    CASE
      WHEN c.conf IS DISTINCT FROM 'high'                 THEN 'low_confidence'
      WHEN c.yield > p_max_yield                          THEN 'implausible_yield'
      WHEN c.new_cap < p_band_lo OR c.new_cap > p_band_hi THEN 'out_of_band'
      ELSE 'apply'
    END AS decision
  FROM cand c;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'apply', (SELECT jsonb_build_object(
                  'events', count(*), 'properties', count(DISTINCT property_id),
                  'avg_old', round(avg(old_cap),4), 'avg_new', round(avg(new_cap),4),
                  'max_abs_delta', round(max(abs(new_cap-old_cap)),4))
                FROM _r421 WHERE decision='apply'),
      'review_total', (SELECT count(*) FROM _r421 WHERE decision<>'apply'),
      'review_by_reason', (SELECT jsonb_object_agg(decision, c)
                FROM (SELECT decision, count(*) c FROM _r421 WHERE decision<>'apply' GROUP BY decision) x),
      'sample_apply', (SELECT jsonb_agg(d) FROM (
                SELECT property_id, event_type, event_date, old_cap, new_cap, round(new_cap-old_cap,4) AS delta, conf
                FROM _r421 WHERE decision='apply' ORDER BY abs(new_cap-old_cap) DESC LIMIT 25) d),
      'sample_review', (SELECT jsonb_agg(d) FROM (
                SELECT property_id, event_type, old_cap, new_cap, rent_used, round(yield,4) AS yield, conf, decision
                FROM _r421 WHERE decision<>'apply' ORDER BY abs(new_cap-old_cap) DESC LIMIT 25) d)
    );
  END IF;

  IF p_max_props IS NOT NULL THEN
    DELETE FROM _r421 WHERE decision='apply' AND property_id NOT IN (
      SELECT property_id FROM _r421 WHERE decision='apply' ORDER BY property_id LIMIT p_max_props);
  END IF;

  -- APPLY (a): the derived ledger -- one row per distinct ledger_id.
  INSERT INTO public.cap_recompute_backup(run_tag, scope, property_id, event_date, price_at_event, ref_id, col, old_value, new_value)
  SELECT DISTINCT ON (ledger_id) v_tag, 'ledger_'||event_type, property_id, event_date, price, ledger_id, 'cap_rate', old_cap, new_cap
  FROM _r421 WHERE decision='apply' ORDER BY ledger_id;

  WITH a AS (SELECT DISTINCT ON (ledger_id) ledger_id, new_cap, rent_used, conf, event_type FROM _r421 WHERE decision='apply' ORDER BY ledger_id),
  upd AS (
    UPDATE public.cap_rate_history h SET
      cap_rate = a.new_cap, rent_at_event = a.rent_used,
      notes = COALESCE(h.notes,'') || ' [r42.1 scoped recompute]'
    FROM a WHERE h.id = a.ledger_id AND h.cap_rate IS DISTINCT FROM a.new_cap
    RETURNING 1
  ) SELECT count(*) INTO v_ledger FROM upd;

  -- APPLY (b): the displayed derived fields on sales (-> of-record trigger
  -- refreshes cap_rate_final). Skip manual overrides.
  INSERT INTO public.cap_recompute_backup(run_tag, scope, property_id, event_date, price_at_event, ref_id, col, old_value, new_value)
  SELECT v_tag, 'sale_calc', property_id, event_date, price, sale_id, 'calculated_cap_rate', old_calc, new_cap
  FROM _r421 WHERE decision='apply' AND sale_id IS NOT NULL AND cap_rate_source IS DISTINCT FROM 'manual'
    AND (old_calc IS DISTINCT FROM new_cap OR old_rent IS DISTINCT FROM rent_used);
  INSERT INTO public.cap_recompute_backup(run_tag, scope, property_id, event_date, price_at_event, ref_id, col, old_value, new_value)
  SELECT v_tag, 'sale_rent', property_id, event_date, price, sale_id, 'rent_at_sale', old_rent, rent_used
  FROM _r421 WHERE decision='apply' AND sale_id IS NOT NULL AND cap_rate_source IS DISTINCT FROM 'manual'
    AND (old_calc IS DISTINCT FROM new_cap OR old_rent IS DISTINCT FROM rent_used);

  WITH s AS (
    SELECT sale_id, new_cap, rent_used FROM _r421
    WHERE decision='apply' AND sale_id IS NOT NULL AND cap_rate_source IS DISTINCT FROM 'manual'
      AND (old_calc IS DISTINCT FROM new_cap OR old_rent IS DISTINCT FROM rent_used)
  ),
  upd AS (
    UPDATE public.sales_transactions t SET calculated_cap_rate = s.new_cap, rent_at_sale = s.rent_used
    FROM s WHERE t.sale_id = s.sale_id
    RETURNING 1
  ) SELECT count(*) INTO v_sales FROM upd;

  -- REVIEW.
  INSERT INTO public.caprate_recompute_review
    (property_id, event_type, event_date, price, old_cap, recomputed_cap, rent_used, gross_yield, income_confidence, reason, tag, run_tag, last_seen)
  SELECT property_id, event_type, event_date, price, old_cap, new_cap, rent_used, yield, conf, decision,
         CASE WHEN decision='implausible_yield' THEN 'bad_rent' ELSE 'suspect_cap' END, v_tag, now()
  FROM _r421 WHERE decision<>'apply'
  ON CONFLICT (property_id, event_type, event_date, (COALESCE(price,-1))) DO UPDATE SET
    old_cap=EXCLUDED.old_cap, recomputed_cap=EXCLUDED.recomputed_cap, rent_used=EXCLUDED.rent_used,
    gross_yield=EXCLUDED.gross_yield, income_confidence=EXCLUDED.income_confidence,
    reason=EXCLUDED.reason, tag=EXCLUDED.tag, run_tag=EXCLUDED.run_tag, last_seen=now();
  GET DIAGNOSTICS v_review = ROW_COUNT;

  RETURN jsonb_build_object('dry_run', false, 'run_tag', v_tag,
    'ledger_applied', v_ledger, 'sales_applied', v_sales, 'review_emitted', v_review);
END $$;

COMMENT ON FUNCTION public.dia_recompute_caps_backfill IS
  'R42.1 (GATED): confidence- + sanity-bounded backfill of stale dia derived caps. dry_run defaults TRUE. Real run auto-applies only high-confidence, in-band, sane-yield recomputes to cap_rate_history.cap_rate + sales_transactions.calculated_cap_rate/rent_at_sale (-> of-record trigger refreshes cap_rate_final); reversible via cap_recompute_backup; routes the rest to caprate_recompute_review.';
