-- P194 — the Tier 0 lane becomes a LOOP: an auto-attach population, one owner for the
-- consumer-mailbox stoplist, and an honest account of what actually un-parks a card.
--
-- Follows prompt 192 (§1 auto-attach, §2 the living loop, §4 learning from verdicts).
-- Three of the four things it asked for were checked against live data first, and two of
-- them came back different from the brief. Those corrections are the substance here.
--
-- ============================================================================
-- 1. THE AUTO-ATTACH POPULATION — and the trap that would have hidden real cards
-- ============================================================================
-- P192 classified `decidability='auto'` (match_strength='exact' AND n_eligible=1) and left
-- the cards VISIBLE because no sweep wrote them (correct-and-invisible is Class 7). The
-- sweep now exists in the JS verdict path (api/_handlers/tier0-auto-attach-tick.js), so
-- those cards leave the queue by being DONE.
--
-- Re-measured 2026-08-26 (P192's header says 11; the lane has moved since — the dated-claim
-- doctrine, hit on our own two-hour-old note): **9 auto cards / 9 owners / $10.4M**, and all
-- 9 read correct on named rows — Deke Hunter @ hunterproperties.com for "Hunter Properties",
-- Joseph Paolino @ paolinoproperties.com for "Paolino Properties", John Bryant @
-- healthcarerealty.com for "Healthcare Realty Trust", and so on. 9/9.
--
-- ⚠️ AND THE SWEEP WOULD HAVE SILENTLY DELETED TWO REAL OPERATOR CARDS. The P192 lane view
-- excludes an owner whose pivot contact came from OUTSIDE this lane:
--     coalesce(pv.active_source,'') <> 'tier0_confirm'
-- A new source string ('tier0_auto') satisfies that inequality, so the first auto-attach on
-- an owner would have hidden EVERY OTHER open card for the same owner. Measured before
-- shipping: **3 of the 9 auto owners hold a second card**, two of them `ask` —
--     Healthcare Realty Trust  auto healthcarerealty.com  + ask healthcarerea.com
--     Capital Square 1031      auto capitalsquare1031.com + ask capitalsq.com
--     Hunter Properties        auto hunterproperties.com  + parked hunterinvestors.com
-- Two live questions would have vanished with no error and no trace. The predicate is now a
-- SET, not an inequality against one literal. **Whenever you add a value to a column that an
-- exclusion tests with `<>`, go read the exclusion** — a new enum member silently changes the
-- meaning of every `<>` written against the old one.
--
-- ============================================================================
-- 2. THE CONSUMER-MAILBOX STOPLIST GETS ONE OWNER
-- ============================================================================
-- Prompt 192: "the consumer-ISP stoplist tests only .com for some hosts — frontier.com is
-- listed, frontier.net is not." True, and the deeper cause is that the list is COPIED: the
-- same equality array + suffix regex appear in the P187 migration, the P188 migration and
-- (in a third spelling) the P134 note-lead rule. That is the normaliser drift this repo keeps
-- paying for, so the fix is a FUNCTION, not a longer regex in four places.
--
-- `lcc_is_consumer_mailbox_domain(text)` is IMMUTABLE and is now the single authority.
--
-- ⚠️ BLAST RADIUS MEASURED BEFORE WIDENING, because "obviously an ISP" is exactly the shape of
-- reasoning that produced the P158a `&` near-miss. Across the whole live person pool the
-- widening removes 41 people, and across the whole Tier 0 lane it removes **exactly ONE
-- card**: `Frontier Hub LLC -> frontier.net`, the named false positive from the P192 header.
-- Zero real cards are lost. Families added on that evidence (each verified present in the
-- pool): frontier.net, earthlink.com, cox.com, embarqmail, swbell, prodigy, centurylink,
-- suddenlink, pacbell, flash.net, ptd.net, mchsi, hughes.net.
--
-- ⚠️ NOT ADDED: `nc.rr.com`-style regional prefixes are already covered by the `(^|\.)` suffix
-- anchor, and no bare corporate domain was added on a hunch — a real firm at its own domain
-- must never be deleted from the pool to remove one bad card.
--
-- ============================================================================
-- 3. §2's HEADLINE CLAIM IS ONLY TRUE FOR ONE OF THE SIX SIGNALS IT LISTS
-- ============================================================================
-- P192 states the parked state is "dated and expiring by construction… a parked card returns
-- to `ask` automatically the moment new evidence lands", and lists six signals: correspondence,
-- an SF campaign, an SF contact, a title, a confirmed sponsor domain, a deal shown.
--
-- Read the decidability CASE. A `weak_partial` card is un-parked by exactly one term:
-- `n_link_evidence > 0` — which counts ONLY `ev_company_matches_owner`, i.e. the candidate's
-- `contact_company` string matching the OWNER's name. (A sponsor-map row also works, by
-- promoting match_strength to `curated_sponsor`.) Correspondence, SF campaign membership, an
-- SF contact record, an Outlook entry and a job title all move `n_person_evidence`, and
-- **the CASE never reads n_person_evidence**.
--
-- Measured: of the 146 parked cards, **95 ($118M) ALREADY carry person evidence** and are
-- parked anyway — and always will be, no matter how much more correspondence lands.
--
-- ⚠️ THE FIX IS NOT TO UN-PARK ON PERSON EVIDENCE. That would re-flood the queue with exactly
-- what P192 removed, and it is the P188 Gary George finding restated: person evidence attests
-- that the PERSON is real, never that they work for THIS owner. Widening here would undo the
-- lane's whole reason to exist. What is wrong is the CLAIM, not the gate — so this migration
-- ships the instrument (`v_lcc_tier0_park_watch`) that makes the real mechanism observable,
-- and the note above corrects the record. Class 10 wearing a disguise: the exclusion IS
-- self-clearing, but the only event that clears it is not among the events anyone expects.
--
-- ============================================================================
-- 4. §4's "learn from rejects" HAS NO INPUT, AND THE ATTACH ANALOGUE IS REFUTED
-- ============================================================================
-- Prompt 192 §4: "Start with the reject signal — it is the cheapest and it directly attacks
-- the 146 parked cards."
--
-- **There are ZERO rejects.** `lcc_tier0_confirm_log` holds 27 attaches and nothing else. The
-- 6 rows that read `reject` in `lcc_decisions` are `status='superseded'` — the
-- `owner_already_reachable` no-op branch, not an operator saying "wrong firm". A demotion
-- engine built on that is a consumer wired to a producer that does not exist (P137), so it is
-- NOT built here.
--
-- ⚠️ AND THE OBVIOUS SUBSTITUTE IS DESTRUCTIVE. The tempting move is to run the same rule on
-- the 27 ATTACHES: a domain already attached to owner A is evidence against proposing it to
-- owner B. Measured on every colliding pair — **16 open cards collide with an attached domain,
-- and 0 of 16 are contradictions.** 13 are the NGP SPE family sharing ngpv.com, and the other
-- three are `Cunningham Development` / `Cunningham Development Co` (a duplicate entity),
-- `Kb Exchange Trust` / `Exchangeright` and `Genesis Kc Dev` / `Genesis Financial Group`.
-- Demoting them would suppress the sponsor inheritance P193 exists to deliver. A shared domain
-- across owners is CORROBORATION or a merge signal, never a contradiction — the same 25%-
-- precision trap P189 measured and rejected for domain-keyed merge grouping.
--
-- REVERSAL:
--   drop view if exists public.v_lcc_tier0_park_watch;
--   drop table if exists public.lcc_tier0_auto_attach_run_log;
--   -- restore the prior candidates view + lane view from migration 20260827020000 / 20260827060000
--   -- and drop function lcc_is_consumer_mailbox_domain(text);
-- The auto-attached rows themselves reverse through the ledger:
--   update owner_contact_pivot p set active_contact_entity_id = l.prior_active_contact_entity_id,
--          active_contact_name = l.prior_active_contact_name, active_source = l.prior_active_source
--     from lcc_tier0_confirm_log l
--    where l.batch_tag like 't0auto_%' and l.reverted_at is null and p.entity_id = l.owner_entity_id;

