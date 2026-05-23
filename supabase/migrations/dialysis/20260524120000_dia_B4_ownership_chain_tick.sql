-- ============================================================================
-- 20260524120000_dia_B4_ownership_chain_tick.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — B4 ownership-chain-tick (dia)
--
-- Surfaces sales chain breaks (seller of sale N+1 != buyer of sale N for
-- the same property) using canonical-key normalization to ignore
-- punctuation, legal suffixes, and the "the" prefix.
--
-- Two artifacts:
--   v_sales_chain_breaks — list every consecutive sale pair per property
--                          with a verdict (match | break | unverifiable)
--   ownership_chain_tick() — counts breaks; opens a data_health_alerts row
--                            when count changes >25 from prior snapshot
--
-- Schedule: nightly at 03:45 UTC (after B5 at 03:15).
--
-- Limitations: pair-based check using only buyer/seller name fields. Doesn't
-- yet consult ownership_history; A6a chronological closure may improve the
-- signal further. Useful even now to surface candidates for manual review.
-- ============================================================================

-- Drop the temp helper from the survey if it exists; we'll rebuild it as
-- part of B4 (production version, IMMUTABLE).
DROP FUNCTION IF EXISTS public._canon_owner_key(text);

CREATE OR REPLACE FUNCTION public.canon_owner_key(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT TRIM(REGEXP_REPLACE(
    LOWER(REGEXP_REPLACE(
      COALESCE(p, ''),
      '[\.,]|\m(llc|inc|corp|corporation|company|co|lp|llp|trust|holdings|properties|propco|the)\M',
      ' ', 'gi'
    )),
    '\s+', ' ', 'g'
  ));
$$;

COMMENT ON FUNCTION public.canon_owner_key IS
  'B4: canonical key for owner name comparison. Lowercases, strips punctuation, legal suffixes (LLC/Inc/Corp/...), and the "the" prefix. Whitespace collapsed. IMMUTABLE for use in views and generated columns.';

CREATE OR REPLACE VIEW public.v_sales_chain_breaks AS
WITH chronological AS (
  SELECT
    property_id,
    sale_id,
    sale_date,
    buyer_name,
    seller_name,
    public.canon_owner_key(buyer_name)  AS buyer_k,
    public.canon_owner_key(seller_name) AS seller_k,
    LAG(sale_id)                                     OVER w AS prev_sale_id,
    LAG(sale_date)                                   OVER w AS prev_sale_date,
    LAG(buyer_name)                                  OVER w AS prev_buyer_name,
    LAG(public.canon_owner_key(buyer_name))          OVER w AS prev_buyer_k
  FROM public.sales_transactions
  WHERE transaction_state='live' AND property_id IS NOT NULL AND sale_date IS NOT NULL
  WINDOW w AS (PARTITION BY property_id ORDER BY sale_date, sale_id)
)
SELECT
  property_id,
  prev_sale_id, prev_sale_date, prev_buyer_name,
  sale_id,      sale_date,      seller_name,
  CASE
    WHEN seller_k IN ('','-') OR prev_buyer_k IN ('','-') THEN 'unverifiable'
    WHEN seller_k = prev_buyer_k THEN 'match'
    ELSE 'break'
  END AS verdict
FROM chronological
WHERE prev_sale_id IS NOT NULL;

COMMENT ON VIEW public.v_sales_chain_breaks IS
  'B4: per-property consecutive sale pairs with verdict (match | break | unverifiable). break = seller of sale N+1 does not match buyer of sale N under canonical-key normalization.';

CREATE OR REPLACE FUNCTION public.ownership_chain_tick()
RETURNS TABLE (
  pairs_total      BIGINT,
  chain_breaks     BIGINT,
  chain_matches    BIGINT,
  unverifiable     BIGINT,
  alert_opened     BOOLEAN,
  run_at           TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_total  BIGINT;
  v_break  BIGINT;
  v_match  BIGINT;
  v_unver  BIGINT;
  v_prev   NUMERIC;
  v_alert  BOOLEAN := FALSE;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE verdict='break'),
    COUNT(*) FILTER (WHERE verdict='match'),
    COUNT(*) FILTER (WHERE verdict='unverifiable')
  INTO v_total, v_break, v_match, v_unver
  FROM public.v_sales_chain_breaks;

  -- Compare to most recent prior snapshot of the same metric.
  SELECT (payload->>'chain_breaks')::numeric INTO v_prev
  FROM public.data_health_snapshots
  WHERE view_name = 'v_sales_chain_breaks'
  ORDER BY snapshot_at DESC LIMIT 1;

  INSERT INTO public.data_health_snapshots (view_name, payload)
  VALUES ('v_sales_chain_breaks',
          jsonb_build_object(
            'pairs_total', v_total,
            'chain_breaks', v_break,
            'chain_matches', v_match,
            'unverifiable', v_unver
          ));

  IF v_prev IS NOT NULL AND (v_break - v_prev) > 25 THEN
    INSERT INTO public.data_health_alerts
      (alert_kind, severity, metric, prev_value, curr_value, delta, summary)
    VALUES ('chain_break_growth', 'warn', 'chain_breaks',
            v_prev, v_break, v_break - v_prev,
            format('Sales chain breaks grew from %s to %s (+%s)', v_prev, v_break, v_break - v_prev));
    v_alert := TRUE;
  END IF;

  RETURN QUERY SELECT v_total, v_break, v_match, v_unver, v_alert, now();
END;
$$;

COMMENT ON FUNCTION public.ownership_chain_tick IS
  'B4: snapshots v_sales_chain_breaks counts daily; opens data_health_alerts row when chain_breaks grows >25 vs prior snapshot.';

DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_existing_jobid FROM cron.job WHERE jobname='lcc-dia-ownership-chain-tick';
  IF v_existing_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_existing_jobid); END IF;
  PERFORM cron.schedule('lcc-dia-ownership-chain-tick', '45 3 * * *',
    $cron$SELECT public.ownership_chain_tick();$cron$);
END $$;
