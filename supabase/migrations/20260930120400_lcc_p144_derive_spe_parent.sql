-- ============================================================================
-- P144 — derive SPE -> parent relationships from buyer / true_buyer co-capture.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-19. 337 edges written.
-- ----------------------------------------------------------------------------
-- P135 concluded the SPE->sponsor rollup needed "a shared property, deed,
-- mailing address, or Salesforce contact -- with name similarity as
-- corroboration rather than the claim", and could not find one. It was in the
-- relationship graph the whole time: the CoStar sidebar captures BOTH the SPE on
-- the deed (role='buyer') AND the beneficial owner behind it (role='true_buyer')
-- in the same extraction. Same asset, same extraction, 1:1 -- one is the parent
-- of the other. No name matching anywhere in the derivation.
--
-- The names then CORROBORATE without being the claim, which is exactly the shape
-- P135 said would be admissible:
--     Agree Central LLC            -> Agree Realty CORP
--     Albany Rd 4 Shaws Cv Llc     -> Albany Road Real Estate Partners
--     ABJ 201 Maple SPV, LLC       -> Allan Bailey Johnson Group     (initials)
--     Somerfield Investor AUT LLC  -> Andrew B Urban Trust           (initials)
--     Arhc Ddhudfl01 Llc           -> American Realty Capital Healthcare Trust III
--     Aei Net Lease Income Fund    -> AEI Capital Corporation
--
-- ⚠️ HOW THE COUNT COLLAPSED -- the first number was a cross-product:
--     33,874  raw buyer x true_buyer co-occurrences on the same asset
--      6,808  after keying on the same costar_sidebar extraction
--        824  asset-extractions with EXACTLY ONE buyer and ONE true_buyer
--        361  distinct SPE->parent pairs
--        337  admissible after the guards
--   One CoStar page carries a property's whole sales history, so pairing every
--   buyer to every true_buyer within an extraction is STILL a cross-product
--   (6.01 pairs per asset-extraction). Only the 1:1 case says which SPE belongs
--   to which parent. Quoting 2,365 would have been wrong by ~7x.
--
-- WHY extracted_at IS THE ONLY AVAILABLE KEY: only deed sources carry
-- document_number (rca_deed 15,732 edges, costar_deed 1,880) and only sidebar
-- sources ever carry true_buyer (costar_sidebar 2,687, rca_sidebar 99). The two
-- never share a document, so the same-document join returns exactly 0 rows.
--
-- GUARDS:
--   * the SPE slot must be ORG-shaped. 20 pairs have a PERSON there
--     ("TAMMY YOUNG" -> "Adlac LLC") -- CoStar recorded the roles inverted and
--     direction cannot be trusted. Skipped, never guessed.
--   * neither side may be a brokerage (4 pairs).
--   * a PERSON in the PARENT slot is KEPT ON PURPOSE ("Mango Plaza Llc" ->
--     "Antonio Zavala"): principal-behind-SPE is the reachable contact the P137
--     work was chasing. That is the good case, not a defect.
--
-- Writes `associated_with` with metadata role='parent_of' rather than inventing a
-- relationship_type, matching how every other role is modelled here.
--
-- LIVE: 337 edges, 329 distinct SPEs, 284 distinct parents. Re-run writes 0.
-- The temp table is dropped defensively -- a second call inside one transaction
-- raised 42P07 before that guard.
--
-- REVERSAL: delete from entity_relationships
--            where metadata->>'via' = 'p144_spe_parent';
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_p144_derive_spe_parent(
  p_dry_run boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
declare v_n int := 0; v_sample jsonb;
begin
  drop table if exists _p144;   -- a second call in one transaction must not 42P07
  create temp table _p144 on commit drop as
  with b as (
    select to_entity_id asset, from_entity_id spe, metadata->>'extracted_at' ex
    from public.entity_relationships
    where relationship_type='purchases' and metadata->>'role'='buyer'
      and metadata->>'source'='costar_sidebar'
  ), tb as (
    select to_entity_id asset, from_entity_id parent, metadata->>'extracted_at' ex
    from public.entity_relationships
    where relationship_type='purchases' and metadata->>'role'='true_buyer'
      and metadata->>'source'='costar_sidebar'
  ), cnt as (
    select coalesce(b.asset,tb.asset) asset, coalesce(b.ex,tb.ex) ex,
           count(distinct b.spe) nb, count(distinct tb.parent) np
    from b full join tb on tb.asset=b.asset and tb.ex=b.ex
    group by 1,2
  ), clean as (select asset, ex from cnt where nb=1 and np=1)
  select distinct b.spe, tb.parent, es.name spe_name, ep.name parent_name
  from clean c
  join b  on b.asset=c.asset  and b.ex=c.ex
  join tb on tb.asset=c.asset and tb.ex=c.ex and tb.parent<>b.spe
  join public.entities es on es.id=b.spe
  join public.entities ep on ep.id=tb.parent
  where public.lcc_owner_name_has_org_marker(es.name)          -- SPE must be org-shaped
    and not public.lcc_owner_name_is_brokerage(es.name)
    and not public.lcc_owner_name_is_brokerage(ep.name);

  select jsonb_agg(x) into v_sample
    from (select spe_name, parent_name from _p144 order by parent_name limit 6) x;

  if p_dry_run then
    return jsonb_build_object('ok',true,'dry_run',true,
      'would_write',(select count(*) from _p144),'sample',coalesce(v_sample,'[]'::jsonb));
  end if;

  insert into public.entity_relationships
    (workspace_id, from_entity_id, to_entity_id, relationship_type, metadata)
  select 'a0000000-0000-0000-0000-000000000001', p.spe, p.parent, 'associated_with',
         jsonb_build_object('role','parent_of','via','p144_spe_parent',
           'basis','CoStar sidebar captured this SPE as buyer and this party as '
                || 'true_buyer in the SAME extraction, 1:1',
           'spe_name',p.spe_name,'parent_name',p.parent_name)
  from _p144 p
  where not exists (
    select 1 from public.entity_relationships r
     where r.from_entity_id=p.spe and r.to_entity_id=p.parent
       and r.relationship_type='associated_with' and r.metadata->>'role'='parent_of');
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok',true,'dry_run',false,'written',v_n,
    'sample',coalesce(v_sample,'[]'::jsonb));
end;
$$;

COMMENT ON FUNCTION public.lcc_p144_derive_spe_parent(boolean) IS
  'P144. SPE->parent edges from CoStar buyer/true_buyer co-capture in ONE '
  'extraction, 1:1 only. This is the structural evidence P135 concluded was '
  'missing -- names corroborate, they are not the claim. Skips 20 pairs whose '
  'SPE slot holds a PERSON (roles inverted, direction untrustworthy) and 4 '
  'touching a brokerage. KEEPS a person in the PARENT slot: principal-behind-SPE '
  'is the good case. Reverse by metadata->>''via''=''p144_spe_parent''.';

GRANT EXECUTE ON FUNCTION public.lcc_p144_derive_spe_parent(boolean) TO service_role;