-- ---------------------------------------------------------------------------
-- 2a. The single consumer-mailbox authority.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_is_consumer_mailbox_domain(p_domain text)
returns boolean
language sql
immutable
as $$
  select case
    when p_domain is null or btrim(p_domain) = '' then false
    else lower(btrim(p_domain)) = any (array[
           'gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','me.com',
           'live.com','msn.com','protonmail.com','mail.com','comcast.net','att.net','verizon.net'])
      -- Suffix-anchored so regional prefixes ('hawaii.rr.com', 'worldnet.att.net') are covered
      -- by the same entry rather than needing one row each.
      -- ⚠️ The whole alternation must stay inside ONE literal: `~` binds tighter than `||`,
      -- so a concatenated pattern parses as (x ~ 'first') || 'rest' and fails 42804 with a
      -- message that names OR rather than the operator that actually mis-bound.
      -- P194 additions: sibling TLDs frontier/earthlink/cox (.com AND .net), then the ISP
      -- families that were absent entirely (embarqmail 7, swbell 6, prodigy 5, centurylink 5,
      -- suddenlink 4, pacbell 4, flash 2, ptd 2, mchsi 1, hughes 1 -- each counted live).
      or lower(btrim(p_domain)) ~ ('(^|\.)(rr\.com|sbcglobal\.net|bellsouth\.net|charter\.net|optonline\.net|windstream\.net|roadrunner\.com|juno\.com|netzero\.net|mac\.com|frontier\.(com|net)|earthlink\.(com|net)|cox\.(com|net)|embarqmail\.com|swbell\.net|prodigy\.net|centurylink\.net|suddenlink\.net|pacbell\.net|flash\.net|ptd\.net|mchsi\.com|hughes\.net)$')
  end;
