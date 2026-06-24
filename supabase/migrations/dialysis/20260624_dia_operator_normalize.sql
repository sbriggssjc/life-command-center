-- ============================================================================
-- dia operator normalization — fill blank `properties.operator` from the tenant
-- string via a deterministic alias map, with a hard guard that a non-dialysis
-- tenant is NEVER assigned a dialysis operator.  (2026-06-24)
--
-- Grounded live: 743 blank-operator dia properties carry a tenant; ~45 map to a
-- known consolidator, ~18 are not dialysis at all (they rode in through the same
-- OM inbox). The fill is BLANKS-ONLY (never clobbers a curated operator) and
-- fully REVERSIBLE via `operator_status` (the prior operator was blank by
-- construction). gov has NO operator column (gov tenant = agency) — N/A there.
--
-- SQL mirror of api/_shared/operator-normalize.js (the single source of the
-- map; used at-ingest by the OM promoter). Keep the two in lock-step;
-- test/operator-normalize.test.mjs pins the receipts.
-- Postgres regex note: `\y` is the word boundary (POSIX has no `\b`).
-- ============================================================================

-- 1. The canonical operator for a tenant, or NULL when no family matches.
--    Anchored `^` so a stray substring never false-positives. ONLY these
--    dialysis-operator-specific families ever return an operator — this is the
--    structural guard that keeps a dialysis operator off a non-dialysis tenant.
create or replace function public.dia_operator_from_tenant(p_tenant text)
returns text language sql immutable as $$
  select case
    when t is null or t = '' then null
    -- DaVita
    when t ~* '^da\s*vita\y'                       then 'DaVita'
    when t ~* '^total\s+renal\s+care\y'            then 'DaVita'
    when t ~* '^dva\s+(renal|healthcare)\y'        then 'DaVita'
    when t ~* '^renal\s+treatment\s+centers\y'     then 'DaVita'
    -- Fresenius
    when t ~* '^fres[ei]?nius\y'                   then 'Fresenius'
    when t ~* '^fmc(na)?\y'                        then 'Fresenius'
    when t ~* '^fkc\y'                             then 'Fresenius'
    when t ~* '^rai\y'                             then 'Fresenius'
    when t ~* '^bio-?\s*medical\s+applications\y'  then 'Fresenius'
    when t ~* '^bma\y'                             then 'Fresenius'
    when t ~* '^american\s+access\s+care\y'        then 'Fresenius'
    when t ~* '^renal\s+care\s+group\y'            then 'Fresenius'
    when t ~* '^azura\s+vascular\s+care\y'         then 'Fresenius'
    when t ~* '^liberty\s+dialysis\y'              then 'Fresenius'
    -- US Renal Care
    when t ~* '^u\.?\s*s\.?\s+renal\s+care\y'      then 'US Renal Care, Inc.'
    when t ~* '^usrc\y'                            then 'US Renal Care, Inc.'
    when t ~* '^dialysis\s+newco\y'                then 'US Renal Care, Inc.'
    when t ~* '^dsi\s+renal\y'                     then 'US Renal Care, Inc.'
    -- Dialysis Clinic, Inc. (DCI)
    when t ~* '^dci\y'                             then 'Dialysis Clinic, Inc.'
    when t ~* '^dialysis\s+clinic(s)?\y'           then 'Dialysis Clinic, Inc.'
    -- American Renal / Innovative Renal Care
    when t ~* '^american\s+renal\y'                then 'American Renal Associates'
    when t ~* '^innovative\s+renal\s+care\y'       then 'American Renal Associates'
    -- Satellite Healthcare
    when t ~* '^satellite\s+(health|healthcare|dialysis)\y' then 'Satellite Healthcare'
    when t ~* '^wellbound\y'                       then 'Satellite Healthcare'
    else null
  end
  from (select btrim(coalesce(p_tenant, '')) as t) s;
$$;

-- 2. Review classification: matched / unmatched_dialysis / non_dialysis.
create or replace function public.dia_operator_tenant_status(p_tenant text)
returns text language sql immutable as $$
  select case
    when t is null or length(t) < 2 then 'non_dialysis'
    when public.dia_operator_from_tenant(t) is not null then 'matched'
    -- confident non-dialysis national brands (retail / fitness / auto)
    when t ~* '\y(planet\s+fitness|staples|macy''?s|hertz|starbucks|walgreens|cvs|dollar\s+general|dollar\s+tree|7-?eleven|autozone|o''?reilly|advance\s+auto|taco\s+bell|mcdonald|wendy''?s|burger\s+king|chipotle|fedex|ups\s+store|verizon|at&t|t-?mobile)\y'
      then 'non_dialysis'
    -- plausibly dialysis (clinical cue) but no family match → leave NULL, report
    when t ~* '\m(dialy|renal|kidney|nephro|esrd|hemodialys)'
      then 'unmatched_dialysis'
    else 'non_dialysis'
  end
  from (select btrim(coalesce(p_tenant, '')) as t) s;
$$;

-- 3. Reversible marker column. Values:
--      tenant_derived     — operator filled from the tenant (matched family)
--      unmatched_dialysis — plausibly dialysis, unknown operator (operator NULL)
--      non_dialysis       — not a dialysis tenant (operator NULL; review)
--    NULL on every curated/untouched row.
alter table public.properties add column if not exists operator_status text;

-- 4. Fill-blanks backfill. ONLY rows with a blank operator AND a tenant.
--    operator is set ONLY on a family match; the other two buckets keep
--    operator NULL and only record the review status.
update public.properties p
   set operator = case
                    when public.dia_operator_from_tenant(p.tenant) is not null
                      then public.dia_operator_from_tenant(p.tenant)
                    else p.operator
                  end,
       operator_status = case
                    when public.dia_operator_tenant_status(p.tenant) = 'matched'
                      then 'tenant_derived'
                    else public.dia_operator_tenant_status(p.tenant)
                  end
 where (p.operator is null or btrim(p.operator) = '')
   and p.tenant is not null and btrim(p.tenant) <> '';

-- 5. Review surfaces (drop → zero trace). The residual `unmatched_dialysis`
--    bucket drives map extension; `non_dialysis` drives "should this OM even sit
--    in the dialysis table?" review.
create or replace view public.v_property_operator_review as
  select property_id, tenant, operator, operator_status
  from public.properties
  where operator_status is not null
  order by operator_status, tenant;

create or replace view public.v_property_operator_review_summary as
  select operator_status, count(*) as n
  from public.properties
  where operator_status is not null
  group by operator_status
  order by operator_status;

-- ----------------------------------------------------------------------------
-- Reversal (fully reverts the fill-blanks backfill — prior operator was blank):
--   update public.properties set operator = null where operator_status = 'tenant_derived';
--   update public.properties set operator_status = null
--     where operator_status in ('tenant_derived','unmatched_dialysis','non_dialysis');
-- ----------------------------------------------------------------------------
