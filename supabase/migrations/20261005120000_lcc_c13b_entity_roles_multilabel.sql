-- C13b — the owner-role classification, as a SET of labels (2026-09-01)
--
-- Design: docs/architecture/owner-role-classification.md (the whole page).
-- Prompt: docs/claude-code/prompts/done/C13b-owner-role-multilabel.md.
-- Writeup: docs/audits/C13b_OWNER_ROLE_MULTILABEL_2026-09-01.md.
--
-- ⚠️ SUPERSEDES the single-valued shape C13 encoded. Scott, 2026-08-31:
-- "I think these categories can exist multiple iterations per one account."
-- A scalar column picks one label and silently destroys the other on the 946
-- entities that carry two or more, which is exactly the population whose dual
-- status decides whether they are worked as a seller or a buyer prospect.
--
-- STORAGE (§1a): a VIEW over the existing spine. NOT a new table, NOT a second
-- cross-database roll-up, NEVER a stamped column.
--   * DERIVED, not stamped — Scott: "this can change over time and isn't a
--     one-time determination." A view cannot go stale and is not a Class 8
--     chore repeated silently forever.
--   * `lcc_entity_portfolio_facts` IS the cross-DB roll-up already, fed from
--     gov and dia by the existing mirror/sync, so every arm is computable from
--     LCC Opps alone. A second aggregation would drift from the spine the panel
--     and the priority queue already read.
--   * `entities.owner_role` is LEFT IN PLACE. 4,132 entities carry a value and
--     `behavioral_override` (425 live, 379 of them on non-tombstoned rows)
--     reads it. Retiring it is a separate decision.
--   * NOT materialized. Profiled below; the measurement did not demand it.
--
-- ⚠️ CEILING, stated rather than papered over: Scott's answer that
-- `one_off_owner` is "all swimlanes" is the intent, and the spine can express
-- exactly two — `lcc_entity_portfolio_facts.source_domain` is `gov` (9,234) and
-- `dia` (4,885) and nothing else across all 14,119 rows. A role computed off the
-- spine says "all swimlanes" and MEANS gov + dia. That is a ceiling in what LCC
-- INGESTS, not in this classifier. No arm here is domain-scoped.
--
-- NOT DONE, deliberately (§3): no lexical classifier — no arm reads a NAME to
-- decide a role; names appear only in the two existing exclusion guards. No
-- value floor. No one-shot backfill. No change to how a role is CONSUMED (the
-- design page §5) — the mapping onto "has role X" is measured and documented,
-- and no live surface is repointed in this unit. `developer` is READ from the
-- existing gov first-generation classifier, never re-implemented. P0.4 is not
-- touched and was 555 before and after.