$$;

comment on function public.lcc_is_consumer_mailbox_domain(text) is
  'THE single test for "this email domain is a personal mailbox, not a firm". P194: the '
  'equality array and the suffix regex previously existed as copies in three migrations and '
  'had already drifted (frontier.com listed, frontier.net not -- which is what proposed '
  '"Frontier Hub LLC -> frontier.net", an ISP, as a Tier 0 card). Extend HERE and nowhere '
  'else, and measure the blast radius on live cards before adding a family: the P194 widening '
  'was verified to remove exactly 1 card, the known false positive.';

-- ---------------------------------------------------------------------------
-- 2b. The candidates view. Rebuilt from the P188 source, PLUS the two things P190
--     applied live and never committed (is_not_prospected; the sponsor_map arm),
--     PLUS the mailbox function. See the ARM 3 note below -- this rebuild is why
--     the "read the live definition" convention is retired.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_owner_contact_candidates as
with owner_rent as (
  select f.entity_id, coalesce(sum(f.annual_rent) filter (where f.is_current),0)::numeric as owner_rent
  from lcc_entity_portfolio_facts f group by f.entity_id
),
owners as (
  select distinct po.owner_entity_id as owner_id, e.name as owner_name,
         coalesce(r.owner_rent,0)::numeric as owner_rent,
         lcc_owner_domain_core(e.name) as core
  from lcc_property_owner po
  join entities e on e.id = po.owner_entity_id
  left join owner_rent r on r.entity_id = po.owner_entity_id
  where e.merged_into_entity_id is null and e.entity_type = 'organization'::entity_type
    and coalesce(r.owner_rent,0) >= 500000::numeric
    -- P190: public bodies AND universities are not prospected.
    and not lcc_owner_name_is_not_prospected(e.name)
),
owner_tok as (
  select o.owner_id, o.owner_name, o.owner_rent, t.t as tok
  from owners o
  cross join lateral unnest(
    regexp_split_to_array(lower(regexp_replace(o.owner_name,'[^a-zA-Z ]','','g')),'\s+')) t(t)
  where length(t.t) >= 5
    and t.t <> all (array[
      -- legal / structural
      'trust','group','holdings','properties','partners','capital','company','realty',
      'investors','management','development','associates','incorporated','limited',
      'national','american','government','property','asset','assets','income','equity',
      'equities','commercial','residential','industrial','venture','ventures','enterprise',
      'enterprises','financial','finance','realestate','services','solutions','systems',
      'corporation','partnership','premier','first','second','third','general','united','global',
      -- directional / generic descriptors
      'western','eastern','northern','southern','pacific','atlantic','central',
      -- P187: generic CRE / address nouns measured as error sources
      'tenant','tenants','developer','developers','office','offices','urban','gateway',
      'street','avenue','building','buildings','center','centre','plaza','tower','towers',
      'place','court','square','station','village','ridge','creek','valley','lakes','river',
      'point','pointe','heights','hills','springs','grove','woods','meadows','landing',
      'crossing','commons','terrace','harbor','island','beach','bridge','summit','estates',
      'campus','market','metro','brook','stone','columbia','century','north','south','america',
      -- P187: geography (SHORT, CURATED — not every city; see the P187 header)
      'omaha','denver','dallas','houston','phoenix','austin','seattle','portland','atlanta',
      'boston','chicago','detroit','orlando','tampa','tucson','wichita','spokane','fresno',
      'tulsa','hawaii','alaska','nevada','arizona','indiana','kansas','oregon','montana',
      'dakota','nebraska','oklahoma','missouri','michigan','wisconsin','minnesota','colorado',
      'virginia','carolina','tennessee','kentucky','alabama','mississippi','louisiana',
      'arkansas','delaware','maryland','florida','georgia','worth'
    ])
),
people as (
  select e.id as person_id, e.name as person_name, e.email, e.phone,
         lower(split_part(split_part(e.email,'@',2),'.',1)) as sld,
         regexp_replace(lower(split_part(split_part(e.email,'@',2),'.',1)),'[^a-z0-9]','','g') as sldn,
         lower(split_part(e.email,'@',2)) as domain
  from entities e
  where e.entity_type = 'person'::entity_type
    and e.merged_into_entity_id is null
    and e.email like '%@%'
    -- P194: the equality list and the suffix regex are now ONE function with ONE
    -- owner (lcc_is_consumer_mailbox_domain). They were duplicated across three
    -- migrations and had already drifted -- 'frontier.com' listed, 'frontier.net'
    -- not, which is what proposed "Frontier Hub LLC -> frontier.net" (an ISP).
    and not lcc_is_consumer_mailbox_domain(split_part(e.email,'@',2))
),
person_prefix as (
  select p.person_id, p.sld, left(p.sld,k) as pfx from people p
  cross join lateral generate_series(5, length(p.sld)) as k
),
tok_fan as (
  -- ⚠️ P188 PERF: this gate was the LAST surviving copy of the un-keyed cross product P186
  --   removed from `matched`. P187 added the fan-out gate written the obvious way --
  --   `people p on p.sld like ot.tok||'%'` -- which the planner can only serve as a Nested Loop
  --   with a Join Filter: measured `Rows Removed by Join Filter: 6,222,095`, 1.78 s of a 3.10 s
  --   view. Fixing `matched` and leaving the GATE on a cross product is the same defect wearing a
  --   different hat, and it was invisible because the gate returns only 160 rows.
  --   The rewrite is P186's own identity, reused verbatim: for a token of length >= 5,
  --   `sld LIKE tok || '%'`  <=>  `left(sld, length(tok)) = tok`, i.e. exactly the prefix rows
  --   `person_prefix` already materialises. Equality join, hashable. Logically identical, not an
  --   approximation -- confirmed by a 0-row EXCEPT ALL diff both directions.
  select ot.tok, count(distinct pp.sld) as dd, count(distinct ot.owner_id) as od
  from owner_tok ot join person_prefix pp on pp.pfx = ot.tok
  group by ot.tok
),
pfx_fan as (
  select left(sldn,8) as p8, count(distinct sldn) as dd
  from people where length(sldn) >= 8 group by 1
),
matched_raw as (
  -- ARM 1: distinctive token prefix-matches the domain, fan-out gated
  select distinct ot.owner_id, pp.person_id, 'token'::text as arm, ot.tok as key
  from owner_tok ot
  join tok_fan tf on tf.tok = ot.tok and tf.dd <= 2 and tf.od <= 2
  join person_prefix pp on pp.pfx = ot.tok
  union
  -- ARM 2: 8-char core/domain prefix equality, fan-out gated
  select distinct o.owner_id, p.person_id, 'core8'::text, left(p.sldn,8)
  from owners o
  join people p on length(o.core) >= 8 and length(p.sldn) >= 8
                and left(o.core,8) = left(p.sldn,8)
  join pfx_fan f on f.p8 = left(p.sldn,8) and f.dd <= 2
  union
  -- ⚠️ P190 ARM 3 — the human-confirmed sponsor map. P190 applied this arm LIVE and
  -- deliberately did NOT commit the view body, saying "read the LIVE definition
  -- (pg_get_viewdef) as the authority ... not duplicated here to avoid two copies drifting
  -- apart." The intent was right and the effect was the opposite: the newest COMMITTED
  -- source (P188) no longer described the shipped view, so P194's first rebuild silently
  -- dropped this arm AND P190's is_not_prospected gate. The equivalence gate caught it --
  -- 20 cards removed (13 ngpv.com, 5 uirc.com, 1 jbg.com) and George Washington University
  -- resurrected -- against a predicted diff of exactly 1. **A migration that changes a view
  -- must carry the whole view. "Read the live definition" makes the repo an unreliable
  -- source and guarantees the next rebuild regresses; a second copy that is CORRECT beats
  -- no copy at all.**
  select distinct o.owner_id, p.person_id, 'sponsor_map'::text, sd.sponsor_token
  from owners o
  join lcc_owner_sponsor_domain sd on o.owner_name ~* ('\m'||sd.sponsor_token||'\M')
  join people p on p.domain = sd.email_domain
),
matched as (
  -- Back to ONE row per (owner, person) so the pair set and its multiplicity are exactly what
  -- the pre-P188 `union` produced; the arms/keys ride along as text.
  select owner_id, person_id,
         string_agg(distinct arm, '+' order by arm) as match_arm,
         string_agg(distinct key, ',' order by key) as match_key
  from matched_raw group by owner_id, person_id
),
owner_has_contact as (
  select distinct pv.entity_id from owner_contact_pivot pv
  where pv.active_contact_entity_id is not null
),
rel_pair as (
  select from_entity_id as a, to_entity_id as b from entity_relationships
  union
  select to_entity_id, from_entity_id from entity_relationships
)
select o.owner_id, o.owner_name, o.owner_rent,
       p.person_id, p.person_name, p.email, p.domain,
       uc.title as contact_title, uc.company_name as contact_company,
       case
         when uc.title ~* '(acquisition|investment|capital market)' then 'acquisitions'
         when uc.title ~* '(disposition|asset manage|portfolio manage)' then 'disposition'
         when uc.title ~* '(broker|agent|realtor)' then 'broker'
         when uc.title ~* '(analyst|coordinator|assistant|coordinator|transaction|due diligence|escrow)' then 'transaction_support'
         when uc.title ~* '(president|principal|partner|owner|founder|ceo|managing director)' then 'principal'
         when uc.title is not null and uc.title <> '' then 'other_titled'
         else 'no_title'
       end as role_bucket,
       uc.outlook_contact_id is not null as from_outlook_sync,
       ohc.entity_id is not null         as owner_already_has_contact,
       rp.a is not null                  as already_linked,
       -- P188 (APPENDED): why this pair was proposed.
       m.match_arm,
       m.match_key
