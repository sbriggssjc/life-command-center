-- P191 — the Tier 0 lane closed cards it had no business closing. Found by Scott working it.
--
-- ============================================================================
-- THE DEFECT — attach was per-OWNER while the card is per-(OWNER, DOMAIN)
-- ============================================================================
-- P188 built the lane as ONE CARD PER (OWNER, DOMAIN) and said so explicitly:
--
--   "The domain split turned out to be load-bearing: RMR also has rob@rmrgroupinc.com, a
--    different firm and a different question, which per-owner grouping would have folded in
--    silently... subject_ref is t0:<owner>:<domain> and rejecting one never closes the other."
--
-- That is TRUE FOR REJECT (which keys on `lcc_decisions.subject_ref`) and was FALSE FOR ATTACH.
-- `v_lcc_tier0_owner_contact_lane_open` read:
--
--   where not owner_already_has_contact and n_eligible > 0
--
-- and `owner_already_has_contact` is derived per OWNER from `owner_contact_pivot`. So the moment
-- ANY domain card for an owner was attached, EVERY other domain card for that owner vanished.
-- Two halves of one design disagreeing: the card is (owner, domain), the exclusion is (owner).
--
-- ============================================================================
-- WHAT IT COST, on the first five cards ever worked (2026-08-26)
-- ============================================================================
-- Scott attached on the **easterlypartners.com** card and it silently closed the
-- **easterlyreit.com** card for the same owner. Reading the two candidates:
--
--   Alison Bernard  abernard@easterlypartners.com  0 emails · no SF · no Outlook · no campaign
--                                                  (the card's own counters: link 0 / person 0)
--   Andrew Pulliam  apulliam@easterlyreit.com      109 emails · in Salesforce · in the GSA Buyer
--                                                  campaign · 37 edges · EVP-Acquisitions
--
-- **The zero-evidence candidate was attached and the doctrinal pursuit target was suppressed** —
-- and the operator was given no signal that a better card had just been closed. This is the
-- playbook's "looks exactly like success" shape: every write was correct, reversible and logged.
--
-- ⚠️ THE OPERATOR DID NOTHING WRONG. Four cards for one firm (two duplicate owner entities x two
--    domains) were presented as four independent questions, and answering one closed two others.
--
-- ============================================================================
-- THE FIX
-- ============================================================================
-- Close only the (owner, DOMAIN) actually decided, while still keeping out owners whose contact
-- came from somewhere else entirely (those need no acquisition and were never this lane's job).
-- The discriminator is `owner_contact_pivot.active_source`: 'tier0_confirm' means THIS lane is
-- being worked, so the owner's remaining domain questions are still open.
--
-- MEASURED (live, expectations stated before the run):
--   lane cards                     260 -> 256
--   easterlyreit.com cards         0   -> **2**  (7 candidates each, Pulliam among them)
--   easterlypartners.com cards     0   ->  0     (correctly stays decided)
--   Boyd Watterson                 0   ->  0     (its only domain was decided)
--   pre-existing pivot contacts (1,381 rows, active_source <> 'tier0_confirm') — still excluded,
--   so the lane does NOT inflate.
--
-- NO REVERT IS NEEDED for the Alison Bernard attaches: the verdict path supersedes rather than
-- overwrites, so attaching Pulliam on the restored card makes him the active contact and leaves
-- her on the bench. A clean revert is available if preferred — `lcc_tier0_confirm_log` carries
-- `prior_active_*` and the runbook is in the P188 migration header.
--
-- ============================================================================
-- ⚠️ AND THE DUPLICATE-ENTITY COST IS NOW MEASURED IN OPERATOR TIME, NOT JUST DATA
-- ============================================================================
-- Easterly is TWO owner entities, so Scott answered the identical question twice and attached the
-- same person to both. "NGP Capital" is FIVE entities (P189): he attached to the $59.8M one, and
-- the $8.5M one still has an open ngpv.com card asking exactly the same question. That is no
-- longer an abstract data-hygiene item — it is duplicated work on the highest-value lane in the
-- system, and it should be fixed before the lane is worked much further (prompt 189).
--
-- REVERSAL: restore `where not owner_already_has_contact and n_eligible > 0`.

create or replace view public.v_lcc_tier0_owner_contact_lane_open as
select * from public.v_lcc_tier0_owner_contact_lane l
where l.n_eligible > 0
  -- Owners whose active contact came from OUTSIDE this lane need no acquisition -- unchanged
  -- intent from P188, but expressed on the source rather than on the bare existence of a contact.
  and not exists (
    select 1 from owner_contact_pivot pv
    where pv.entity_id = l.owner_id
      and pv.active_contact_entity_id is not null
      and coalesce(pv.active_source,'') <> 'tier0_confirm'
  )
  -- Once THIS lane is being worked, close only the (owner, DOMAIN) actually decided.
  and not exists (
    select 1 from lcc_tier0_confirm_log cl
    where cl.owner_entity_id = l.owner_id
      and cl.domain = l.domain
      and cl.reverted_at is null
  );

comment on view public.v_lcc_tier0_owner_contact_lane_open is
  'Open Tier 0 cards. P191: closes only the (owner, DOMAIN) actually decided -- attaching on one '
  'domain used to close every other domain card for that owner, which suppressed Easterly''s '
  'easterlyreit.com card (Andrew Pulliam, EVP-Acquisitions, 109 emails) the moment a '
  'zero-evidence candidate was attached on easterlypartners.com. Owners whose contact came from '
  'outside this lane (active_source <> ''tier0_confirm'') remain excluded, so the lane does not '
  'inflate.';
