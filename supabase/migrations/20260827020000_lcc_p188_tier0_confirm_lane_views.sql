-- P188 — the Tier 0 CONFIRM LANE: turn the bench into calls, one human verdict at a time.
--
-- P186 fixed the view's performance and scope; P187 fixed the matching rule. Neither wrote
-- anything to `owner_contact_pivot`, and that is still the right state: measured top-45-by-rent
-- precision is ~91% and it decays to ~60-70% in the ~$2M single-property SPE band. One in eleven
-- unattended writes at the TOP of the book would put the wrong firm's employee on an owner, and
-- worse further down. So the consumer is a HUMAN VERDICT LANE, not a promoter.
--
-- This migration is VIEWS ONLY. It mutates no data and creates no writer. The write path is the
-- Decision Center verdict in api/admin.js (attach / reject / research), which re-runs the pure
-- shape gate server-side before it writes.
--
-- ============================================================================
-- PART 1 — append match provenance to the candidates view
-- ============================================================================
-- The operator's whole job in this lane is judging whether a person works for THIS owner. The
-- view already knows exactly why it proposed each pair -- which token, or which 8-char core
-- prefix -- and threw that away. Carrying it is what lets a card say "matched on the token
-- 'george'", which is the single most useful fact for rejecting George Washington University ->
-- georgesinc.com (P187's recorded residue: the token has fan-out 1, so no fan-out gate can ever
-- see it, and only a human can).
--
-- ⚠️ `CREATE OR REPLACE VIEW` is APPEND-ONLY for columns (42P16 if you insert one mid-list), so
-- match_arm/match_key go at the END. Everything above them is byte-identical to P187 except that
-- the two arms of `matched` now carry their arm + key and are aggregated back to ONE row per
-- pair -- the previous `union` already collapsed a pair matched twice, so the pair set and its
-- multiplicity are unchanged. Verified by an EXCEPT ALL diff both directions (0 rows) against a
-- same-session snapshot of the pre-change view; snapshot dropped afterwards (a stale baseline
-- left lying around is the P176 shelf-life trap).

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
    and not lcc_owner_name_is_public_body(e.name)
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
    and lower(split_part(e.email,'@',2)) <> all (array[
      'gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','me.com',
      'live.com','msn.com','protonmail.com','mail.com','comcast.net','att.net','verizon.net'])
    and lower(split_part(e.email,'@',2)) !~
        '(^|\.)(rr\.com|sbcglobal\.net|bellsouth\.net|cox\.net|charter\.net|earthlink\.net|optonline\.net|windstream\.net|roadrunner\.com|juno\.com|netzero\.net|mac\.com|frontier\.com)$'
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

comment on view public.v_lcc_tier0_owner_contact_candidates is
  'Tier 0 owner-contact bench: (owner, person) pairs proposed by email-domain matching. '
  'P188 appended match_arm/match_key -- the token or 8-char core prefix that produced the pair -- '
  'because judging "does this person work for THIS owner" is exactly the question the confirm '
  'lane asks, and the matching key is the evidence for it. RECALL NET, NOT AN IDENTITY RULE: '
  'never write from this view unattended (measured precision ~91% at the top of the rent book, '
  '~60-70% in the ~$2M SPE band).';