from matched m
join owners o                 on o.owner_id  = m.owner_id
join people p                 on p.person_id = m.person_id
left join unified_contacts uc on lower(uc.email) = lower(p.email)
left join owner_has_contact ohc on ohc.entity_id = o.owner_id
left join rel_pair rp on rp.a = o.owner_id and rp.b = p.person_id;

-- ---------------------------------------------------------------------------
-- 1a. The lane view's owner-exclusion becomes a SET.
--
-- ⚠️ THIS IS THE WHOLE REASON THE SWEEP IS SAFE. `<> 'tier0_confirm'` means "any source
-- other than a Tier 0 human verdict proves the owner was solved elsewhere, so stop asking".
-- 'tier0_auto' is ALSO this lane solving the owner, so it must be inside the exemption, not
-- outside it. Measured: without this change the first auto-attach hides
-- `healthcarerea.com [ask]` and `capitalsq.com [ask]` — two live operator questions — with
-- no error, no log line and no way to notice.
--
-- Everything else in this view is unchanged from P192 (20260827060000).
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_owner_contact_lane_triage as
with base as (
  select l.*,
         lcc_owner_domain_core(l.owner_name) as owner_core,
         regexp_replace(lower(split_part(l.domain,'.',1)),'[^a-z0-9]','','g') as domain_sld
  from public.v_lcc_tier0_owner_contact_lane l
  where l.n_eligible > 0
    -- owners whose contact came from OUTSIDE this lane need no acquisition (P188 intent,
    -- P191 form). P194: a SET, so adding a lane-internal source cannot silently widen it.
    and not exists (
      select 1 from owner_contact_pivot pv
      where pv.entity_id = l.owner_id and pv.active_contact_entity_id is not null
        and coalesce(pv.active_source,'') not in ('tier0_confirm','tier0_auto'))
    -- close only the (owner, DOMAIN) actually decided (P191)
    and not exists (
      select 1 from lcc_tier0_confirm_log cl
      where cl.owner_entity_id = l.owner_id and cl.domain = l.domain and cl.reverted_at is null)
), classed as (
  select b.*,
    case when b.domain_sld = b.owner_core                                       then 'exact'
         when b.owner_core like b.domain_sld||'%' and length(b.domain_sld) >= 6 then 'domain_is_core_prefix'
         when b.domain_sld like b.owner_core||'%' and length(b.owner_core) >= 6 then 'core_is_domain_prefix'
         when 'sponsor_map' = any(string_to_array(b.match_arms,'+'))            then 'curated_sponsor'
         else 'weak_partial' end as match_strength
  from base b
)
select c.*,
  case when c.match_strength = 'exact' and c.n_eligible = 1 then 'auto'
       when c.match_strength in ('exact','domain_is_core_prefix','core_is_domain_prefix','curated_sponsor') then 'ask'
       when c.n_link_evidence > 0 then 'ask'
       else 'parked_domain_only' end as decidability
