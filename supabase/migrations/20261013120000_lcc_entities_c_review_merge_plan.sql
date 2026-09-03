-- PR5c-entities-c-review — the 15 genuine same-person pairs, as a plan Scott confirms row by row.
--
-- WHAT THIS IS NOT: it is not a merge, not a rule, and not a producer. Nothing here writes to
-- `entities`. `v_lcc_entity_email_tier_blind_pairs` (PR5c-entities-c) holds 55 live person pairs
-- sharing a non-generic email across domains; 15 are the same person under a name variant and 40
-- are not (27% precision -- the band P189 measured at 25% and P198 at 7% and both refused). This
-- migration records that human read as a LEDGER and projects the 15 as a merge plan.
--
-- ⚠️ NO `auto_mergeable` COLUMN, DELIBERATELY (P198): `lcc_apply_fuzzy_merges()` loops on that flag
--    and would merge unreviewed rows unattended.
--
-- ⚠️ THE SELECTION IS TWO BASES, NOT ONE RULE, AND THE SPLIT IS THE POINT.
--    `initial_only_expansion` (6 of 15) is STRUCTURAL and reproducible: strip single-character
--    tokens (initials) from both canonical names and the residues are identical, multi-token.
--    It fires on 6 of the 55 and on 0 of the other 49 -- it selects `Carl Verstandig` /
--    `Carl J. Verstandig` and correctly refuses `Income & Expenses` / `Expenses` (whose extra
--    tokens are words, not initials).
--    `human_read` (9 of 15) has NO RULE. Reaching Andy/Andrew, Jim/James, Nick/Nicholas,
--    Steve/Steven, Vince/Vincent, Ravi/Ravindra, Greg/Gregory needs a nickname dictionary or a
--    shared-prefix test, and Randy Blankstein/Blankenstein needs edit distance. Those are
--    name-similarity comparators, BANNED FOR IDENTITY throughout this codebase
--    (`docs/architecture/entity-identity-and-dedup.md` §1). So they are recorded as a human read
--    with a named reviewer, never inferred.
--
-- ⚠️ THE P195 WINNER RULE DEGENERATES ON THIS POPULATION -- READ `winner_decided_by`.
--    The rule is ownership-first (`owns_assets -> current_rent -> portfolio_facts -> external_ids
--    -> relationships -> created_at -> id`) and was calibrated on OWNERS. These 30 endpoints are
--    brokers and contacts: `owns_assets`, `current_rent` and `portfolio_facts` are ZERO on all 30
--    (and on 92 of the 93 endpoints across all 55 pairs). The first three tiers are therefore
--    constant and the winner is decided entirely by `external_ids`, then `relationships`. That
--    tie-break knows nothing about which NAME should survive: it picks `Frank Johnson` over the
--    older, better-connected `Frank D. Johnson`, and `Steve Karlson` over `Steven Karlson`.
--    The plan reports the rule's answer AND names the tier that decided it; the confirm SQL takes
--    an explicit (loser, winner) so Scott can swap the direction per row.
--
-- ⚠️ THE REVERSAL IS `lcc_unmerge_entity`, NOT `lcc_p195_unmerge`. Measured live on the Harrison
--    pair in a rolled-back transaction: the P195 path restored 17 rows and left TWO byte-identical
--    `brokers` edges on the winner, because `trg_lcc_entity_rel_resolve_survivor` is a BEFORE
--    INSERT trigger that SKIPS a duplicate edge, so the row never reaches
--    `ON CONFLICT (id) DO UPDATE` -- P196's exact finding, in the one reversal path that never got
--    P196's fix. Row COUNT was 26 before and after, so counting rows reads it as clean. The plain
--    P196 path (`lcc_merge_entity`, which self-snapshots, then `lcc_unmerge_entity`) round-tripped
--    0 lost / 0 new / 0 changed on the same pair. Use it. See `lcc_p195_unmerge` / backlog
--    PR5c-entities-c-p195-unmerge.

begin;

-- ---------------------------------------------------------------------------
-- 1. The human-read ledger. All 55 pairs get a recorded verdict, so the 40
--    non-merges are a DECISION rather than residue somebody re-reads next round.
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_entities_c_pair_verdict (
  entity_a_id  uuid not null references public.entities(id) on delete cascade,
  entity_b_id  uuid not null references public.entities(id) on delete cascade,
  verdict      text not null check (verdict in ('same_person','different_parties')),
  basis        text not null check (basis in ('initial_only_expansion','human_read')),
  reason_class text,
  note         text,
  reviewed_by  text not null default 'claude:PR5c-entities-c-review',
  reviewed_at  timestamptz not null default now(),
  primary key (entity_a_id, entity_b_id)
);

