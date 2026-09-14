-- ===========================================================================
-- P117a -- the P117 feeder needed a junk-flag + federal guard. SELF-CAUGHT.
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- ===========================================================================
-- P120 re-ranked the junk lane by attached BD value, and the top of the lane
-- immediately showed `GSA (US Gov't)` holding $19,412,561 of portfolio rent.
-- Tracing the row: ownership_source = 'lcc_property_owner' -- i.e. the P117
-- feeder written earlier the same day put it there.
--
-- The error: P117 guarded BROKERAGE (the agent) and OPERATOR (the tenant, dia),
-- but not the two guards `ensureEntityLink` has carried all along -- junk-flagged
-- placeholders and FEDERAL AGENCIES. On a GSA-leased asset the landlord is a
-- private owner and GSA is the TENANT. Attaching the building to "GSA (US Gov't)"
-- as owner is the gov-side twin of the dia operator-as-owner conflation that
-- P113's is_operator_not_owner flag exists to prevent -- the exact class of bug
-- CLAUDE.md warns about, committed by a feeder written to respect it.
--
-- Upstream cause is real but separate: lcc_property_owner itself resolved that
-- owner (source relationship_graph, confidence 0.635). P117 propagated it
-- faithfully. The feeder is the layer that can cheaply refuse it, so the guard
-- goes here; the upstream row is left for the owner-review lane rather than
-- silently rewritten.
--
-- Blast radius: 11 rows removed (1 junk-flagged + 10 federal). Every OTHER
-- portfolio row sitting on a junk-flagged entity predates P117 and belongs to
-- other feeders (26 rows source NULL, 22 sales_transactions_seller_exit,
-- 4 sales_transaction) -- deliberately NOT touched; they are those rounds' to
-- reconcile, and quietly cleaning them here would hide the same class of bug.
--
-- Verified after: 0 P117 rows on junk/federal entities; 1,929 P117 rows remain;
-- the dry run now reports skip_federal_agency=10, skip_junk_flagged=1,
-- skip_operator=6, skip_brokerage=5, inserts 0 (idempotent).
--
-- REVERSAL: re-run the feeder with the two new WHEN arms removed.
-- ===========================================================================


-- 1. Guard the feeder so this cannot recur.
CREATE OR REPLACE FUNCTION lcc_sync_property_owner_to_portfolio(
  p_dry_run boolean default true,
  p_limit   int     default null
)
returns table(
  action text, n bigint, distinct_owners bigint, with_rent bigint, total_annual_rent numeric
)
language plpgsql
as $fn$
#variable_conflict use_column
declare
  v_inserted bigint := 0;
begin
  create temp table _p117_cand on commit drop as
  with owned as (
    select po.owner_entity_id, po.owner_name,
           ei.source_system as source_domain, ei.external_id as source_property_id
    from lcc_property_owner po
    join external_identities ei
      on ei.entity_id = po.entity_id
     and ei.source_type = 'asset'
     and ei.source_system in ('dia','gov')
    where po.owner_entity_id is not null
  )
  select
    o.owner_entity_id, o.source_domain, o.source_property_id, a.annual_rent,
    case
      when lcc_owner_name_is_brokerage(o.owner_name)  then 'skip_brokerage'
      when lcc_is_operator_owner_name(o.owner_name)   then 'skip_operator'
      -- P117a: a junk-flagged entity is a capture placeholder, not a party.
      when (oe.metadata->>'junk_name_flagged') = 'true'
       and coalesce((oe.metadata->>'junk_name_reviewed')::boolean, false) = false
        then 'skip_junk_flagged'
      -- P117a: a federal agency is the TENANT on a gov-leased asset, never the
      -- landlord. Mirrors the federal guard in ensureEntityLink.
      when o.owner_name ~* '\m(gsa|general services administration|u\.?s\.? gov|us gov|united states government|federal government|dept\.? of|department of|social security administration)\M'
        then 'skip_federal_agency'
      else 'insert'
    end as verdict
  from owned o
  left join entities oe on oe.id = o.owner_entity_id
  left join lcc_entity_portfolio_facts pf
    on pf.entity_id = o.owner_entity_id
   and pf.source_domain = o.source_domain
   and pf.source_property_id::text = o.source_property_id
  left join lcc_property_attributes a
    on a.source_domain = o.source_domain
   and a.source_property_id::text = o.source_property_id
  where pf.entity_id is null;          -- FILL-BLANKS: never touch an existing row

  if p_limit is not null then
    delete from _p117_cand c
    where c.ctid not in (
      select ctid from _p117_cand where verdict = 'insert' order by annual_rent desc nulls last limit p_limit
    ) and c.verdict = 'insert';
  end if;

  if not p_dry_run then
    insert into lcc_entity_portfolio_facts
      (entity_id, source_domain, source_property_id, ownership_end_date, annual_rent, ownership_source, updated_at)
    select c.owner_entity_id, c.source_domain, c.source_property_id::bigint, null, c.annual_rent, 'lcc_property_owner', now()
    from _p117_cand c where c.verdict = 'insert'
    on conflict (entity_id, source_domain, source_property_id) do nothing;
    get diagnostics v_inserted = row_count;
  end if;

  return query
  select c.verdict::text, count(*)::bigint, count(distinct c.owner_entity_id)::bigint,
         count(c.annual_rent)::bigint, sum(c.annual_rent)
  from _p117_cand c group by c.verdict
  union all
  select case when p_dry_run then 'DRY_RUN_no_write' else 'rows_written' end,
         case when p_dry_run then 0::bigint else v_inserted end, 0::bigint, 0::bigint, null::numeric;
end;
$fn$;

-- 2. Remove the rows P117 should never have written (only ever its OWN tag, so
--    other feeders' rows on the same entities are left for those rounds).
DELETE FROM lcc_entity_portfolio_facts f
USING entities e
WHERE f.entity_id = e.id
  AND f.ownership_source = 'lcc_property_owner'
  AND (
        ((e.metadata->>'junk_name_flagged') = 'true'
          AND coalesce((e.metadata->>'junk_name_reviewed')::boolean, false) = false)
     OR e.name ~* '\m(gsa|general services administration|u\.?s\.? gov|us gov|united states government|federal government|social security administration)\M'
  );