from classed c;

comment on view public.v_lcc_tier0_owner_contact_lane_triage is
  'Every open Tier 0 card, classified by match_strength (how strongly the email domain '
  'identifies the owner) and decidability (auto / ask / parked_domain_only). Computed LIVE, '
  'never stored. P194: the pivot exclusion is a SET (tier0_confirm, tier0_auto) -- an auto '
  'attach on one domain must not hide the same owner''s other open cards, which an inequality '
  'against a single literal silently did.';

-- ---------------------------------------------------------------------------
-- 3a. The park-watch instrument.
--
-- Makes the §3 finding above observable instead of a paragraph: per parked card, what
-- evidence is ALREADY on file (and therefore did not un-park it) and what would actually
-- have to change. It writes nothing and gates nothing -- its whole job is to stop
-- "parked" from reading as "waiting for evidence" when 95 of 146 are waiting for a
-- DIFFERENT KIND of evidence than the one arriving.
--
-- `unpark_requires` names the real event. `person_evidence_already_landed` is the count that
-- refutes the assumption. Read them together; either alone misleads.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_park_watch as
select t.owner_id, t.owner_name, t.domain, t.owner_rent, t.match_strength,
       t.n_eligible, t.n_link_evidence, t.n_person_evidence,
       (t.n_person_evidence > 0) as person_evidence_already_landed,
       t.match_arms, t.match_keys,
       -- The ONLY three events that move this card into `ask`.
       case when t.n_link_evidence > 0 then 'already_unparked'
            else 'a candidate''s contact_company must match this owner, '
                 || 'OR a lcc_owner_sponsor_domain row must confirm the domain, '
                 || 'OR a new candidate at this domain must arrive carrying a matching company'
       end as unpark_requires,
       -- Stated out loud so nobody re-derives the wrong expectation from the card.
       (t.n_person_evidence > 0) as evidence_arrived_but_did_not_unpark
