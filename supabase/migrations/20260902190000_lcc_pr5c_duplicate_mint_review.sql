-- PR5c-entities-b-dupes — read-only review surface for duplicate entity mints.
--
-- NAMING: the prompt called this `v_lcc_sf_bridge_duplicate_mints`. That name is
-- wrong and would misdirect whoever meets it next: measured on `bridge_runs`, there
-- were ZERO Salesforce bridge runs in the incident window (2026-08-07..20) — the only
-- bridge running was `outlook.messages`, 41,519 runs. `handleSalesforceContactUpsert`
-- and its `findEntityForUpsert` never executed for these rows. The actual writers are
-- the `lcc-sf-contact-resolve` tick (cron 165, */30 — 10 of 13 mints land within
-- seconds of :00/:30) and the CoStar sidebar (3 off-cadence mints carrying a
-- `costar/contact` identity). Both mint through `ensureEntityLink`.
--
-- READ-ONLY, HUMAN-CONFIRM. It deliberately carries NO `auto_mergeable` column:
-- `lcc_apply_fuzzy_merges()` loops on that flag, and 5 of the 13 rows here are NOT
-- duplicates at all (P198). Merging is a separate, reversible decision per row via
-- lcc_merge_entity / lcc_unmerge_entity (P196).
create or replace view public.v_lcc_entity_duplicate_mint_review as
with minted as (
  select distinct on (e.id)
         e.id, e.name, e.email, e.domain, e.canonical_name,
         e.workspace_id, e.created_at, ei.external_id as sf_contact_id
  from external_identities ei
  join entities e on e.id = ei.entity_id
  where ei.source_system = 'salesforce'
    and ei.source_type   = 'Contact'
    and ei.created_at >= now() - interval '90 days'
    and e.merged_into_entity_id is null
  order by e.id, ei.created_at
),
paired as (
  select n.id           as new_entity_id,
         n.name         as new_name,
         n.email        as new_email,
         n.domain       as new_domain,
         n.created_at   as new_created_at,
         n.sf_contact_id,
         o.id           as older_entity_id,
         o.name         as older_name,
         o.email        as older_email,
         o.domain       as older_domain,
         o.entity_type  as older_entity_type,
         o.created_at   as older_created_at,
         n.canonical_name,
         extract(epoch from (n.created_at - o.created_at)) as age_gap_seconds,
         (o.email is not null and n.email is not null
          and lower(btrim(o.email)) = lower(btrim(n.email)))  as same_email
  from minted n
  join entities o
    on  o.canonical_name = n.canonical_name
    and o.workspace_id   = n.workspace_id
    and o.id <> n.id
    and o.created_at < n.created_at
    and o.merged_into_entity_id is null
)
select p.*,
       case
         -- The defect this round fixed: canonical_name matched and the identity
         -- lookup was scoped by `domain`, so the older row was invisible.
         when p.same_email and p.new_domain is distinct from p.older_domain
           then 'cross_domain_canonical_miss'
         -- Lookup ran before the sibling insert committed, inside one request.
         when p.same_email and p.age_gap_seconds < 5
           then 'intra_request_race'
         when p.same_email
           then 'same_email_unexplained'
         when p.older_email is null
           then 'older_row_has_no_email'
         when p.older_entity_type is distinct from 'person'
           then 'older_row_not_person'
         -- Different mailbox on the same name: usually the person changed firms.
         -- NOT a duplicate — the correct treatment is a relationship edge, never a
         -- merge (account-based-contact-intelligence.md: people change firms and we
         -- track where they went).
         else 'different_email_likely_firm_change'
       end as mechanism,
       (p.same_email and (p.new_domain is distinct from p.older_domain
                          or p.age_gap_seconds < 5)) as is_probable_duplicate
from paired p;

comment on view public.v_lcc_entity_duplicate_mint_review is
  'PR5c-entities-b-dupes: read-only review of entity mints that landed on a '
  'canonical_name an older live entity already held. `mechanism` names WHY the '
  'identity lookup missed. Human-confirm only; no auto_mergeable column by design '
  '(P198) — a shared name across domains with a different email is a firm change, '
  'not a duplicate.';

grant select on public.v_lcc_entity_duplicate_mint_review to service_role;
