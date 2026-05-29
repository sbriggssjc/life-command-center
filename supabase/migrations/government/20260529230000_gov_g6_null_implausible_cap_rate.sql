-- G6 (gov): stop implausible cap rates leaking into the capital-markets cap-rate
-- metrics and the gov sales comps. "Null the cap rate, keep the row":
-- cap_rate_quality='implausible_unverified' contributes NO cap rate, but the
-- sale still counts in volume/count/price comps. Surgical, idempotent patches of
-- each consumer via pg_get_viewdef (reads the live definition, so it adapts to
-- any orthogonal redefinitions). Targets carry a leading space to avoid the
-- cs./c. alias substring collision; each patch asserts exactly one occurrence.
-- Output cap-rate columns recast to numeric(6,4) to keep view column types.
--
-- Two cap-rate chains:
--  * cm_gov_market_quarterly (quarterly, feeds cap_rate_ttm_by_quarter via
--    cm_gov_cap_ttm_q): averages RAW sold_cap_rate with no band/quality filter
--    -> the primary leak. Null sold_cap_rate at source (internal CTE column).
--  * cm_gov_market_quarterly_master_m (monthly): already band-filters (0.04-0.12)
--    AND prefers an NOI-recalculated cap_rate_history value over the stated one.
--    Only the STATED fallback is nulled when implausible; the recalculated
--    cap_rate_history value is preserved (TTM-A).

-- 1) Quarterly chain (primary capital-markets cap-rate source) — internal CTE col
DO $mig$
DECLARE d text; tgt text := ' s.sold_cap_rate,'; n int;
BEGIN
  IF position($m$cap_rate_quality = 'implausible_unverified'$m$ IN pg_get_viewdef('public.cm_gov_market_quarterly'::regclass, true)) > 0 THEN
    RAISE NOTICE 'cm_gov_market_quarterly already patched; skipping'; RETURN;
  END IF;
  SELECT pg_get_viewdef('public.cm_gov_market_quarterly'::regclass, true) INTO d;
  n := (length(d) - length(replace(d, tgt, ''))) / length(tgt);
  IF n <> 1 THEN RAISE EXCEPTION 'cm_gov_market_quarterly: expected 1 occurrence of target, found %', n; END IF;
  d := replace(d, tgt, $r$ CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE s.sold_cap_rate END AS sold_cap_rate,$r$);
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_market_quarterly AS ' || d;
  RAISE NOTICE 'cm_gov_market_quarterly patched';
END
$mig$;

-- 2) Monthly chain (TTM-A: preserve NOI recalc, null only implausible stated fallback) — internal CTE col
DO $mig$
DECLARE d text; tgt text := ', s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate) AS cap_rate,'; n int;
BEGIN
  IF position($m$cap_rate_quality = 'implausible_unverified'$m$ IN pg_get_viewdef('public.cm_gov_market_quarterly_master_m'::regclass, true)) > 0 THEN
    RAISE NOTICE 'cm_gov_market_quarterly_master_m already patched; skipping'; RETURN;
  END IF;
  SELECT pg_get_viewdef('public.cm_gov_market_quarterly_master_m'::regclass, true) INTO d;
  n := (length(d) - length(replace(d, tgt, ''))) / length(tgt);
  IF n <> 1 THEN RAISE EXCEPTION 'cm_gov_market_quarterly_master_m: expected 1 occurrence of target, found %', n; END IF;
  d := replace(d, tgt, $r$, CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE COALESCE(s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate) END) AS cap_rate,$r$);
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_market_quarterly_master_m AS ' || d;
  RAISE NOTICE 'cm_gov_market_quarterly_master_m patched';
END
$mig$;

-- 3) gov v_sale_comps (passthrough comp view) — sold_cap_rate is a direct output col
DO $mig$
DECLARE d text; tgt text := ' sold_cap_rate,'; n int;
BEGIN
  IF position($m$cap_rate_quality = 'implausible_unverified'$m$ IN pg_get_viewdef('public.v_sale_comps'::regclass, true)) > 0 THEN
    RAISE NOTICE 'v_sale_comps already patched; skipping'; RETURN;
  END IF;
  SELECT pg_get_viewdef('public.v_sale_comps'::regclass, true) INTO d;
  n := (length(d) - length(replace(d, tgt, ''))) / length(tgt);
  IF n <> 1 THEN RAISE EXCEPTION 'v_sale_comps: expected 1 occurrence of target, found %', n; END IF;
  d := replace(d, tgt, $r$ (CASE WHEN cap_rate_quality = 'implausible_unverified'::text THEN NULL ELSE sold_cap_rate END)::numeric(6,4) AS sold_cap_rate,$r$);
  EXECUTE 'CREATE OR REPLACE VIEW public.v_sale_comps AS ' || d;
  RAISE NOTICE 'v_sale_comps patched';
END
$mig$;

-- 4) gov v_sales_comps — adaptive: handle whether it is currently a view or matview
--    (it was observed flipping matview->view + transaction_state=live filter by a
--    concurrent process; pg_get_viewdef + relkind detection make this robust).
DO $mig$
DECLARE d text; tgt text := ' s.sold_cap_rate,'; n int; k "char";
BEGIN
  SELECT c.relkind INTO k FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE ns.nspname='public' AND c.relname='v_sales_comps';
  IF k IS NULL THEN RAISE EXCEPTION 'v_sales_comps not found'; END IF;
  IF position($m$cap_rate_quality = 'implausible_unverified'$m$ IN pg_get_viewdef('public.v_sales_comps'::regclass, true)) > 0 THEN
    RAISE NOTICE 'gov v_sales_comps already patched; skipping'; RETURN;
  END IF;
  SELECT pg_get_viewdef('public.v_sales_comps'::regclass, true) INTO d;
  n := (length(d) - length(replace(d, tgt, ''))) / length(tgt);
  IF n <> 1 THEN RAISE EXCEPTION 'gov v_sales_comps: expected 1 occurrence of target, found %', n; END IF;
  d := replace(d, tgt, $r$ (CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL ELSE s.sold_cap_rate END)::numeric(6,4) AS sold_cap_rate,$r$);
  IF k = 'm' THEN
    EXECUTE 'DROP MATERIALIZED VIEW public.v_sales_comps';
    EXECUTE 'CREATE MATERIALIZED VIEW public.v_sales_comps AS ' || d;
    EXECUTE 'CREATE INDEX idx_v_sales_comps_date ON public.v_sales_comps USING btree (sale_date DESC NULLS LAST)';
    EXECUTE 'CREATE INDEX idx_v_sales_comps_property ON public.v_sales_comps USING btree (property_id)';
    EXECUTE 'GRANT ALL ON public.v_sales_comps TO anon, authenticated, service_role';
    RAISE NOTICE 'gov v_sales_comps (matview) patched';
  ELSE
    EXECUTE 'CREATE OR REPLACE VIEW public.v_sales_comps AS ' || d;
    RAISE NOTICE 'gov v_sales_comps (view) patched';
  END IF;
END
$mig$;

-- 5) propagate the monthly-chain change into its materialized view
REFRESH MATERIALIZED VIEW public.cm_gov_market_quarterly_master_m_mat;