-- ============================================================================
-- PART 2 — the confirm-lane view: ONE CARD PER (OWNER, DOMAIN)
-- ============================================================================
-- ⚠️ THE UNIT OF JUDGEMENT IS THE (OWNER, DOMAIN) PAIR, NOT THE (OWNER, PERSON) PAIR.
--   RMR Group carries 20 people at rmrgroup.com. "Do RMR's people work for RMR?" is ONE
--   judgement; asking it twenty times is the badge-that-is-noise failure this repo keeps
--   documenting. Once the operator accepts the domain, picking WHICH human to call is a second,
--   cheaper decision made on the same card. Live: 558 pairs collapse to 283 cards.
--   And the split is real, not cosmetic -- RMR also has rob@rmrgroupinc.com, a DIFFERENT domain
--   and therefore a separate judgement, which per-owner grouping would have silently folded in.
--
-- EVIDENCE, AND WHAT IT ACTUALLY PROVES (P186 §5's structural finding, encoded).
--   Salesforce campaign membership, a Salesforce contact record, an Outlook address-book entry
--   and real correspondence all answer "is this person real and known to us?" -- they say
--   NOTHING about whether the person works for this owner. Gary George at georgesinc.com (a
--   poultry company) passes three of the four for George Washington University.
--   So evidence is split into two labelled classes and the card must never blur them:
--     PERSON evidence  -- sf_campaign, sf_contact, outlook, correspondence, company_confirms_employer
--     LINK   evidence  -- company_matches_owner  (the contact's stated employer IS this owner)
--   Only LINK evidence corroborates the thing being decided. n_link_evidence is therefore
--   surfaced separately from n_person_evidence, and neither is a gate -- a human decides.
--
--   ⚠️ company_confirms_employer and company_matches_owner are DIFFERENT CLAIMS and were measured
--   apart on purpose. Gary George's company "George's Inc" DOES corroborate the domain
--   georgesinc.com (he really works there) and does NOT corroborate the owner. Collapsing them
--   into one "company corroborates" flag -- which is what P186 §5 measured -- is precisely how
--   that row came back green.
--
-- ELIGIBILITY. Three exclusions, all of them the HOUSE rule rather than a re-implementation:
--   * role_bucket = 'broker'  -- the view's OWN derived column. A broker is the agent, never the
--     principal, at any deal size (owner-reachable-via NON_REACHABLE_ROLES; excluded outright,
--     never merely ranked last).
--   * lcc_is_rejected_contact_name() / lcc_looks_like_person() -- the same two SQL guards
--     v_owner_contact_candidates already uses for this exact question. Reuse, not a copy.
--   An excluded person is KEPT ON THE CARD, flagged with its reason, rather than hidden: the
--   operator seeing "1 broker excluded" is the honest count; silently dropping it is not.
--   The JS planner re-applies a name-shape gate on top (isPersonShaped + a narrow role/legal-form
--   stoplist measured on this bench) and the verdict path re-runs it again before writing.

create or replace view public.v_lcc_tier0_owner_contact_lane as
with c as (
  select * from public.v_lcc_tier0_owner_contact_candidates
),
uc as (
  -- Pre-AGGREGATED by email. unified_contacts is not unique on email, and the candidates view
  -- LEFT JOINs it raw -- a correlated re-join here would fan a card's people list out silently.
  select lower(u.email) as email_l,
         bool_or(u.sf_contact_id is not null)      as has_sf_contact,
         bool_or(u.outlook_contact_id is not null) as has_outlook,
         bool_or(u.last_email_date is not null
                 or u.last_meeting_date is not null
                 or u.last_call_date is not null)  as has_correspondence,
         max(u.last_email_date)                    as last_email_date
  from public.unified_contacts u
  where u.email is not null and u.email <> ''
  group by lower(u.email)
),
camp as (
  select m.entity_id,
         count(*)::int as n_campaigns,
         (array_agg(distinct m.campaign_name))[1:3] as campaign_names
  from public.lcc_sf_list_membership m
  where m.entity_id is not null
  group by m.entity_id
),
enriched as (
  select c.*,
    public.lcc_owner_domain_core(c.owner_name)      as owner_core,
    public.lcc_owner_domain_core(c.contact_company) as company_core,
    regexp_replace(lower(split_part(c.domain,'.',1)),'[^a-z0-9]','','g') as sldn,
    coalesce(uc.has_sf_contact,     false) as ev_sf_contact,
    coalesce(uc.has_outlook,        false) as ev_outlook,
    coalesce(uc.has_correspondence, false) as ev_correspondence,
    uc.last_email_date,
    coalesce(camp.n_campaigns, 0)          as n_campaigns,
    camp.campaign_names,
    (c.role_bucket = 'broker')                            as is_broker,
    public.lcc_is_rejected_contact_name(c.person_name)     as name_rejected,
    public.lcc_looks_like_person(c.person_name)            as name_person_shaped
  from c
  left join uc   on uc.email_l   = lower(c.email)
  left join camp on camp.entity_id = c.person_id
),
scored as (
  select e.*,
    (e.n_campaigns > 0) as ev_sf_campaign,
    (length(e.company_core) >= 5 and length(e.sldn) >= 5
      and (position(e.company_core in e.sldn) > 0 or position(e.sldn in e.company_core) > 0)
    ) as ev_company_confirms_employer,
    (length(e.company_core) >= 6 and length(e.owner_core) >= 6
      and (position(e.company_core in e.owner_core) > 0
           or position(e.owner_core in e.company_core) > 0
           -- A shared distinctive OPENING is what catches the real ones containment misses:
           -- "Easterly Partners" vs "Easterly Gov Properties" share `easterly` and contain
           -- neither. "George's Inc" -> core `georges` (7 chars) never reaches this arm, which
           -- is the whole point.
           or (length(e.company_core) >= 8 and length(e.owner_core) >= 8
               and left(e.company_core,8) = left(e.owner_core,8)))
    ) as ev_company_matches_owner,
    (not (e.role_bucket = 'broker') and not e.name_rejected and e.name_person_shaped) as eligible,
    case when e.role_bucket = 'broker'   then 'broker_role'
         when e.name_rejected            then 'rejected_contact_name'
         when not e.name_person_shaped   then 'not_person_shaped'
         else null end as block_reason
  from enriched e
),
grouped as (
  select
    s.owner_id, s.owner_name, max(s.owner_rent) as owner_rent, s.domain,
    count(*)::int                                        as n_candidates,
    count(*) filter (where s.eligible)::int              as n_eligible,
    count(*) filter (where not s.eligible)::int          as n_excluded,
    bool_or(s.owner_already_has_contact)                 as owner_already_has_contact,
    count(*) filter (where s.eligible and s.ev_company_matches_owner)::int as n_link_evidence,
    count(*) filter (where s.eligible and (s.ev_sf_campaign or s.ev_sf_contact
                       or s.ev_outlook or s.ev_correspondence
                       or s.ev_company_confirms_employer))::int            as n_person_evidence,
    count(*) filter (where s.eligible and s.already_linked)::int           as n_already_linked,
    string_agg(distinct s.match_arm, '+' order by s.match_arm)             as match_arms,
    (array_agg(distinct s.match_key))[1:4]                                 as match_keys,
    jsonb_agg(jsonb_build_object(
      'person_id',   s.person_id,
      'person_name', s.person_name,
      'email',       s.email,
      'title',       s.contact_title,
      'company',     s.contact_company,
      'role_bucket', s.role_bucket,
      'match_arm',   s.match_arm,
      'match_key',   s.match_key,
      'eligible',    s.eligible,
      'block_reason',s.block_reason,
      'already_linked',   s.already_linked,
      'from_outlook_sync',s.from_outlook_sync,
      'last_email_date',  s.last_email_date,
      'campaign_names',   to_jsonb(coalesce(s.campaign_names, array[]::text[])),
      'evidence', jsonb_build_object(
        'sf_campaign',               s.ev_sf_campaign,
        'sf_contact',                s.ev_sf_contact,
        'outlook',                   s.ev_outlook,
        'correspondence',            s.ev_correspondence,
        'company_confirms_employer', s.ev_company_confirms_employer,
        'company_matches_owner',     s.ev_company_matches_owner)
      )
      order by s.eligible desc, s.ev_company_matches_owner desc,
               (s.role_bucket in ('acquisitions','principal')) desc,
               s.person_name)                                              as people
  from scored s
  group by s.owner_id, s.owner_name, s.domain
)
select g.*,
       e.workspace_id                                    as owner_workspace_id,
       count(*) over (partition by g.owner_id)::int      as owner_domain_cards,
       g.owner_rent                                      as rank_value
from grouped g
left join public.entities e on e.id = g.owner_id;

comment on view public.v_lcc_tier0_owner_contact_lane is
  'P188 Tier 0 confirm lane: ONE card per (owner, email domain). The judgement is "do the people '
  'at this domain work for this owner"; picking the human is a second decision on the same card. '
  'Evidence is split into PERSON evidence (sf_campaign/sf_contact/outlook/correspondence/'
  'company_confirms_employer -- proves the person is real and known to us) and LINK evidence '
  '(company_matches_owner -- proves their stated employer IS this owner). Only the latter '
  'corroborates the decision; neither is a gate. Ineligible people (broker role, rejected or '
  'non-person name) stay ON the card flagged with a reason rather than being hidden.';

-- ---------------------------------------------------------------------------
-- The ACTIONABLE slice (Consumption-Layer rule 3: actionable-only, value-ranked).
-- An owner that already carries an active contact does not need one found; a card with no
-- eligible person cannot be acted on. Both drop out, so the badge counts work, not output.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_owner_contact_lane_open as
select * from public.v_lcc_tier0_owner_contact_lane
where not owner_already_has_contact and n_eligible > 0;

comment on view public.v_lcc_tier0_owner_contact_lane_open is
  'Actionable slice of v_lcc_tier0_owner_contact_lane: owner not already reachable AND at least '
  'one eligible person on the card. This is what the Decision Center badge counts.';

grant select on public.v_lcc_tier0_owner_contact_lane      to authenticated, service_role;
grant select on public.v_lcc_tier0_owner_contact_lane_open to authenticated, service_role;

-- ============================================================================
-- REVERSAL
-- ============================================================================
--   drop view if exists public.v_lcc_tier0_owner_contact_lane_open;
--   drop view if exists public.v_lcc_tier0_owner_contact_lane;
--   -- and re-run 20260827010000_lcc_p187_tier0_core_arm_and_stoplist.sql to drop the two
--   -- appended columns from v_lcc_tier0_owner_contact_candidates.
-- Nothing here writes, so there is no data to reverse.

-- ============================================================================
-- PART 3 — the reversible ledger for the confirm lane's writes
-- ============================================================================
-- This lane is the FIRST thing that has ever written a Tier 0 candidate into
-- `owner_contact_pivot`. `active_contact_entity_id` is the field the whole
-- outreach chain reads (v_owner_contact_enrich_queue drains on it; the owner
-- panel hero renders off it), so a wrong write is expensive and a wrong BATCH of
-- writes is worse.
--
-- One row per verdict, written BEFORE the pivot patch, carrying the PRIOR pivot
-- state verbatim so a reversal restores exactly what was there rather than
-- nulling a field that some other source had legitimately filled. Reject and
-- research are ledgered too -- a lane's own history is how you tell "nobody has
-- worked it" apart from "it was all rejected".
--
-- REVERSAL RUNBOOK (one verdict, or a whole batch by batch_tag):
--   update owner_contact_pivot p set
--     active_contact_entity_id = l.prior_active_contact_entity_id,
--     active_contact_name      = l.prior_active_contact_name,
--     active_contact_role      = l.prior_active_contact_role,
--     active_authority_level   = l.prior_active_authority_level,
--     active_source            = l.prior_active_source,
--     confidence               = l.prior_confidence,
--     updated_at               = now()
--   from lcc_tier0_confirm_log l
--   where l.batch_tag = '<tag>' and l.verdict = 'attach' and l.reverted_at is null
--     and p.entity_id = l.owner_entity_id;
--   delete from owner_contact_pivot p using lcc_tier0_confirm_log l
--    where l.batch_tag = '<tag>' and l.pivot_row_created and l.reverted_at is null
--      and p.entity_id = l.owner_entity_id;
--   delete from entity_relationships r using lcc_tier0_confirm_log l
--    where l.batch_tag = '<tag>' and l.relationship_created and l.reverted_at is null
--      and r.id = l.relationship_id;
--   update lcc_tier0_confirm_log set reverted_at = now() where batch_tag = '<tag>';
--   -- then re-open the decisions:
--   delete from lcc_decisions where decision_type = 'tier0_owner_contact'
--     and subject_ref in (select subject_ref from lcc_tier0_confirm_log where batch_tag = '<tag>');

create table if not exists public.lcc_tier0_confirm_log (
  log_id                          bigserial primary key,
  batch_tag                       text        not null,
  subject_ref                     text        not null,
  verdict                         text        not null,
  owner_entity_id                 uuid,
  owner_name                      text,
  domain                          text,
  owner_rent                      numeric,
  rent_band                       text,
  match_arms                      text,
  match_keys                      text[],
  person_entity_id                uuid,
  person_name                     text,
  person_email                    text,
  link_evidence                   text[],
  person_evidence                 text[],
  -- prior pivot state, captured before the write so a reversal is exact
  prior_active_contact_entity_id  uuid,
  prior_active_contact_name       text,
  prior_active_contact_role       text,
  prior_active_authority_level    int,
  prior_active_source             text,
  prior_confidence                text,
  pivot_row_created               boolean     not null default false,
  relationship_id                 uuid,
  relationship_created            boolean     not null default false,
  relationship_role               text,
  actor                           uuid,
  created_at                      timestamptz not null default now(),
  reverted_at                     timestamptz
);

-- Idempotent replay: the same verdict on the same subject in the same batch
-- lands once. (Deliberately NOT unique on subject_ref alone -- a reversal
-- followed by a genuine re-decision must be able to write a second row.)
create unique index if not exists uq_lcc_tier0_confirm_log_subject_verdict_batch
  on public.lcc_tier0_confirm_log (subject_ref, verdict, batch_tag);
create index if not exists idx_lcc_tier0_confirm_log_owner
  on public.lcc_tier0_confirm_log (owner_entity_id);
create index if not exists idx_lcc_tier0_confirm_log_batch
  on public.lcc_tier0_confirm_log (batch_tag);

comment on table public.lcc_tier0_confirm_log is
  'P188: reversible ledger for every Tier 0 confirm-lane verdict. Written BEFORE the '
  'owner_contact_pivot patch and carrying the prior pivot state verbatim, so a reversal restores '
  'what was there rather than nulling a field another source had filled. Reject/research verdicts '
  'are recorded too -- that is how "nobody worked the lane" is told apart from "it was all rejected".';

grant select, insert, update on public.lcc_tier0_confirm_log to service_role;
grant select on public.lcc_tier0_confirm_log to authenticated;
grant usage, select on sequence public.lcc_tier0_confirm_log_log_id_seq to service_role;
