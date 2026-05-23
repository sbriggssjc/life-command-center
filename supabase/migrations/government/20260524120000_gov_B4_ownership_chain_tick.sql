-- ============================================================================
-- 20260524120000_gov_B4_ownership_chain_tick.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — B4 ownership-chain-tick (gov)
--
-- Gov uses buyer/seller (text columns; no _name suffix). Same canonical-key
-- normalization and the same v_sales_chain_breaks shape so the dashboard
-- query is cross-domain identical.
-- ============================================================================

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
  'B4: canonical key for owner name comparison. Lowercases, strips punctuation, legal suffixes (LLC/Inc/Corp/...), and the "the" prefix. Whitespace collapsed.';

CREATE OR REPLACE VIEW public.v_sales_chain_breaks AS
WITH chronological AS (
  SELECT
    property_id, sale_id, sale_date,
    buyer, seller,
    public.canon_owner_key(buyer)  AS buyer_k,
    public.canon_owner_key(seller) AS seller_k,
    LAG(sale_id)                              OVER w AS prev_sale_id,
    LAG(sale_date)                            OVER w AS prev_sale_date,
    LAG(buyer)                                OVER w AS prev_buyer_name,
    LAG(public.canon_owner_key(buyer))        OVER w AS prev_buyer_k
  FROM public.sales_transactions
  WHERE transaction_state='live' AND property_id IS NOT NULL AND sale_date IS NOT NULL
  WINDOW w AS (PARTITION BY property_id ORDER BY sale_date, sale_id)
)
SELECT
  property_id,
  prev_sale_id, prev_sale_date, prev_buyer_name,
  sale_id,      sale_date,      seller AS seller_name,
  CASE
    WHEN seller_k IN ('','-') OR prev_buyer_k IN ('','-') THEN 'unverifiable'
    WHEN seller_k = prev_buyer_k THEN 'match'
    ELSE 'break'
  END AS verdict
FROM chronological
WHERE prev_sale_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ownership_chain_tick()
RETURNS TABLE (
  pairs_total      BIGINT,
  chain_breaks     BIGINT,
  chain_matches    BIGINT,
  unverifiable     BIGINT,
  alert_opened     BOOLEAN,
  run_at           TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
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

DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_existing_jobid FROM cron.job WHERE jobname='lcc-gov-ownership-chain-tick';
  IF v_existing_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_existing_jobid); END IF;
  PERFORM cron.schedule('lcc-gov-ownership-chain-tick', '45 3 * * *',
    $cron$SELECT public.ownership_chain_tick();$cron$);
END $$;
