-- A3 — the ownership-history `mismatch` lane is mostly a REPRESENTATION question, not a data error.
--
-- 2026-08-27 · LCC Opps (xengecqvemvfknjvbvrq) · applied live.
-- NOTHING HERE WRITES AN OWNERSHIP FACT. No confirmation is seeded. No lane count moves today.
--
-- ============================================================================
-- RE-MEASURED FIRST — the population moved under the prompt
-- ============================================================================
-- The A3 brief was written against `mismatch = 73`. Live on 2026-08-27 it is **74 chains /
-- 46 owners / $403.0M**, because A2 landed in between and drained `agrees` 380 -> 90. The
-- dated-blocker doctrine applies to a population size exactly as it applies to a blocker:
-- re-measure before quoting. Every number below is from this run.
--
-- The last recorded grantee != the owner we hold. Read on named rows, that splits three ways:
--
--   sponsor_family_candidate  32 chains  12 owners  12 decisions   Boyd alone: 20 chains, 1 decision
--   unexplained               31 chains  27 owners                 the genuine integrity residue
--   name_variant              11 chains  10 owners                 legal form / punctuation / word order
--
-- ⚠️ Per-class rent DOUBLE-COUNTS an owner that spans classes. Three do (Boyd Watterson,
--    Easterly, DEAMO), so the class sums ($221.0M + $344.6M + $47.1M = $612.6M) exceed the
--    lane's distinct total of **$403.0M**. Quote the distinct figure. Value is per OWNER,
--    never per chain -- Boyd's $179.8M appears on 24 chains and is one owner.
--
-- ============================================================================
-- ⚠️ THE PROMPT'S OWN PRESCRIPTION WAS MEASURED AND PARTLY REJECTED
-- ============================================================================
-- The brief said: reuse `lcc_owner_sponsor_domain` (P190), one confirm per sponsor TOKEN.
-- Two measurements say a token-scoped confirm is the wrong key for THIS question:
--
--  1. **A bare token is not bounded.** Counting live entities carrying each proposed token as a
--     standalone word: `east` **146**, `boyd` **122**, `fgf` 67, `madison` 50, `arc` 43,
--     `commonwealth` 29 -- and the samples are exactly the noise class P196 warned about
--     (`1 EAST BROWARD OWNER LLC`, `100 East PropCo LLC`, and for `boyd` the surnames
--     `Boyd Alexander`, `A Boyd Charles E and Holly`). Confirming `east` token-wide asserts a
--     sponsor family over 146 owners to answer a question about ONE. In `lcc_owner_sponsor_domain`
--     a wrong token merely fails to join to a person; here it would assert a false ownership fact.
--     So the confirm is keyed **(sponsor entity, token)** -- bounded to the owner we actually hold.
--  2. **The PK could not express a case already in the data.** `madison` is proposed by TWO owner
--     entities (`Madison Capital Group LLC` and `Madison Capital Group or affiliated principals`,
--     both pointing at `MADISON-OFC WESTON POINTE FL LLC` -- itself a duplicate-owner signal for
--     P189/P195). And `egp` names BOTH `Easterly Government Properties` and `EastGroup Properties,
--     Inc.`, whose SPEs are `EGP 116 Suffolk LLC` and `EGP 85 Charleston LLC`. A `sponsor_token`
--     primary key holds one row per token and cannot carry either pair.
--
-- ⚠️ WHY THIS IS NOT THE SECOND-REGISTRY DRIFT THIS REPO KEEPS WARNING ABOUT.
--    The drift warning is about a second DETECTOR of the same fact. This is not one:
--      * the DETECTOR is shared -- `lcc_ownership_sponsor_token` composes `lcc_tier0_brand_token`
--        and the very guard predicates `lcc_tier0_sponsor_brand_token` uses, which are extracted
--        into named functions in Unit 1 below precisely so there is ONE copy of each;
--      * the two tables answer different questions at different scopes. `lcc_owner_sponsor_domain`
--        is token -> email domain ("who do we call"); this is (entity, token) -> family ("does a
--        deed to this SPE satisfy 'terminates at this owner'"). A row in one is not a row in
--        the other, and neither derives from the other.
--
-- ⚠️ AND A CONTACT CONFIRM DOES NOT ANSWER THE OWNERSHIP QUESTION -- IT IS EVIDENCE ON THE CARD.
--    The tempting shortcut is to let Scott's 8 existing `lcc_owner_sponsor_domain` rows resolve
--    ownership chains for free. Measured: they resolve **0 of 74** today, so the shortcut buys
--    nothing -- and it would let a contact-matching decision, whose own proposal gate reads ~4-of-6
--    on named rows (P196), silently settle an ownership fact. That is the P188 finding restated:
--    the evidence answers a DIFFERENT question than the one being asked, and that belongs on the
--    card. `v_lcc_ownership_sponsor_family_proposals.also_confirmed_for_contacts` surfaces it;
--    nothing inherits.
--
-- ============================================================================
-- REVERSAL
-- ============================================================================
--   delete from lcc_ownership_sponsor_family where confirmed_by = '<who>';   -- undo one confirm
--   drop view if exists v_lcc_ownership_sponsor_family_proposals;
--   drop view if exists v_lcc_ownership_mismatch_classified;
--   drop table if exists lcc_ownership_sponsor_family;
--   drop function if exists lcc_ownership_mismatch_class(text,text);
--   drop function if exists lcc_ownership_sponsor_token(text,text);
--   -- then restore v_lcc_ownership_history_lane_split from 20260827090000 and re-inline the
--   -- two guard bodies into lcc_tier0_sponsor_brand_token from 20260827160000.

-- ---------------------------------------------------------------------------
-- UNIT 1 — extract P196's guards so there is ONE copy of each, not two.
--
-- `lcc_tier0_sponsor_brand_token` inlines four guards. A3 needs three of them and must NOT
-- re-type the regexes (that is the fresh-detector drift). They become named predicates and the
-- P196 function is rewritten to CALL them, so its behaviour is unchanged by construction and is
-- gated below on the live Tier 0 population.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_name_reads_as_street(p_name text)
returns boolean language sql immutable set search_path to 'public','pg_temp' as $$
  select coalesce(p_name,'') ~* '\m(rd|road|st|street|ave|avenue|blvd|dr|drive|ln|lane|hwy|highway|pkwy|ct|way)\M';
$$;

comment on function public.lcc_name_reads_as_street(text) is
  'P196/A3 sponsor gates ONLY: the name carries a street-type word ("Steel Station Rd, LLC", '
  '"8111 GATEHOUSE ROAD, LLC"). Extracted verbatim from lcc_tier0_sponsor_brand_token so both '
  'gates share ONE copy. Not a general address detector and never an identity comparator.';

create or replace function public.lcc_name_has_spe_marker(p_name text)
returns boolean language sql immutable set search_path to 'public','pg_temp' as $$
  select coalesce(p_name,'') ~* '\m(propert(y|ies)|holdings|owner|propco|holdco|fund)\M';
$$;

comment on function public.lcc_name_has_spe_marker(text) is
  'P196/A3 sponsor gates ONLY: the name says it is a property-holding vehicle. Extracted verbatim '
  'from lcc_tier0_sponsor_brand_token. ⚠️ MEASURED POPULATION-SPECIFIC: required by the P196 Tier 0 '
  'gate, and it drops 24 of 27 genuine sponsor-SPE rows in the A3 ownership population, where the '
  'SPE is a GSA build named for its city (BOYD PHOENIX GSA LLC, Lorton GSA LLC). A3 therefore does '
  'not apply it, and says so at its call site rather than weakening this predicate.';

-- Behaviour-preserving rewrite: identical logic, guards now by name.
create or replace function public.lcc_tier0_sponsor_brand_token(p_owner_name text, p_company text)
returns text language sql stable set search_path to 'public','pg_temp' as $$
  select case
    when o is null or c is null then null
    when length(o) < 5 or length(c) < 5 then null
    when not (o = c or left(c, length(o)) = o or left(o, length(c)) = c) then null
    when not public.lcc_name_has_spe_marker(p_owner_name) then null
    when public.lcc_name_reads_as_street(p_owner_name) then null
    when public.lcc_looks_like_person(p_owner_name) then null
    when public.lcc_owner_name_is_brokerage(p_company) then null
    else o
  end
  from (select public.lcc_tier0_brand_token(p_owner_name) o,
               public.lcc_tier0_brand_token(p_company)    c) z;
$$;

comment on function public.lcc_tier0_sponsor_brand_token(text,text) is
  'P196: the shared sponsor brand token when a parked Tier 0 candidate''s employer looks like the '
  'SPE owner''s sponsor, else NULL. ~4 of 6 on named rows -- a PROPOSAL gate for '
  'lcc_owner_sponsor_domain, never a write gate. A3 (2026-08-27) extracted its street/SPE-marker '
  'guards into named predicates; the logic is unchanged and gated at 0 rows differing.';

-- ---------------------------------------------------------------------------
-- UNIT 2 — the A3 gate. Composes the SHARED primitives; no new regex is introduced except
-- the whole-token containment test, which is the same technique P196 uses on cores.
--
-- Arms, in order:
--   lead_token       both names' leading brand token are equal (lcc_tier0_brand_token)
--   token_contained  one name's leading brand token appears as a WHOLE TOKEN in the other
--                    ("FGF Management" <-> "GERMANTOWN MD I FGF, LLC")
-- Floor of 3 characters on the shared token.
--
-- ⚠️ THIS IS NOT P187'S REJECTED ACRONYM ARM, AND THE DIFFERENCE IS STRUCTURAL, NOT A TUNING.
--    P187 INFERRED a fact from one name ("a 3-4 char ALL-CAPS token is an acronym, so look up
--    its domain") and scored ~30-40%, because 27.6% of owner names are entirely uppercase. This
--    requires the token to be present on BOTH sides of a deed for the SAME property: the candidate
--    space is one grantee per chain, not the whole internet. Measured over the 74: 32 proposals,
--    **32 of 32 read as a genuine family relation on named rows**, and the strongest single
--    proposal (Boyd, 20 chains) is also the largest.
--
-- ⚠️ THE P196 SPE-MARKER GUARD IS DELIBERATELY NOT APPLIED, MEASURED.
--    `lcc_tier0_sponsor_brand_token(grantee, owner)` returns non-null for **3 of 74** here. The
--    SPE-marker requirement is what drops the other 24 genuine ones: a government SPE is named
--    for its city and agency (`BOYD SACRAMENTO GSA, LLC`), not "Propco". Keeping the guard would
--    silently reduce A3 to a rounding error while reading like a working gate.
--    The other three guards ARE applied, and their cost is measured, not assumed:
--      street guard    fires 3 times, changes 0 outcomes (none had a shared token anyway)
--      brokerage guard fires 0 times
--      person guard    costs exactly TWO false negatives, both named and both genuine:
--                        `City of Oakland`  <- `PORT DEPARTMENT OF THE CITY OF OAKLAND`
--                        `Glenn Olds ...`   <- `U-Land, Glenn Olds, LLC`
--                      (both are `lcc_looks_like_person` false positives -- "City of Oakland" is
--                      not a person -- a pre-existing guard defect, named here, NOT patched.)
--                      Kept per P196's stated trade: a false negative costs one card; a false
--                      positive asserts a stranger's firm over an SPE family.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_ownership_sponsor_token(p_owner_name text, p_grantee_name text)
returns text language sql immutable set search_path to 'public','pg_temp' as $$
  with z as (
    select public.lcc_tier0_brand_token(p_owner_name)   as ot,
           public.lcc_tier0_brand_token(p_grantee_name) as gt,
           ' '||regexp_replace(lower(coalesce(p_owner_name,'')),  '[^a-z0-9]+',' ','g')||' ' as onorm,
           ' '||regexp_replace(lower(coalesce(p_grantee_name,'')),'[^a-z0-9]+',' ','g')||' ' as gnorm
  )
  select case
    -- Same party under the sanctioned identity comparator is `name_variant`, a different class.
    when public.lcc_owner_strict_core(p_owner_name)
       = public.lcc_owner_strict_core(p_grantee_name) then null
    when public.lcc_looks_like_person(p_owner_name) then null
    when public.lcc_owner_name_is_brokerage(p_owner_name)
      or public.lcc_owner_name_is_brokerage(p_grantee_name) then null
    when public.lcc_name_reads_as_street(p_grantee_name) then null
    when ot is not null and ot = gt and length(ot) >= 3 then ot
    when length(coalesce(ot,'')) >= 3 and gnorm like ('% '||ot||' %') then ot
    when length(coalesce(gt,'')) >= 3 and onorm like ('% '||gt||' %') then gt
    else null
  end
  from z;
$$;

comment on function public.lcc_ownership_sponsor_token(text,text) is
  'A3 ownership-mismatch gate ONLY: the brand token shared by an owner we hold and the last '
  'grantee recorded on a deed for the SAME property, when the pair reads as sponsor<->SPE. NULL '
  'otherwise. A PROPOSAL gate -- every proposal is human-confirmed into '
  'lcc_ownership_sponsor_family. NEVER an identity comparator, never a write gate, and never to '
  'be reused on a population where the two names are not both parties to one property.';

create or replace function public.lcc_ownership_mismatch_class(p_owner_name text, p_grantee_name text)
returns text language sql immutable set search_path to 'public','pg_temp' as $$
  select case
    when public.lcc_owner_strict_core(p_owner_name)
       = public.lcc_owner_strict_core(p_grantee_name) then 'name_variant'
    when public.lcc_ownership_sponsor_token(p_owner_name, p_grantee_name) is not null
      then 'sponsor_family_candidate'
    else 'unexplained'
  end;
$$;

comment on function public.lcc_ownership_mismatch_class(text,text) is
  'A3: THE single owner of the three-way mismatch classification. There is no JS mirror. '
  '⚠️ `name_variant` uses lcc_owner_strict_core, which A2 measured and REJECTED for WRITES on this '
  'very population (it equates BAMMF (8) LLC with BAMMF (3) LLC). It is used here to LABEL a card '
  'for a human, never to retire a task and never to write an ownership fact -- and a name_variant '
  'chain stays human_actionable for exactly that reason.';

-- ---------------------------------------------------------------------------
-- UNIT 3 — the confirm registry. Human decisions only, one per (sponsor entity, token).
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_ownership_sponsor_family (
  sponsor_entity_id uuid        not null references public.entities(id) on delete cascade,
  sponsor_token     text        not null,
  confirmed_by      text        not null,
  confirmed_at      timestamptz not null default now(),
  notes             text,
  primary key (sponsor_entity_id, sponsor_token),
  constraint chk_ownership_sponsor_token_len check (length(sponsor_token) >= 3),
  constraint chk_ownership_sponsor_token_norm
    check (sponsor_token = lower(btrim(sponsor_token)) and sponsor_token !~ '[^a-z0-9]')
);

comment on table public.lcc_ownership_sponsor_family is
  'CURATED (sponsor entity, brand token) families for the A3 ownership-mismatch lane. A row means '
  'a human decided: a deed recording a grantee that carries this token DOES satisfy "the chain '
  'terminates at this owner". ONE row covers that sponsor''s whole SPE family, now and future. '
  'Every row is a HUMAN decision, never inferred -- confirmed_by is required, exactly as '
  'lcc_owner_sponsor_domain (P190) requires it. '
  '⚠️ SIBLING OF, NOT A FORK OF, lcc_owner_sponsor_domain: that table is token -> email domain '
  '("who do we call at this sponsor"); this is (entity, token) -> family ("does this deed satisfy '
  'this owner"). Entity-scoped because a bare token is not bounded -- `east` matches 146 live '
  'entities and `boyd` 122, including the surname `Boyd Alexander`. Neither table derives from the '
  'other and NOTHING inherits across them; a token confirmed there shows on the A3 card as '
  'evidence (also_confirmed_for_contacts) and settles nothing.';

comment on column public.lcc_ownership_sponsor_family.sponsor_entity_id is
  'The owner entity we hold. Matched through lcc_entity_survivor so a later merge cannot strand '
  'the confirmation (P175: existence is not liveness).';

-- ---------------------------------------------------------------------------
-- UNIT 4 — the classification view. One row per open mismatch chain.
-- Exposes only STRUCTURED signals; nothing greps the drafter's prose (P182 / A1).
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_ownership_mismatch_classified as
with base as (
  select s.research_task_id, s.entity_id, s.workspace_id, s.priority, s.created_at,
         s.current_owner_name, s.address, s.link_count, s.contiguous, s.proposal_id,
         (select l->>'to'   from jsonb_array_elements(p.proposed_link->'links')
            with ordinality a(l,o) order by o desc limit 1) as last_grantee,
         (select l->>'date' from jsonb_array_elements(p.proposed_link->'links')
            with ordinality a(l,o) order by o desc limit 1) as last_transfer_date,
         (select l->'citation'->>'data_source' from jsonb_array_elements(p.proposed_link->'links')
            with ordinality a(l,o) order by o desc limit 1) as last_data_source
    from v_lcc_ownership_history_lane_split s
    join lcc_clean_assist_proposals p on p.proposal_id = s.proposal_id
   where s.action = 'mismatch'
)
select b.research_task_id, b.entity_id, b.workspace_id, b.priority, b.created_at,
       b.current_owner_name, b.last_grantee, b.last_transfer_date, b.last_data_source,
       b.address, b.link_count, b.contiguous, b.proposal_id,
       lcc_ownership_mismatch_class(b.current_owner_name, b.last_grantee) as mismatch_class,
       lcc_ownership_sponsor_token(b.current_owner_name, b.last_grantee) as sponsor_token,
       -- which arm produced the token, for the card and for regression reading
       case
         when lcc_ownership_sponsor_token(b.current_owner_name, b.last_grantee) is null then null
         when lcc_tier0_brand_token(b.current_owner_name) = lcc_tier0_brand_token(b.last_grantee)
           then 'lead_token'
         else 'token_contained'
       end as sponsor_arm,
       -- WHICH GUARD dropped a pair that otherwise shared a token. Structured, not prose, so a
       -- future A3b can rank the residue without a second classifier.
       case
         when lcc_ownership_mismatch_class(b.current_owner_name, b.last_grantee) <> 'unexplained'
           then null
         when lcc_looks_like_person(b.current_owner_name) then 'owner_reads_as_person'
         when lcc_owner_name_is_brokerage(b.current_owner_name)
           or lcc_owner_name_is_brokerage(b.last_grantee) then 'brokerage'
         when lcc_name_reads_as_street(b.last_grantee) then 'grantee_reads_as_street'
         else 'no_shared_brand_token'
       end as unexplained_reason,
       lcc_is_spe_shell_name(b.last_grantee) as grantee_detected_as_spe,
       lcc_owner_known_annual_rent(b.entity_id) as owner_annual_rent,
       exists (
         select 1 from lcc_ownership_sponsor_family f
          where f.sponsor_entity_id = lcc_entity_survivor(b.entity_id)
            and f.sponsor_token = lcc_ownership_sponsor_token(b.current_owner_name, b.last_grantee)
       ) as sponsor_confirmed
  from base b;

comment on view public.v_lcc_ownership_mismatch_classified is
  'A3: every open ownership-history `mismatch` chain, classified. 74 chains / 46 owners / $403.0M '
  'distinct on 2026-08-27: sponsor_family_candidate 32, unexplained 31, name_variant 11. '
  '⚠️ owner_annual_rent is PER OWNER and repeats across that owner''s chains -- sum it over '
  'DISTINCT entity_id, and note three owners span two classes, so per-class sums double-count.';

-- ---------------------------------------------------------------------------
-- UNIT 5 — the proposals. ONE row per (sponsor entity, token) = one decision.
-- Value-ranked, so the operator meets the largest and most reliable end first.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_ownership_sponsor_family_proposals as
select c.entity_id as sponsor_entity_id,
       lcc_entity_survivor(c.entity_id) as sponsor_survivor_id,
       c.sponsor_token,
       max(c.current_owner_name) as sponsor_name,
       count(*)::int as chains_resolved,
       count(distinct c.sponsor_arm)::int as arms_used,
       string_agg(distinct c.sponsor_arm, ',' order by c.sponsor_arm) as sponsor_arms,
       string_agg(distinct c.last_grantee, ' | ' order by c.last_grantee) as grantees,
       max(c.owner_annual_rent) as owner_annual_rent,
       bool_or(c.sponsor_confirmed) as already_confirmed,
       -- Evidence, NOT an answer (P188): the same token confirmed for CONTACT matching.
       exists (select 1 from lcc_owner_sponsor_domain sd where sd.sponsor_token = c.sponsor_token)
         as also_confirmed_for_contacts,
       -- Blast radius of the bare token, so a generic one is visible before it is confirmed.
       (select count(*)::int from entities e
         where e.merged_into_entity_id is null
           and (' '||regexp_replace(lower(e.name),'[^a-z0-9]+',' ','g')||' ')
               like ('% '||c.sponsor_token||' %')) as token_entities_fleetwide
  from v_lcc_ownership_mismatch_classified c
 where c.mismatch_class = 'sponsor_family_candidate'
 group by c.entity_id, c.sponsor_token
 order by count(*) desc, max(c.owner_annual_rent) desc nulls last;

comment on view public.v_lcc_ownership_sponsor_family_proposals is
  'A3: one row per SPONSOR DECISION. 12 rows covering 32 chains on 2026-08-27 (Boyd Watterson 20 '
  'chains in one decision). Confirm with an INSERT into lcc_ownership_sponsor_family naming a '
  'confirmed_by -- the same curated shape P190/P196 established. NOTHING here writes. '
  '⚠️ Read token_entities_fleetwide before confirming: `east` names 146 live entities and `boyd` '
  '122. The A3 gate requires the token on BOTH the owner and the deed grantee of the SAME '
  'property, so that breadth cannot leak -- but it is on the card because a generic token is the '
  'weakest proposal in the set. ⚠️ also_confirmed_for_contacts is EVIDENCE ABOUT A DIFFERENT '
  'QUESTION and must not be read as a confirmation (P188).';

-- ---------------------------------------------------------------------------
-- UNIT 6 — the split view learns a FIFTH action, `sponsor_spe`, gated on a CONFIRMED row.
--
-- ⚠️ `agrees` IS DELIBERATELY NOT REUSED. Folding a confirmed sponsor chain into `agrees` would
--    hand it to A2's apply path (cron 244), which writes portfolio facts -- a materially bigger
--    decision than "these names describe one family", and one nobody has graded. A2 is untouched
--    and `agrees` must not move. Extending A2 to consume `sponsor_spe` is A3b, named not built.
--
-- ⚠️ `name_variant` DOES NOT get an action and STAYS human_actionable. Retiring it would let
--    lcc_owner_strict_core -- which A2 rejected for writes on this exact population -- silently
--    close 11 cards on an automated name judgement. It is labelled, not decided.
--
-- The whole view body is carried here, not just the delta (the P194 lesson). Two columns are
-- APPENDED AT THE END (`CREATE OR REPLACE VIEW` is append-only for columns, 42P16).
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_ownership_history_lane_split as
with open_tasks as (
  select rt.id, rt.workspace_id, rt.title, rt.status, rt.priority, rt.domain,
         rt.source_record_id, rt.entity_id, rt.assigned_to, rt.created_at, rt.updated_at
    from research_tasks rt
   where rt.research_type = 'establish_ownership_history'
     and rt.status = any (array['queued'::research_status, 'in_progress'::research_status])
), draft as (
  select r.proposal_id, r.proposed_link, r.reason, r.confidence, r.updated_at, r.research_task_id, r.rn
    from (
      select p.proposal_id, p.proposed_link, p.reason, p.confidence, p.updated_at,
             (p.proposed_link ->> 'research_task_id')::uuid as research_task_id,
             row_number() over (partition by ((p.proposed_link ->> 'research_task_id')::uuid)
                                order by p.proposal_id desc) as rn
        from lcc_clean_assist_proposals p
       where p.source = 'ownership_chain_draft' and p.status = 'proposed'
         and (p.proposed_link ->> 'research_task_id') is not null
    ) r
   where r.rn = 1
), scored as (
  select t.*, d.proposal_id, d.proposed_link, d.reason, d.confidence,
         d.updated_at as drafted_at,
         d.proposed_link ->> 'current_owner_name' as current_owner_name_x,
         (select l->>'to' from jsonb_array_elements(d.proposed_link->'links')
            with ordinality a(l,o) order by o desc limit 1) as last_grantee_x
    from open_tasks t
    left join draft d on d.research_task_id = t.id
), cls as (
  -- ⚠️ CLASSIFY ONLY THE MISMATCHES. Running the classifier over `agrees` / `no_records` rows
  -- would stamp every card with a class the question does not apply to -- the unearned-positive
  -- default (P124's `else` branch) in column form. NULL means "not a mismatch", not "unclassified".
  select s.*,
         case when s.proposal_id is not null
               and (s.proposed_link ->> 'draftable')::boolean is true
               and (s.proposed_link ->> 'terminates_at_current_owner')::boolean is false
              then lcc_ownership_mismatch_class(s.current_owner_name_x, s.last_grantee_x) end as mclass,
         case when s.proposal_id is not null
               and (s.proposed_link ->> 'draftable')::boolean is true
               and (s.proposed_link ->> 'terminates_at_current_owner')::boolean is false
              then lcc_ownership_sponsor_token(s.current_owner_name_x, s.last_grantee_x) end as mtoken
    from scored s
), fam as (
  select c.*,
         (c.mtoken is not null and exists (
            select 1 from lcc_ownership_sponsor_family f
             where f.sponsor_entity_id = lcc_entity_survivor(c.entity_id)
               and f.sponsor_token = c.mtoken)) as sponsor_confirmed
    from cls c
)
select t.id as research_task_id,
  t.workspace_id,
  t.title,
  t.status::text as status,
  t.priority,
  t.domain,
  t.source_record_id,
  t.entity_id,
  t.assigned_to,
  t.created_at,
  t.updated_at,
  t.proposal_id is not null as has_draft,
  case
    when t.proposal_id is null then null::text
    when ((t.proposed_link ->> 'draftable')::boolean) is not true then
      case t.proposed_link ->> 'insufficient_reason'
        when 'no_transitions_on_file'   then 'no_records'::text
        when 'all_transitions_guarded'  then 'all_guarded'::text
        else null::text
      end
    when ((t.proposed_link ->> 'terminates_at_current_owner')::boolean) is true then 'agrees'::text
    when ((t.proposed_link ->> 'terminates_at_current_owner')::boolean) is false
      then case when t.sponsor_confirmed then 'sponsor_spe'::text else 'mismatch'::text end
    else null::text
  end as action,
  case
    when t.proposal_id is null then 'awaiting_draft'::text
    when ((t.proposed_link ->> 'draftable')::boolean) is not true then
      case when (t.proposed_link ->> 'insufficient_reason')
             = any (array['no_transitions_on_file','all_transitions_guarded'])
           then 'classified'::text else 'unrecognised_payload'::text end
    when ((t.proposed_link ->> 'terminates_at_current_owner')::boolean) is not null
      then 'classified'::text
    else 'unrecognised_payload'::text
  end as split_state,
  case
    when t.proposal_id is null then false
    when ((t.proposed_link ->> 'draftable')::boolean) is not true
      then (t.proposed_link ->> 'insufficient_reason') = 'all_transitions_guarded'
    -- a confirmed sponsor family is answered; it is no longer a question for a human
    else ((t.proposed_link ->> 'terminates_at_current_owner')::boolean) is false
         and not t.sponsor_confirmed
  end as human_actionable,
  (t.proposed_link ->> 'draftable')::boolean as draftable,
  (t.proposed_link ->> 'terminates_at_current_owner')::boolean as terminates_at_current_owner,
  t.proposed_link ->> 'insufficient_reason' as insufficient_reason,
  t.proposed_link ->> 'current_owner_name' as current_owner_name,
  t.proposed_link ->> 'address' as address,
  coalesce(jsonb_array_length(coalesce(t.proposed_link -> 'links', '[]'::jsonb)), 0) as link_count,
  jsonb_array_length(coalesce(t.proposed_link -> 'rejected', '[]'::jsonb)) as rejected_count,
  ((t.proposed_link -> 'continuity') ->> 'contiguous')::boolean as contiguous,
  ((t.proposed_link -> 'continuity') ->> 'breaks')::integer as continuity_breaks,
  t.reason as draft_reason,
  t.confidence as draft_confidence,
  t.drafted_at,
  t.proposal_id,
  -- APPENDED (A3, 2026-08-27)
  t.mclass as mismatch_class,
  t.mtoken as mismatch_sponsor_token
from fam t;
