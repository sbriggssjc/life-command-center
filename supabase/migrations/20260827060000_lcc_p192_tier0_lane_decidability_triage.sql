-- P192 — stop asking Scott questions the data already answers (or can't answer at all).
--
-- Scott, 2026-08-26, after working the lane:
--   "We should only propose the strongest candidates for attachment in this decision lane and
--    automate as much of this as we can so we are only asking the human in the loop for feedback
--    when we absolutely need it and can't resolve this automatically with the data we have."
--   "I got back in the decision center and still see a number of duplicate firms."
--
-- ⚠️ BOTH OBSERVATIONS HAVE THE SAME CAUSE. Most of what reads as a "duplicate firm" is one owner
-- shown twice because its SECOND domain card is a weak match nobody should be asked about —
-- "Cunningham Development Co → cunninghamdevco.com" (real) sitting directly above
-- "Cunningham Development Co → cunninghamwalters.com" (a different firm, zero evidence). Gating on
-- decidability removes most of the apparent duplication without touching entity resolution.
--
-- ============================================================================
-- THE MISSING AXIS — "link evidence" was never the right test on its own
-- ============================================================================
-- P188 gated on whether a candidate's stated employer matches the owner. Necessary, and NOT
-- sufficient in either direction:
--   * Prologis, L.p. -> prologis.com has ZERO link evidence and is near-certain.
--   * Westlake Village Natomas -> westlakefarmsinc.com HAS link evidence ("Westlake Farms Inc"
--     contains 'westlake') and is a FARM.
-- The missing axis is **how strong the domain<->owner match itself is**, computed from the
-- P187 order-preserving core:
--
--   exact                  domain SLD == owner core          prologis == prologis
--   domain_is_core_prefix  core starts with the SLD          boydwatterson  ⊂ boydwattersonassetmanagement
--   core_is_domain_prefix  SLD starts with the core
--   curated_sponsor        the P190 human-confirmed map      ngp -> ngpv.com
--   weak_partial           an 8-char or token overlap only   cunninghamwalters vs cunninghamdevelopment
--
-- ============================================================================
-- THE TRIAGE — measured live, 255 cards
-- ============================================================================
--   ask                 98 cards / 90 owners / $394M   -> the operator's queue
--   auto                11 cards / 11 owners /  $26M   -> exact match, exactly ONE candidate
--   parked_domain_only 146 cards /105 owners / $231M   -> NEVER SHOWN; revisited when evidence lands
--
-- **The operator's queue drops 255 -> 109 (a 57% cut) with no loss of a single strong card.**
-- Verified on named rows: Easterly/easterlyreit.com still visible (2), Prologis still visible,
-- while crystalmgmt.com and cunninghamwalters.com — the two weak cards at the top of Scott's
-- screenshot — are gone.
--
-- ⚠️ WHY `auto` IS STILL SHOWN. The 11 exact/single-candidate cards were read individually and are
-- 11/11 correct (Agree Realty -> Joey Agree, Paolino Properties -> Joseph Paolino, AVG Partners ->
-- Arnold Schlesinger, Healthcare Realty Trust -> John Bryant, ...). They are the auto-attach
-- population. **But no sweep writes them yet**, and silently hiding a card nobody attaches is the
-- Class 7 failure (correct-and-invisible is indistinguishable from not-built). They stay in front
-- of the operator, FLAGGED, until the P192b sweep exists. Then they leave the queue by being done.
--
-- ⚠️ AND WHY `domain_is_core_prefix` IS **NOT** AUTO-ATTACHABLE, though it looks like it should be.
-- Read individually it is ~9/12, and the failures are severe:
--     "JP Morgan Chase Commercial Mortgage Securities Trust 2018PTC..." -> jpmorgan.com
--        — a securitization vehicle is not the bank, and is not a prospect at all
--     "Frontier Hub LLC" -> frontier.net
--        — an internet service provider ('frontier.com' is in the consumer-ISP stoplist;
--          '.net' is not — the stoplist needs the sibling TLDs)
-- One tier of match strength separates 11/11 from 9/12. **Auto-attach only on `exact`.**
--
-- ============================================================================
-- ⚠️ THIS IS A STANDING FUNCTION, NOT A ONE-TIME SORT (Scott's framing, and it is the design)
-- ============================================================================
--   "this is not a final determination but an ongoing pursuit and will change as time goes on or
--    as we learn about new hires or new roles or new fund or new targets... a dynamic and living
--    thing that grows as time goes on and we ingest more correspondence or show more deals."
--
-- `parked_domain_only` is therefore a **DATED, EXPIRING** state, not a wastebasket. A parked card
-- must return to `ask` the moment new evidence lands — correspondence, an SF campaign, a title, an
-- Outlook contact, a confirmed sponsor domain. Because the classification is computed live in this
-- view rather than stored, that re-entry is automatic TODAY: nothing has to remember to unpark.
-- **Do not "optimise" this into a stored status column without also building the sweep that clears
-- it** — that is Class 10 (an exclusion keyed on a state nothing ever clears) and Class 12 (a
-- worker whose cursor is its own output), both of which this codebase has already paid for.
--
-- Design for the rest of the living loop: `docs/claude-code/prompts/192-*.md`.
--
-- REVERSAL: `create or replace view v_lcc_tier0_owner_contact_lane_open as select * from
-- v_lcc_tier0_owner_contact_lane_triage;` (shows everything again).

create or replace view public.v_lcc_tier0_owner_contact_lane_triage as
with base as (
  select l.*,
         lcc_owner_domain_core(l.owner_name) as owner_core,
         regexp_replace(lower(split_part(l.domain,'.',1)),'[^a-z0-9]','','g') as domain_sld
  from public.v_lcc_tier0_owner_contact_lane l
  where l.n_eligible > 0
    -- owners whose contact came from OUTSIDE this lane need no acquisition (P188 intent, P191 form)
    and not exists (
      select 1 from owner_contact_pivot pv
      where pv.entity_id = l.owner_id and pv.active_contact_entity_id is not null
        and coalesce(pv.active_source,'') <> 'tier0_confirm')
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
  'Every open Tier 0 card, classified by match_strength (how strongly the email domain identifies '
  'the owner) and decidability (auto / ask / parked_domain_only). The classification is COMPUTED '
  'LIVE, never stored, so a parked card returns to the queue automatically the moment new evidence '
  'lands -- correspondence, an SF campaign, a title. Do not convert this to a stored status without '
  'building the sweep that clears it.';

create or replace view public.v_lcc_tier0_owner_contact_lane_open as
select * from public.v_lcc_tier0_owner_contact_lane_triage
where decidability in ('ask','auto');

comment on view public.v_lcc_tier0_owner_contact_lane_open is
  'What the operator is asked. P192: actionable-only -- 255 cards -> 109, dropping 146 '
  'domain-match-alone cards ($231M) that carry no evidence anyone could act on. The 11 `auto` '
  'cards (exact match, single candidate, read 11/11 correct) remain visible and flagged until the '
  'auto-attach sweep exists; hiding a card nobody attaches would be the Class 7 failure.';