comment on table public.lcc_entities_c_pair_verdict is
  'PR5c-entities-c-review: the recorded human read of v_lcc_entity_email_tier_blind_pairs. '
  'A LEDGER, never a classifier input -- no producer reads it to decide an attach. '
  'verdict=same_person feeds v_lcc_entities_c_review_merge_plan (human confirm, one row at a time).';

insert into public.lcc_entities_c_pair_verdict (entity_a_id, entity_b_id, verdict, basis, reason_class, note)
select p.entity_a_id, p.entity_b_id,
  case when same then 'same_person' else 'different_parties' end,
  case when same and initial_only then 'initial_only_expansion' else 'human_read' end,
  case
    when same and initial_only then 'middle_initial_added'
    when same then 'nickname_or_spelling_variant'
    when label then 'p131_document_row_label'
    when firm  then 'firm_filed_as_person'
    else 'two_real_people_one_mailbox'
  end,
  case when same and not initial_only then
    'no deterministic rule reaches this pair: a nickname/spelling variant needs a dictionary, '
    'a shared-prefix test or edit distance -- all name-similarity comparators, banned for identity.' end
from (
  select p.*,
    (res_a = res_b and coalesce(array_length(res_a,1),0) >= 2) as initial_only,
    ((res_a = res_b and coalesce(array_length(res_a,1),0) >= 2)
      or (p.name_a, p.name_b) in (
        ('Andy Nathan','Andrew Nathan'), ('Gregory Geiger','W Greg Geiger'),
        ('James Anthony','Jim I. Anthony'), ('James Harrison','Jamie Harrison'),
        ('Nicholas Borrelli','Nick Borrelli'), ('Randy Blankstein','Randy Blankenstein'),
        ('Ravi Gangavaram','Ravindra G. Gangavaram'), ('Steven Karlson','Steve Karlson'),
        ('Vince Curran','Vincent Curran'))) as same,
    (p.name_a in ('Income & Expenses','Expenses','Per SF','Condo','Condo Size','Condo Type',
                  'First Vice President','Executive Vice Chairman','Managing Partner','Equity Funds',
                  'This was an all-cash deal.','User','Foreign','Japan','Singapore','Government')
     or p.name_b in ('Income & Expenses','Expenses','Per SF','Condo','Condo Size','Condo Type',
                  'First Vice President','Executive Vice Chairman','Managing Partner','Equity Funds',
                  'This was an all-cash deal.','User','Foreign','Japan','Singapore','Government')) as label,
    (p.name_a in ('Marcus & Millichap','Kidder Mathews','Global Net Lease','Avison Young','SUMMIT RE','Ace Hardware')
     or p.name_b in ('Marcus & Millichap','Kidder Mathews','Global Net Lease','Avison Young','SUMMIT RE','Ace Hardware')) as firm
  from (
    select v.*,
      (select array_agg(t order by t) from unnest(string_to_array(v.canonical_a,' ')) t where length(t) > 1) as res_a,
      (select array_agg(t order by t) from unnest(string_to_array(v.canonical_b,' ')) t where length(t) > 1) as res_b
    from public.v_lcc_entity_email_tier_blind_pairs v
  ) p
) p
on conflict (entity_a_id, entity_b_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The plan. Read-only. One row per confirmed same-person pair.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_entities_c_review_merge_plan as
with pairs as (
  select v.entity_a_id, v.entity_b_id, v.shared_email, v.name_a, v.name_b,
         d.basis, d.reason_class, d.note as basis_note
    from public.v_lcc_entity_email_tier_blind_pairs v
    join public.lcc_entities_c_pair_verdict d
      on d.entity_a_id = v.entity_a_id and d.entity_b_id = v.entity_b_id
   where d.verdict = 'same_person'
), members as (
  select p.entity_a_id, p.entity_b_id, p.shared_email, p.basis, p.reason_class, p.basis_note,
         e.id, e.name, e.domain, e.created_at,
         (select count(*) from public.lcc_property_owner po where po.owner_entity_id = e.id) as owns_assets,
         coalesce((select sum(f.annual_rent) from public.lcc_entity_portfolio_facts f
                    where f.entity_id = e.id and f.is_current), 0) as current_rent,
         (select count(*) from public.lcc_entity_portfolio_facts f where f.entity_id = e.id) as portfolio_facts,
         (select count(*) from public.external_identities x where x.entity_id = e.id) as external_ids,
         (select count(*) from public.entity_relationships r
           where r.from_entity_id = e.id or r.to_entity_id = e.id) as relationships,
         (select count(*) from public.owner_contact_pivot pv where pv.entity_id = e.id) as pivots,
         (select count(*) from public.touchpoint_cadence tc where tc.entity_id = e.id) as cadences,
         (select count(*) from public.bd_opportunities bo where bo.entity_id = e.id) as bd_opps
    from pairs p
    join public.entities e on e.id in (p.entity_a_id, p.entity_b_id)
   where e.merged_into_entity_id is null
), ranked as (
  select m.*,
         row_number() over (partition by m.shared_email
           order by m.owns_assets desc, m.current_rent desc, m.portfolio_facts desc,
                    m.external_ids desc, m.relationships desc, m.created_at, m.id) as win_rank
    from members m
), sides as (
  select shared_email, basis, reason_class, basis_note,
         (max(id::text) filter (where win_rank = 1))::uuid as winner_id,
         max(name) filter (where win_rank = 1) as winner_name,
         max(domain) filter (where win_rank = 1) as winner_domain,
         (max(id::text) filter (where win_rank = 2))::uuid as loser_id,
         max(name) filter (where win_rank = 2) as loser_name,
         max(domain) filter (where win_rank = 2) as loser_domain,
         max(owns_assets)     filter (where win_rank = 1) as w_owns,
         max(owns_assets)     filter (where win_rank = 2) as l_owns,
         max(current_rent)    filter (where win_rank = 1) as w_rent,
         max(current_rent)    filter (where win_rank = 2) as l_rent,
         max(portfolio_facts) filter (where win_rank = 1) as w_pf,
         max(portfolio_facts) filter (where win_rank = 2) as l_pf,
         max(external_ids)    filter (where win_rank = 1) as w_ids,
         max(external_ids)    filter (where win_rank = 2) as l_ids,
         max(relationships)   filter (where win_rank = 1) as w_rel,
         max(relationships)   filter (where win_rank = 2) as l_rel,
         max(pivots)          filter (where win_rank = 1) as w_pivots,
         max(pivots)          filter (where win_rank = 2) as l_pivots,
         max(cadences)        filter (where win_rank = 1) as w_cad,
         max(cadences)        filter (where win_rank = 2) as l_cad,
         max(bd_opps)         filter (where win_rank = 1) as w_bd,
         max(bd_opps)         filter (where win_rank = 2) as l_bd,
         max(created_at)      filter (where win_rank = 1) as w_created,
         max(created_at)      filter (where win_rank = 2) as l_created
    from ranked group by 1,2,3,4
)
select
  shared_email, basis, reason_class, basis_note,
  winner_id, winner_name, winner_domain,
  loser_id,  loser_name,  loser_domain,
  -- which tier of the P195 rule actually broke the tie. On this population the
  -- ownership-first tiers are constant at zero, so this is almost always 'external_ids'.
  case when w_owns <> l_owns then 'owns_assets'
       when w_rent <> l_rent then 'current_rent'
       when w_pf   <> l_pf   then 'portfolio_facts'
       when w_ids  <> l_ids  then 'external_ids'
       when w_rel  <> l_rel  then 'relationships'
       when w_created <> l_created then 'created_at'
       else 'entity_id_tiebreak' end as winner_decided_by,
  (w_owns = 0 and l_owns = 0 and w_rent = 0 and l_rent = 0 and w_pf = 0 and l_pf = 0)
    as ownership_tiers_all_zero,
  -- what a merge moves off the loser and onto the winner
  l_pf   as delta_portfolio_facts,
  l_ids  as delta_external_identities,
  l_rel  as delta_relationships,
  l_pivots as delta_pivots,
  l_cad  as delta_cadences,
  l_bd   as delta_bd_opportunities,
  l_rent as delta_current_rent,
  w_ids, w_rel, w_cad, w_created, l_created,
  -- every merge since P196 self-snapshots into r40_merge_reconcile_backup and logs to
  -- lcc_entity_merge_log, so every row here reverses with lcc_unmerge_entity(loser_id).
  true as reversible,
  'select * from lcc_merge_entity('''||loser_id||''','''||winner_id||''');' as confirm_sql,
  'select * from lcc_unmerge_entity('''||loser_id||''');' as reverse_sql
from sides;

comment on view public.v_lcc_entities_c_review_merge_plan is
  'PR5c-entities-c-review: the 15 same-person pairs from v_lcc_entity_email_tier_blind_pairs, one '
  'row per pair, with the P195 winner rule applied and the tier that decided it named. READ-ONLY '
  'and human-confirm: no auto_mergeable column (P198). ⚠️ winner_decided_by is almost always '
  '''external_ids'' because these are brokers with no assets -- the ownership-first tiers are all '
  'zero, so the rule does not express a preference about which NAME survives. Swap loser/winner in '
  'confirm_sql where the human disagrees. Reverse with lcc_unmerge_entity, NEVER lcc_p195_unmerge.';

grant select on public.v_lcc_entities_c_review_merge_plan to anon, authenticated, service_role;
grant select on public.lcc_entities_c_pair_verdict          to anon, authenticated, service_role;

commit;

-- REVERSAL RUNBOOK
--   drop view if exists public.v_lcc_entities_c_review_merge_plan;
--   drop table if exists public.lcc_entities_c_pair_verdict;
-- Neither object is written to by any producer; dropping them loses the recorded human read only.
