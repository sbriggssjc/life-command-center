-- ============================================================================
-- Owner resolution — SUPERSESSION tier (ownership is a chain, not a vote)
-- ============================================================================
-- Origin: Prompt 113 sized this and deliberately left it ("it changes the
-- shared consumer"). Re-grounded live 2026-08-15 before building.
--
-- THE DEFECT
-- `lcc_reconcile_property_owner` scores every piece of evidence and sets
--     confidence = top_candidate_score / SUM(all_candidate_scores)
-- i.e. the winner's SHARE of the vote. Recency decay is floored at 0.25, so a
-- 20-year-old transaction never stops voting. A building sold three times
-- therefore reads as three competing claims and the top share lands ~0.33-0.50,
-- under the 0.55 gate.
--
-- Measured live 2026-08-15: **741** assets have evidence and no resolved owner.
-- **ALL 741 are multi-candidate and NONE pass the gate** (avg top share 0.407).
-- So the gate is the only blocker, 100% of the time. Adding more evidence
-- cannot fix this class — more evidence makes the share worse.
--
-- Most telling: **295** of the 741 already carry a `domain_true_owner` row —
-- the domain's *curated current owner-of-record*, the highest-authority
-- non-manual source (weight 5.0) — and still lose, because a pile of historical
-- purchases outvotes it. That is the proof the share model is wrong: ownership
-- is a CHAIN with a most-recent link, not an election.
--
-- THE RULE
-- Authority first, then recency within the winning authority tier:
--     1 manual · 2 domain_true_owner · 3 rel_purchase · 4 sf_seller · 5 rel_owns
-- A later purchase SUPERSEDES an earlier one — that is what "current owner"
-- means. Ties on the winning date ABSTAIN (never guess).
--
-- WHY rel_purchase OUTRANKS a more recent rel_owns (checked, not assumed):
-- `rel_purchase.observed_at` is the real transaction date (values cluster on
-- first-of-month, CoStar sale-date granularity). `rel_owns.observed_at` is a
-- SYNC timestamp (2026-06-08, 2026-05-15 … the day we walked the graph), so
-- recency within rel_owns carries no ownership meaning. Ranking a sync stamp
-- above a dated deed would be a recency illusion.
--
-- SAFETY — what the live dry-run changed about the design
-- Spot-checking the proposed winners found **"Alexandria Foster"** — a PERSON —
-- winning a purchase edge and about to be written as a property owner. Sizing
-- it: **64 of 505** unique winners are `entity_type='person'`, every one from
-- the purchase tier (the domain_true_owner tier is 100% clean). Writing those
-- would be the same person/org conflation `sf-account-link.js` and Prompt 114
-- guard against — a person CAN own a building, but a person on a purchase edge
-- is just as likely to be a broker or signatory we mis-modelled.
-- So: organizations auto-resolve; people go to a human.
--
--   741 evidence-but-unresolved
--     441  auto-resolve  (organization-shaped, unique winner)   <- this function
--      64  review        (person-shaped winner)                 -> review view
--     236  abstain       (tie on the winning date)              -> review view
--
-- Verified clean on the 441: 0 operator-name leaks past `lcc_owner_operator_block`,
-- 0 blank/junk names.
--
-- DISCIPLINE: additive · fill-blanks-only (never touches a resolved owner) ·
-- conservative/unambiguous (ties abstain) · operator- and shape-guarded ·
-- reversible by batch tag · idempotent · DRY-RUN DEFAULT.
--
-- REVERSAL RUNBOOK
--   delete from public.lcc_property_owner po
--    using public.lcc_owner_supersession_log l
--    where l.batch_tag = '<tag>' and l.entity_id = po.entity_id
--      and po.source = 'supersession';
--   update public.lcc_owner_supersession_log set reversed_at = now() where batch_tag = '<tag>';
-- ============================================================================

-- ── Reversibility ledger ────────────────────────────────────────────────────
create table if not exists public.lcc_owner_supersession_log (
  id              bigserial primary key,
  batch_tag       text        not null,
  entity_id       uuid        not null,
  owner_entity_id uuid        not null,
  owner_name      text,
  tier            int         not null,
  tier_source     text        not null,
  winning_date    timestamptz,
  runner_up_date  timestamptz,
  confidence      numeric,
  created_at      timestamptz not null default now(),
  reversed_at     timestamptz
);
create index if not exists idx_lcc_owner_supersession_log_batch
  on public.lcc_owner_supersession_log (batch_tag) where reversed_at is null;

comment on table public.lcc_owner_supersession_log is
  'Reversibility ledger for lcc_supersede_property_owner. One row per asset resolved by the supersession tier.';

-- ── The candidate set: one row per (asset, candidate) in the winning tier ───
create or replace view public.v_lcc_owner_supersession_candidates as
with ev as (
  select e.*
    from public.lcc_property_owner_evidence e
   where e.candidate_owner_entity not in (select owner_entity_id from public.lcc_owner_operator_block)
),
unresolved as (            -- FILL-BLANKS: assets with no resolved owner at all
  select distinct ev.entity_id
    from ev
    left join public.lcc_property_owner po on po.entity_id = ev.entity_id
   where po.entity_id is null
),
u as (select ev.* from ev join unresolved x on x.entity_id = ev.entity_id),
tiered as (
  select entity_id, candidate_owner_entity, source, observed_at,
         case source
           when 'manual'            then 1
           when 'domain_true_owner' then 2
           when 'rel_purchase'      then 3
           when 'sf_seller'         then 4
           else                          5
         end as tier
    from u
),
best_tier as (select entity_id, min(tier) as tier from tiered group by entity_id),
in_tier as (
  select t.* from tiered t join best_tier b on b.entity_id = t.entity_id and b.tier = t.tier
),
latest as (select entity_id, max(observed_at) as win_date from in_tier group by entity_id),
runner as (   -- the next distinct earlier date in the winning tier (for the gap)
  select i.entity_id, max(i.observed_at) as runner_up_date
    from in_tier i join latest l on l.entity_id = i.entity_id
   where i.observed_at < l.win_date
   group by i.entity_id
)
select i.entity_id,
       i.candidate_owner_entity            as owner_entity_id,
       oe.name                             as owner_name,
       oe.entity_type                      as owner_entity_type,
       i.tier,
       i.source                            as tier_source,
       l.win_date,
       r.runner_up_date,
       count(*)      over (partition by i.entity_id) as winners_at_date,
       (count(*)     over (partition by i.entity_id)) = 1 as is_unique
  from in_tier i
  join latest  l on l.entity_id = i.entity_id and i.observed_at = l.win_date
  left join runner r on r.entity_id = i.entity_id
  left join public.entities oe on oe.id = i.candidate_owner_entity;

comment on view public.v_lcc_owner_supersession_candidates is
  'Per-asset winner(s) under the authority-then-recency supersession rule, for assets with evidence but no resolved owner. winners_at_date > 1 means a tie (abstain).';

-- ── The human worklist. A VIEW, deliberately, not a table ───────────────────
-- Prompt 114 flagged that a review TABLE with no consumer is an un-consumed
-- producer. A view recomputes from live evidence, so it drains automatically as
-- upstream data improves and can never go stale or need an auto-retire sweep.
create or replace view public.v_lcc_owner_supersession_review as
select c.entity_id,
       a.name                                   as asset_name,
       c.owner_entity_id,
       c.owner_name,
       c.owner_entity_type,
       c.tier,
       c.tier_source,
       c.win_date,
       c.winners_at_date,
       case
         when c.winners_at_date > 1                     then 'tie_on_winning_date'
         when c.owner_entity_type = 'person'            then 'person_shaped_winner'
         when coalesce(c.owner_name,'') = ''            then 'unnamed_candidate'
         else                                                'other'
       end                                      as review_reason
  from public.v_lcc_owner_supersession_candidates c
  left join public.entities a on a.id = c.entity_id
 where c.winners_at_date > 1
    or c.owner_entity_type is distinct from 'organization'
    or coalesce(c.owner_name,'') = '';

comment on view public.v_lcc_owner_supersession_review is
  'Supersession cases a human must decide: ties on the winning date, and person-shaped winners (a person on a purchase edge is as likely a broker/signatory as an owner). Self-draining — recomputed from live evidence.';

-- ── The feeder ──────────────────────────────────────────────────────────────
create or replace function public.lcc_supersede_property_owner(
  p_dry_run boolean default true,
  p_batch   text    default null,
  p_limit   int     default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_batch   text := coalesce(p_batch, 'supersede_' || to_char(now(), 'YYYYMMDD_HH24MI'));
  v_applied int  := 0;
  v_person  int  := 0;
  v_tie     int  := 0;
  v_sample  jsonb;
begin
  -- Eligible = unique winner, organization-shaped, named.
  create temporary table _sup_elig on commit drop as
  select c.entity_id, c.owner_entity_id, c.owner_name, c.tier, c.tier_source,
         c.win_date, c.runner_up_date,
         -- Honest confidence, derived from AUTHORITY + SEPARATION, never from a
         -- vote share. Curated current owner-of-record is the strongest signal
         -- we hold short of a human; a superseding purchase with a clear gap to
         -- the prior link is next.
         case
           when c.tier = 1 then 0.95
           when c.tier = 2 then 0.80
           when c.tier = 3 and (c.runner_up_date is null
                                or c.win_date - c.runner_up_date >= interval '180 days') then 0.75
           when c.tier = 3 then 0.65
           else 0.60
         end as confidence
    from public.v_lcc_owner_supersession_candidates c
   where c.is_unique
     and c.owner_entity_type = 'organization'
     and coalesce(c.owner_name,'') <> ''
   order by c.tier, c.win_date desc
   limit coalesce(p_limit, 1000000);

  select count(*) into v_applied from _sup_elig;
  select count(distinct entity_id) into v_person
    from public.v_lcc_owner_supersession_review where review_reason = 'person_shaped_winner';
  select count(distinct entity_id) into v_tie
    from public.v_lcc_owner_supersession_review where review_reason = 'tie_on_winning_date';

  select jsonb_agg(x) into v_sample from (
    select entity_id, owner_name, tier_source, win_date::date as win_date, confidence
      from _sup_elig order by tier, win_date desc limit 10
  ) x;

  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dry_run', true, 'batch', v_batch,
      'would_resolve', v_applied,
      'review_person_shaped', v_person, 'review_ties', v_tie,
      'sample', coalesce(v_sample, '[]'::jsonb));
  end if;

  -- Fill-blanks: the ON CONFLICT DO NOTHING is a belt-and-braces guard on top of
  -- the view's own "no resolved owner" filter, so a concurrent resolve wins.
  insert into public.lcc_property_owner
    (entity_id, owner_entity_id, owner_name, confidence, margin, source, resolved_at, detail)
  select e.entity_id, e.owner_entity_id, e.owner_name, e.confidence,
         null,
         'supersession',
         now(),
         jsonb_build_object('tier', e.tier, 'tier_source', e.tier_source,
                            'win_date', e.win_date, 'runner_up_date', e.runner_up_date,
                            'batch_tag', v_batch)
    from _sup_elig e
  on conflict (entity_id) do nothing;

  get diagnostics v_applied = row_count;

  insert into public.lcc_owner_supersession_log
    (batch_tag, entity_id, owner_entity_id, owner_name, tier, tier_source,
     winning_date, runner_up_date, confidence)
  select v_batch, e.entity_id, e.owner_entity_id, e.owner_name, e.tier, e.tier_source,
         e.win_date, e.runner_up_date, e.confidence
    from _sup_elig e
    join public.lcc_property_owner po
      on po.entity_id = e.entity_id and po.source = 'supersession';

  return jsonb_build_object(
    'ok', true, 'dry_run', false, 'batch', v_batch,
    'resolved', v_applied,
    'review_person_shaped', v_person, 'review_ties', v_tie,
    'sample', coalesce(v_sample, '[]'::jsonb));
end $function$;

comment on function public.lcc_supersede_property_owner(boolean, text, int) is
  'Resolves the current owner by AUTHORITY then RECENCY (ownership is a chain, not a vote) for assets that have evidence but fail lcc_reconcile_property_owner''s share-based 0.55 gate. Organizations only; person-shaped winners and date ties go to v_lcc_owner_supersession_review. Dry-run default; reversible via lcc_owner_supersession_log.batch_tag.';

grant select on public.v_lcc_owner_supersession_candidates to service_role;
grant select on public.v_lcc_owner_supersession_review      to service_role;

-- ============================================================================
-- GUARDS ADDED AFTER THE LIVE DRY-RUN (the design changed because of the data)
-- ============================================================================
-- Sampling the proposed winners by NAME — not by entity_type — found brokerages
-- about to be written as the property owner: "Matthews(tm)", "Colliers",
-- "Coldwell Banker Commercial(r)", "PeerRealty". The BROKER on the transaction
-- had been modelled as the purchaser. `entity_type` said 'organization' for
-- every one, so the shape guard could not catch it.
--
-- Note the asymmetry, which is deliberate: a personal name is SUSPICIOUS on the
-- purchase tier (as likely a broker or signatory as an owner) but LEGITIMATE on
-- the domain_true_owner tier, which is the curated owner-of-record — a clinic
-- really can be owned by "Surinder Mann" or the "Chao T & Chen T L Liu Trust".
create or replace function public.lcc_owner_name_is_brokerage(p_name text)
returns boolean language sql immutable as $$
  select coalesce(p_name,'') ~* '(\mnorthmarq\M|\mcbre\M|\mjll\M|\mcolliers\M|\mnewmark\M|cushman|marcus\s*&?\s*millichap|\mmatthews\M|berkadia|\mhanley\M|capital pacific|\mnai\M|stream realty|kw commercial|avison|stan johnson|\msjc\M|coldwell banker|\mkeller williams\M|\mmarcus\M|peerrealty|\bsperry\b|\mlee\s*&\s*associates\M|\mcresa\M|\msvn\M|\mtranswestern\M)';
$$;

create or replace function public.lcc_owner_name_has_org_marker(p_name text)
returns boolean language sql immutable as $$
  select coalesce(p_name,'') ~* '(\m(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co|lp|llp|ltd|limited|trust|dst|reit|holdings|properties|property|partners|partnership|realty|capital|group|ventures|associates|enterprises|investments|investment|fund|bank|assn|association|church|center|centre|university|hospital|authority|district|management|equities|estates|development|developers)\M)'
      or coalesce(p_name,'') ~ '[0-9]';
$$;

-- The review view and the feeder were re-created with:
--   ... and not public.lcc_owner_name_is_brokerage(owner_name)
--   and (tier <> 3 or public.lcc_owner_name_has_org_marker(owner_name))
-- (applied live 2026-08-15; see the live definitions, which are authoritative).

-- ── OPERATOR FLAG FIX AT SOURCE (not a competing name test) ─────────────────
-- The dry-run also surfaced "Satellite Dialysis" as a proposed owner. CLAUDE.md
-- is explicit: use `dia.true_owners.is_operator_not_owner`; NEVER write a second
-- name-based operator test, or the two definitions drift. Investigating showed
-- this was a FLAG-COVERAGE GAP, not a judgement call: "Satellite Healthcare"
-- (56 properties) was already flagged true, while its sibling rows for the same
-- operator were NULL. Fixed at source in dia, then propagated into
-- `lcc_owner_operator_block` BY ID via external_identities:
--
--   -- dia (zqzrriwuavgrquhisnoa), reversible by setting these back to NULL:
--   update public.true_owners set is_operator_not_owner = true
--    where true_owner_id in ('b31fb50e-65b5-43b1-8028-4b6a470a6f9d',   -- Satellite Dialysis (15 props)
--                            '84b2994d-3f7e-4c4c-902e-671ecd1f8ef0',   -- SATELLITE DIALYSIS CENTERS INC
--                            '09b86f32-c841-4501-b195-04f17d820b03');  -- Satellite Healthcare, Inc.
--
-- After the guards + the flag fix: 0 operator-ish and 0 brokerage names remain
-- in the eligible set.
--
-- ── APPLIED 2026-08-15, batch `supersede_20260815` ─────────────────────────
--   eligible / written          418   (293 domain_true_owner · 124 latest purchase · 1 other)
--   ledger rows                 418   (reconciles exactly with lcc_property_owner.source='supersession')
--   re-run                        0   (idempotent)
--   review view                 323 assets (236 ties · 59 person · 18 brokerage · 10 no-org-marker)
--   assets with a resolved owner   1,910 -> 2,294  (49.2% -> 59.0%)
--   owner entities                 1,118 -> 1,420
--   reachable_hero_effective         228 -> 262
--
-- Reconciliation note: the asset count rose 384 while 418 rows were written —
-- the other 34 target entities are `entity_type='asset'` with a **NULL domain**,
-- so `v_lcc_owner_reachability` (which filters `domain in ('dia','gov')`) does
-- not count them. 384 + 34 = 418. Those domain-less assets are a separate
-- hygiene item, logged in connectivity-and-open-threads.md.