from public.v_lcc_tier0_owner_contact_lane_triage t
where t.decidability = 'parked_domain_only';

comment on view public.v_lcc_tier0_park_watch is
  'P194 instrument for prompt 192 §2. A parked Tier 0 card is un-parked by ONE term of the '
  'decidability CASE -- n_link_evidence > 0 (contact_company matches the OWNER) -- or by a '
  'sponsor-map row. Correspondence, SF campaigns, SF contacts, Outlook entries and titles all '
  'move n_person_evidence, which the CASE never reads: 95 of 146 parked cards ($118M) already '
  'carry person evidence and are parked anyway. Do NOT "fix" that by un-parking on person '
  'evidence -- P188 measured that person evidence does not attest the employer link (Gary '
  'George at a poultry company, green on three person signals for George Washington '
  'University), and widening here would restore exactly the noise P192 removed.';

-- ---------------------------------------------------------------------------
-- 1b. Run log for the auto-attach sweep (P123 lifecycle).
--
-- Opened at request entry (status='started'), PATCHed on the way out. A row still reading
-- 'started' means the handler never came back -- which pg_net cannot tell you, because it
-- records only the HTTP attempt and prunes net._http_response to ~6 hours.
--
-- ⚠️ `already_attached` and `skipped_*` are RE-DISCOVERY tallies and must never be read as
-- throughput (P159a). The state delta is `attached` -- and, honestly, `cards_open_before` /
-- `cards_open_after`, which is the population the sweep is supposed to drain.
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_tier0_auto_attach_run_log (
  run_id             bigserial primary key,
  ran_at             timestamptz not null default now(),
  finished_at        timestamptz,
  duration_ms        integer,
  status             text not null default 'started',
  ok                 boolean,
  trigger_source     text,                    -- 'cron' | 'manual' | 'api'
  batch_tag          text,                    -- joins to lcc_tier0_confirm_log.batch_tag
  flag_enabled       boolean,
  dry_run            boolean not null default false,
  batch_limit        integer,
  -- Scan shape.
  auto_candidates    integer,                 -- decidability='auto' rows seen
  planned            integer,                 -- passed the pure planner
  skipped_not_auto   integer,
  skipped_gate       integer,                 -- failed the JS shape gate / verdict gate
  skipped_owner_has_contact integer,          -- fill-blanks: solved since the scan
  -- The state delta.
  attached           integer,
  failed_writes      integer,
  -- The honest drain: the lane population before and after.
  cards_open_before  integer,
  cards_open_after   integer,
  capped             boolean not null default false,
  budget_stopped     boolean not null default false,
  error_count        integer not null default 0,
  detail             jsonb
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.lcc_tier0_auto_attach_run_log'::regclass
                    and conname  = 'chk_tier0_auto_attach_run_log_status') then
    alter table public.lcc_tier0_auto_attach_run_log
      add constraint chk_tier0_auto_attach_run_log_status
      check (status in ('started','completed','failed'));
  end if;
