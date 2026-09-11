-- ============================================================================
-- ID2a — two defects found while VERIFYING the real backfill write (applied
-- 2026-09-11 via dia_id2a_backfill_property_operator_ids(false)), both caught
-- because the verification checked the WRITE against the review's own
-- stated design intent rather than just reading `auto_applied` back.
--
-- 1. `dia_operator_from_tenant`'s DaVita prefix regex (`^da\s*vita\y`)
--    matched the FIRST TOKEN of a multi-tenant capture artifact and silently
--    resolved+wrote `operator_id = DaVita` on both of them — exactly the
--    "invent a merge" outcome 20260911200000's own header forbids for these
--    two rows (`kind='non_operator'`, reserved for ID3i multi-tenant
--    restructuring; "do not invent a merge"). Measured blast radius before
--    fixing: EXACTLY 2 properties fleet-wide contain a pipe in `operator`,
--    and both were the two known artifacts (`DaVita | US Army Corps of
--    Engineers`, `DaVita |San Antonio Kidney Disease Center`). Fixed by
--    refusing to classify ANY tenant string containing `|` at all — it now
--    falls through to `needs_review`, the fail-closed default this whole
--    design exists to produce. Both wrongly-written rows were reset
--    (`operator_id = NULL`) and logged to `dia_operator_write_review` with
--    the raw text intact, never silently dropped.
--
-- 2. `v_id2a_operator_registry_parity` fanned out: it drives `FROM operators
--    o` — one row per REGISTRY VARIANT, not per survivor — and left-joins
--    `properties` on the coalesced survivor id, so a merged operator with N
--    variants counted every property N times. Measured live BEFORE the fix:
--    DaVita (2 variants) reported 8,874 against a true 4,437; Satellite
--    Healthcare (3 variants) reported 276 against a true 92. Fixed with
--    `count(distinct p.property_id)`. Positive-controlled after the fix:
--    `sum(v_id2a_operator_registry_parity.property_count)` now equals
--    `count(*) from properties where operator_id is not null` EXACTLY
--    (9,307 = 9,307) — the check that a per-row count and a per-population
--    count agree once the fan-out is removed.
--
-- Net effect on the live backfill: `properties.operator_id` populated
-- 9,309 → 9,307 (the 2 multi-tenant rows correctly un-set);
-- `dia_operator_write_review` 1,018 → 1,020 open rows.
-- ============================================================================

create or replace function public.dia_operator_from_tenant(p_tenant text)
returns text language sql immutable as $$
  select case
    when t is null or t = '' then null
    -- ID2a fix: a piped string is a multi-tenant capture artifact (ID1 §10),
    -- never a single operator's name — refuse to classify it at all so it
    -- falls through to needs_review rather than matching on its first token.
    when t ~ '\|' then null
    -- DaVita
    when t ~* '^da\s*vita\y'                       then 'DaVita'
    when t ~* '^total\s+renal\s+care\y'            then 'DaVita'
    when t ~* '^dva\s+(renal|healthcare)\y'        then 'DaVita'
    when t ~* '^renal\s+treatment\s+centers\y'     then 'DaVita'
    -- Fresenius (ID2a: canonical renamed to 'Fresenius Medical Care')
    when t ~* '^fres[ei]?nius\y'                   then 'Fresenius Medical Care'
    when t ~* '^fmc(na)?\y'                        then 'Fresenius Medical Care'
    when t ~* '^fkc\y'                             then 'Fresenius Medical Care'
    when t ~* '^rai\y'                             then 'Fresenius Medical Care'
    when t ~* '^bio-?\s*medical\s+applications\y'  then 'Fresenius Medical Care'
    when t ~* '^bma\y'                             then 'Fresenius Medical Care'
    when t ~* '^american\s+access\s+care\y'        then 'Fresenius Medical Care'
    when t ~* '^renal\s+care\s+group\y'            then 'Fresenius Medical Care'
    when t ~* '^azura\s+vascular\s+care\y'         then 'Fresenius Medical Care'
    when t ~* '^liberty\s+dialysis\y'              then 'Fresenius Medical Care'
    -- US Renal Care (ID2a: canonical renamed to the brand form)
    when t ~* '^u\.?\s*s\.?\s+renal\s+care\y'      then 'US Renal Care'
    when t ~* '^usrc\y'                            then 'US Renal Care'
    when t ~* '^dialysis\s+newco\y'                then 'US Renal Care'
    when t ~* '^dsi\s+renal\y'                     then 'US Renal Care'
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

comment on function public.dia_operator_from_tenant(text) is
  'ID2a deterministic family classifier. Returns the canonical operator name '
  'for a recognised prefix, or NULL (never fabricates). A tenant string '
  'containing a pipe (a multi-tenant capture artifact, ID1 §10 / ID3i) is '
  'refused outright, even if its first token would otherwise match.';

create or replace view public.v_id2a_operator_registry_parity as
select
  coalesce(surv.operator_id, o.operator_id) as operator_id,
  coalesce(surv.name, o.name) as canonical_name,
  count(distinct o.operator_id) as merged_variant_count,
  array_agg(distinct o.name order by o.name) as variant_names,
  count(distinct p.property_id) as property_count
from public.operators o
left join public.operators surv on surv.operator_id = public.dia_operator_survivor(o.operator_id)
left join public.properties p on p.operator_id = coalesce(surv.operator_id, o.operator_id)
where o.kind = 'company'
group by coalesce(surv.operator_id, o.operator_id), coalesce(surv.name, o.name)
order by property_count desc nulls last;

comment on view public.v_id2a_operator_registry_parity is
  'ID2a parity input: one row per SURVIVOR operator, its merged variant names, '
  'and the DISTINCT property_id count now resolved to it via operator_id. '
  'count(distinct ...) is load-bearing: the FROM clause drives one row per '
  'registry VARIANT, so a plain count() over-multiplies by merged_variant_count.';

-- Correct the 2 properties the multi-tenant regex bug wrongly auto-resolved
-- to DaVita on the live apply: reset operator_id, route to the review lane
-- with the raw text intact (never silently drop the row's need for a human
-- decision). Idempotent by construction (WHERE ... AND operator_id IS NOT
-- NULL) — a re-run after this fix finds nothing left to correct.
insert into public.dia_operator_write_review (table_name, record_pk, raw_operator_text)
select 'properties', p.property_id::text, p.operator
  from public.properties p
 where p.operator like '%|%' and p.operator_id is not null;

update public.properties
   set operator_id = null
 where operator like '%|%' and operator_id is not null;
