-- ============================================================================
-- A2 — APPLY the 380 `agrees` ownership chains. Make the lane complete a task.
--      (2026-08-27). LCC Opps (xengecqvemvfknjvbvrq).
--
-- A1 split `establish_ownership_history` into four jobs. `agrees` (380 tasks /
-- 360 owners / 450 links / $714.7M) is the one that is not a question: the
-- drafted chain's last recorded grantee IS the owner we already hold
-- (`terminates_at_current_owner = true`), so the chain CORROBORATES current
-- state. Nothing about it needs a human, and A1 deliberately kept it off the
-- operator badge. This migration is its consumer.
--
-- The lane has completed 0 tasks in 69 days. That -- not rows written, not a
-- view existing -- is the acceptance test:
--   select count(*) from research_tasks
--    where research_type='establish_ownership_history' and status='completed';
--
-- ---------------------------------------------------------------------------
-- WHY SQL AND NOT A RAILWAY TICK
-- ---------------------------------------------------------------------------
-- Everything A2 needs is already in LCC Opps: the bucket is A1's view, the
-- links are `lcc_clean_assist_proposals.proposed_link->'links'` (P131 wrote
-- them), and the parties resolve against `entities`. No gov read happens at
-- apply time. A migration ships INSTANTLY while the JS that reads it does not
-- (CLAUDE.md, P131/P135/P136) -- so a SQL applier can be hand-run and MEASURED
-- the day it lands, and its cron calls the function directly the way crons 103
-- and 144 already do, with no deploy on the critical path.
--
-- ---------------------------------------------------------------------------
-- WHAT A LINK LICENSES, AND WHAT IT DOES NOT
-- ---------------------------------------------------------------------------
-- A link is `<grantor> --(date)--> <grantee>`. It licenses exactly ONE portfolio
-- fact: the GRANTOR owned this property UNTIL `date`.
--
--   * `ownership_end_date` = the link's transfer date. NEVER NULL.
--     `lcc_entity_portfolio_facts.is_current` is GENERATED ALWAYS as
--     (ownership_end_date IS NULL), so a fact written without an end date would
--     read as a CURRENT owner and corrupt every surface that ranks on
--     `is_current` (lcc_owner_known_annual_rent, the priority queue, Tier 0).
--     Every row this function writes carries an end date or it is not written.
--   * `ownership_start_date` = the PREVIOUS link's date, and ONLY when the
--     previous link handed off to this one (`gap_before = false`). At a gap the
--     start is NOT ON FILE and stays NULL -- P131's whole doctrine is that a
--     break is REPORTED, never bridged.
--   * The GRANTEE of the last link is the CURRENT owner. Its end date is
--     unknown-because-open, so it is not ours to write; it already has an
--     `is_current` fact. Grantees before a gap have an UNKNOWN end date and are
--     deliberately NOT written -- writing NULL would claim they still own it,
--     and writing the next link's date would bridge the gap.
--   * `annual_rent` / `sale_price` stay NULL. The link's price is what the
--     grantor EXITED at, not what they paid; a fact the record does not state
--     stays blank.
--
-- One fact per link. 450 links -> at most 450 historical facts.
--
-- ---------------------------------------------------------------------------
-- IDENTITY: THE MEASUREMENT THAT SHAPED THIS
-- ---------------------------------------------------------------------------
-- The record carries an ID for the GRANTEE of a transfer
-- (`v_ownership_transitions_portfolio.new_owner_true_owner_id`, name-verified)
-- and NO id at all for the grantor. Measured over the 450 `agrees` links:
-- only **9** grantors are resolvable ID-to-ID as the previous link's grantee
-- (380 links are first-of-chain, 61 follow a gap). An ID-only path therefore
-- delivers 9 facts out of 450 and answers none of what the lane is for -- the
-- lane's gap is literally `owner_links <= 1`, i.e. the PRIOR owner.
--
-- So the grantor is resolved BY NAME, and the comparator is the narrowest one
-- this repo sanctions:
--
--   `lcc_ownership_chain_name_key(text)` = lower() THEN strip non-alphanumerics.
--
--   * lower() BEFORE the character-class strip. `regexp_replace(x,'[^a-z0-9]','','g')`
--     carries no `i` flag, so applied to raw text it DELETES every capital and
--     every ALL-CAPS name collapses to ''. That footgun shipped a 32.6% finding
--     that was really 0.8% (CLAUDE.md). It is also the exact rule
--     `ownership-chain-draft-planner.js::chainNameKey` already uses to decide
--     chain continuity, so the applier and the drafter compare names the SAME way.
--   * It strips NO meaning-bearing token and does NOT sort tokens. That rules
--     out `lcc_normalize_entity_name` (banned for identity: "Century Park
--     Partners" == "Century Park Properties LLC") and `lcc_owner_strict_core`.
--
-- ⚠️ `lcc_owner_strict_core` WAS TRIED HERE AND IS WRONG FOR THIS GATE, VERIFIED
-- ON NAMED ROWS. It drops tokens shorter than 2 chars and sorts the rest, so:
--     BAMMF (8) LLC        == BAMMF (3) LLC == BAMMF (9) LLC == BAMMF (S) LLC
--     F R M ASSOCIATES LLC == G B A Associates == J/4 Associates
--                          == M.O.B. I ASSOCIATES, L.L.C.   (core: "associates")
-- Four different SPEs and four different firms, each collapsing to one core. It
-- matched 393 of 396 distinct grantors against SOME entity, which is the kind of
-- implausibly clean number that is a bug signal, not a finding (P182). The
-- name-key matches 378 and, sampled, the matches are byte-identical names.
--
-- Resolution is UNAMBIGUOUS-ONLY: exactly one LIVE entity may carry the key.
-- Measured -- 365 of 450 links resolve, 54 are ambiguous, 31 have no entity.
--
-- ⚠️ AND THE 291 ENTITIES THIS LANDS ON WERE MINTED BY A PRODUCER WITH NO
-- CONSUMER. 291 of the 331 unambiguously-matched grantors carry
-- `metadata.source = 'r9_chain_connect'`: `/api/chain-connect-tick` (cron 104,
-- every 30 min) reads the SAME `v_lcc_ownership_chain_completeness`, pulls the
-- SAME gov `ownership_history` prior/new owner names, and mints an entity per
-- name via `ensureEntityLink` -- and then attaches it to NOTHING. It never
-- writes a portfolio fact, so `owner_links` never grows, `chain_complete` stays
-- false, and the property is re-scanned forever. By that feeder's own retire
-- predicate ("a minted entity with no evidence and no portfolio fact has no
-- consumer"), those 291 were retirable. A2 is the missing consumer, and this is
-- why resolution lands so high: the parties were already there, unattached.
--
-- A2 NEVER MINTS. `ensureEntityLink` resolves on `normalizeCanonicalName`, which
-- strips group|partners|company|co -- the banned-for-identity family -- so
-- minting through it could attach a chain to a different firm. r9_chain_connect
-- is the minting producer and it already ran; the 31 unmatched names are the
-- ones its guards skipped or it has not reached. They are reported, not guessed.
--
-- ---------------------------------------------------------------------------
-- SEED PREDICATE -- WHAT RE-CREATES A COMPLETED TASK (P176)
-- ---------------------------------------------------------------------------
-- `lcc_generate_chain_research_tasks` (cron 144, 05:10) seeds from
-- `v_ownership_chain_worklist` and excludes a property only when it carries an
-- OPEN task or a TERMINAL skip -- **`completed` is not excluded**. So marking a
-- task complete is NOT by itself enough to stop the re-mint.
--
-- What stops it is the FACT. `v_ownership_chain_worklist.suggested_research_type`
-- is `establish_ownership_history` only while `missing_segments` reads
-- `no_prior_owners_recorded`, i.e. while `owner_links <= 1`. One historical fact
-- takes owner_links to >= 2, the suggestion flips to
-- `trace_ownership_to_developer`, and this lane can no longer be seeded for that
-- property.
--
-- ⚠️ THE COROLLARY IS THE COMPLETION RULE: a task completed WITHOUT a fact WOULD
-- be re-seeded tomorrow -- silent churn that reads as a completion. Hence: a
-- task is completed only when every one of its links reached a terminal GOOD
-- disposition (inserted / already present / start filled) and none is blocked or
-- conflicted. 57 of the 380 have no resolvable grantor and STAY OPEN.
--
-- Where those 323 properties go next is `trace_ownership_to_developer`, which is
-- a LIVE lane (40 completed / 18 open), not another dead one.
--
-- ---------------------------------------------------------------------------
-- FILL-BLANKS, AND THE CONFLICT THAT IS NOT OURS TO RESOLVE
-- ---------------------------------------------------------------------------
-- An existing fact is never overwritten. A fact that CONTRADICTS the chain is
-- surfaced and the task stays open (`v_lcc_ownership_chain_apply_conflict`):
--   * existing fact reads CURRENT (end date NULL) while the chain says they
--     conveyed on a date -- deleting or end-dating it would resolve toward one
--     side of a genuine disagreement, which is the P175a mistake that would have
--     dropped $1.7M of live rent.
--   * existing end/start date differs from the chain's.
-- Measured today: 0 conflicts, 0 already-present, 365 genuinely new. The handling
-- exists for re-runs and for the days after.
--
-- ---------------------------------------------------------------------------
-- HONEST COUNTS
-- ---------------------------------------------------------------------------
-- Read `facts_inserted` and `tasks_completed`. `links_already_present` is a
-- re-discovery tally that reads exactly like throughput (P159a) and on a correct
-- quiet re-run it is the WHOLE population against 0 written.
--
-- REVERSAL:  select lcc_a2_unapply_ownership_chains('<batch_tag>');
-- Full teardown at the foot of this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The identity comparator for this gate. ONE owner, IMMUTABLE so it can back
--    a functional index.
-- ---------------------------------------------------------------------------
create or replace function lcc_ownership_chain_name_key(p_name text)
returns text
language sql
immutable
set search_path to 'public','pg_temp'
as $$
  -- lower() FIRST. See the header: the reverse deletes every capital letter.
  select regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]', '', 'g');
$$;

comment on function lcc_ownership_chain_name_key(text) is
  'A2/P131 identity key for ownership-chain parties: lower() then strip non-alphanumerics. '
  'Strips NO meaning-bearing token and does NOT sort tokens, so it is safe for identity where '
  'lcc_normalize_entity_name and lcc_owner_strict_core are not. Mirrors chainNameKey() in '
  'api/_shared/ownership-chain-draft-planner.js so the applier and the drafter compare names alike.';

-- The partial predicate is stated by every query below, so the planner can use
-- the index (P118: a partial index the query cannot IMPLY is never chosen).
create index if not exists idx_entities_ownership_chain_name_key
  on entities (lcc_ownership_chain_name_key(name))
  where merged_into_entity_id is null;

-- ---------------------------------------------------------------------------
-- 2. A NARROW placeholder guard, scoped to this gate.
--
-- `Previous Owner` appears as a grantor in the gov ownership feed and is caught
-- by NEITHER shared guard: `lcc_is_placeholder_owner_name` lists 'current owner'
-- but not 'previous owner', and the JS `isPlaceholderOwnerName` matches bare
-- buyer/seller/escrow and unknown-owner but not this. Today it costs nothing --
-- no entity carries that name, so it fails to resolve anyway -- but that is
-- luck, not a guard, and two live entities are literally named "Unknown".
--
-- Narrow and gate-scoped on purpose (the `lcc_p131_is_document_row_label`
-- precedent). It is NOT exported into the shared guards: there a false positive
-- deletes a real owner, here it costs one unwritten link.
-- ---------------------------------------------------------------------------
create or replace function lcc_a2_is_placeholder_party(p_name text)
returns boolean
language sql
immutable
set search_path to 'public','pg_temp'
as $$
  select p_name is null
      or btrim(p_name) = ''
      or lcc_is_placeholder_owner_name(p_name)
      or lcc_owner_name_is_junk(p_name)
      -- ANCHORED PREFIX, not an exact match. The first cut of this list matched
      -- exact keys only and the live apply proved that insufficient within one
      -- run: the gov feed decorates the placeholder, so `Previous Owner` was
      -- blocked while `Previous Owner Name`, `Previous Owner Name Unknown` and
      -- `Previous Owner LLC` sailed through and took 13 portfolio facts with
      -- them. An exact-match stoplist is defeated by a decorated placeholder.
      -- Anchored, so a real firm is never swallowed by a substring: blast radius
      -- measured over all 62,356 live entities = exactly 3 rows, all three of
      -- them those placeholders, and NONE holding a current portfolio fact
      -- (the P158a rule: measure the widening before shipping it).
      or regexp_replace(lower(p_name), '[^a-z0-9]', '', 'g')
           ~ '^(previous|prior|former|original)owner'
      or regexp_replace(lower(p_name), '[^a-z0-9]', '', 'g') in (
           'ownerofrecord','grantor','grantee','seedeed','notonfile',
           'unknownowner','variousowners','unknown'
         );
$$;

-- ---------------------------------------------------------------------------
-- 3. THE PLAN. One row per link of an `agrees` task.
--
-- ⚠️ The bucket is read from A1's `action` column. It is NOT re-derived here --
-- no `terminates_at_current_owner` test, no `reason ilike`. A JS/SQL copy of a
-- classifier is the normaliser drift this repo has paid for a dozen times (P134
-- re-derived a view's GROUP BY and got 150 members for a 2-member group).
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` is append-only for columns (42P16 on a mid-list
-- insert), so a re-run over an older shape of this view must drop it first.
-- Its dependents are recreated further down this same file.
drop view if exists v_lcc_ownership_chain_apply_blocked;
drop view if exists v_lcc_ownership_chain_apply_conflict;
drop view if exists v_lcc_ownership_chain_apply_owner_start_plan;
drop view if exists v_lcc_ownership_chain_apply_plan;

create view v_lcc_ownership_chain_apply_plan as
with agrees as (
  select s.research_task_id, s.workspace_id, s.entity_id as task_entity_id,
         case lower(coalesce(s.domain,''))
           when 'dialysis' then 'dia' when 'government' then 'gov'
           else lower(coalesce(s.domain,'')) end          as source_domain,
         s.source_record_id::text                          as source_property_id,
         s.proposal_id, s.priority, s.address, s.current_owner_name
  from v_lcc_ownership_history_lane_split s
  where s.action = 'agrees'
),
lk as (
  select a.*,
         l.ord::int                                        as link_ord,
         count(*) over (partition by a.research_task_id)    as chain_links,
         l.link->>'from'                                    as grantor_name,
         l.link->>'to'                                      as grantee_name,
         nullif(l.link->>'date','')::date                   as transfer_date,
         coalesce((l.link->>'gap_before')::boolean, false)   as gap_before,
         nullif(l.link->'citation'->>'ownership_id','')      as ownership_id,
         l.link->'citation'->>'data_source'                  as data_source,
         lag(nullif(l.link->>'date','')::date)
           over (partition by a.research_task_id order by l.ord) as prev_transfer_date
  from agrees a
  join lcc_clean_assist_proposals p on p.proposal_id = a.proposal_id
  cross join lateral jsonb_array_elements(coalesce(p.proposed_link->'links','[]'::jsonb))
       with ordinality as l(link, ord)
),
keyed as (
  select lk.*, lcc_ownership_chain_name_key(lk.grantor_name) as grantor_key
  from lk
),
matched as (
  select k.*, m.n_entities, m.only_entity
  from keyed k
  left join lateral (
    -- min(uuid) does not exist in Postgres; order the agg so the pick is deterministic.
    select count(*)::int as n_entities, (array_agg(e.id order by e.id))[1] as only_entity
    from entities e
    where e.merged_into_entity_id is null          -- implies the partial index
      and k.grantor_key <> ''
      and lcc_ownership_chain_name_key(e.name) = k.grantor_key
  ) m on true
),
resolved as (
  select m.*,
         -- Existence is not liveness (P175). Resolve to the terminal survivor
         -- even though the candidate was already filtered live: a merge landing
         -- between the read and the write must not strand the fact on a
         -- tombstone, and a tombstoned survivor is refused outright.
         case when m.n_entities = 1
              then (select sv.id from entities sv
                     where sv.id = lcc_entity_survivor(m.only_entity)
                       and sv.merged_into_entity_id is null)
         end as grantor_entity_id,
         case when m.gap_before then null else m.prev_transfer_date end as plan_start_date
  from matched m
),
graded as (
  select r.*,
    case
      when lcc_a2_is_placeholder_party(r.grantor_name)     then 'placeholder'
      when lcc_owner_name_is_brokerage(r.grantor_name)     then 'brokerage_is_agent_not_principal'
      when r.transfer_date is null                         then 'undated_link'
      when r.ownership_id  is null                         then 'uncited_link'
      when coalesce(r.n_entities,0) = 0                    then 'no_entity'
      when r.n_entities > 1                                then 'ambiguous_entity'
      when r.grantor_entity_id is null                     then 'survivor_unresolved'
      else 'resolved'
    end as resolution0
  from resolved r
),
-- ⚠️ THE PK IS (entity_id, source_domain, source_property_id) -- ONE interval per
-- (party, property). Two links naming the same grantor on the same property
-- cannot both be stored, and `on conflict do nothing` would drop one SILENTLY
-- while the run still reported both as written. That is what the first live
-- apply did: 365 planned, 347 actually written, and the difference invisible.
--
-- They are not repeat ownership. Read on named rows, all 14 pairs are ONE
-- conveyance recorded several times -- `SENTINEL SQUARE I -> WASHINGTON DC VI
-- FGF` on 2020-02, 2020-03 AND 2020-04; `WASHINGTON OFFICE CENTER -> WOC LLC`
-- across three dates -- i.e. the `gsa_lease_diff` lessor-field flicker P138
-- documented, surviving the drafter's (from, to, date) dedup because the DATE
-- differs. Several are also missed name variants (`MILLENIUM TOWER` ->
-- `MILLENNIUM TOWER CORPORATION`, `SP PLAZA LLC` -> `S.P. PLAZA, L.C.`), which
-- the P138 is_name_variant guard only catches as a strict prefix extension.
--
-- Picking the earliest date would be a guess about which record is real, so the
-- pair is BLOCKED and surfaced with its alternate dates. Never guess.
paired as (
  select g.*,
         case when g.grantor_entity_id is null then 1
              else count(*) over (partition by g.grantor_entity_id, g.source_domain,
                                               g.source_property_id) end as pair_links
  from graded g
)
select
  g.research_task_id, g.workspace_id, g.task_entity_id, g.priority,
  g.source_domain, g.source_property_id, g.address, g.current_owner_name,
  g.link_ord, g.chain_links, g.grantor_name, g.grantee_name, g.grantor_key,
  g.transfer_date, g.gap_before, g.ownership_id, g.data_source,
  g.n_entities, g.grantor_entity_id, g.pair_links,
  case when g.resolution0 = 'resolved' and g.pair_links > 1
       then 'repeat_transfer_unrepresentable' else g.resolution0 end as resolution,
  g.plan_start_date                       as proposed_start_date,
  g.transfer_date                         as proposed_end_date,
  f.ownership_start_date                  as existing_start_date,
  f.ownership_end_date                    as existing_end_date,
  f.ownership_source                      as existing_source,
  case
    when g.resolution0 <> 'resolved' or g.pair_links > 1               then 'blocked'
    when f.entity_id is null                                           then 'insert'
    when f.ownership_end_date is null                                  then 'conflict_reads_current'
    when f.ownership_end_date <> g.transfer_date                       then 'conflict_end_date_differs'
    when f.ownership_start_date is null and g.plan_start_date is not null then 'fill_start_date'
    when f.ownership_start_date is not null and g.plan_start_date is not null
         and f.ownership_start_date <> g.plan_start_date               then 'conflict_start_date_differs'
    else 'already_present'
  end as disposition
from paired g
left join lcc_entity_portfolio_facts f
  on f.entity_id          = g.grantor_entity_id
 and f.source_domain      = g.source_domain
 and f.source_property_id = g.source_property_id;

grant select on v_lcc_ownership_chain_apply_plan to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The CURRENT owner's acquisition date -- the one fully ID-safe write here.
--
-- `agrees` means the last link's grantee IS the current owner, so that link's
-- date is when they acquired it. The entity comes from
-- `v_lcc_ownership_chain_completeness.current_owner_entity_id` (an id, not a
-- name match), and a FRESHNESS gate re-checks the live current-owner name
-- against the drafted last grantee: the draft's verdict was recorded days ago,
-- and a verdict recorded before the current state is stale (P121).
--
-- Measured today: 343 already carry exactly this date (the P138-P141 feeder wrote
-- it, corroborating the chain), 9 are blank and fillable, 28 differ.
--
-- A differing start date here is surfaced but does NOT block task completion --
-- the deliverable is the PRIOR-owner history; the current owner's start date is
-- a fill-blank bonus, and blocking 28 completions on it would trade the lane's
-- first-ever drain for a metadata disagreement.
-- ---------------------------------------------------------------------------
create view v_lcc_ownership_chain_apply_owner_start_plan as
with last_link as (
  select distinct on (p.research_task_id)
         p.research_task_id, p.source_domain, p.source_property_id,
         p.grantee_name, p.transfer_date, p.link_ord
  from v_lcc_ownership_chain_apply_plan p
  order by p.research_task_id, p.link_ord desc
)
select
  l.research_task_id, l.source_domain, l.source_property_id,
  l.grantee_name, l.transfer_date              as proposed_start_date,
  c.current_owner_entity_id, c.current_owner_name,
  f.ownership_start_date                        as existing_start_date,
  case
    when c.current_owner_entity_id is null                                   then 'no_current_owner_row'
    when lcc_ownership_chain_name_key(c.current_owner_name)
         is distinct from lcc_ownership_chain_name_key(l.grantee_name)       then 'stale_current_owner'
    when f.entity_id is null                                                 then 'no_current_fact'
    when l.transfer_date is null                                             then 'undated_link'
    when f.ownership_start_date is null                                      then 'fill'
    when f.ownership_start_date = l.transfer_date                            then 'already_matches'
    else 'conflict_start_date_differs'
  end as disposition
from last_link l
left join v_lcc_ownership_chain_completeness c
  on c.source_domain = l.source_domain and c.source_property_id = l.source_property_id
left join lcc_entity_portfolio_facts f
  on f.entity_id = c.current_owner_entity_id
 and f.source_domain = l.source_domain
 and f.source_property_id = l.source_property_id
 and f.is_current;

grant select on v_lcc_ownership_chain_apply_owner_start_plan to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Ledger + run log. The ledger records the PRIOR value of every field it
--    touches, which is what makes a fill-blank reversible rather than merely
--    deletable.
-- ---------------------------------------------------------------------------
create table if not exists lcc_ownership_chain_apply_log (
  apply_id                  bigserial primary key,
  batch_tag                 text        not null,
  applied_at                timestamptz not null default now(),
  reversed_at               timestamptz,
  research_task_id          uuid        not null,
  source_domain             text,
  source_property_id        text,
  link_ord                  int,
  entity_id                 uuid,
  grantor_name              text,
  ownership_id              text,
  -- fact_inserted | fact_start_filled | owner_start_filled | task_completed
  action                    text        not null,
  prior_ownership_start_date date,
  prior_ownership_end_date   date,
  new_ownership_start_date   date,
  new_ownership_end_date     date,
  prior_task_status          text,
  detail                     jsonb
);
create index if not exists idx_a2_apply_log_batch on lcc_ownership_chain_apply_log (batch_tag);
create index if not exists idx_a2_apply_log_task  on lcc_ownership_chain_apply_log (research_task_id);

comment on table lcc_ownership_chain_apply_log is
  'A2 reversal ledger: one row per write. Reverse with lcc_a2_unapply_ownership_chains(batch_tag).';

create table if not exists lcc_ownership_chain_apply_run (
  run_id                bigserial primary key,
  batch_tag             text,
  ran_at                timestamptz not null default now(),
  dry_run               boolean     not null,
  trigger_source        text,
  tasks_considered      int,
  links_considered      int,
  -- THROUGHPUT. Quote these two.
  facts_inserted        int,
  tasks_completed       int,
  -- Everything below is state, not throughput.
  facts_start_filled    int,
  owner_start_filled    int,
  links_already_present int,   -- re-discovery tally; reads like throughput (P159a)
  links_blocked         int,
  links_conflicted      int,
  tasks_left_open       int,
  blocked_by            jsonb,
  conflicts_by          jsonb
);

comment on column lcc_ownership_chain_apply_run.links_already_present is
  'Re-discovery tally, NEVER throughput. On a correct quiet re-run this is the whole population '
  'against facts_inserted = 0.';

-- ---------------------------------------------------------------------------
-- 6. THE APPLIER. Dry-run by default.
--
--    p_limit bounds TASKS, never links: a task is applied atomically (all of its
--    links or none), because the completion rule is "every link terminal-good"
--    and a half-applied chain would be completed on a partial reading.
-- ---------------------------------------------------------------------------
create or replace function lcc_a2_apply_ownership_chains(
  p_dry_run        boolean default true,
  p_batch          text    default null,
  p_limit          int     default null,
  p_trigger_source text    default 'manual'
) returns jsonb
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_batch   text := coalesce(p_batch, 'a2-chain-' || to_char(now(),'YYYYMMDDHH24MISS'));
  v_out     jsonb;
  v_tasks   int; v_links int;
  v_ins     int := 0; v_fill int := 0; v_ownfill int := 0;
  v_present int; v_blocked int; v_conflict int;
  v_done    int := 0; v_open int;
  v_blockedby jsonb; v_conflictsby jsonb;
begin
  -- `on commit drop` frees these at COMMIT, so two calls inside one transaction
  -- would collide on the name. Drop first so a dry-run-then-apply pair in one
  -- statement batch works.
  drop table if exists _a2_tasks;
  drop table if exists _a2_plan;
  drop table if exists _a2_owner;
  drop table if exists _a2_completable;

  -- The task slice, value-ranked (priority was stamped by P179).
  create temp table _a2_tasks on commit drop as
  select distinct research_task_id, priority
  from v_lcc_ownership_chain_apply_plan
  order by priority asc nulls last, research_task_id
  limit case when p_limit is null or p_limit <= 0 then null else p_limit end;

  create temp table _a2_plan on commit drop as
  select p.* from v_lcc_ownership_chain_apply_plan p
  join _a2_tasks t on t.research_task_id = p.research_task_id;

  create temp table _a2_owner on commit drop as
  select o.* from v_lcc_ownership_chain_apply_owner_start_plan o
  join _a2_tasks t on t.research_task_id = o.research_task_id;

  select count(distinct research_task_id), count(*) into v_tasks, v_links from _a2_plan;
  select count(*) filter (where disposition = 'already_present'),
         count(*) filter (where disposition = 'blocked'),
         count(*) filter (where disposition like 'conflict%')
    into v_present, v_blocked, v_conflict
  from _a2_plan;

  select coalesce(jsonb_object_agg(resolution, n), '{}'::jsonb) into v_blockedby
  from (select resolution, count(*) n from _a2_plan where disposition='blocked' group by 1) z;
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_conflictsby
  from (
    select disposition k, count(*) n from _a2_plan where disposition like 'conflict%' group by 1
    union all
    select 'owner_start_' || disposition, count(*) from _a2_owner
     where disposition = 'conflict_start_date_differs' group by disposition
  ) z;

  -- A task completes only when EVERY link is terminal-good. Anything blocked or
  -- conflicted keeps it open -- and, per the header, a task completed without a
  -- fact would simply be re-seeded by cron 144 tomorrow.
  create temp table _a2_completable on commit drop as
  select research_task_id
  from _a2_plan
  group by research_task_id
  having bool_and(disposition in ('insert','already_present','fill_start_date'));

  if p_dry_run then
    select count(*) filter (where disposition='insert'),
           count(*) filter (where disposition='fill_start_date')
      into v_ins, v_fill from _a2_plan;
    select count(*) filter (where disposition='fill') into v_ownfill from _a2_owner;
    select count(*) into v_done from _a2_completable;
    v_out := jsonb_build_object(
      'mode','dry_run', 'batch_tag', v_batch,
      'tasks_considered', v_tasks, 'links_considered', v_links,
      'facts_would_insert', v_ins, 'tasks_would_complete', v_done,
      'facts_start_would_fill', v_fill, 'owner_start_would_fill', v_ownfill,
      'links_already_present', v_present,
      'links_blocked', v_blocked, 'blocked_by', v_blockedby,
      'links_conflicted', v_conflict, 'conflicts_by', v_conflictsby,
      'tasks_would_stay_open', v_tasks - v_done);
    insert into lcc_ownership_chain_apply_run
      (batch_tag, dry_run, trigger_source, tasks_considered, links_considered,
       facts_inserted, tasks_completed, facts_start_filled, owner_start_filled,
       links_already_present, links_blocked, links_conflicted, tasks_left_open,
       blocked_by, conflicts_by)
    values (v_batch, true, p_trigger_source, v_tasks, v_links, v_ins, v_done, v_fill,
            v_ownfill, v_present, v_blocked, v_conflict, v_tasks - v_done,
            v_blockedby, v_conflictsby);
    return v_out;
  end if;

  -- ---- WRITE 1: the historical facts ---------------------------------------
  -- ownership_end_date is NOT NULL by construction (disposition='insert' implies
  -- resolution='resolved' implies transfer_date is not null).
  -- The ledger is fed from the RETURNING set, never from the plan: `on conflict
  -- do nothing` means intent and effect can differ, and a ledger that records
  -- intent would claim a reversal is possible for a row nobody wrote.
  with ins as (
    insert into lcc_entity_portfolio_facts
      (entity_id, source_domain, source_property_id,
       ownership_start_date, ownership_end_date, ownership_source, updated_at)
    select p.grantor_entity_id, p.source_domain, p.source_property_id,
           p.proposed_start_date, p.proposed_end_date,
           'gov_ownership_chain:' || p.ownership_id, now()
    from _a2_plan p
    where p.disposition = 'insert'
    on conflict (entity_id, source_domain, source_property_id) do nothing
    returning entity_id, source_domain, source_property_id,
              ownership_start_date, ownership_end_date, ownership_source
  ), lg as (
    -- Exactly one ledger row per INSERTED fact. The join back to the plan is
    -- 1:1 because a repeated (entity, domain, property) is blocked upstream --
    -- but the count comes from `ins`, not from this insert, so the reported
    -- number is what the table received even if that ever stops holding.
    insert into lcc_ownership_chain_apply_log
      (batch_tag, research_task_id, source_domain, source_property_id, link_ord, entity_id,
       grantor_name, ownership_id, action, new_ownership_start_date, new_ownership_end_date, detail)
    select v_batch, p.research_task_id, i.source_domain, i.source_property_id, p.link_ord,
           i.entity_id, p.grantor_name, p.ownership_id, 'fact_inserted',
           i.ownership_start_date, i.ownership_end_date,
           jsonb_build_object('data_source', p.data_source, 'gap_before', p.gap_before,
                              'grantee_name', p.grantee_name)
    from ins i
    join _a2_plan p
      on p.grantor_entity_id = i.entity_id
     and p.source_domain = i.source_domain
     and p.source_property_id = i.source_property_id
     and p.disposition = 'insert'
    returning 1
  )
  select (select count(*) from ins) into v_ins;

  -- ---- WRITE 2: fill a blank start date on an existing historical fact ------
  with upd as (
    update lcc_entity_portfolio_facts f
       set ownership_start_date = p.proposed_start_date, updated_at = now()
    from _a2_plan p
    where p.disposition = 'fill_start_date'
      and f.entity_id = p.grantor_entity_id
      and f.source_domain = p.source_domain
      and f.source_property_id = p.source_property_id
      and f.ownership_start_date is null          -- fill-blanks, re-checked at write
    returning f.entity_id, f.source_domain, f.source_property_id, p.research_task_id,
              p.link_ord, p.grantor_name, p.ownership_id, p.proposed_start_date
  ), lg as (
    insert into lcc_ownership_chain_apply_log
      (batch_tag, research_task_id, source_domain, source_property_id, link_ord, entity_id,
       grantor_name, ownership_id, action, prior_ownership_start_date, new_ownership_start_date)
    select v_batch, u.research_task_id, u.source_domain, u.source_property_id, u.link_ord,
           u.entity_id, u.grantor_name, u.ownership_id, 'fact_start_filled', null, u.proposed_start_date
    from upd u returning 1
  )
  select (select count(*) from upd) into v_fill;

  -- ---- WRITE 3: the current owner's acquisition date ------------------------
  with upd as (
    update lcc_entity_portfolio_facts f
       set ownership_start_date = o.proposed_start_date, updated_at = now()
    from _a2_owner o
    where o.disposition = 'fill'
      and f.entity_id = o.current_owner_entity_id
      and f.source_domain = o.source_domain
      and f.source_property_id = o.source_property_id
      and f.ownership_end_date is null            -- the current fact, never a historical one
      and f.ownership_start_date is null
    returning f.entity_id, f.source_domain, f.source_property_id,
              o.research_task_id, o.proposed_start_date, o.grantee_name
  ), lg as (
    insert into lcc_ownership_chain_apply_log
      (batch_tag, research_task_id, source_domain, source_property_id, entity_id,
       grantor_name, action, prior_ownership_start_date, new_ownership_start_date)
    select v_batch, u.research_task_id, u.source_domain, u.source_property_id, u.entity_id,
           u.grantee_name, 'owner_start_filled', null, u.proposed_start_date
    from upd u returning 1
  )
  select (select count(*) from upd) into v_ownfill;

  -- ---- WRITE 4: COMPLETE THE TASKS -----------------------------------------
  -- This is the deliverable. 450 links written with 380 tasks still open would
  -- mean nothing was consumed.
  with tgt as (
    select c.research_task_id, rt.status::text as prior_status,
           count(*) filter (where p.disposition='insert')             as links_applied,
           count(*) filter (where p.disposition='already_present')    as links_already,
           count(*) filter (where p.disposition='fill_start_date')    as links_filled,
           jsonb_agg(distinct p.ownership_id)                         as citations
    from _a2_completable c
    join research_tasks rt on rt.id = c.research_task_id
    join _a2_plan p on p.research_task_id = c.research_task_id
    where rt.status in ('queued','in_progress')
    group by c.research_task_id, rt.status
  ), upd as (
    update research_tasks rt
       set status = 'completed',
           completed_at = now(),
           updated_at = now(),
           outcome = coalesce(rt.outcome,'{}'::jsonb) || jsonb_build_object(
             'status','applied',
             'reason','ownership_chain_applied',
             'source','a2_ownership_chain',
             'batch', v_batch,
             'links_applied', t.links_applied,
             'links_already_present', t.links_already,
             'links_start_filled', t.links_filled,
             'citation_record','gov.ownership_history',
             'citation_ownership_ids', t.citations)
    from tgt t where t.research_task_id = rt.id
    returning rt.id, t.prior_status, t.links_applied, t.links_already, t.links_filled
  ), lg as (
    insert into lcc_ownership_chain_apply_log
      (batch_tag, research_task_id, action, prior_task_status, detail)
    select v_batch, u.id, 'task_completed', u.prior_status,
           jsonb_build_object('links_applied', u.links_applied,
                              'links_already_present', u.links_already,
                              'links_start_filled', u.links_filled)
    from upd u returning 1
  )
  select (select count(*) from upd) into v_done;

  v_open := v_tasks - v_done;

  insert into lcc_ownership_chain_apply_run
    (batch_tag, dry_run, trigger_source, tasks_considered, links_considered,
     facts_inserted, tasks_completed, facts_start_filled, owner_start_filled,
     links_already_present, links_blocked, links_conflicted, tasks_left_open,
     blocked_by, conflicts_by)
  values (v_batch, false, p_trigger_source, v_tasks, v_links, v_ins, v_done, v_fill,
          v_ownfill, v_present, v_blocked, v_conflict, v_open, v_blockedby, v_conflictsby);

  return jsonb_build_object(
    'mode','apply', 'batch_tag', v_batch,
    'tasks_considered', v_tasks, 'links_considered', v_links,
    'facts_inserted', v_ins, 'tasks_completed', v_done,
    'facts_start_filled', v_fill, 'owner_start_filled', v_ownfill,
    'links_already_present', v_present,
    'links_blocked', v_blocked, 'blocked_by', v_blockedby,
    'links_conflicted', v_conflict, 'conflicts_by', v_conflictsby,
    'tasks_left_open', v_open);
end $$;

-- ---------------------------------------------------------------------------
-- 7. REVERSAL. Restores prior values rather than only deleting, because two of
--    the three writes are fill-blanks.
-- ---------------------------------------------------------------------------
create or replace function lcc_a2_unapply_ownership_chains(p_batch text)
returns jsonb
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare v_del int := 0; v_start int := 0; v_own int := 0; v_task int := 0;
begin
  -- Facts we inserted. The ownership_source guard means a row another writer has
  -- since re-sourced is left alone rather than silently deleted.
  with d as (
    delete from lcc_entity_portfolio_facts f
    using lcc_ownership_chain_apply_log l
    where l.batch_tag = p_batch and l.action = 'fact_inserted' and l.reversed_at is null
      and f.entity_id = l.entity_id
      and f.source_domain = l.source_domain
      and f.source_property_id = l.source_property_id
      and f.ownership_source = 'gov_ownership_chain:' || l.ownership_id
    returning 1
  ) select count(*) into v_del from d;

  with u as (
    update lcc_entity_portfolio_facts f
       set ownership_start_date = l.prior_ownership_start_date, updated_at = now()
    from lcc_ownership_chain_apply_log l
    where l.batch_tag = p_batch and l.action = 'fact_start_filled' and l.reversed_at is null
      and f.entity_id = l.entity_id
      and f.source_domain = l.source_domain
      and f.source_property_id = l.source_property_id
      and f.ownership_start_date = l.new_ownership_start_date
    returning 1
  ) select count(*) into v_start from u;

  with u as (
    update lcc_entity_portfolio_facts f
       set ownership_start_date = l.prior_ownership_start_date, updated_at = now()
    from lcc_ownership_chain_apply_log l
    where l.batch_tag = p_batch and l.action = 'owner_start_filled' and l.reversed_at is null
      and f.entity_id = l.entity_id
      and f.source_domain = l.source_domain
      and f.source_property_id = l.source_property_id
      and f.ownership_start_date = l.new_ownership_start_date
    returning 1
  ) select count(*) into v_own from u;

  with u as (
    update research_tasks rt
       set status = coalesce(l.prior_task_status,'queued')::research_status,
           completed_at = null, updated_at = now(),
           outcome = rt.outcome - 'status' - 'reason' - 'source' - 'batch'
                     - 'links_applied' - 'links_already_present' - 'links_start_filled'
                     - 'citation_record' - 'citation_ownership_ids'
    from lcc_ownership_chain_apply_log l
    where l.batch_tag = p_batch and l.action = 'task_completed' and l.reversed_at is null
      and rt.id = l.research_task_id
      and rt.outcome->>'batch' = p_batch
    returning 1
  ) select count(*) into v_task from u;

  update lcc_ownership_chain_apply_log set reversed_at = now()
   where batch_tag = p_batch and reversed_at is null;

  return jsonb_build_object('batch_tag', p_batch, 'facts_deleted', v_del,
    'fact_starts_restored', v_start, 'owner_starts_restored', v_own,
    'tasks_reopened', v_task);
end $$;

-- ---------------------------------------------------------------------------
-- 8. The two residue surfaces. Neither is auto-resolved.
-- ---------------------------------------------------------------------------

-- Conflicts: the chain disagrees with a fact already on file. Never resolved
-- automatically -- resolving toward either side is the P175a mistake.
create view v_lcc_ownership_chain_apply_conflict as
select 'historical_fact'::text as scope, p.research_task_id, p.source_domain,
       p.source_property_id, p.address, p.grantor_name as party_name,
       p.grantor_entity_id as entity_id, p.disposition as conflict,
       p.proposed_start_date, p.proposed_end_date,
       p.existing_start_date, p.existing_end_date, p.existing_source,
       p.ownership_id
from v_lcc_ownership_chain_apply_plan p
where p.disposition like 'conflict%'
union all
select 'current_owner', o.research_task_id, o.source_domain, o.source_property_id,
       null, o.current_owner_name, o.current_owner_entity_id, o.disposition,
       o.proposed_start_date, null, o.existing_start_date, null, null, null
from v_lcc_ownership_chain_apply_owner_start_plan o
where o.disposition = 'conflict_start_date_differs';

grant select on v_lcc_ownership_chain_apply_conflict to anon, authenticated, service_role;

-- Blocked: a link A2 cannot apply, with the reason and (for ambiguity) the rival
-- entity names. Ambiguity here is LCC holding duplicate entities, not two
-- different companies -- measured 2026-08-27, the ambiguous set is dominated by
-- case-variant pairs (`Duke Realty Limited Partnership` /
-- `DUKE REALTY LIMITED PARTNERSHIP`). Merging them unblocks the link; A2 never
-- picks a winner (P195: a byte-identical name is a merge question, not a licence).
create view v_lcc_ownership_chain_apply_blocked as
select p.research_task_id, p.source_domain, p.source_property_id, p.address,
       p.link_ord, p.grantor_name, p.grantor_key, p.grantee_name, p.transfer_date,
       p.resolution as blocked_reason, p.n_entities, p.pair_links,
       case when p.resolution = 'ambiguous_entity' then (
         select array_agg(e.name order by e.id) from entities e
         where e.merged_into_entity_id is null
           and lcc_ownership_chain_name_key(e.name) = p.grantor_key
       ) end as rival_entity_names,
       -- For a repeat pair: the other dates the SAME conveyance was recorded on,
       -- so the flicker is visible without re-deriving the grouping.
       case when p.resolution = 'repeat_transfer_unrepresentable' then (
         select array_agg(q.transfer_date order by q.transfer_date)
         from v_lcc_ownership_chain_apply_plan q
         where q.grantor_entity_id = p.grantor_entity_id
           and q.source_domain = p.source_domain
           and q.source_property_id = p.source_property_id
       ) end as repeat_transfer_dates,
       lcc_owner_known_annual_rent(p.task_entity_id) as owner_annual_rent
from v_lcc_ownership_chain_apply_plan p
where p.disposition = 'blocked';

grant select on v_lcc_ownership_chain_apply_blocked to anon, authenticated, service_role;

-- Run health. Read `facts_inserted` / `tasks_completed`, never
-- `links_already_present` (P159a).
create or replace view v_lcc_ownership_chain_apply_run_health as
select r.run_id, r.batch_tag, r.ran_at, r.dry_run, r.trigger_source,
       r.tasks_considered, r.links_considered,
       r.facts_inserted, r.tasks_completed,
       r.facts_start_filled, r.owner_start_filled,
       r.links_already_present, r.links_blocked, r.links_conflicted,
       r.tasks_left_open, r.blocked_by, r.conflicts_by,
       (select count(*) from research_tasks t
         where t.research_type = 'establish_ownership_history' and t.status = 'completed')
         as lane_completed_ever
from lcc_ownership_chain_apply_run r
order by r.run_id desc;

grant select on v_lcc_ownership_chain_apply_run_health to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Provenance registration. `lcc_entity_portfolio_facts` carried NO
--    field_source_priority rows at all (pre-existing drift, the class CLAUDE.md
--    records as 35 unranked rows elsewhere). Registering the source A2
--    introduces is the part this change owns; the other writers of this table
--    (gsa_lease_diff, sales_transactions_seller_exit, lcc_property_owner, ...)
--    remain unranked and are named here rather than silently guessed at.
-- ---------------------------------------------------------------------------
insert into field_source_priority (target_table, field_name, source, priority, enforce_mode, notes)
values
  ('lcc.lcc_entity_portfolio_facts','ownership_end_date','gov_ownership_chain',18,'record_only',
   'A2. The end date of a historical ownership interval, taken from a dated gov.ownership_history '
   'transfer surfaced by v_ownership_transitions_portfolio and drafted by P131. Same evidence class '
   'and rung as gov_ownership_transition (18) on lcc.lcc_property_owner/owner_entity_id: the '
   'domain''s own recorded transfer, above an inferred relationship edge and below the curated '
   'current owner. Fill-blanks only; a contradicting fact is surfaced in '
   'v_lcc_ownership_chain_apply_conflict, never overwritten.'),
  ('lcc.lcc_entity_portfolio_facts','ownership_start_date','gov_ownership_chain',18,'record_only',
   'A2. The start of a historical ownership interval, taken from the PREVIOUS link in the same '
   'chain and only where that link handed off (gap_before = false). At a chain gap the start is '
   'Not on file and stays NULL -- never bridged.')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 10. Inert-feature registry (audit 4.4.3): make the state visible.
-- ---------------------------------------------------------------------------
insert into feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
values ('A2_OWNERSHIP_CHAIN_APPLY',
        'Apply the `agrees` ownership chains (A1 split) into lcc_entity_portfolio_facts as historical '
        'ownership and complete the establish_ownership_history tasks they answer.',
        'pg_cron lcc-a2-ownership-chain-apply -> lcc_a2_apply_ownership_chains()',
        null, 'on', null, 'scott',
        'SQL-scheduled, not env-gated: the cron calls the function directly. Pause by '
        'UPDATE cron.job SET active=false WHERE jobname=''lcc-a2-ownership-chain-apply''. '
        'Reverse a batch with lcc_a2_unapply_ownership_chains(batch_tag).')
on conflict (flag) do update set purpose = excluded.purpose, surface = excluded.surface,
  state = excluded.state, notes = excluded.notes;

-- ---------------------------------------------------------------------------
-- 11. THE SCHEDULE (P133/P176). A lane that re-mints nightly needs a sweep, or
--     the one-shot repair becomes a chore repeated silently forever.
--
--     06:49 UTC, cron 244 (jobid on LCC Opps). The ordering is load-bearing:
--       05:10  lcc_generate_chain_research_tasks   seeds new lane rows
--       06:45  lcc-ownership-chain-draft           drafts them (P133)
--       06:49  THIS                                applies + completes them
--     A row seeded tonight is drafted tonight and applied tonight. 06:49 was
--     the first free minute after the drafter (06:46-06:48 leave no headroom
--     for its 100-row batch; 06:50 and 06:52 and 06:55 are taken).
--
--     It calls the function DIRECTLY rather than going through lcc_cron_post,
--     so nothing here depends on a Railway deploy (crons 103 and 144 already
--     do this). The applier is idempotent: on a quiet night every link reads
--     `already_present` and facts_inserted is 0.
-- ---------------------------------------------------------------------------
select cron.schedule('lcc-a2-ownership-chain-apply', '49 6 * * *',
  $cron$select public.lcc_a2_apply_ownership_chains(false, null, null, 'cron')$cron$);

grant execute on function lcc_a2_apply_ownership_chains(boolean,text,int,text) to service_role;
grant execute on function lcc_a2_unapply_ownership_chains(text) to service_role;
grant execute on function lcc_ownership_chain_name_key(text) to anon, authenticated, service_role;
grant execute on function lcc_a2_is_placeholder_party(text) to anon, authenticated, service_role;

-- ============================================================================
-- VERIFICATION GATE
--   select lcc_a2_apply_ownership_chains(true);          -- dry run, no writes
--   select lcc_a2_apply_ownership_chains(false, 'a2-<tag>');
--   select count(*) filter (where status='completed') from research_tasks
--    where research_type='establish_ownership_history';  -- must leave 0
--   select * from v_lcc_ownership_chain_apply_run_health limit 3;
--
-- REVERSAL (data):     select lcc_a2_unapply_ownership_chains('<batch_tag>');
-- REVERSAL (objects):
--   drop view if exists v_lcc_ownership_chain_apply_run_health;
--   drop view if exists v_lcc_ownership_chain_apply_blocked;
--   drop view if exists v_lcc_ownership_chain_apply_conflict;
--   drop view if exists v_lcc_ownership_chain_apply_owner_start_plan;
--   drop view if exists v_lcc_ownership_chain_apply_plan;
--   drop function if exists lcc_a2_unapply_ownership_chains(text);
--   drop function if exists lcc_a2_apply_ownership_chains(boolean,text,int,text);
--   drop function if exists lcc_a2_is_placeholder_party(text);
--   drop index if exists idx_entities_ownership_chain_name_key;
--   drop function if exists lcc_ownership_chain_name_key(text);
--   drop table if exists lcc_ownership_chain_apply_run;
--   drop table if exists lcc_ownership_chain_apply_log;
--   delete from field_source_priority where source='gov_ownership_chain';
--   delete from feature_flags_registry where flag='A2_OWNERSHIP_CHAIN_APPLY';
--   select cron.unschedule('lcc-a2-ownership-chain-apply');
-- ============================================================================
