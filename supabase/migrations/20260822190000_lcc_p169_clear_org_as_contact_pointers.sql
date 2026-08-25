-- ============================================================================
-- P169 — clear the 70 pointers where the "decision-maker" is the company itself
--        (2026-08-22). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--        Reversible via lcc_phantom_contact_clear_log / lcc_unclear_phantom_owner_contacts.
--
-- Extends lcc_clear_phantom_owner_contacts to cover P168's org-as-contact class:
--     67  org contact, NO email and NO phone   $33.5M   (Trammell Crow Co ->
--         "Trammell Crow", Blake Real Estate Inc -> "Blake Real Estate",
--         Global Net Lease -> "Global Net Lease")
--      3  person-shaped phantom, no contact detail  $9.4M (Genesis Financial
--         Group -> "Genesis Financial")
--
-- DELIBERATELY LEFT: the 3 org contacts that DO carry an email/phone (RIPCO Real
-- Estate, Transwestern, Forged Real Estate). A switchboard is at least
-- something, and all three are brokerage-named — a different problem tracked in
-- v_lcc_prospecting_edge_review. Worklist remainder after this: 9 rows, all kept
-- on purpose.
--
-- Clearing is honest: "no contact on file" is TRUE for these owners and puts
-- them back in the acquisition queue. A wrong contact does neither.
--
-- ⚠️ THE VERIFICATION GATE FAILED FIRST, AND THE GATE WAS WRONG — NOT THE CLEAR.
-- It asserted "0 individual owners swept" using
--   credible_person AND NOT org_marker AND NOT firm_suffix
-- and returned 14. Reading those 14 by name: Global Net Lease (a REIT), Hunt
-- Midwest, Sheltair Aviation, Walter Bros. Construction, Farley White Interests
-- — all COMPANIES. They trip the documented false positive of
-- lcc_owner_name_is_credible_person (CLAUDE.md already records that it accepts
-- "Global Net Lease" and "U.S. Department of Veterans Affairs").
--
-- The gate was asking the wrong question. It ignored the CONTACT TYPE, and an
-- ORGANISATION contact cannot be "an individual owning in their own name" — that
-- P164 failure requires a PERSON contact on a person-shaped owner. Corrected
-- assertion, which is the one that matters:
--
--     cleared contact = person AND owner person-shaped  ->  0 rows   PASS
--     (67 org-contact clears, 3 person-contact clears, none person-shaped)
--
-- Recorded rather than quietly relaxed, because "my gate failed so I loosened
-- it" is exactly how a real defect ships. The justification is structural, and
-- the risk case was measured empty, not assumed empty.
--
-- VERIFICATION GATE (final):
--   clearable rows remaining in the worklist       0    PASS
--   worklist remainder (kept on purpose)           9    PASS
--   reversal ledger rows for the batch            70    PASS
--   person-contact cleared from person-shaped owner 0   PASS
--
-- REVERSAL: select * from lcc_unclear_phantom_owner_contacts('p169-org-contact-clear-20260822');
-- ============================================================================

create or replace function lcc_clear_phantom_owner_contacts(
  p_dry_run boolean default true,
  p_batch   text    default null,
  p_limit   int     default null
) returns table(action text, owners bigint, annual_rent numeric)
language plpgsql as $$
declare
  v_batch text := coalesce(p_batch, 'phantom-clear-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  drop table if exists _cand;
  create temp table _cand on commit drop as
  select w.owner_entity_id, w.owner_name, w.known_annual_rent, w.confidence
  from v_lcc_phantom_owner_contact_worklist w
  where
    -- (1) person-shaped phantom with no contact detail (P164, narrowed by P164a)
    w.confidence = 'phantom_no_contact_detail'
    -- (2) P168/P169: an ORGANISATION recorded as the decision-maker, carrying
    --     nothing. An org is never "the individual in control", and one with no
    --     email or phone cannot even be dialled — it is noise occupying the
    --     "contact resolved" slot and keeping the owner OUT of the acquisition
    --     queue. Org contacts that DO carry a contact detail are left alone.
    or (w.confidence = 'org_as_contact_never_a_decision_maker'
        and w.contact_email = '' and w.contact_phone = '')
  order by w.known_annual_rent desc
  limit coalesce(p_limit, 1000000);

  if p_dry_run then
    return query select 'DRY-RUN would_clear: ' || c.confidence, count(*)::bigint,
                        coalesce(sum(c.known_annual_rent),0)
                 from _cand c group by c.confidence;
    return;
  end if;

  insert into lcc_phantom_contact_clear_log(batch_tag, entity_id, owner_name,
    prior_active_contact_entity_id, prior_active_contact_name,
    prior_active_authority_level, prior_active_contact_role, prior_enrichment_action)
  select v_batch, p.entity_id, p.owner_name, p.active_contact_entity_id, p.active_contact_name,
         p.active_authority_level, p.active_contact_role, p.enrichment_action
  from owner_contact_pivot p join _cand c on c.owner_entity_id = p.entity_id;

  update owner_contact_pivot p
     set active_contact_entity_id = null, active_contact_name = null,
         active_authority_level = null, active_contact_role = null, updated_at = now()
  from _cand c where c.owner_entity_id = p.entity_id;

  return query select 'CLEARED ' || c.confidence || ' (batch ' || v_batch || ')',
                      count(*)::bigint, coalesce(sum(c.known_annual_rent),0)
               from _cand c group by c.confidence;
end $$;
