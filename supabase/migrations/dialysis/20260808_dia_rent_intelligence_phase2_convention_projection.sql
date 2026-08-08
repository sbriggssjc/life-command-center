-- Rent Intelligence Engine Phase 2 — convention-aware projection (dia).
-- Removes the hardcoded projection default: dia_project_rent_at_date's default is
-- materialized from the tenant_lease_conventions '*' generic_fallback row at
-- migration time, and dia_project_rent_for_tenant reads per-tenant conventions.
-- Applied live to zqzrriwuavgrquhisnoa. See phase2 report.

CREATE OR REPLACE FUNCTION public.dia_resolve_lease_convention(p_tenant text, p_as_of date DEFAULT NULL)
RETURNS TABLE(
  tenant_canonical text, bump_pct numeric, bump_interval_years numeric,
  initial_term_years numeric, option_count integer, option_term_years numeric,
  expense_structure text, base_confidence numeric, source text, flagged_low_conf boolean
)
LANGUAGE sql STABLE SET search_path TO 'public','extensions','pg_temp' AS $$
  WITH norm AS (SELECT public.dia_normalize_operator(p_tenant) AS op),
  hit AS (
    SELECT c.* FROM public.tenant_lease_conventions c, norm
    WHERE c.tenant_canonical = norm.op AND c.effective_from <= COALESCE(p_as_of, CURRENT_DATE)
    ORDER BY c.effective_from DESC LIMIT 1),
  fallback AS (
    SELECT c.* FROM public.tenant_lease_conventions c
    WHERE c.tenant_canonical = '*' AND c.effective_from <= COALESCE(p_as_of, CURRENT_DATE)
    ORDER BY c.effective_from DESC LIMIT 1),
  pick AS (SELECT * FROM hit UNION ALL SELECT * FROM fallback WHERE NOT EXISTS (SELECT 1 FROM hit))
  SELECT tenant_canonical, bump_pct, bump_interval_years, initial_term_years,
         option_count, option_term_years, expense_structure, base_confidence, source, flagged_low_conf
  FROM pick LIMIT 1;
$$;

-- Rebuild the core with a DATA-DRIVEN default (no literal). See report.
DO $mig$
DECLARE v_bump numeric; v_int_mo int;
BEGIN
  SELECT bump_pct, round(bump_interval_years*12)::int INTO v_bump, v_int_mo
  FROM public.tenant_lease_conventions WHERE tenant_canonical='*' ORDER BY effective_from DESC LIMIT 1;
  IF v_bump IS NULL THEN RAISE EXCEPTION 'generic_fallback convention row missing'; END IF;
  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.dia_project_rent_at_date(
      p_anchor_rent numeric, p_anchor_date date, p_target_date date,
      p_bump_pct numeric DEFAULT %L, p_bump_interval_mo integer DEFAULT %L)
    RETURNS numeric LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public','extensions','pg_temp' AS $function$
    DECLARE months_elapsed int; bumps_applied int; projected numeric;
    BEGIN
      IF p_anchor_rent IS NULL OR p_anchor_rent <= 0 THEN RETURN NULL; END IF;
      IF p_anchor_date IS NULL OR p_target_date IS NULL THEN RETURN p_anchor_rent; END IF;
      IF p_target_date <= p_anchor_date THEN RETURN p_anchor_rent; END IF;
      IF p_bump_interval_mo IS NULL OR p_bump_interval_mo <= 0 THEN RETURN p_anchor_rent; END IF;
      IF p_bump_pct IS NULL OR p_bump_pct = 0 THEN RETURN p_anchor_rent; END IF;
      months_elapsed := (EXTRACT(YEAR FROM p_target_date) - EXTRACT(YEAR FROM p_anchor_date))::int * 12
                      + (EXTRACT(MONTH FROM p_target_date) - EXTRACT(MONTH FROM p_anchor_date))::int;
      bumps_applied := GREATEST(0, months_elapsed / p_bump_interval_mo);
      projected := p_anchor_rent * POWER(1 + p_bump_pct, bumps_applied);
      RETURN round(projected, 2);
    END; $function$;
  $f$, v_bump, v_int_mo);
END $mig$;

CREATE OR REPLACE FUNCTION public.dia_project_rent_for_tenant(
  p_anchor_rent numeric, p_anchor_date date, p_target_date date, p_tenant text, p_as_of date DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path TO 'public','extensions','pg_temp' AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.dia_resolve_lease_convention(p_tenant, COALESCE(p_as_of, p_anchor_date));
  RETURN public.dia_project_rent_at_date(p_anchor_rent, p_anchor_date, p_target_date,
    c.bump_pct, round(c.bump_interval_years*12)::int);
END; $$;

GRANT EXECUTE ON FUNCTION public.dia_resolve_lease_convention(text,date),
  public.dia_project_rent_for_tenant(numeric,date,date,text,date) TO anon, authenticated, service_role;
