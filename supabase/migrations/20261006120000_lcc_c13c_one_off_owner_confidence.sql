-- C13c — `one_off_owner` carries its CONFIDENCE, and the known-wrong rows are
-- recorded as reviewed (2026-09-01)
--
-- Design: docs/architecture/owner-role-classification.md §7.4 (the shipped
-- state), §8 (the user_owner confirmation pattern this reuses), §9 (the C13c
-- measurement). Prompt: docs/claude-code/prompts/C13c-one-off-owner-confidence.md.
-- Writeup: docs/audits/C13c_ONE_OFF_OWNER_CONFIDENCE_2026-09-01.md.
--
-- THE DEFECT. `one_off_owner` = 142 entities and its only evidence is
-- `entities.entity_type = 'person'`. That column is wrong in BOTH directions.
-- Read on named rows 2026-09-01: `Jamestown` — an institutional investment
-- manager holding $22,801,678 of current annual rent — is on a one-off
-- INDIVIDUAL investor lane, alongside AvalonBay, BREIT, Brixmor, Alexandria,
-- LaSalle and MIT; and genuine individuals are typed correctly but REJECTED by
-- every name test available (`Maslow Robert C & Michele C` at $654k,
-- `Anil M & Rajeshkumar K Khatri` at $454k, `Richard S Coulter & Camilla M
-- Coulter`, `Rubinfeld Family`, `Separovich/Domich`).
--
-- ⚠️ A NAME RULE IS NOT THE FIX AND WAS MEASURED, NOT ASSUMED.
--   * `lcc_owner_name_has_org_marker` catches 0 of the 142.
--   * `lcc_looks_like_person` flags only 28 of 142, and its failures are
--     dominated by married couples — `&` is a couple, not a firm (P158a) — while
--     it PASSES `Gates Hudson` ($19.6M), `Metropolitan Life Insurance` ($11.8M)
--     and `Gladstone Commercial` ($2.7M), which are firms. It measures the regex,
--     not the population.
--   * Every name-based owner classifier graded in this arc landed ~25% raw, 7%,
--     or 4-of-6 guarded (P189, P196, P198).
--
-- ✅ THE DISCRIMINATING RECORDED FACT, AND ITS POSITIVE CONTROL. A
-- `salesforce/Contact` external identity: 13 of the 142. Read on named rows all
-- 13 — Martin Starr, Denis Rodger, Bill Weitzenkorn, Ryan Gaylord, Brian Revis,
-- Jim Glickman, Jay Morris, Molly Huang, Sarita Mutscher, Michael P Brown,
-- Justin Kaufmann, Pinakinl & Rajendrabhai J Patel — are 12 unmistakable
-- individuals. The one miss is `Law Offices`, the documented
-- two-capitalised-tokens false positive, REPORTED rather than special-cased: one
-- known false positive in 13, named, beats a rule nobody has graded.
-- ⚠️ THE POSITIVE CONTROL IS THE IMPORTANT HALF — ZERO of the institutional
-- names carry one. Not Jamestown, BREIT, AvalonBay, Brixmor, Alexandria or MIT.
-- The signal separates exactly the population that must be separated, which is
-- what makes it worth building on where a name test is not. (`salesforce/Account`
-- on the arm: 0. `works_at` edges either direction: 0.)
--
-- WHAT THIS DOES — A CONFIDENCE SPLIT, NOT A DELETION.
--   * 142 -> 13 would be wrong: it discards every genuine individual simply
--     absent from Salesforce.
--   * Asserting all 142 flat is also wrong: it is what puts a $22.8M
--     institutional manager on a one-off-individual lane.
--   * So the ARM SPLITS ITS EVIDENCE and the surface gates on it. This is P181
--     one layer down: when a worker escalates its residue, the escalation must
--     carry the worker's CONFIDENCE, and a genuine judgement call must not wear
--     the same label as a worthless one.
--
-- ⚠️ THE ROLE COUNT IS DELIBERATELY UNCHANGED AT 142 (13 + 129), and that is a
-- tension worth naming rather than hiding. The design page §9 says the reviewed
-- institutional rows should "stop being emitted as individuals"; the same
-- prompt's assertion table says `one_off_owner` total is "142 — unchanged in
-- COUNT" and splits it 13/129, which leaves no room for a suppressed set.
-- The numeric assertion governs (numbers over prose is this repo's own rule),
-- and suppression is a separate decision with its own blast radius: every one of
-- these entities ALSO carries `investor_owner`, correctly, so today a wrong
-- `one_off_owner` removes nobody and admits nobody. Filed as C13f.
--
-- ⚠️ WHAT THIS DELIBERATELY DOES NOT DO
--   * It does not repair `entities.entity_type`. That column is written by other
--     producers and read by other consumers; correcting it fleet-wide is a
--     larger change with its own blast radius. SIZED in the writeup, filed as
--     C13g — not started here.
--   * It does not touch `investor_owner`. Those same institutional entities are
--     CORRECTLY `investor_owner` and must stay so; only their `one_off_owner`
--     claim is false.
--   * It does not touch P0.4 (555), the deal-timing bands, the prospecting brief
--     or any other arm. No consumer is repointed; there is still no JS consumer
--     of these objects at all.
--   * It adds NO name stoplist to the classifier. The reviewed rows go in the
--     `lcc_entity_role_confirmation` ledger (§8's pattern, just used for
--     `user_owner`) and the view READS the ledger.
--
-- REVERSAL RUNBOOK
--   1. delete from public.lcc_entity_role_confirmation
--       where role = 'one_off_owner' and confirmed_by = 'c13c_named_review';
--   2. re-apply 20261005120000_lcc_c13b_entity_roles_multilabel.sql to restore
--      the single `individual_single_current_asset` evidence arm and the
--      142-row ambiguity branch.
--   3. drop index if exists public.idx_extid_salesforce_contact_entity;

-- ---------------------------------------------------------------------------
-- 1. The reviewed rows — a LEDGER, never a stoplist in the classifier.
-- ---------------------------------------------------------------------------
-- 21 entities that a human has read by name and judged to be organizations
-- despite `entities.entity_type = 'person'`. They are not "low confidence" —
-- they are WRONG, and they are identifiable today only because somebody read
-- the list, which is precisely why this is recorded as a verdict rather than
-- inferred by a rule.
--
-- ⚠️ THE JOIN ON `e.name` IS A TRIPWIRE, NOT A LOOKUP KEY. The entity_id is the
-- key. Re-checking the name means a merge, rename or repoint since the review
-- makes the row FAIL TO INSERT and trip the assertion below, rather than
-- silently stamping a verdict onto a party nobody reviewed.
--
-- ⚠️ `verdict = 'rejected'` is the CHECK-constrained vocabulary (§8: it is
-- `confirmed`/`rejected`, not confirm/reject). It records "reviewed, and this
-- entity is not an individual". It does NOT suppress the role today — see the
-- count note in the header.
insert into public.lcc_entity_role_confirmation (entity_id, role, verdict, evidence_note, confirmed_by)
select v.entity_id::uuid,
       'one_off_owner',
       'rejected',
       'C13c named review ' || v.provenance || ': read by name and judged an ORGANIZATION '
         || 'despite entities.entity_type = ''person''. The one_off_owner arm''s only evidence '
         || 'is that column. This row records the human read; it does not repair entity_type '
         || 'and does not remove the entity''s (correct) investor_owner role.',
       'c13c_named_review'
from (values
  -- from the C13c prompt §1 / design page §9 (the 15 named there)
  ('f4daf60e-ff42-4fc5-863e-d16ced190845', 'Jamestown',                      'C13c-prompt-s1'),
  ('84a598b5-57e6-4d3c-bc02-17aed420695c', 'SkyREM',                         'C13c-prompt-s1'),
  ('4dccb94f-9fb3-46f9-b0d5-1de8779aaea5', 'Deoworks',                       'C13c-prompt-s1'),
  ('98aa1ebf-de85-4af8-b2c0-4e4b652891db', 'Protea Primewest (PPW)',         'C13c-prompt-s1'),
  ('5e9c7b3f-8037-4040-a425-c327c28adb2b', 'Everbank',                       'C13c-prompt-s1'),
  ('112fd6ed-b8b8-41b2-8a0e-8bec22815576', 'Gofsco',                         'C13c-prompt-s1'),
  ('a18b2f3c-c4c5-4b1e-9fe3-40d0bf543a0a', 'AEI NET Lease Portfolio XIII D', 'C13c-prompt-s1'),
  ('d4f87ed8-67b7-4f4f-997b-930ca3442f02', 'Alexandria',                     'C13c-prompt-s1'),
  ('14e4b0e9-db93-4dc6-bb49-b2661304ae47', 'Brixmor',                        'C13c-prompt-s1'),
  ('05cb85c3-762d-4cdf-a4b5-0a8a4d28c8e8', 'AvalonBay',                      'C13c-prompt-s1'),
  ('66812c82-3636-4e60-8f6d-fc0e0df5e19c', 'BREIT',                          'C13c-prompt-s1'),
  ('2d3ac7f3-fa90-44be-9b20-1063d3495199', 'LaSalle',                        'C13c-prompt-s1'),
  ('10544b5c-6535-4de6-bb05-296e17a09c9b', 'MIT',                            'C13c-prompt-s1'),
  ('c23a1b28-0a32-4edd-a396-043b2e528728', 'Komatsu',                        'C13c-prompt-s1'),
  ('5df81910-fd82-4b05-b43d-a952aad46186', 'EJME',                           'C13c-prompt-s1'),
  -- from the design page §7.4's read of 20 named rows. These PASS
  -- `lcc_looks_like_person`, which is exactly why §1's list (drawn from the 28
  -- name-test failures) does not contain them — and they include the arm's #2
  -- and #3 by rent. Leaving the two largest known-wrong rows unmarked while
  -- marking smaller ones is the worse outcome, so the ledger covers both reads.
  ('b65f4914-a63e-44c9-98aa-770d510eea71', 'Gates Hudson',                   'design-s7.4'),
  ('29ba55d5-0305-45f5-b156-aec2fcfd9ff3', 'Metropolitan Life Insurance',    'design-s7.4'),
  ('3fdeaeab-b66c-485b-b936-bb383258f1d0', 'Gladstone Commercial',           'design-s7.4'),
  ('81910e78-561e-4db0-a327-fe729b367fb3', 'Beverly Wilshire',               'design-s7.4'),
  ('fcec245a-fbaa-4302-99b7-c0ad1fe84afa', 'Samaritan''s Purse',             'design-s7.4'),
  ('0901e790-61d0-4eae-b168-2a01c17f5258', 'Apollo Global RE',               'design-s7.4')
) as v(entity_id, entity_name, provenance)
join public.entities e
  on e.id = v.entity_id::uuid
 and e.name = v.entity_name
