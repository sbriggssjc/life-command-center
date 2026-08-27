-- =============================================================================
-- A2a -- merge the duplicate entities blocking the `ambiguous_entity` ownership
--        chains, so cron 244 (A2) applies those chains unaided.
--
-- 2026-08-27 -- LCC Opps (xengecqvemvfknjvbvrq)
--
-- WHAT THIS IS NOT
--   It is NOT a merge driver. P196 made `lcc_merge_entity` snapshot the loser
--   side, fold `owner_contact_pivot` fill-blanks, and reverse via
--   `lcc_unmerge_entity`. This file adds a PLAN (which pairs, which winner, and
--   why a group is held) and a BATCH LEDGER on top of that one function. Every
--   write goes through `lcc_merge_entity`; every reversal through
--   `lcc_unmerge_entity`. A second implementation of the merge itself is the
--   normaliser drift CLAUDE.md warns about a dozen times.
--
-- WHY THE GATES ARE WHAT THEY ARE (measured on this population, 2026-08-27)
--   `ambiguous_entity` means the grantor NAME resolves to more than one live
--   entity -- so the name is exactly what is in question, and identity has to be
--   earned rather than assumed.
--
--   * g_case_only -- every member's name is equal after `lower()`. This is
--     P195's byte-identical standard, relaxed only for case. 10 of 43 groups
--     fail it and are HELD, 9 of them on punctuation inside the legal form
--     (`800 K Street Associates, LLC` vs `800 K STREET ASSOCIATES, L.L.C.`).
--     Those 9 are probably the same party; "probably" is not the standard for a
--     write that asserts who owned a building. The tenth is why the gate exists:
--     `Mr Champa LLC` vs `M.R. Champa, LLC` -- an honorific or two initials, and
--     nothing on either row decides it.
--     NOTE the comparators that are BANNED here and were not used:
--     `lcc_owner_strict_core` (A2 measured it collapsing `BAMMF (8) LLC` onto
--     `BAMMF (3) LLC` on this exact population) and `lcc_normalize_entity_name`
--     (P189: returns NULL for acronym firms, strips `group|partners|capital`).
--
--   * g_all_organization -- no member typed `person`. Two humans sharing a name
--     is ordinary, and a person<->organization merge picks an answer to a
--     question nobody has asked. 7 groups HELD (`Robert Clark`, `John Frew`,
--     `Abdallah Taha`, `Steve Beckman`, plus `Matan Companies` / `Precor Ruffin`
--     / `FD Stonewater`, which are firms carrying one mistyped `person` row).
--     ⚠️ `lcc_looks_like_person` is deliberately NOT the gate: measured over
--     these 43 names it returns TRUE for `CANO FAMCO`, `Hokanson Companies`,
--     `HORAK DEVELOPMENT IV, L.P.`, `Matan Companies`, `Precor Ruffin` and
--     `USAA Real Estate` -- six organisations. It is the documented
--     two-capitalised-tokens false positive (A3, P196). The RECORDED
--     `entity_type` is a fact LCC holds; the regex is a guess about a string.
--
--   * g_no_rival_identity -- no two members carry the same
--     (source_system, source_type) with DIFFERENT external_ids. Two distinct
--     records in one upstream system is not proof of two parties (Salesforce is
--     minimum-necessary and full of duplicates) but it is not evidence of one
--     either. 1 group HELD (`FD Stonewater`, two salesforce/Account ids), which
--     the person gate also catches.
--
--   * g_distinctive_residue -- P195's own gate, reused rather than re-invented.
--     ⚠️ It is a NO-OP on this population: 43 of 43 pass. Recorded as measured
--     rather than dropped, because P195 measured it holding 4 groups on its own
--     population (`Capital`, `Partners Group`), so the function discriminates --
--     this population simply carries no pure-generic names.
--
--   * g_clean_name -- placeholder/brokerage. Also 0 of 43. Same treatment.
--
--   WINNER RULE is P195's, unchanged and ownership-first: owns_assets desc ->
--   current_rent desc -> portfolio_facts desc -> external_ids desc ->
--   relationships desc -> created_at asc -> id asc. It deliberately does NOT
--   promote the pivot-bearing member; `lcc_merge_fold_pivot` preserves the
--   contact regardless of who wins.
--
--   P175a CHECKED, NOT ASSUMED: across all 43 groups there are ZERO
--   (source_domain, source_property_id) portfolio-fact collisions and zero
--   lcc_property_owner collisions between members, so the merge's dedup-DELETE
--   cannot resolve a ghost-vs-ENDED disagreement toward the stale side. The
--   positive control for that zero is 2,966 such collisions fleetwide (P182 --
--   an implausibly clean number is a bug signal, so it was pointed at a known
--   positive first).
--
-- VERIFY BY THE DRAIN, NOT THE MERGE COUNT
--   select count(*) filter (where status='completed')
--     from research_tasks where research_type='establish_ownership_history';
--   Merges performed is an input. The outcome is tasks completed by cron 244.
--
-- REVERSAL
--   select * from public.lcc_a2a_unmerge('<batch_tag>');
--   (loops `lcc_unmerge_entity` newest-first; read `restored_with_residue`.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The plan. One row per LIVE member of every `ambiguous_entity` grantor
--    group, carrying the verdict, the hold reason, and the deterministic
--    winner. This is also the dry-run surface and the recurrence watch: it is
--    derived from the live lane, so a group that comes back reappears here.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_a2a_ambiguity_merge_plan as
with grp as (
  select distinct b.grantor_key as group_key
  from public.v_lcc_ownership_chain_apply_blocked b
  where b.blocked_reason = 'ambiguous_entity'
),
mem as (
  select g.group_key,
         e.id as entity_id, e.name, e.entity_type, e.domain, e.created_at,
         coalesce(e.metadata->>'source', 'other') as mint_source,
         (select count(*) from public.lcc_property_owner po
           where po.owner_entity_id = e.id) as owns_assets,
         coalesce((select sum(f.annual_rent) from public.lcc_entity_portfolio_facts f
                    where f.entity_id = e.id and f.is_current), 0) as current_rent,
         (select count(*) from public.lcc_entity_portfolio_facts f
           where f.entity_id = e.id) as portfolio_facts,
         (select count(*) from public.external_identities x
           where x.entity_id = e.id) as external_ids,
         (select count(*) from public.entity_relationships r
           where r.from_entity_id = e.id or r.to_entity_id = e.id) as relationships,
         (select count(*) from public.owner_contact_pivot p
           where p.entity_id = e.id) as pivots,
         (select p.active_contact_name from public.owner_contact_pivot p
           where p.entity_id = e.id) as pivot_contact_name
  from grp g
  join public.entities e
    on e.merged_into_entity_id is null
   and public.lcc_ownership_chain_name_key(e.name) = g.group_key
),
xconf as (
  select z.group_key from (
    select m.group_key, x.source_system, x.source_type
    from mem m
    join public.external_identities x on x.entity_id = m.entity_id
    group by 1, 2, 3
    having count(distinct x.external_id) > 1
       and count(distinct m.entity_id) > 1
  ) z group by z.group_key
),
gate as (
  select m.group_key,
         count(*)::int as member_count,
         (count(distinct lower(m.name)) = 1)                       as g_case_only,
         (count(*) filter (where m.entity_type = 'person') = 0)     as g_all_organization,
         (m.group_key not in (select group_key from xconf))         as g_no_rival_identity,
         bool_and(public.lcc_p195_name_has_distinctive_residue(m.name))
                                                                    as g_distinctive_residue,
         bool_and(not public.lcc_is_placeholder_owner_name(m.name)
              and not public.lcc_owner_name_is_brokerage(m.name))   as g_clean_name
  from mem m group by m.group_key
),
verdict as (
  select gate.*,
         case
           when not gate.g_clean_name           then 'held:placeholder_or_brokerage_name'
           when not gate.g_distinctive_residue  then 'held:generic_name_no_distinctive_token'
           when not gate.g_case_only            then 'held:name_variant_beyond_case'
           when not gate.g_all_organization     then 'held:person_typed_member'
           when not gate.g_no_rival_identity    then 'held:rival_identity_same_system'
           else 'merge'
         end as verdict
  from gate
),
ranked as (
  select m.*, v.verdict, v.member_count,
         v.g_case_only, v.g_all_organization, v.g_no_rival_identity,
         v.g_distinctive_residue, v.g_clean_name,
         row_number() over (
           partition by m.group_key
           order by m.owns_assets desc, m.current_rent desc, m.portfolio_facts desc,
                    m.external_ids desc, m.relationships desc,
                    m.created_at asc, m.entity_id asc) as win_rank
  from mem m join verdict v on v.group_key = m.group_key
)
select ranked.group_key,
       ranked.verdict,
       ranked.member_count,
       ranked.entity_id,
       ranked.name,
       ranked.entity_type,
       ranked.domain,
       ranked.mint_source,
       ranked.created_at,
       ranked.win_rank,
       (ranked.win_rank = 1) as is_winner,
       first_value(ranked.entity_id) over (
         partition by ranked.group_key order by ranked.win_rank) as winner_id,
       ranked.g_case_only, ranked.g_all_organization, ranked.g_no_rival_identity,
       ranked.g_distinctive_residue, ranked.g_clean_name,
       ranked.owns_assets, ranked.current_rent, ranked.portfolio_facts,
       ranked.external_ids, ranked.relationships, ranked.pivots,
       ranked.pivot_contact_name,
       (select count(distinct b.research_task_id)
          from public.v_lcc_ownership_chain_apply_blocked b
         where b.grantor_key = ranked.group_key
           and b.blocked_reason = 'ambiguous_entity') as blocked_tasks,
       -- value is per OWNER, never per task or per link: one owner can carry
       -- several blocked tasks and one task several blocked links.
       (select sum(o.rent) from (
          select distinct p.task_entity_id,
                 public.lcc_owner_known_annual_rent(p.task_entity_id) as rent
            from public.v_lcc_ownership_chain_apply_plan p
           where p.disposition = 'blocked'
             and p.resolution = 'ambiguous_entity'
             and p.grantor_key = ranked.group_key) o) as blocked_owner_rent
from ranked;

comment on view public.v_lcc_a2a_ambiguity_merge_plan is
  'A2a: one row per live member of an `ambiguous_entity` grantor group, with the deterministic P195 ownership-first winner and the verdict. verdict<>''merge'' is HELD and never merged. Derived from the live lane, so it doubles as the recurrence watch.';

-- ---------------------------------------------------------------------------
-- 2. The held groups, named. A count with no reason is the thing P196 fixed for
--    the Tier 0 parks; the same rule applies here.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_a2a_ambiguity_hold_watch as
select group_key,
       verdict as hold_reason,
       member_count,
       max(blocked_tasks) as blocked_tasks,
       max(blocked_owner_rent) as blocked_owner_rent,
       array_agg(name order by win_rank) as member_names,
       array_agg(entity_type order by win_rank) as member_types,
       array_agg(mint_source order by win_rank) as member_mint_sources
from public.v_lcc_a2a_ambiguity_merge_plan
where verdict <> 'merge'
group by group_key, verdict, member_count
order by max(blocked_owner_rent) desc nulls last, group_key;

comment on view public.v_lcc_a2a_ambiguity_hold_watch is
  'A2a: the ambiguity groups NOT merged, each naming why, value-ranked per owner. Held is a decision, not residue.';

-- ---------------------------------------------------------------------------
-- 3. Batch ledger. The per-merge snapshot lives where P196 put it
--    (r40_merge_reconcile_backup + lcc_entity_merge_log); this table only
--    records which batch and which group a merge belonged to, so a batch can be
--    reversed as a unit.
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_a2a_merge_log (
  id            bigserial primary key,
  batch_tag     text        not null,
  group_key     text        not null,
  entity_name   text        not null,
  winner_id     uuid        not null,
  loser_id      uuid        not null,
  merge_log_id  bigint,
  pivot_note    text,
  reconcile     jsonb,
  merged_at     timestamptz not null default now(),
  unmerged_at   timestamptz,
  unmerge_note  text
);
create index if not exists idx_lcc_a2a_merge_log_batch on public.lcc_a2a_merge_log(batch_tag);
create unique index if not exists uq_lcc_a2a_merge_log_open
  on public.lcc_a2a_merge_log(loser_id) where unmerged_at is null;

comment on table public.lcc_a2a_merge_log is
  'A2a: one row per loser merged by lcc_a2a_merge_ambiguous_chain_entities, tying it to its batch and to the P196 lcc_entity_merge_log row that makes it reversible.';

-- ---------------------------------------------------------------------------
-- 4. The driver. Dry-run by default. Calls `lcc_merge_entity` -- nothing else
--    writes -- and reports counts that are effects, not intentions.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_a2a_merge_ambiguous_chain_entities(
  p_dry_run   boolean default true,
  p_batch_tag text    default null,
  p_group_key text    default null,
  p_limit     int     default null
) returns table(
  dry_run          boolean,
  batch_tag        text,
  groups_eligible  int,
  groups_merged    int,
  losers_merged    int,
  groups_held      int,
  held_by_reason   jsonb,
  write_set        jsonb
)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_tag    text := coalesce(p_batch_tag, 'a2a-' || to_char(now(), 'YYYYMMDDHH24MISS'));
  v_set    jsonb;
  v_elem   jsonb;
  v_loser  uuid;
  v_winner uuid;
  v_logid  bigint;
  v_pivot  text;
  v_rec    jsonb;
  v_gk     text[] := '{}';
  v_losers int := 0;
begin
  select count(*) filter (where g.verdict = 'merge'),
         count(*) filter (where g.verdict <> 'merge')
    into groups_eligible, groups_held
    from (select distinct group_key, verdict
            from public.v_lcc_a2a_ambiguity_merge_plan) g;

  select coalesce(jsonb_object_agg(z.verdict, z.n), '{}'::jsonb)
    into held_by_reason
    from (select g.verdict, count(*) as n
            from (select distinct group_key, verdict
                    from public.v_lcc_a2a_ambiguity_merge_plan) g
           where g.verdict <> 'merge'
           group by g.verdict) z;

  -- The write set is snapshotted BEFORE anything moves: the plan view is derived
  -- from the live lane, so merging changes what it returns.
  select coalesce(jsonb_agg(jsonb_build_object(
           'group_key', p.group_key, 'name', p.name,
           'winner_id', p.winner_id, 'loser_id', p.entity_id)
         order by p.group_key, p.win_rank), '[]'::jsonb)
    into v_set
    from public.v_lcc_a2a_ambiguity_merge_plan p
   where p.verdict = 'merge'
     and not p.is_winner
     and (p_group_key is null or p.group_key = p_group_key)
     and (p_limit is null or p.group_key in (
           select l.gk from (select distinct group_key as gk
                               from public.v_lcc_a2a_ambiguity_merge_plan q
                              where q.verdict = 'merge'
                                and (p_group_key is null or q.group_key = p_group_key)
                              order by 1 limit p_limit) l));

  if p_dry_run then
    dry_run := true; batch_tag := v_tag; write_set := v_set;
    select count(distinct e.value->>'group_key')::int, count(*)::int
      into groups_merged, losers_merged
      from jsonb_array_elements(v_set) e;
    return next; return;
  end if;

  for v_elem in select value from jsonb_array_elements(v_set) loop
    v_loser  := (v_elem->>'loser_id')::uuid;
    v_winner := (v_elem->>'winner_id')::uuid;

    -- Re-verify at execution time rather than trusting the snapshot: a member
    -- may have been merged by another path since the plan was read.
    if not exists (select 1 from public.entities
                    where id = v_loser and merged_into_entity_id is null) then
      continue;
    end if;

    perform * from public.lcc_merge_entity(v_loser, v_winner);

    select l.id, l.pivot_note, l.reconcile
      into v_logid, v_pivot, v_rec
      from public.lcc_entity_merge_log l
     where l.loser_id = v_loser and l.unmerged_at is null
     order by l.id desc limit 1;

    insert into public.lcc_a2a_merge_log(
      batch_tag, group_key, entity_name, winner_id, loser_id,
      merge_log_id, pivot_note, reconcile)
    values (v_tag, v_elem->>'group_key', v_elem->>'name', v_winner, v_loser,
            v_logid, v_pivot, v_rec);

    v_losers := v_losers + 1;
    v_gk := v_gk || (v_elem->>'group_key');
  end loop;

  dry_run := false; batch_tag := v_tag; write_set := v_set;
  losers_merged := v_losers;
  select coalesce(count(distinct x), 0)::int into groups_merged from unnest(v_gk) as x;
  return next;
end;
$fn$;

comment on function public.lcc_a2a_merge_ambiguous_chain_entities(boolean, text, text, int) is
  'A2a: merges the `ambiguous_entity` groups whose verdict is `merge`, one lcc_merge_entity call per loser. Dry-run default. NOT a merge implementation -- every write goes through lcc_merge_entity so P196 snapshotting, pivot folding and reversal apply unchanged.';

-- ---------------------------------------------------------------------------
-- 5. Batch reversal, through `lcc_unmerge_entity` -- never a bespoke restore.
--    Newest-first, so a group merged 3->1 unwinds in the order it was built.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_a2a_unmerge(p_batch_tag text)
returns table(losers_reversed int, notes jsonb)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  r      record;
  v_note text;
  v_n    int := 0;
  v_out  jsonb := '[]'::jsonb;
begin
  for r in
    select * from public.lcc_a2a_merge_log
     where batch_tag = p_batch_tag and unmerged_at is null
     order by id desc
  loop
    select public.lcc_unmerge_entity(r.loser_id) into v_note;
    update public.lcc_a2a_merge_log
       set unmerged_at = now(), unmerge_note = v_note
     where id = r.id;
    v_n := v_n + 1;
    v_out := v_out || jsonb_build_object(
      'group_key', r.group_key, 'loser_id', r.loser_id, 'note', v_note);
  end loop;
  losers_reversed := v_n; notes := v_out; return next;
end;
$fn$;

comment on function public.lcc_a2a_unmerge(text) is
  'A2a: reverses one merge batch by calling lcc_unmerge_entity per loser, newest first. Read the per-row note -- `restored_with_residue:...` means a P177 survivor trigger refused a duplicate edge and the restore is partial.';

-- ---------------------------------------------------------------------------
-- 6. TEARDOWN (reverse the batch FIRST, then drop the objects)
--    select * from public.lcc_a2a_unmerge('<batch_tag>');
--    drop function if exists public.lcc_a2a_unmerge(text);
--    drop function if exists public.lcc_a2a_merge_ambiguous_chain_entities(boolean,text,text,int);
--    drop view if exists public.v_lcc_a2a_ambiguity_hold_watch;
--    drop view if exists public.v_lcc_a2a_ambiguity_merge_plan;
--    drop table if exists public.lcc_a2a_merge_log;
--
--    NOT SCHEDULED, deliberately. The duplicate producer recurs (see the A2a
--    writeup), so this will have work to do again -- but an unattended merge
--    sweep is exactly what P196 declined to enable when it left
--    lcc_apply_fuzzy_merges unwired at auto_mergeable = 3,053. Reversibility
--    lowers the cost of being wrong; it does not replace the grading.
-- =============================================================================
