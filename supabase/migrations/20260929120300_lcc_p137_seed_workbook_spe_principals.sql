-- ============================================================================
-- P137 — seed the workbook's SPE->principal rows into the EXISTING P114 lane.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-18.
-- LIVE RESULT: 36 proposals, 36 owner entities, $11.7M, 7 surname-corroborated.
--              entity_relationships written: 0. Re-run idempotent.
-- ----------------------------------------------------------------------------
-- SCOPE, and why it is ~40 owners and not 258 (see
-- docs/architecture/dia-ownership-master-bridge-2026-08.md §4):
--
--   The workbook names a beneficial owner for 332 gap owners. Comparing that
--   name against the LCC owner splits four ways, and only ONE bucket is an
--   unambiguous unlock:
--
--     rec_core = lcc_core  AND  own_core <> lcc_core
--       -> "LCC holds the SPE; the workbook names the principal behind it"
--
--   The other three buckets are deliberately NOT seeded:
--     228 DISAGREE with LCC          -> needs date arbitration. The workbook is
--                                       a point-in-time research file, so it can
--                                       be stale relative to LCC AND LCC can be
--                                       wrong relative to it. P113 in BOTH
--                                       directions; last_sale_date is the only
--                                       arbiter and it is present on 124 of 228.
--      49 workbook owner IS the LCC owner -> no new party
--      27 prose in the name field    -> "Closed account - Eli Mordechai"
--
-- CORROBORATION (recorded, not required): a striking share carry independent
-- support beyond "a human wrote it down" --
--   M & M Rafizadeh Family LTD -> Mahran Rafizadeh   (surname)
--   Atwater Enterprises Inc    -> Glenn Atwater      (surname)
--   Davidson Properties        -> Jerry Davidson     (surname)
--   The Hagers LP              -> Robert Hager       (surname)
--   Mogster Family Trust       -> Garry Mogster      (surname)
--   Kantor LLC                 -> Jonathan Kantor    (surname)
--   Bepo Inc                   -> BEatriz POrras     (initials)
--   Jb Harrison Properties     -> JB Harrison        (initials)
-- surname_corroborated is stamped into the evidence so a reviewer can sort by
-- it. It is NOT a gate -- an SPE named for a place rather than a person is
-- perfectly normal and those rows are still good proposals.
--
-- Seeds PROPOSALS only. The P114 confirm path re-runs the shape gate
-- server-side (owner-contact-verdict-planner.validateVerdict), mints via
-- ensureEntityLink, links via linkPersonToEntity, ledgers the edge id for
-- reversal, and offers a terminal reject.
--
-- NOTE: these proposals carry NO email or phone. The workbook has none. They
-- answer "WHO do I look for", not "how do I reach them" -- which is still the
-- expensive half of the 3,883-owner / $2.72B reachability gap.
--
-- REVERSAL: delete from lcc_owner_contact_propagate_review
--            where batch_tag='p137_workbook_spe_principal' and status='pending';
--           -- confirmed rows reverse through the P114 ledger (applied_log_id).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_p137_seed_workbook_spe_principals(
  p_dry_run boolean DEFAULT true
) RETURNS TABLE (
  action text, lcc_owner text, principal text, surname_corroborated boolean, annual_rent numeric
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
declare
  v_batch text := 'p137_workbook_spe_principal';
begin
  create temp table _p137 on commit drop as
  with gap as (
    select p.entity_id, p.owner_name, p.annual_rent, f.source_property_id
    from public.v_lcc_top_seller_prospects p
    join public.lcc_entity_portfolio_facts f
      on f.entity_id = p.entity_id and f.is_current and f.source_domain = 'dia'
    where p.pursuit_status = 'needs a contact first'
  ), j as (
    select distinct g.entity_id, g.owner_name, g.annual_rent, g.source_property_id,
      m.recorded_owner, m.true_owner, m.last_sale_date, m.medicare_ccn,
      regexp_replace(lower(public.lcc_owner_strict_core(g.owner_name)),'[^a-z0-9]','','g') lcc_core,
      regexp_replace(lower(public.lcc_owner_strict_core(m.recorded_owner)),'[^a-z0-9]','','g') rec_core,
      regexp_replace(lower(public.lcc_owner_strict_core(m.true_owner)),'[^a-z0-9]','','g') own_core
    from gap g
    join public.lcc_dia_ownership_master m
      on m.source_property_id = g.source_property_id
     and m.batch_tag = 'dia_ownership_master'
    where m.true_owner is not null and m.recorded_owner is not null
  ), spe as (
    select * from j
    where rec_core = lcc_core and own_core <> lcc_core and own_core <> ''
  ), cand as (
    select s.*, trim(c) as candidate
    from spe s, lateral unnest(string_to_array(s.true_owner, '|')) c
  )
  select distinct on (entity_id, candidate)
    ('diaown:' || entity_id::text || ':' || md5(candidate)) as subject_ref,
    entity_id, owner_name, annual_rent, candidate, medicare_ccn,
    source_property_id, recorded_owner, true_owner, last_sale_date,
    exists (
      select 1 from unnest(string_to_array(lower(public.lcc_owner_strict_core(owner_name)),' ')) t
      where t = lower(regexp_replace(split_part(candidate, ' ',
                 array_length(string_to_array(candidate,' '),1)), '[^A-Za-z]', '', 'g'))
        and length(t) >= 4
    ) as surname_corroborated
  from cand
  where candidate ~ '^[A-Za-z][A-Za-z.''-]*( +[A-Za-z][A-Za-z.''-]*){1,3}$'
    and candidate !~* '\m(LLC|INC|CORP|LP|LLP|LTD|TRUST|COMPANY|PROPERTIES|PARTNERS|HOLDINGS|GROUP|CAPITAL|REALTY|INVESTMENTS|ASSOCIATES|VENTURES|DEVELOPMENT|MANAGEMENT|ENTERPRISES|FUND|REIT|BANK|HOSPITAL|CENTER|CLINIC|DIALYSIS|SYSTEM|CARE|MEDICAL|HEALTH)\M'
    and candidate !~* '(closed account|unknown|^n/?a$|tbd|see |per )'
  order by entity_id, candidate, annual_rent desc nulls last;

  if p_dry_run then
    return query
      select case when x.subject_ref is null then 'would_insert' else 'already_present' end::text,
             c.owner_name::text, c.candidate::text, c.surname_corroborated, c.annual_rent
      from _p137 c
      left join public.lcc_owner_contact_propagate_review x using (subject_ref)
      order by c.annual_rent desc nulls last;
    return;
  end if;

  insert into public.lcc_owner_contact_propagate_review (
    subject_ref, batch_tag, owner_entity_id, owner_name, source_domain,
    source_contact_id, source_bound_by, contact_name, contact_type, data_source,
    reason, evidence, rank_value, status
  )
  select
    c.subject_ref, v_batch, c.entity_id, c.owner_name, 'dia',
    null, 'dia_ownership_master', c.candidate, 'decision_maker', 'dia_ownership_master',
    'workbook_spe_principal',
    jsonb_build_object(
      'medicare_ccn',         c.medicare_ccn,
      'source_property_id',   c.source_property_id,
      'workbook_recorded',    c.recorded_owner,
      'workbook_true_owner',  c.true_owner,
      'last_sale_date',       c.last_sale_date,
      'surname_corroborated', c.surname_corroborated,
      'basis',               'LCC holds the SPE (recorded owner matches the LCC '
                          || 'owner); the workbook names the principal behind it.',
      'caveat',              'Team Briggs research file, point-in-time. It has no '
                          || 'contact detail -- this proposes WHO to find, not how '
                          || 'to reach them. 228 other gap owners DISAGREE with LCC '
                          || 'outright and are deliberately NOT in this batch.'
    ),
    c.annual_rent, 'pending'
  from _p137 c
  on conflict (subject_ref) do nothing;

  return query
    select 'inserted'::text, c.owner_name::text, c.candidate::text,
           c.surname_corroborated, c.annual_rent
    from _p137 c
    join public.lcc_owner_contact_propagate_review p using (subject_ref)
    where p.batch_tag = v_batch
    order by c.annual_rent desc nulls last;
end;
$$;

COMMENT ON FUNCTION public.lcc_p137_seed_workbook_spe_principals(boolean) IS
  'P137. Seeds the ONE unambiguous bucket of the dia ownership workbook -- LCC '
  'holds the SPE, the workbook names the principal -- as proposals in the P114 '
  'lane. Dry-run default, idempotent. Deliberately excludes the 228 rows that '
  'DISAGREE with LCC (they need date arbitration, P113 in both directions), the '
  '49 that restate the LCC owner, and the 27 carrying prose.';

GRANT EXECUTE ON FUNCTION public.lcc_p137_seed_workbook_spe_principals(boolean) TO service_role;
