-- ENTC (2026-09-03) — PR5c-entities-c-junk80: the census, read-only.
--
-- The population: a LIVE person entity holding a real (non-generic) mailbox whose
-- NAME fails at least one of the four shared name guards. That mailbox is what the
-- email tier of ensureEntityLink resolves an inbound person onto, so each row is a
-- live attach landmine.
--
-- The predicate is stated here and nowhere else, and reproduces the 80 exactly
-- (83 before the generic-inbox exclusion removes 3). NO new name regex — the four
-- guards are the existing shared ones.
--
-- ⚠️ THE 80 ARE NOT ONE CLASS, and a blanket sweep would do harm. Read rather than
-- counted: SIX rows carry a >=4-char name token inside their own mailbox localpart
-- (Eyal (Al) Elkayam / eyal@, Hunt / hunt@, Jackson / kjackson@, Lew (Doug) Hodge /
-- louhodges@) — the row IS that mailbox's person and clearing its email is the harm,
-- not the fix. TWO more are a real person behind a CoStar section-label prefix
-- ("Seller ContactsDon H. Doyle") — repairable by rename, not retirable. Those are
-- held; only the residue is a sweep candidate.
--
-- ⚠️ "alone on its mailbox" is TWO numbers and they differ: 31 by email address,
-- 37 once scoped to entities.domain — which is the scope the tier actually uses
-- (ensureEntityLink appends &domain=eq.<domain> when the caller supplies one).
-- Both columns are emitted so nobody has to guess which figure a reader meant.
--
-- Read-only. Nothing here writes. REVERSAL: drop view public.v_lcc_entities_c_junk80;

drop view if exists public.v_lcc_entities_c_junk80;

create view public.v_lcc_entities_c_junk80 as
with base as (
  select e.id, e.name, e.email, e.domain, e.created_at, e.metadata,
         lower(split_part(e.email,'@',1)) as email_localpart,
         lower(split_part(e.email,'@',2)) as email_domain
    from public.entities e
   where e.entity_type = 'person'
     and e.merged_into_entity_id is null
     and e.email is not null and e.email <> ''
     and not public.lcc_is_generic_inbox_localpart(e.email)
     and (not public.lcc_looks_like_person(e.name)
          or public.lcc_is_rejected_contact_name(e.name)
          or public.lcc_owner_name_is_junk(e.name)
          or public.lcc_p131_is_document_row_label(e.name))
), flagged as (
  select b.*,
    -- which guard(s) fired — the reason, not just the verdict
    array_remove(array[
      case when not public.lcc_looks_like_person(b.name)      then 'not_person_shaped' end,
      case when public.lcc_is_rejected_contact_name(b.name)   then 'rejected_contact_name' end,
      case when public.lcc_owner_name_is_junk(b.name)         then 'owner_name_is_junk' end,
      case when public.lcc_p131_is_document_row_label(b.name) then 'p131_document_row_label' end
    ], null) as guards_fired,
    -- the row IS this mailbox's person. Positive-controlled: fires on 6 of 80,
    -- not 0 and not 80, and all six read correct on named rows.
    coalesce((select bool_or(length(tok) >= 4 and b.email_localpart like '%'||lower(tok)||'%')
                from regexp_split_to_table(regexp_replace(b.name,'[^A-Za-z ]',' ','g'), '\s+') tok), false)
      as email_localpart_corroborates_name,
    -- a real person behind a CoStar section-label prefix. Mirrors
    -- stripContactLabelPrefix() in api/_handlers/sidebar-pipeline.js; this is a
    -- CLASSIFICATION only — any actual rename goes through that JS function, so
    -- the two cannot drift into two different repairs.
    (b.name ~* '^(Buyer|Seller|Owner|Listing( Broker)?) Contacts\s*\S')
      as name_repairable_label_prefix,
    (select count(*) from public.entity_relationships r
      where r.from_entity_id = b.id or r.to_entity_id = b.id) as n_edges,
    (select count(*) from public.external_identities x
      where x.entity_id = b.id and x.source_system = 'salesforce') as n_salesforce_ids,
    (select count(*) from public.external_identities x
      where x.entity_id = b.id and x.source_system in ('costar','rca')) as n_vendor_ids,
    (select count(*) from public.external_identities x where x.entity_id = b.id) as n_identities,
    (select count(*) from public.lcc_entity_portfolio_facts f where f.entity_id = b.id) as n_portfolio_facts,
    (select count(*) from public.touchpoint_cadence c where c.entity_id = b.id) as n_cadences,
    (select count(*) from public.owner_contact_pivot p where p.entity_id = b.id) as n_pivot_owner_rows,
    (select count(*) from public.owner_contact_pivot p where p.active_contact_entity_id = b.id) as n_pivot_active_contact,
    (select count(*) from public.bd_opportunities o where o.entity_id = b.id) as n_bd_opportunities,
    (select count(*) from public.entities e2
      where e2.entity_type = 'person' and e2.merged_into_entity_id is null
        and lower(e2.email) = lower(b.email)) as n_live_persons_on_mailbox,
    (select count(*) from public.entities e2
      where e2.entity_type = 'person' and e2.merged_into_entity_id is null
        and lower(e2.email) = lower(b.email)
        and e2.domain is not distinct from b.domain) as n_live_persons_on_mailbox_domain_scoped,
    ((b.metadata->>'junk_name_flagged') is not null) as already_junk_flagged,
    exists (select 1 from public.junk_entity_review jr
             where jr.domain='lcc' and jr.table_name='entities' and jr.pk_value = b.id::text) as already_in_review_lane
  from base b
)
select f.*,
  (f.n_cadences > 0 or f.n_pivot_owner_rows > 0 or f.n_pivot_active_contact > 0
   or f.n_portfolio_facts > 0 or f.n_bd_opportunities > 0) as has_inbound_reference,
  case
    when f.email_localpart_corroborates_name then 'hold_email_corroborated'
    when f.name_repairable_label_prefix       then 'hold_name_repairable'
    when f.n_salesforce_ids > 0               then 'hold_salesforce_identity'
    when (f.n_cadences > 0 or f.n_pivot_owner_rows > 0 or f.n_pivot_active_contact > 0
          or f.n_portfolio_facts > 0 or f.n_bd_opportunities > 0) then 'hold_inbound_reference'
    else 'sweep_candidate'
  end as disposition,
  -- feeds junk_entity_review.proposed_verdict. Only sweep_candidate proposes an
  -- action; every hold is 'uncertain' so a confirm cannot be a default.
  case
    when f.email_localpart_corroborates_name then 'uncertain'
    when f.name_repairable_label_prefix       then 'rename'
    when f.n_salesforce_ids > 0               then 'uncertain'
    when (f.n_cadences > 0 or f.n_pivot_owner_rows > 0 or f.n_pivot_active_contact > 0
          or f.n_portfolio_facts > 0 or f.n_bd_opportunities > 0) then 'uncertain'
    else 'dismiss'
  end as proposed_verdict
from flagged f;

comment on view public.v_lcc_entities_c_junk80 is
  'ENTC 2026-09-03 (PR5c-entities-c-junk80): live person entities holding a real mailbox under a guard-failing name — what the ensureEntityLink email tier resolves an inbound person onto. Read-only census; disposition/proposed_verdict feed junk_entity_review. hold_* rows are human-only, never bulk. Relationships are NEVER touched by the retirement path (unstampMisparseMember clears email + identities only), so the 480-edge vendor rows keep their deal history.';

grant select on public.v_lcc_entities_c_junk80 to anon, authenticated, service_role;