-- ---------------------------------------------------------------------------
-- 1. The human-confirmed lane's INPUT store.
-- ---------------------------------------------------------------------------
-- `user_owner` is a human-confirmed lane, not an automated arm (Scott: "fairly
-- infrequent... good with it being a human determination"). At n = 15 candidates
-- reading them is both cheaper and strictly more accurate than any rule, and
-- every name test measured in this arc landed ~25% raw / 7% / 4-of-6 guarded.
--
-- This is an INPUT ledger for a human verdict, not a derived stamp — without it
-- the lane is a consumer with no producer and could never emit a row. It starts
-- EMPTY, which is why `user_owner` reads 0 until someone confirms.
create table if not exists public.lcc_entity_role_confirmation (
  entity_id     uuid        not null references public.entities(id) on delete cascade,
  role          text        not null,
  verdict       text        not null check (verdict in ('confirmed','rejected')),
  evidence_note text,
  confirmed_by  text,
  confirmed_at  timestamptz not null default now(),
  primary key (entity_id, role)
);

comment on table public.lcc_entity_role_confirmation is
  'C13b: human verdicts for confirmation-gated role arms (today: user_owner). '
  'INPUT to v_lcc_entity_roles, never a derived stamp. A rejected verdict drops '
  'the candidate off v_lcc_user_owner_candidates permanently.';

grant select on public.lcc_entity_role_confirmation to anon, authenticated;
grant select, insert, update, delete on public.lcc_entity_role_confirmation to service_role;

-- ---------------------------------------------------------------------------
-- 2. The candidate surface for that lane — owner ≈ tenant on the SAME property.
-- ---------------------------------------------------------------------------
-- ⚠️ `user_owner` is about OCCUPANCY, not ownership. The first draft of this
-- design defined it as "holds >=1 current portfolio asset" — 6,308 entities,
-- which is just *an owner*, and would have labelled every REIT, fund and
-- landlord in the system an owner-occupier. Wrong by three orders of magnitude.
--
-- The comparison is within a SINGLE property row (owner name vs the tenant on
-- the property that owner holds), which is what makes it survivable where the
-- lexical owner-to-owner classifiers this arc rejected did not. It is still not
-- trusted to write: it is surfaced for a human, because its known failure shape
-- is an SPE or DST NAMED AFTER THE TENANT IT HOUSES. Read on all 15 rows
-- 2026-09-01: 10 genuine owner-occupiers (Atlantis Healthcare Group, Centers for
-- Dialysis Care, Concerto Missouri, Michigan Kidney Consultants, Northwest
-- Kidney Centers, Wake Forest University, Gundersen Lutheran, Mayo Clinic
-- Dialysis, Puget Sound Kidney Centers, Sanford Health) against 5 of that
-- failure shape (`FSC FMC Carbondale IL DST`, `USGBF NIAID LLC`,
-- `NOAA Maryland LLC`, `MORGANTOWN GSA USDA, LLC`, and the ambiguous
-- `Mena Dialysis`).
create or replace view public.v_lcc_user_owner_candidates as
with held as (
  select f.entity_id, f.source_domain, f.source_property_id
  from public.lcc_entity_portfolio_facts f
  join public.entities e on e.id = f.entity_id and e.merged_into_entity_id is null
  where f.is_current
),
j as (
  select h.entity_id,
         e.name                                              as entity_name,
         e.entity_type::text                                 as entity_type,
         h.source_domain,
         h.source_property_id,
         coalesce(pa.tenant_short, pa.tenant_label)          as tenant_name,
         public.lcc_owner_domain_core(e.name)                as owner_core,
         public.lcc_owner_domain_core(coalesce(pa.tenant_short, pa.tenant_label)) as tenant_core
  from held h
  join public.entities e on e.id = h.entity_id
  join public.lcc_property_attributes pa
    on pa.source_domain = h.source_domain
   and pa.source_property_id = h.source_property_id
  where coalesce(pa.tenant_short, pa.tenant_label) is not null
)
select j.entity_id,
       j.entity_name,
       j.entity_type,
       j.source_domain,
       j.source_property_id,
       j.tenant_name,
       j.owner_core,
       j.tenant_core,
       (j.owner_core = j.tenant_core)                        as is_exact_core_match,
       public.lcc_is_spe_shell_name(j.entity_name)           as name_reads_as_spe_shell,
       public.lcc_owner_name_is_not_prospected(j.entity_name) as is_not_prospected,
       c.verdict                                             as confirmation_verdict,
       c.confirmed_at
from j
left join public.lcc_entity_role_confirmation c
  on c.entity_id = j.entity_id and c.role = 'user_owner'
where j.owner_core is not null and j.tenant_core is not null
  and length(j.owner_core) >= 4 and length(j.tenant_core) >= 4
  and (j.owner_core like '%' || j.tenant_core || '%' or j.tenant_core like '%' || j.owner_core || '%');

comment on view public.v_lcc_user_owner_candidates is
  'C13b: owner-occupier CANDIDATES (owner name core matches the tenant on a '
  'property that owner currently holds). Human-confirmed lane — a row here is '
  'NOT a user_owner until lcc_entity_role_confirmation says so. Known failure '
  'shape: an SPE/DST named after its tenant (name_reads_as_spe_shell).';

grant select on public.v_lcc_user_owner_candidates to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The role set itself.
-- ---------------------------------------------------------------------------
-- ⚠️ SHAPE IS LOAD-BEARING FOR PERFORMANCE, AND IT WAS MEASURED BOTH WAYS.
-- The first cut expressed the arms as eight `union all` branches over a
-- MATERIALIZED `cand` CTE. A CTE referenced nine times is always materialized,
-- so an `entity_id = ?` predicate — the exact shape a consumer's
-- `EXISTS (... WHERE entity_id = ? AND role = ?)` issues — could not push down:
-- the single-entity probe cost 39,968 buffers / ~686 ms, scanning all 13,280
-- candidates nine times. Rewritten as ONE `cand` scan (`not materialized`) with
-- the arms as a LATERAL VALUES list, the predicate reaches `entities_pkey`:
-- 1,787 buffers / ~13 ms, a 22× reduction in buffers (the durable evidence;
-- wall-clock on this box is session-variable by 2-4x). The ranked-scan shape
-- (`where role = ? order by current_annual_rent desc limit 50`) reads the same
-- 39,967 buffers either way and timed 362 ms after vs 718 ms before.
-- ⚠️ THE NAME GUARDS ARE APPLIED IN THE OUTER `WHERE`, NOT INSIDE EACH ARM.
-- Inlining `cand` means an expression referenced in all eight VALUES rows is
-- evaluated eight times per candidate — 106,240 guard calls instead of ~11,700.
-- Moving them to a single predicate over the surviving (entity, arm) pairs is
-- what made the inlined shape faster than the materialized one rather than 2.4x
-- slower. Materialization was therefore NOT needed; do not add it without a new
-- measurement.
create or replace view public.v_lcc_entity_roles as
with fact as (
  select f.entity_id,
         count(*) filter (where f.is_current)                                          as current_assets,
         count(*) filter (where f.ownership_end_date is not null)                      as ended_holdings,
         count(*) filter (where f.is_current and f.ownership_start_date is not null)   as current_assets_dated,
         max(f.ownership_start_date) filter (where f.is_current)                       as last_acquisition_current,
         max(f.ownership_end_date)                                                     as last_ownership_end,
         sum(f.annual_rent) filter (where f.is_current)                                as current_annual_rent
  from public.lcc_entity_portfolio_facts f
  group by f.entity_id
),
pur as (
  -- ⚠️ THE KEY IS THE DISTINCT ASSET, NOT THE EDGE. Scott's definition is
  -- "anyone that has acquired more than one ASSET in our swimlane."
  -- `entity_relationships` has no unique constraint on (from,to,type) (P177),
  -- and `purchases` is fed by costar_sidebar / costar_deed / rca_deed, each of
  -- which observes the same conveyance independently. Measured 2026-09-01:
  -- counting EDGES gives 3,258 "repeat buyers" (the figure the design carried);
  -- counting DISTINCT ASSETS gives 401. Read on named rows, the 2,857-entity
  -- difference is address-named single-asset SPEs — `1300 Pine Avenue Llc`
  -- holding `1300 Pine Ave`, `Stoneforge Advisors LLC by ARA` with five
  -- byte-identical edges on one asset, Korea Investment Corporation reading as a
  -- repeat buyer on the strength of ONE property recorded twice. An edge count
  -- is an OBSERVATION count, not an acquisition count.
  -- ⚠️ Keying on (asset, date) instead gives 735 and is also wrong: the extra
  -- 334 are one asset seen on two dates from two sources — A2b's cross-source
  -- lag, read on named rows (`1849 Davisville Rd` 2010 costar_deed / 2025
  -- costar_sidebar). Scott's words say ASSET; the asset is the key.
  select r.from_entity_id                                                              as entity_id,
         count(distinct r.to_entity_id)                                                as assets_acquired,
         count(distinct r.to_entity_id) filter (where r.effective_from is not null)     as assets_acquired_dated,
         count(*)                                                                      as purchase_edges,
         max(r.effective_from)                                                         as last_acquisition_at,
         min(r.effective_from)                                                         as first_acquisition_at
  from public.entity_relationships r
  where r.relationship_type = 'purchases'
  group by r.from_entity_id
),
op as (
  -- P113: the domain `true_owner` is often the OPERATOR filed in the owner slot.
  -- RECORDED FACTS ONLY — the mirrored `true_owner_is_operator` flag. Never a
  -- second name-based operator test; the flag is the single authority. gov
  -- returns constant false there, so this arm is dia in substance, which is a
  -- property of the data rather than a filter anyone wrote.
  select distinct ei.entity_id
  from public.lcc_property_owner_facts f
  join public.external_identities ei
    on ei.source_system = f.source_domain
   and ei.source_type = 'true_owner'
   and ei.external_id = coalesce(f.true_owner_effective_id, f.true_owner_id)::text
  where f.true_owner_is_operator
),
cand as not materialized (
  -- Tombstones are excluded: 46 merged-away entities carry a
  -- `behavioral_override` and would otherwise emit a role for a party that no
  -- longer exists.
  select e.id as entity_id, e.name as entity_name, e.entity_type::text as entity_type,
         e.domain, e.behavioral_override, e.owner_role,
         coalesce(f.current_assets, 0)          as current_assets,
         coalesce(f.ended_holdings, 0)          as ended_holdings,
         coalesce(f.current_assets_dated, 0)    as current_assets_dated,
         f.last_acquisition_current,
         f.last_ownership_end,
         f.current_annual_rent,
         coalesce(p.assets_acquired, 0)         as assets_acquired,
         coalesce(p.assets_acquired_dated, 0)   as assets_acquired_dated,
         coalesce(p.purchase_edges, 0)          as purchase_edges,
         p.last_acquisition_at,
         p.first_acquisition_at,
         (op.entity_id is not null)             as is_flagged_operator,
         (conf.verdict = 'confirmed')           as user_owner_confirmed,
         conf.confirmed_at                      as user_owner_confirmed_at,
         conf.confirmed_by                      as user_owner_confirmed_by,
         conf.evidence_note                     as user_owner_note
  from public.entities e
  left join fact f on f.entity_id = e.id
  left join pur  p on p.entity_id = e.id
  left join op        on op.entity_id = e.id
  left join public.lcc_entity_role_confirmation conf
    on conf.entity_id = e.id and conf.role = 'user_owner'
  where e.merged_into_entity_id is null
    and e.entity_type in ('organization','person')
    and (f.entity_id is not null
      or p.entity_id is not null
      or op.entity_id is not null
      or e.behavioral_override is not null
      or e.owner_role in ('developer','operator'))
)
select c.entity_id,
       c.entity_name,
       c.entity_type,
       c.domain,
       a.role,
       a.evidence_arm,
       case a.evidence_arm
         when 'domain_true_owner_operator_flag' then jsonb_build_object('flagged_in_mirror', true,  'stamped_owner_role', c.owner_role)
         when 'entities_owner_role_operator'    then jsonb_build_object('flagged_in_mirror', false, 'stamped_owner_role', c.owner_role)
         when 'human_confirmed_owner_occupier'  then jsonb_build_object('confirmed_at', c.user_owner_confirmed_at,
                                                                        'confirmed_by', c.user_owner_confirmed_by,
                                                                        'note', c.user_owner_note)
         when 'current_portfolio_fact'          then jsonb_build_object('current_assets', c.current_assets,
                                                                        'current_annual_rent', c.current_annual_rent)
         when 'distinct_assets_acquired'        then jsonb_build_object('assets_acquired', c.assets_acquired,
                                                                        'purchase_edges', c.purchase_edges,
                                                                        'first_acquisition_at', c.first_acquisition_at)
         when 'ended_holding_no_current'        then jsonb_build_object('ended_holdings', c.ended_holdings)
         when 'individual_single_current_asset' then jsonb_build_object('current_assets', c.current_assets,
                                                                        'assets_acquired', c.assets_acquired)
         when 'gov_first_generation_classifier' then jsonb_build_object('stamped_owner_role', c.owner_role)
         when 'manual_override'                 then jsonb_build_object('override_value', c.behavioral_override)
       end                                                     as evidence_detail,
       (a.evidence_arm = 'manual_override')                    as is_manual_override,
       -- ⚠️ `not_prospected` is SURFACED, NEVER SUPPRESSING. Wake Forest
       -- University and Mayo Clinic Dialysis are correctly user_owner
       -- candidates; whether we PROSPECT them is a separate gate on a separate
       -- surface. A classification is a fact about the party. 228 role-bearing
       -- entities carry this flag and every one keeps its roles.
       public.lcc_owner_name_is_not_prospected(c.entity_name)  as is_not_prospected,
       c.current_assets,
       c.current_annual_rent,
       c.ended_holdings,
       c.assets_acquired,
       c.assets_acquired_dated,
       -- ⚠️ Recency is CARRIED, never baked into the `former_owner` label — a
       -- 2015 seller and a 2025 seller are both former owners and are not the
       -- same prospect, and a cutoff inside a label starts lying the day it
       -- stops matching how the desk works.
       c.last_ownership_end,
       -- PACING ------------------------------------------------------------
       -- ⚠️ ABSENCE IS NEVER REPORTED AS DORMANCY. `ownership_start_date` is
       -- present on 7,152 of 14,119 portfolio facts (50.7%), so roughly half of
       -- apparent "dormancy" is MISSING DATES, not inactivity. Reporting it
       -- otherwise is the P180 NULL-is-not-zero failure on the single dimension
       -- Scott says drives seller-vs-buyer treatment. Where there is no date the
       -- answer is `pacing_unknown`; the quiet bucket is named `quiet_5y_plus`,
       -- never "dormant", because a party can also be quiet only in OUR RECORD.
       -- Each arm paces off ITS OWN dates: repeat_buyer off the acquisition
       -- edges it is built from (98.8% dated), investor_owner off the start
       -- dates of what it currently holds (66% dated). `assets_acquired_dated`
       -- vs `assets_acquired` makes the blindness visible per row.
       case when a.role = 'repeat_buyer' then c.last_acquisition_at
            when a.role = 'investor_owner' then c.last_acquisition_current
            else null end                                       as last_acquisition_at,
       case
         when a.role not in ('repeat_buyer','investor_owner') then null
         when (case when a.role = 'repeat_buyer' then c.last_acquisition_at
                    else c.last_acquisition_current end) is null then 'pacing_unknown'
         when (case when a.role = 'repeat_buyer' then c.last_acquisition_at
                    else c.last_acquisition_current end) >= current_date - interval '2 years' then 'active_2y'
         when (case when a.role = 'repeat_buyer' then c.last_acquisition_at
                    else c.last_acquisition_current end) >= current_date - interval '5 years' then 'active_5y'
         else 'quiet_5y_plus'
       end                                                      as pacing,
       now()                                                    as computed_at
from cand c
cross join lateral (
  select v.role, v.evidence_arm, v.needs_name_guard
  from (values
    -- OPERATOR. Two evidence arms, named apart so the row says which fact
    -- produced it. The mirror FLAG stands on its own; the stamped
    -- `entities.owner_role` is the column a `behavioral_override` REPLACES
    -- (that is what `coalesce(behavioral_override, owner_role)` has always meant
    -- on `v_entities_effective_role`), so it is suppressed whenever a human has
    -- written any override at all.
    ('operator'::text,
     (case when c.is_flagged_operator then 'domain_true_owner_operator_flag' else 'entities_owner_role_operator' end)::text,
     true,
     (c.behavioral_override is distinct from 'operator'
       and (c.is_flagged_operator
            or (c.owner_role = 'operator' and c.behavioral_override is null)))),
    -- USER_OWNER — human-confirmed only; reads 0 until someone confirms.
    ('user_owner', 'human_confirmed_owner_occupier', false,
     (coalesce(c.user_owner_confirmed, false)
       and c.behavioral_override is distinct from 'user_owner')),
    -- INVESTOR_OWNER — deliberately BROAD (Scott: "anyone or firm or SPE that
    -- owns for the purpose of investing and probably should include all of our
    -- prospects in the space"). SPEs are IN. Evidence is >=1 CURRENT fact.
    ('investor_owner', 'current_portfolio_fact', true,
     (c.current_assets >= 1 and c.behavioral_override is distinct from 'investor_owner')),
    ('repeat_buyer', 'distinct_assets_acquired', true,
     (c.assets_acquired >= 2 and c.behavioral_override is distinct from 'repeat_buyer')),
    -- FORMER_OWNER — "we know of no current holdings by that company but they
    -- used to own a tenant in our target market." Because the spine is fed only
    -- from gov and dia, "in our target market" is structurally guaranteed
    -- rather than assumed.
    ('former_owner', 'ended_holding_no_current', true,
     (c.ended_holdings >= 1 and c.current_assets = 0 and c.behavioral_override is distinct from 'former_owner')),
    -- ONE_OFF_OWNER — Scott: "a category of INDIVIDUAL investor that only owns
    -- one of our target submarket category." An INDIVIDUAL — person-typed —
    -- holding exactly one. The earlier 2,448 counted any organisation with one
    -- asset, which is a different thing and is `investor_owner` under the broad
    -- definition. NOT domain-scoped: "one_off_owner should be a treatment we use
    -- across all swimlanes... We are pursuing clients first, not necessarily the
    -- product type itself."
    -- ⚠️ THE RECORDED TYPE IS UNRELIABLE HERE AND THAT IS SURFACED, NOT PATCHED.
    -- Read on 20 named rows 2026-09-01, roughly half of this arm is typed
    -- `person` and reads as a firm (Jamestown $22.8M, Metropolitan Life
    -- Insurance $11.8M, Gladstone Commercial, SkyREM, AvalonBay, BREIT). No
    -- non-lexical corroboration exists: 0 of 142 carry a `salesforce/Account`
    -- identity, an inbound `works_at` edge, or an `org_type`, and
    -- `first_name`/`last_name` is a whitespace split of the same string, so it
    -- carries no independent information (`Metropolitan` / `Life Insurance`)
    -- and is absent on a real individual (`Kalven Cederberg`). A name test is
    -- banned by §3 and was measured unreliable in both directions anyway
    -- (`lcc_looks_like_person` flags only 28 of 142). The arm therefore emits
    -- exactly what the recorded fact says, and
    -- `v_lcc_entity_role_ambiguity.one_off_owner_rests_on_recorded_entity_type`
    -- states that the "individual" half of the label is unverified.
    ('one_off_owner', 'individual_single_current_asset', true,
     (c.entity_type = 'person' and c.current_assets = 1 and c.behavioral_override is distinct from 'one_off_owner')),
    -- DEVELOPER — READ, NEVER RE-IMPLEMENTED. Scott's definition ("the first
    -- owner in the chain of ownership with our target tenant's first action in
    -- that building") IS the implemented one: `v_gov_owner_at_first_gen` / the
    -- gov v5 classification, five generations since 2026-05-22, whose output
    -- reaches LCC as `entities.owner_role`. A second classifier for one concept
    -- is the normaliser drift this repo warns about a dozen times. Its known
    -- defect (it cannot separate the builder from the first net-lease buyer,
    -- because the chain does not reach back before the lease on 353 of 354
    -- candidates) is a CHAIN-DEPTH problem recorded in the design page §2f.
    -- ⚠️ AN OVERRIDE REPLACES THE COLUMN THIS ARM READS, IT DOES NOT SIT BESIDE
    -- IT. Measured 2026-09-01: 119 live entities carry `owner_role='developer'`
    -- together with a human override of `buyer`, and one with `operator` — i.e.
    -- somebody looked at the gov classifier's verdict and said "this is not a
    -- developer." Emitting `developer` for those 120 anyway would resurrect
    -- exactly the machine call the human corrected, which is the opposite of
    -- "a manual override always wins." It cost 838 -> 718 developer rows.
    ('developer', 'gov_first_generation_classifier', false,
     (c.owner_role = 'developer' and c.behavioral_override is null)),
    -- MANUAL OVERRIDE — emitted VERBATIM, and it bypasses the name guards
    -- because a human's explicit statement outranks a regex. It is NOT
    -- translated into the derived vocabulary: `buyer` stays `buyer` (124 rows).
    -- Silently remapping one human's word onto another word is the kind of
    -- inference this design exists to avoid, and a consumer asking for
    -- `investor_owner` must not get a false positive out of it. Every derived
    -- arm above carries `behavioral_override is distinct from '<its role>'`, so
    -- one entity can never emit the same role twice.
    (c.behavioral_override, 'manual_override', false,
     (c.behavioral_override is not null))
  ) as v(role, evidence_arm, needs_name_guard, keep)
  where v.keep
) a
-- ⚠️ EXCLUSION GUARDS, and only these two. A brokerage is the AGENT, never the
-- principal; a placeholder ("Undisclosed", "Various") is not a party at all.
-- They suppress a DERIVED arm and cost 22 investor_owner, 16 repeat_buyer,
-- 15 former_owner and 1 one_off_owner. `lcc_owner_name_is_not_prospected` is
-- NOT here — see the column comment above.
where not a.needs_name_guard
   or not (public.lcc_owner_name_is_brokerage(c.entity_name)
           or public.lcc_is_placeholder_owner_name(c.entity_name));

comment on view public.v_lcc_entity_roles is
  'C13b: the owner-role classification as a SET — one row per (entity, role), '
  'each carrying the evidence arm that produced it, its dates and its pacing. '
  'DERIVED from the BD spine on every read; never stamped. A role with no '
  'recorded basis is the "status nobody earned" failure, so evidence_arm is '
  'mandatory on every row. Consumers that asked owner_role IN (...) ask '
  'EXISTS(... WHERE entity_id = ? AND role = ?) instead.';

grant select on public.v_lcc_entity_roles to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The genuinely ambiguous — SURFACED, never bucketed.
-- ---------------------------------------------------------------------------
-- Under accuracy-first an honest absence beats a guess. Membership here does
-- NOT remove any role the entity legitimately earns; it records what cannot be
-- decided from the record.
-- ⚠️ C13's "477 single-asset-but-active and 35 SPE-shell-named" do not
-- reproduce, because both were artifacts of the SINGLE-VALUED model and the
-- org-inclusive `one_off_owner` C13 encoded. Under multi-label an entity that
-- holds one asset and buys repeatedly is simply BOTH, with no contradiction to
-- resolve; and a single-asset organisation is unambiguously `investor_owner`
-- under Scott's broad definition. Re-derived against the shipped arms the
-- residual ambiguity is 12 / 129 / 15 / 142 below.
create or replace view public.v_lcc_entity_role_ambiguity as
select c.entity_id, e.name as entity_name, e.entity_type::text as entity_type,
       'user_owner_candidate_unconfirmed'::text as ambiguity_kind,
       'owner name matches the tenant on a property it holds; could be an owner-occupier or an SPE named after its tenant'::text as why
from public.v_lcc_user_owner_candidates c
join public.entities e on e.id = c.entity_id
where c.confirmation_verdict is null
union all
select f.entity_id, e.name, e.entity_type::text,
       'individual_single_asset_but_multi_acquisition',
       'a person holding exactly one asset who has acquired two or more: one_off_owner and repeat_buyer are both literally true, and which one drives BD treatment is a human call'
from (
  select f.entity_id from public.lcc_entity_portfolio_facts f where f.is_current
  group by f.entity_id having count(*) = 1) f
join public.entities e on e.id = f.entity_id and e.merged_into_entity_id is null and e.entity_type = 'person'
where exists (select 1 from public.entity_relationships r
              where r.relationship_type = 'purchases' and r.from_entity_id = f.entity_id
              group by r.from_entity_id having count(distinct r.to_entity_id) >= 2)
union all
select f.entity_id, e.name, e.entity_type::text,
       'spe_shell_named_single_asset',
       'a single-asset holder whose name reads as an SPE shell: the sponsor behind it is the party we would work, and we cannot tell which from the record'
from (
  select f.entity_id from public.lcc_entity_portfolio_facts f where f.is_current
  group by f.entity_id having count(*) = 1) f
join public.entities e on e.id = f.entity_id and e.merged_into_entity_id is null
where public.lcc_is_spe_shell_name(e.name)
union all
select r.entity_id, r.entity_name, r.entity_type,
       'one_off_owner_rests_on_recorded_entity_type',
       'the only thing separating an INDIVIDUAL investor from a firm here is entities.entity_type, and that column is mis-set on a large share of this arm: read on 20 named rows 2026-09-01, the top 10 by rent include Jamestown, Metropolitan Life Insurance, Gladstone Commercial and SkyREM, all typed person. No non-lexical corroboration exists (0 of 142 carry an SF Account identity, an inbound works_at edge or an org_type; first_name/last_name is a whitespace split of the same string and so carries no independent information). The role is emitted because it is what the recorded fact says; treat "individual" as unverified.'
from public.v_lcc_entity_roles r
where r.role = 'one_off_owner';

comment on view public.v_lcc_entity_role_ambiguity is
  'C13b: entities whose role is genuinely undecidable from the record. '
  'Surfaced, never bucketed. Membership here does not remove any role the '
  'entity legitimately earns elsewhere.';

grant select on public.v_lcc_entity_role_ambiguity to anon, authenticated, service_role;
