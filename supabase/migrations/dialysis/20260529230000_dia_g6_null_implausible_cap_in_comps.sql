-- G6 (dia): null implausible cap rates in v_sales_comps so they stop leaking
-- into comps. "Null the cap rate, keep the row": a sale tagged
-- cap_rate_quality='implausible_unverified' contributes NO cap rate to comp
-- averages, but still counts in price/SF comps. Surgical, idempotent patch of
-- the matview via pg_get_viewdef (avoids transcribing the LATERAL column lists).
-- Applied to dia (zqzrriwuavgrquhisnoa). 472 live implausible cap rates nulled.
DO $mig$
DECLARE d text;
BEGIN
  IF position($m$cap_rate_quality = 'implausible_unverified'$m$ IN pg_get_viewdef('public.v_sales_comps'::regclass, true)) > 0 THEN
    RAISE NOTICE 'dia v_sales_comps already enforces cap_rate_quality; skipping';
    RETURN;
  END IF;

  SELECT pg_get_viewdef('public.v_sales_comps'::regclass, true) INTO d;

  d := regexp_replace(
    d,
    'CASE\s+WHEN st\.cap_rate > 1::numeric THEN st\.cap_rate / 100\.0\s+ELSE st\.cap_rate\s+END AS cap_rate',
    $r$CASE WHEN st.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric WHEN st.cap_rate > 1::numeric THEN st.cap_rate / 100.0 ELSE st.cap_rate END AS cap_rate$r$
  );

  IF position($m$cap_rate_quality = 'implausible_unverified'$m$ IN d) = 0 THEN
    RAISE EXCEPTION 'dia v_sales_comps: cap_rate CASE target not found; aborting (definition changed?)';
  END IF;

  EXECUTE 'DROP MATERIALIZED VIEW public.v_sales_comps';
  EXECUTE 'CREATE MATERIALIZED VIEW public.v_sales_comps AS ' || d;
  EXECUTE 'CREATE UNIQUE INDEX v_sales_comps_uniq ON public.v_sales_comps USING btree (sale_id)';
  EXECUTE 'GRANT ALL ON public.v_sales_comps TO anon, authenticated, service_role';
  RAISE NOTICE 'dia v_sales_comps patched (implausible cap rates nulled)';
END
$mig$;
