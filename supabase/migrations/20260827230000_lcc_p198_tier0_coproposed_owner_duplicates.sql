-- P198 — duplicate owner entities found by CO-PROPOSAL, not by name normalization.
--
-- WHY THIS EXISTS
-- ---------------
-- P189 measured the merge detector blind to 1,089 organisations, and P195 merged the
-- byte-identical half. The WORDING half is still open (N3a): `Easterly Government Properties`
-- and `Easterly Gov Properties (REIT)` are one firm, normalize differently, and therefore
-- render as FOUR separate Tier 0 cards proposing the SAME person (Andrew Pulliam) — on the
-- highest-rent owner in the system ($85.0M + $29.8M).
--
-- P189 measured and REJECTED grouping on the shared email domain (25% precision — a shared
-- domain means an SPE family shares its sponsor's). This view uses a strictly narrower signal:
-- two owner entities that the Tier 0 lane proposes THE SAME PERSON for, ON THE SAME DOMAIN,
-- AND whose name cores share an 8-character opening.
--
-- ⚠️ MEASURED PRECISION, BEFORE ANYONE BUILDS ON THIS (2026-08-27, live):
--
--   co-proposal alone (same person + same domain)        95 pairs —   7% useful
--     of which name cores are UNRELATED                  88 pairs — SPE families, never merge
--     of which name cores share an 8-char opening         7 pairs — this view
--
--   the 7, read on named rows:
--     Easterly Government Properties / Easterly Gov Properties (REIT)   ✅ same firm
--     Gardner-Tannenbaum / Gardner Tanenbaum Holdings                   ✅ same firm (spelling)
--     Cambridge Holdings / Cambridge Properties Inc                     ⚠️ probable, Scott's call
--     Briarcliff I&II SPE / HILLTOP SPE / III & CANTER SPE  (3 pairs)   ❌ sibling SPEs
--     UIRC-GSA V Douglas AZ / UIRC-GSA V VAN HORN TX                    ❌ different properties
--
-- So co-proposal is NOT a merge rule. It is a CANDIDATE GENERATOR whose residue is dominated
-- by sponsor families, which is the same shape P189 rejected and the same shape A2a/P195 hold
-- on. Hence: **no `auto_mergeable` column, deliberately.** `lcc_apply_fuzzy_merges` loops on
-- that flag, and admitting an ungraded key there would auto-merge sibling SPEs into each other.
-- Every row here is a human confirm through `lcc_merge_entity` (reversible since P196).
--
-- ⚠️ AND THE DISCRIMINATOR IS NAMED BACKWARDS. `lcc_name_has_spe_marker` does NOT mean "this
-- is an SPE" — it detects a PORTFOLIO/sponsor marker (Properties, Holdings), and returns
-- FALSE for every name literally containing the string "SPE" (all three Briarcliff rows, both
-- UIRC rows). It happens to separate this population correctly *because* of that inversion —
-- both true duplicates are portfolio-marked on both sides, and all four SPE-sibling pairs are
-- not. Read the function, never the function's name. On 7 rows that is a tiebreak worth
-- surfacing and far too thin to promote to a rule.
--
-- Read-only. Creates one view. No table, no function, no write path, nothing scheduled.

create or replace view public.v_lcc_tier0_coproposed_owner_duplicates as
with proposed as (
  select l.owner_id,
         l.owner_name,
         l.owner_rent,
         l.domain,
         (p ->> 'person_id')::uuid  as person_id,
         p ->> 'person_name'        as person_name
    from public.v_lcc_tier0_owner_contact_lane_open l
    cross join lateral jsonb_array_elements(l.people) p
   where (p ->> 'eligible')::boolean
),
pairs as (
  select a.owner_id                       as owner_a_id,
         b.owner_id                       as owner_b_id,
         a.owner_name                     as owner_a_name,
         b.owner_name                     as owner_b_name,
         a.owner_rent                     as owner_a_rent,
         b.owner_rent                     as owner_b_rent,
         a.domain                         as domain,
         count(distinct a.person_id)      as shared_people,
         min(a.person_name)               as a_person_example
    from proposed a
    join proposed b
      on b.person_id = a.person_id
     and b.domain    = a.domain
     and a.owner_id  < b.owner_id          -- unordered pair, once
   group by 1,2,3,4,5,6,7
)
select p.owner_a_id,
       p.owner_b_id,
       p.owner_a_name,
       p.owner_b_name,
       p.owner_a_rent,
       p.owner_b_rent,
       (p.owner_a_rent + p.owner_b_rent)                     as combined_rent,
       p.domain,
       p.shared_people,
       p.a_person_example                                    as shared_person_example,
       public.lcc_owner_domain_core(p.owner_a_name)          as core_a,
       public.lcc_owner_domain_core(p.owner_b_name)          as core_b,
       left(public.lcc_owner_domain_core(p.owner_a_name), 8) as shared_opening,
       -- see the header: this reads PORTFOLIO-marked, not "is an SPE"
       public.lcc_name_has_spe_marker(p.owner_a_name)        as a_portfolio_marked,
       public.lcc_name_has_spe_marker(p.owner_b_name)        as b_portfolio_marked,
       case
         when public.lcc_name_has_spe_marker(p.owner_a_name)
          and public.lcc_name_has_spe_marker(p.owner_b_name)
           then 'likely_duplicate'
         else 'review_sponsor_family_risk'
       end                                                   as verdict_hint
  from pairs p
 where public.lcc_owner_domain_core(p.owner_a_name)
       <> public.lcc_owner_domain_core(p.owner_b_name)                 -- identical cores are
                                                                       -- already P195's job
   and length(public.lcc_owner_domain_core(p.owner_a_name)) >= 8
   and length(public.lcc_owner_domain_core(p.owner_b_name)) >= 8
   and left(public.lcc_owner_domain_core(p.owner_a_name), 8)
     = left(public.lcc_owner_domain_core(p.owner_b_name), 8)
 order by (p.owner_a_rent + p.owner_b_rent) desc;

comment on view public.v_lcc_tier0_coproposed_owner_duplicates is
  'P198. Owner-entity duplicate CANDIDATES surfaced by the Tier 0 lane proposing the same '
  'person on the same domain for two owners whose name cores share an 8-char opening. '
  'HUMAN CONFIRM ONLY — deliberately carries no auto_mergeable column: the wider co-proposal '
  'signal is 7% precise (88 of 95 pairs are sibling SPEs) and this narrowing was graded on 7 '
  'rows. Merge through lcc_merge_entity (reversible, P196); never through lcc_apply_fuzzy_merges. '
  'verdict_hint rests on lcc_name_has_spe_marker, which detects a PORTFOLIO marker and returns '
  'FALSE for names containing the literal string SPE — read the function, not its name.';

grant select on public.v_lcc_tier0_coproposed_owner_duplicates to anon, authenticated, service_role;

-- REVERSAL: drop view public.v_lcc_tier0_coproposed_owner_duplicates;