end $$;

create index if not exists idx_tier0_auto_attach_run_log_ran_at
  on public.lcc_tier0_auto_attach_run_log (ran_at desc);

comment on table public.lcc_tier0_auto_attach_run_log is
  'P194 run ledger for the Tier 0 auto-attach sweep. Row OPENED before the work and closed on '
  'the way out, so a run that dies mid-flight leaves status=''started'' instead of nothing. '
  'Read `attached` and the cards_open_before/after delta; `already_*`/`skipped_*` are '
  're-discovery tallies that read exactly like throughput while nothing moves (P159a).';

create or replace view public.v_lcc_tier0_auto_attach_run_health as
select run_id, ran_at, status, ok, dry_run, trigger_source, batch_tag,
       auto_candidates, planned, attached, failed_writes,
       cards_open_before, cards_open_after,
       (cards_open_before - cards_open_after) as cards_drained,
       capped, budget_stopped, error_count, duration_ms
from public.lcc_tier0_auto_attach_run_log
order by ran_at desc;

comment on view public.v_lcc_tier0_auto_attach_run_health is
  'P194: recent auto-attach runs, with cards_drained (the state delta) next to attached (the '
  'write tally). They should agree; a run where attached > 0 and cards_drained = 0 means the '
  'writes are not removing cards from the lane, which is the failure that looks like success.';

