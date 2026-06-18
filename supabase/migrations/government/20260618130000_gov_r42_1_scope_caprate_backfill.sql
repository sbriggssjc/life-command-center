-- R42.1 (2026-06-18): scope the cap-rate backfill (confidence + sanity band) +
-- flag bad rent (gov).
--
-- Review of the R42 Unit-2 dry-run found the blanket apply would fix hundreds of
-- garbage ingest caps (e.g. prop 9763 22.5%->~7%, 14197 22%->6.15%) but also
-- publish a few BAD-RENT caps (prop 1152: rent $1.77M on a $4.36M sale -> ~40%
-- gross yield -> 29% cap; old 4.05%->new 29.4% is a REGRESSION). So the REAL
-- write is now confidence- + sanity-bounded; excluded movers are routed to a
-- review artifact, nothing auto-publishes the suspect ones.
--
-- A recomputed derived cap is auto-APPLIED only when ALL hold:
--   * income_confidence = 'high'                 (drop low/medium)
--   * recomputed cap in [p_band_lo, p_band_hi]   (gov default 0.04..0.12 -- from
--                                                 the live high-conf distribution:
--                                                 p02 3.87% / p50 7.83% / p98 18.1%)
--   * implied gross yield rent_gross/price <= p_max_yield (0.25) -- the bad-rent
--                                                 signal that caught 1152
-- Everything excluded -> public.caprate_recompute_review (reason + bad_rent tag),
-- NOT applied. The forward Unit-1 recompute-on-rent-change pass + the loader stay
-- exactly as shipped in R42; only this one-time BACKFILL is scoped.
--
-- Grounded live 2026-06-18: of 1,034 drifting gov events, 804 auto-apply
-- (high-conf, in-band, sane yield); 230 -> review (138 low/med-conf, 26
-- implausible-yield/bad_rent, 66 out-of-band). Reversible via cap_recompute_backup.

-- ---------------------------------------------------------------------------
-- Review artifact: suspect movers + bad-rent rows. Upserted per event (idempotent
-- across re-runs); resolved rows keep their resolution.
-- ---------------------------------------------------------------------------
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
  reason            text,    -- 'low_confidence' | 'implausible_yield' | 'out_of_band'
  tag               text,    -- 'bad_rent' (implausible_yield) | 'suspect_cap'
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

-- ---------------------------------------------------------------------------
-- Scoped backfill (supersedes the R42 3-arg version). dry_run defaults TRUE.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.gov_recompute_caps_backfill(boolean, numeric, int);

CREATE OR REPLACE FUNCTION public.gov_recompute_caps_backfill(
  p_dry_run    boolean DEFAULT true,
  p_min_drift  numeric DEFAULT 0.005,
  p_band_lo    numeric DEFAULT 0.04,
  p_band_hi    numeric DEFAULT 0.12,
  p_max_yield  numeric DEFAULT 0.25,
  p_max_props  int     DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_tag text := 'r42_backfill_' || to_char(now(),'YYYYMMDDHH24MISS');
  v_applied int := 0;
  v_review  int := 0;
BEGIN
  CREATE TEMP TABLE _r421 ON COMMIT DROP AS
  WITH ev AS (
    SELECT s.property_id, s.sale_date AS evdate, s.sold_price AS price, 'sale'::text AS et
    FROM public.sales_transactions s
    WHERE COALESCE(s.exclude_from_market_metrics,false)=false AND s.property_id IS NOT NULL AND s.sold_price>0 AND s.sale_date IS NOT NULL
    UNION ALL
    SELECT al.property_id, COALESCE(al.last_price_change, al.listing_date), COALESCE(al.asking_price, al.original_price), 'listing'
    FROM public.available_listings al WHERE al.property_id IS NOT NULL AND COALESCE(al.asking_price, al.original_price)>0
    UNION ALL
    SELECT pse.property_id, COALESCE(pse.sale_date, CURRENT_DATE), pse.price, 'sale'
    FROM public.property_sale_events pse WHERE pse.property_id IS NOT NULL AND pse.price>0
  ),
  cand AS (
    SELECT DISTINCT ON (h.id)
      ev.property_id, ev.et AS event_type, ev.evdate AS event_date, ev.price,
      h.id AS ledger_id, h.cap_rate AS old_cap,
      fc.cap_rate AS new_cap, fc.income_confidence AS conf,
      COALESCE(fc.rent_gross, fc.income_used) AS rent_used,
      COALESCE(fc.rent_gross, fc.income_used) / NULLIF(ev.price,0) AS yield
    FROM ev
    JOIN public.cap_rate_history h ON h.property_id=ev.property_id AND h.event_type::text=ev.et
       AND h.event_date=ev.evdate AND COALESCE(h.price_at_event,-1)=COALESCE(ev.price,-1) AND h.cap_rate IS NOT NULL
    JOIN LATERAL public.gov_compute_cap_rate(ev.property_id, ev.price, ev.evdate) fc ON true
    WHERE fc.cap_rate IS NOT NULL AND abs(fc.cap_rate - h.cap_rate) >= p_min_drift
    ORDER BY h.id
  )
  SELECT c.*,
    CASE
      WHEN c.conf IS DISTINCT FROM 'high'                    THEN 'low_confidence'
      WHEN c.yield > p_max_yield                             THEN 'implausible_yield'
      WHEN c.new_cap < p_band_lo OR c.new_cap > p_band_hi    THEN 'out_of_band'
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

  -- Optional bound: cap the number of applied properties.
  IF p_max_props IS NOT NULL THEN
    DELETE FROM _r421 WHERE decision='apply' AND property_id NOT IN (
      SELECT property_id FROM _r421 WHERE decision='apply' ORDER BY property_id LIMIT p_max_props
    );
  END IF;

  -- APPLY: snapshot (reversible) then rewrite the derived ledger cap.
  INSERT INTO public.cap_recompute_backup(run_tag, scope, property_id, event_date, price_at_event, ref_id, col, old_value, new_value)
  SELECT v_tag, 'ledger_'||event_type, property_id, event_date, price, ledger_id, 'cap_rate', old_cap, new_cap
  FROM _r421 WHERE decision='apply';

  WITH upd AS (
    UPDATE public.cap_rate_history h SET
      cap_rate          = c.new_cap,
      rent_at_event     = c.rent_used,
      income_confidence = c.conf,
      notes             = COALESCE(h.notes,'') || ' [r42.1 scoped recompute]'
    FROM _r421 c
    WHERE c.decision='apply' AND h.id = c.ledger_id AND h.cap_rate IS DISTINCT FROM c.new_cap
    RETURNING 1
  ) SELECT count(*) INTO v_applied FROM upd;

  -- REVIEW: upsert the excluded movers (idempotent on the event key).
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
    'caps_applied', v_applied, 'review_emitted', v_review);
END $$;

COMMENT ON FUNCTION public.gov_recompute_caps_backfill IS
  'R42.1 (GATED): confidence- + sanity-bounded backfill of stale derived caps. dry_run defaults TRUE (returns scoped before/after + review counts). Real run auto-applies only high-confidence, in-band [p_band_lo,p_band_hi], sane-yield (<=p_max_yield) recomputes (reversible via cap_recompute_backup); routes the rest to caprate_recompute_review (bad_rent tag for implausible yield).';
