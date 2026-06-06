-- Exact-name auto-merge candidates (junk-lane aftermath of the B9 clean-renames).
-- A recently-worked junk entity (metadata.junk_name_reviewed) whose name now
-- exactly (case-insensitive) matches a CLEAN canonical entity (not junk-flagged,
-- not itself reviewed) in the same workspace. SAFE = single canonical match,
-- domain-compatible (equal or either side domainless), and not BOTH sides
-- carrying a Salesforce identity. Everything else is REVIEW.
-- Idempotent by construction: both sides require merged_into_entity_id IS NULL,
-- so a merged loser drops out of the view on the next read.
-- Consumed by api/admin.js ?_route=exact-merge (GET preview / POST apply-safe).
create or replace view public.v_lcc_exact_name_merge_candidates as
with junk as (
  select id, lower(btrim(name)) lname, name, domain, workspace_id
  from public.entities
  where metadata->>'junk_name_reviewed' = 'true'
    and merged_into_entity_id is null
),
cand as (
  select j.id junk_id, j.name junk_name, j.domain junk_domain, j.workspace_id ws,
         t.id tgt_id, t.name tgt_name, t.domain tgt_domain
  from junk j
  join public.entities t
    on t.merged_into_entity_id is null
   and t.id <> j.id
   and lower(btrim(t.name)) = j.lname
   and t.workspace_id = j.workspace_id
   and coalesce(t.metadata->>'junk_name_flagged','') <> 'true'
   and coalesce(t.metadata->>'junk_name_reviewed','') <> 'true'
),
agg as (
  select junk_id, junk_name, junk_domain, ws,
         count(*) n_tgt,
         (array_agg(tgt_id   order by tgt_id))[1] tgt_id,
         (array_agg(tgt_name order by tgt_id))[1] tgt_name,
         (array_agg(tgt_domain order by tgt_id))[1] tgt_domain
  from cand
  group by junk_id, junk_name, junk_domain, ws
)
select
  a.junk_id, a.junk_name, a.junk_domain,
  a.tgt_id, a.tgt_name, a.tgt_domain,
  a.ws as workspace_id, a.n_tgt,
  (exists (select 1 from public.external_identities ei where ei.entity_id = a.junk_id and ei.source_system = 'salesforce')) as junk_has_sf,
  (exists (select 1 from public.external_identities ei where ei.entity_id = a.tgt_id  and ei.source_system = 'salesforce')) as tgt_has_sf,
  case
    when a.n_tgt = 1
     and (a.junk_domain = a.tgt_domain or a.junk_domain is null or a.tgt_domain is null)
     and not (
        exists (select 1 from public.external_identities ei where ei.entity_id = a.junk_id and ei.source_system = 'salesforce')
    and exists (select 1 from public.external_identities ei where ei.entity_id = a.tgt_id  and ei.source_system = 'salesforce'))
    then 'safe' else 'review'
  end as classification,
  case
    when a.n_tgt > 1 then 'multi_match'
    when not (a.junk_domain = a.tgt_domain or a.junk_domain is null or a.tgt_domain is null) then 'domain_mismatch'
    when exists (select 1 from public.external_identities ei where ei.entity_id = a.junk_id and ei.source_system = 'salesforce')
     and exists (select 1 from public.external_identities ei where ei.entity_id = a.tgt_id  and ei.source_system = 'salesforce') then 'sf_conflict'
    else null
  end as review_reason
from agg a;