-- ---------------------------------------------------------------------------
-- Flag registry (audit 4.4.3): an env-gated capability must be visible when OFF.
-- ---------------------------------------------------------------------------
insert into public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
values ('TIER0_AUTO_ATTACH',
        'Auto-attach the Tier 0 cards the data already answers: exact domain<->owner core match '
        'with exactly ONE eligible candidate. Writes through the same JS verdict path (and the '
        'same shape guards) a human click uses.',
        'POST /api/tier0-auto-attach-tick (cron lcc-tier0-auto-attach)',
        'TIER0_AUTO_ATTACH', 'off', now(), 'scott',
        'OFF pending Scott''s read of the GET dry-run. Population is 9 cards / $10.4M, read 9/9 '
        'correct on named rows. Deliberately NOT extended to domain_is_core_prefix, which reads '
        '~9/12 and proposes JP Morgan CMBS Trust -> jpmorgan.com. The GET grade path is ungated '
        'so the flag can be judged before it is flipped.')
on conflict (flag) do update set
  purpose = excluded.purpose, surface = excluded.surface,
  env_var = excluded.env_var, notes = excluded.notes;

-- ---------------------------------------------------------------------------
-- 1c. Schedule the sweep. 06:55 UTC (jobid 241).
--
-- Chosen because it lands AFTER `lcc-owner-contact-pivot-refresh` (05:20), which is what makes
-- the sweep's fill-blanks check honest: the pivot must be current or the sweep can attach to an
-- owner that was solved elsewhere overnight. It is also the only free minute at the end of the
-- 06:xx block (06:20/25/30/35/40/45/50 each already carry 1-4 jobs).
--
-- ⚠️ DELIBERATELY NOT GATED ON THE FLAG (the P133 rule). With TIER0_AUTO_ATTACH off the POST
-- no-ops and the run log records `flag_enabled=false, attached=0` -- visible. An UNSCHEDULED job
-- is invisible, and "we'll add the cron when we flip the flag" is how a capability ships and then
-- silently never runs.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'lcc_cron_post') then
    perform cron.unschedule('lcc-tier0-auto-attach')
      where exists (select 1 from cron.job where jobname = 'lcc-tier0-auto-attach');
    perform cron.schedule('lcc-tier0-auto-attach', '55 6 * * *',
      $cron$SELECT public.lcc_cron_post('/api/tier0-auto-attach-tick', '{"limit":50,"source":"cron"}'::jsonb, 'railway');$cron$);
  end if;
end $$;
