-- P193 — SPE subsidiaries should inherit the sponsor's answer, not re-ask it.
--
-- Scott, 2026-08-26, working the lane:
--   "I've gotten to a spot where I am seeing duplicates that are subsidiaries and matching the
--    correct contacts. I feel like these should be automatically merged or connected to the true
--    owner parent once we get to this spot where we have a connected domain and person."
--
-- He was looking at `NGP VI ESSEX VT LLC -> ngpv.com` sitting directly above
-- `Ngp Vi Harlingen Tx LLC -> ngpv.com` — the same three candidates (Fran Cowan, Kim Phillips,
-- David Kent), the same sponsor, the same answer, asked twice.
--
-- ⚠️ THESE ARE NOT DUPLICATE ENTITIES. Unlike Easterly x2 (one firm recorded twice, a merge
-- problem — prompt 189), NGP VI ESSEX VT LLC and Ngp Vi Harlingen Tx LLC are **legitimately
-- distinct legal entities** holding different properties. Merging them would be wrong. What they
-- share is a SPONSOR. The fix is a parent relationship and inheritance, NOT a merge — and
-- conflating the two problems would corrupt the ownership record.
--
-- ============================================================================
-- MEASURED — 19 of 107 workable cards are ONE question asked three times
-- ============================================================================
--   ngp  -> ngpv.com   13 SPE entities  $26.1M   3 candidates   parent: NGP Capital (registered)
--   uirc -> uirc.com    5 SPE entities   $4.9M   7 candidates   parent: UIRC, Urban Investment
--                                                                        Research Corp. (registered)
--   jbg  -> jbg.com     1 SPE entity     $2.9M   3 candidates   parent: not registered
--
-- **19 cards collapse to 3 questions (-84% on that population).** And the judgement was ALREADY
-- MADE: `lcc_owner_sponsor_domain.confirmed_by = 'scott 2026-08-26'` for all three. Asking again
-- per SPE is pure repetition of a decision already recorded.
--
-- ============================================================================
-- ⚠️ THE MACHINERY MOSTLY EXISTS — review before building (measured 2026-08-26)
-- ============================================================================
--   lcc_buyer_parents            25 rows, human-curated. **NGP Capital, UIRC, RMR Group, Boyd
--                                Watterson, Easterly, Elman, Realty Income, Agree Realty and
--                                CoreCivic are ALREADY IN IT.**
--   v_lcc_entity_tier0_parent   330 parent proposals; **85 already cover NGP/UIRC SPEs.**
--   entity_relationships          **0 parent edges — and no parent TYPE exists.** The enum is
--                                associated_with, brokers, deal_party, developed, finances,
--                                guaranteed_by, leases, owns, purchases, sells. That is the gap.
--
-- ⚠️ NAMING TRAP, checked before assuming redundancy: `lcc_buyer_parents.domain` is the VERTICAL
--    ('dia' / 'gov'), **not an email domain**. It does not overlap with
--    `lcc_owner_sponsor_domain.email_domain` (P190) despite the column name. Two different
--    meanings of "domain" one table apart.
--
-- ============================================================================
-- WHAT THIS MIGRATION SHIPS — a read-only proposal surface, nothing more
-- ============================================================================
-- One row per (confirmed sponsor, email domain), carrying the SPE entities it covers, the shared
-- candidate people, and the registered parent where one exists. It is the basis for a single
-- rollup CARD replacing N per-SPE cards.
--
-- **The bulk attach is NOT built here and must NOT be built in SQL.** The JS verdict path carries
-- the shape guards (isPersonShaped / isJunkEntityName / isMisparseName / broker role_bucket) and
-- re-reads the card at write time; a SQL writer would bypass all of it. Spec: prompt 193.
--
-- ⚠️ AND THE ROLLUP MUST NOT BECOME A BULK-ATTACH SHORTCUT THAT SKIPS THE PERSON CHOICE. "Do the
--    people at ngpv.com work for the NGP SPEs?" is one judgement; **"which of Fran Cowan, Kim
--    Phillips and David Kent do we call?" is still a real second decision** and stays on the card.
--    UIRC has SEVEN candidates — collapsing that to an automatic pick would be the P188 mistake
--    (attaching the first available person) at 5x the blast radius.
--
-- REVERSAL: drop view v_lcc_tier0_sponsor_rollup; it reads, it writes nothing.

create or replace view public.v_lcc_tier0_sponsor_rollup as
with open_sponsor as (
  select l.owner_id, l.owner_name, l.owner_rent, l.domain, l.people, l.n_eligible,
         sd.sponsor_token, sd.email_domain, sd.confirmed_by, sd.confirmed_at
  from public.v_lcc_tier0_owner_contact_lane_open l
  join public.lcc_owner_sponsor_domain sd
    on l.owner_name ~* ('\m'||sd.sponsor_token||'\M')
   and l.domain = sd.email_domain
)
select o.sponsor_token,
       o.email_domain,
       count(*)                   as spe_cards,
       count(distinct o.owner_id) as spe_entities,
       sum(o.owner_rent)          as combined_annual_rent,
       max(o.n_eligible)          as candidate_people,
       o.confirmed_by             as sponsor_confirmed_by,
       o.confirmed_at             as sponsor_confirmed_at,
       (select pe.name from lcc_buyer_parents bp join entities pe on pe.id = bp.parent_entity_id
         where pe.name ~* ('\m'||o.sponsor_token||'\M') limit 1) as registered_parent_name,
       (select bp.parent_entity_id from lcc_buyer_parents bp join entities pe on pe.id = bp.parent_entity_id
         where pe.name ~* ('\m'||o.sponsor_token||'\M') limit 1) as registered_parent_entity_id,
       array_agg(o.owner_id order by o.owner_rent desc)          as spe_entity_ids,
       string_agg(o.owner_name, ' | ' order by o.owner_rent desc) as spe_names,
       (array_agg(o.people order by o.owner_rent desc))[1]        as shared_candidates
from open_sponsor o
group by o.sponsor_token, o.email_domain, o.confirmed_by, o.confirmed_at;

comment on view public.v_lcc_tier0_sponsor_rollup is
  'One row per (human-confirmed sponsor, email domain) with the SPE entities it covers. These are '
  'NOT duplicate entities -- they are distinct legal SPEs sharing a sponsor, so the fix is a '
  'parent relationship and inheritance, never a merge (contrast prompt 189, which IS a merge '
  'problem). PROPOSAL SURFACE ONLY: the bulk attach goes through the JS verdict path so the shape '
  'guards run, and the WHICH-PERSON choice stays a human decision (UIRC has 7 candidates).';
