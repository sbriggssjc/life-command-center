-- ID3b: gov owner fuzzy-variant merge (recorded_owners + true_owners)
--
-- Context: RO2a sized the recorded_owners fuzzy-variant population (name variants that
-- collapse to the same public.gov_owner_strict_core(name) but were never exact-canonical-
-- name duplicates, so owner_merge_tick's canonical_name-equality clustering never catches
-- them) at 1,380 groups / 2,870 rows / ~1,807 properties. ID3b re-measured live on
-- 2026-09-12 and found the same population unchanged (1,380/2,870), plus a true_owners
-- side (227 groups / 461 rows after other identity work already collapsed most of it from
-- the prior day's 237/483 estimate).
--
-- This migration adds two new tick-shaped functions, one per table, that:
--   1. Group unmerged rows by gov_owner_strict_core(name-or-canonical_name), core length >= 4
--      (matches the measurement query so counts reproduce exactly).
--   2. Pick the group member with the most linked properties as survivor (ties broken by id).
--   3. Guard every group: if ANY member name matches gov_owner_name_is_brokerage,
--      is_generic_gov_owner, or a bank/lender/lienholder regex, the WHOLE group is routed to
--      entity_match_candidates + gov_owner_merge_review_log for human review -- NEVER
--      auto-merged. This mirrors owner_merge_tick's own review-routing pattern exactly.
--   4. Guard-clean groups are merged via the EXISTING apply_owner_merge / apply_true_owner_merge
--      primitives (unmodified -- both already accept arbitrary caller-supplied survivor/loser
--      pairs, confirmed by reading their bodies; no new merge mechanism is introduced here).
--
-- What this deliberately does NOT do (see docs/claude-code/prompts/ID3b-owner-duplicate-merge.md
-- "What NOT to do"): no new identity audit (RO2a already did that), no agency/guarantor/broker
-- classification work (ID3a/ID3d/ID3c), no touch to true_owners.is_operator_not_owner (OWN4's
-- separate doctrine decision), no dia work (dia recorded_owners/true_owners are already at
-- zero exact AND fuzzy dups per ID3b's live 2026-09-12 measurement).
--
-- Ship result (live, 2026-09-12, government project scknotsqkcheojiaewwh):
--   recorded_owners: 1,380 groups seen, 1,466 losers merged, 24 losers routed to review.
--   true_owners:       227 groups seen,   232 losers merged,  2 losers routed to review.
--   Parity confirmed: total_properties, properties_with_recorded_owner and
--   properties_with_true_owner were bit-for-bit unchanged before/after both live runs
--   (20,509 / 9,327 / 9,848) -- only owner-row counts dropped, by exactly the merged-loser
--   counts (17,143->15,677 and 15,061->14,829). No property changed to a different real owner.

create or replace function public.gov_owner_variant_merge_tick(p_dry_run boolean default false)
returns table(losers_merged bigint, routed_to_review bigint, groups_seen bigint, run_at timestamptz)
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_merged   bigint := 0;
  v_routed   bigint := 0;
  v_groups   bigint := 0;
  v_run_id   text := 'gov_owner_variant_merge_tick';
  grp        record;
  v_cand_id  uuid;
  i          int;
begin
  for grp in
    with props_per_owner as (
      select recorded_owner_id, count(*) as props
      from public.properties
      where recorded_owner_id is not null
      group by recorded_owner_id
    ),
    base as (
      select ro.recorded_owner_id as id, ro.name,
             public.gov_owner_strict_core(ro.name) as core,
             coalesce(pp.props, 0) as props
      from public.recorded_owners ro
      left join props_per_owner pp on pp.recorded_owner_id = ro.recorded_owner_id
      where ro.merged_into_recorded_owner_id is null
        and ro.name is not null
    ),
    grouped as (
      select core,
             count(*) as n_rows,
             array_agg(id order by props desc, id) as ids,
             array_agg(name order by props desc, id) as names
      from base
      where core is not null and length(core) >= 4
      group by core
      having count(*) > 1
    )
    select
      core, n_rows, ids, names,
      ids[1] as survivor_id,
      names[1] as survivor_name,
      (
        (select bool_or(public.gov_owner_name_is_brokerage(nm)) from unnest(names) nm)
        or (select bool_or(public.is_generic_gov_owner(nm)) from unnest(names) nm)
        or (select bool_or(nm ~* '\mbank\M|national association|\mn\.?a\.?\M|trust company|savings|credit union|as trustee|as custodian|mortgage') from unnest(names) nm)
      ) as flagged
    from grouped
  loop
    v_groups := v_groups + 1;

    if grp.flagged then
      for i in 2..array_length(grp.ids, 1) loop
        v_routed := v_routed + 1;
        if not p_dry_run then
          if not exists (
            select 1 from public.entity_match_candidates
            where source_table = 'recorded_owners' and source_id = grp.ids[i]
              and target_table = 'recorded_owners' and target_id = grp.survivor_id
              and match_method = 'gov_owner_variant_merge_tick_review'
              and status in ('pending_review', 'pending')
          ) then
            insert into public.entity_match_candidates
              (source_table, source_id, source_name, target_table, target_id, target_name,
               match_method, similarity, status)
            values
              ('recorded_owners', grp.ids[i], grp.names[i],
               'recorded_owners', grp.survivor_id, grp.survivor_name,
               'gov_owner_variant_merge_tick_review', 1.0, 'pending_review')
            returning id into v_cand_id;

            insert into public.gov_owner_merge_review_log
              (survivor_id, loser_id, survivor_name, loser_name, canonical_name,
               survivor_strict, loser_strict, similarity, run_id, match_candidate_id)
            values
              (grp.survivor_id, grp.ids[i], grp.survivor_name, grp.names[i], grp.core,
               grp.core, grp.core, 1.0, v_run_id, v_cand_id);
          end if;
        end if;
      end loop;
    else
      for i in 2..array_length(grp.ids, 1) loop
        v_merged := v_merged + 1;
        if not p_dry_run then
          perform public.apply_owner_merge(grp.survivor_id, grp.ids[i], grp.core, v_run_id);
        end if;
      end loop;
    end if;
  end loop;

  return query select v_merged, v_routed, v_groups, now();
end;
$function$;

comment on function public.gov_owner_variant_merge_tick(boolean) is
  'ID3b: merges recorded_owners fuzzy-name-variant groups (grouped by gov_owner_strict_core, '
  'core length >= 4). Guard-flagged groups (brokerage/generic/bank-lender name in the group) '
  'are routed to entity_match_candidates/gov_owner_merge_review_log for human review and are '
  'NEVER auto-merged. Guard-clean groups are merged via the existing apply_owner_merge '
  'primitive, survivor = member with the most linked properties. p_dry_run=true reports the '
  'auto/review split without writing anything.';

create or replace function public.gov_true_owner_variant_merge_tick(p_dry_run boolean default false)
returns table(losers_merged bigint, routed_to_review bigint, groups_seen bigint, run_at timestamptz)
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_merged   bigint := 0;
  v_routed   bigint := 0;
  v_groups   bigint := 0;
  v_run_id   text := 'gov_true_owner_variant_merge_tick';
  grp        record;
  v_cand_id  uuid;
  i          int;
begin
  for grp in
    with props_per_owner as (
      select true_owner_id, count(*) as props
      from public.properties
      where true_owner_id is not null
      group by true_owner_id
    ),
    base as (
      select tow.true_owner_id as id, tow.canonical_name as name,
             public.gov_owner_strict_core(tow.canonical_name) as core,
             coalesce(pp.props, 0) as props
      from public.true_owners tow
      left join props_per_owner pp on pp.true_owner_id = tow.true_owner_id
      where tow.merged_into_true_owner_id is null
        and tow.canonical_name is not null
    ),
    grouped as (
      select core,
             count(*) as n_rows,
             array_agg(id order by props desc, id) as ids,
             array_agg(name order by props desc, id) as names
      from base
      where core is not null and length(core) >= 4
      group by core
      having count(*) > 1
    )
    select
      core, n_rows, ids, names,
      ids[1] as survivor_id,
      names[1] as survivor_name,
      (
        (select bool_or(public.gov_owner_name_is_brokerage(nm)) from unnest(names) nm)
        or (select bool_or(public.is_generic_gov_owner(nm)) from unnest(names) nm)
        or (select bool_or(nm ~* '\mbank\M|national association|\mn\.?a\.?\M|trust company|savings|credit union|as trustee|as custodian|mortgage') from unnest(names) nm)
      ) as flagged
    from grouped
  loop
    v_groups := v_groups + 1;

    if grp.flagged then
      for i in 2..array_length(grp.ids, 1) loop
        v_routed := v_routed + 1;
        if not p_dry_run then
          if not exists (
            select 1 from public.entity_match_candidates
            where source_table = 'true_owners' and source_id = grp.ids[i]
              and target_table = 'true_owners' and target_id = grp.survivor_id
              and match_method = 'gov_true_owner_variant_merge_tick_review'
              and status in ('pending_review', 'pending')
          ) then
            insert into public.entity_match_candidates
              (source_table, source_id, source_name, target_table, target_id, target_name,
               match_method, similarity, status)
            values
              ('true_owners', grp.ids[i], grp.names[i],
               'true_owners', grp.survivor_id, grp.survivor_name,
               'gov_true_owner_variant_merge_tick_review', 1.0, 'pending_review')
            returning id into v_cand_id;

            insert into public.gov_owner_merge_review_log
              (survivor_id, loser_id, survivor_name, loser_name, canonical_name,
               survivor_strict, loser_strict, similarity, run_id, match_candidate_id)
            values
              (grp.survivor_id, grp.ids[i], grp.survivor_name, grp.names[i], grp.core,
               grp.core, grp.core, 1.0, v_run_id, v_cand_id);
          end if;
        end if;
      end loop;
    else
      for i in 2..array_length(grp.ids, 1) loop
        v_merged := v_merged + 1;
        if not p_dry_run then
          perform public.apply_true_owner_merge(grp.survivor_id, grp.ids[i], grp.core, v_run_id);
        end if;
      end loop;
    end if;
  end loop;

  return query select v_merged, v_routed, v_groups, now();
end;
$function$;

comment on function public.gov_true_owner_variant_merge_tick(boolean) is
  'ID3b: merges true_owners fuzzy-name-variant groups (grouped by gov_owner_strict_core over '
  'canonical_name, core length >= 4). Guard-flagged groups are routed to review and are NEVER '
  'auto-merged. Guard-clean groups are merged via the existing apply_true_owner_merge primitive, '
  'survivor = member with the most linked properties. p_dry_run=true reports the auto/review '
  'split without writing anything.';