on conflict (entity_id, role) do nothing;

do $$
declare n int;
begin
  select count(*) into n
  from public.lcc_entity_role_confirmation
  where role = 'one_off_owner' and confirmed_by = 'c13c_named_review';
  if n <> 21 then
    raise exception 'C13c: expected 21 named-review rows, found %. An entity was '
      'merged, renamed or repointed since the review — re-read the list before '
      'stamping a verdict on a party nobody looked at.', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1b. The corroboration's measured cost, paid down.
-- ---------------------------------------------------------------------------
-- ⚠️ MEASURED BOTH WAYS, because §7.7 made shape load-bearing on this view and
-- "buffers are the durable evidence" (wall-clock on this box moves 2-4x between
-- sessions on unchanged SQL). On the two shapes that matter:
--
--   single-entity probe (the consumer mapping's EXISTS)   60 ->    63 buffers
--   ranked scan (role = ? order by rent limit 50)      39,968 -> 50,861 buffers
--
-- The probe is +3 — one index probe, the `sfc` predicate pushes straight down,
-- which is the property §7.7's whole rewrite existed to protect. The ranked
-- scan was +27%, all of it the `sfc` leg reading 10,083 rows through
-- `external_identities_workspace_id_source_system_source_type__key` and
-- fetching every heap tuple for `entity_id`.
--
-- P118 corollary 2 is the applicable rule: the aggregate is already hoisted out
-- of the correlation (it is a CTE, not a per-row EXISTS), so there is nothing
-- left to hoist and an INDEX is the fix. P118 corollary 3 is why this one is
-- usable: a PARTIAL index is only reachable if the query's own predicates IMPLY
-- the index predicate, and `sfc` states `source_system = 'salesforce' and
-- source_type = 'Contact'` verbatim.
--
--   ranked scan, after                                 39,968 -> 44,204 buffers
--   (the sfc leg alone: 10,893 -> 4,236, an Index Only Scan)
--
-- So the honest residual cost of the arm's new evidence is +10.6% buffers on
-- the scan shape and +3 buffers on the probe shape. Stated rather than rounded
-- away. Built NON-concurrently (P118: a cancelled CREATE INDEX CONCURRENTLY
-- leaves an INVALID index to clean up) — ~10k entries on a 70,540-row table.
-- Drop it to reverse; nothing depends on it for correctness.
create index if not exists idx_extid_salesforce_contact_entity
  on public.external_identities (entity_id)
  where source_system = 'salesforce' and source_type = 'Contact';

-- ---------------------------------------------------------------------------
-- 2. The arm splits its evidence.
-- ---------------------------------------------------------------------------
-- Only the `one_off_owner` arm and its `evidence_detail` branch change. Every
-- other arm, guard, column and comment is carried over byte-for-byte from
-- 20261005120000; the diff below is the whole change, and the C13b guard still
-- reads THIS file (P197: a guard that reads a superseded definition describes
-- something that is no longer shipped).
--
-- ⚠️ THE CORROBORATION IS A CTE, NOT A PER-ROW `EXISTS`. §7.7 measured that an
-- expression referenced in all nine VALUES rows is evaluated nine times per
-- candidate. `sfc` mirrors the existing `op` CTE — one scan, one hash join, one
-- boolean on the row — so the arms read a column, never a subquery.
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
sfc as (
  -- C13c: the ONLY non-lexical fact measured to separate an individual from a
  -- firm on the `one_off_owner` arm. A `salesforce/Contact` identity means the
  -- CRM holds this party as a PERSON record — a recorded fact from a different
  -- system, not a re-reading of the same string (P125: a proxy for a fact you
  -- already hold is not a measurement, which is why `first_name`/`last_name`,
  -- a whitespace split of `name`, was rejected).
  -- ⚠️ ONE canonical spelling, verified live: `external_identities` carries
  -- salesforce/Account 16,319, salesforce/Contact 10,083, salesforce/Lead 80 and
  -- no case variants, so this predicate cannot miss on a spelling.
  select distinct ei.entity_id
  from public.external_identities ei
  where ei.source_system = 'salesforce'
    and ei.source_type = 'Contact'
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
         (sfc.entity_id is not null)            as has_sf_contact,
         (conf.verdict = 'confirmed')           as user_owner_confirmed,
         conf.confirmed_at                      as user_owner_confirmed_at,
         conf.confirmed_by                      as user_owner_confirmed_by,
         conf.evidence_note                     as user_owner_note
  from public.entities e
  left join fact f on f.entity_id = e.id
  left join pur  p on p.entity_id = e.id
  left join op        on op.entity_id = e.id
  left join sfc       on sfc.entity_id = e.id
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
         -- C13c: the two one_off_owner arms say, on the row, what the word
         -- INDIVIDUAL is resting on. `individual_evidence` is the field a
         -- surface gates on; the caveat travels with the weak arm so a consumer
         -- reading one row cannot mistake it for the strong one.
         when 'individual_single_current_asset_sf_corroborated' then jsonb_build_object(
                                                                        'current_assets', c.current_assets,
                                                                        'assets_acquired', c.assets_acquired,
                                                                        'individual_evidence', 'entities.entity_type + a salesforce/Contact identity',
                                                                        'caveat', 'read on all 13 named rows 2026-09-01: 12 unmistakable individuals; the one miss is Law Offices, the documented lcc_looks_like_person two-capitalised-tokens false positive')
         when 'individual_single_current_asset_unverified'      then jsonb_build_object(
                                                                        'current_assets', c.current_assets,
                                                                        'assets_acquired', c.assets_acquired,
                                                                        'individual_evidence', 'entities.entity_type ONLY',
                                                                        'caveat', 'entities.entity_type is the sole evidence that this is an INDIVIDUAL and it is measured wrong in BOTH directions (C13c): Jamestown at $22.8M of rent is typed person, and genuine married couples are rejected by every name test. Treat "individual" as unverified.')
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
    -- ⚠️ C13c does NOT touch this arm. The institutional entities wrongly typed
    -- `person` are CORRECTLY investor_owner and must stay so; only their
    -- `one_off_owner` claim is false.
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
    --
    -- ⚠️ C13c: THE MEMBERSHIP TEST IS UNCHANGED; WHAT CHANGED IS THAT THE ROW
    -- NOW SAYS HOW MUCH TO TRUST IT. Splitting membership would have been the
    -- deletion this unit exists to refuse (13 of 142 discards
    -- `Maslow Robert C & Michele C` and every other genuine individual absent
    -- from Salesforce); flattening it is what put Jamestown on the lane. So the
    -- CONFIDENCE moves into `evidence_arm`, which the view already makes
    -- mandatory on every row, and the surface gates on it — P181 one layer down.
    -- ⚠️ `has_sf_contact` is a RECORDED FACT from another system, never a name
    -- test: §3 bans a lexical classifier here and the measurements say a lexical
    -- one would not work anyway (`lcc_owner_name_has_org_marker` catches 0 of
    -- 142; `lcc_looks_like_person` flags 28 and passes three real firms).
    ('one_off_owner',
     (case when c.has_sf_contact then 'individual_single_current_asset_sf_corroborated'
           else 'individual_single_current_asset_unverified' end)::text,
     true,
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
  'C13b/C13c: the owner-role classification as a SET — one row per (entity, '
  'role), each carrying the evidence arm that produced it, its dates and its '
  'pacing. DERIVED from the BD spine on every read; never stamped. A role with '
  'no recorded basis is the "status nobody earned" failure, so evidence_arm is '
  'mandatory on every row. C13c: one_off_owner carries its CONFIDENCE in that '
  'arm — _sf_corroborated (entity_type plus a salesforce/Contact identity) vs '
  '_unverified (entity_type only, a column measured wrong in both directions). '
  'The COUNT is unchanged; a consumer that needs a defensible individual gates '
  'on the arm. Consumers that asked owner_role IN (...) ask '
  'EXISTS(... WHERE entity_id = ? AND role = ?) instead.';

grant select on public.v_lcc_entity_roles to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The ambiguity surface — narrowed where it is now decided, widened where a
--    human has read the row and found it wrong.
-- ---------------------------------------------------------------------------
-- Two changes, both consequences of the split:
--   * `one_off_owner_rests_on_recorded_entity_type` NARROWS from 142 to the 129
--     uncorroborated. A corroborated row does not rest on `entity_type` alone —
--     it rests on `entity_type` AND a salesforce/Contact identity — so listing
--     it under a kind whose name says otherwise would be false. (It is not
--     PERFECT: `Law Offices` is in the corroborated 13 and is a firm. One named
--     false positive in 13 beats a rule nobody has graded — §4.)
--   * `entity_type_contradicted_by_named_review` is NEW and reads the LEDGER,
--     never a name list. That is the whole point: the classifier stays free of
--     a stoplist, and the judgement lives where a human's judgement belongs.
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
       'the only thing separating an INDIVIDUAL investor from a firm on this row is entities.entity_type, and that column is mis-set on a large share of this arm: read on named rows 2026-09-01 it types Jamestown ($22.8M of current rent), Gates Hudson, Metropolitan Life Insurance and Gladstone Commercial as persons, while rejecting genuine married couples via every available name test. No lexical repair is available (lcc_owner_name_has_org_marker catches 0 of 142; lcc_looks_like_person flags 28 and passes three real firms) and first_name/last_name is a whitespace split of the same string, so it carries no independent information. C13c: this kind now lists only the UNCORROBORATED rows — a row also carrying a salesforce/Contact identity has a second, independent recorded fact and is listed nowhere here. The role is still emitted because it is what the recorded fact says; treat "individual" as unverified.'
from public.v_lcc_entity_roles r
where r.role = 'one_off_owner'
  and r.evidence_arm = 'individual_single_current_asset_unverified'
union all
select r.entity_id, r.entity_name, r.entity_type,
       'entity_type_contradicted_by_named_review',
       'a human read this entity by name and recorded it as an ORGANIZATION, contradicting the entities.entity_type = ''person'' that is the one_off_owner arm''s only evidence. These are not low-confidence rows, they are WRONG ones — Jamestown is an institutional investment manager and Metropolitan Life Insurance is an insurer, both on a one-off-INDIVIDUAL lane. The verdict lives in lcc_entity_role_confirmation (the §8 pattern), never as a name stoplist in the classifier. ⚠️ It does NOT suppress the role today: the count stays 142 by design (C13c §5), the entity keeps its CORRECT investor_owner role, and both the suppression and the underlying entities.entity_type repair are filed separately (C13f / C13g).'
from public.v_lcc_entity_roles r
join public.lcc_entity_role_confirmation cr
  on cr.entity_id = r.entity_id and cr.role = 'one_off_owner' and cr.verdict = 'rejected'
where r.role = 'one_off_owner';

comment on view public.v_lcc_entity_role_ambiguity is
  'C13b/C13c: entities whose role is genuinely undecidable from the record, plus '
  '(C13c) those a human has read and found contradicted by the recorded fact. '
  'Surfaced, never bucketed. Membership here does not remove any role the '
  'entity legitimately earns.';

grant select on public.v_lcc_entity_role_ambiguity to anon, authenticated, service_role;
