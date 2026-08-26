-- ============================================================================
-- P131 lane B — DECIDABILITY GATE for `owner_contact_manual`.
--
-- ⚠️ MEASURED PREMISE CORRECTION: THIS LANE IS NOT DRAFTABLE, AND SAYING SO IS
-- THE DELIVERABLE. P131 assumed the decision-maker could be drafted from on-box
-- evidence (SOS managing-member + email signature blocks + notice address). Live
-- over all 316 open rows, 2026-08-26:
--   * notice_address  : 0 of 316 carry one.
--   * linked person   : 0 of 316 have a person entity edged to the owner.
--   * comms/signatures: 1 of 316 owners has ANY activity_events row, so there is
--                       no signature-block corpus to mine for these parties.
--   * SOS             : every row's `tried` reads sos/address/web = "unconfigured"
--                       (the SOS-direct path is the §25 bot-wall blocker, an
--                       operator gate, not a modelling gap).
--   * bench           : 202 candidates across 192 owners, of which 173 (86%) are
--                       SELF-ECHOES — the SOS registry naming the LLC as its own
--                       manager ("Browman Development Co." as manager of
--                       "Browman Development Co."), wrongly stamped
--                       is_named_individual on 176 of 202.
--   * at source, gov.recorded_owners has 1,482 managers of which 966 are
--     person-shaped — but of the 212 gov-linked owners IN THIS QUEUE only 15
--     have a manager name distinct from the owner. The queue IS the residue the
--     automation already picked over; that is precisely why it never drains.
-- Running a local model over that would not draft, it would FABRICATE — the P124
-- `else`-branch failure. So this ships the P181 remedy instead: make the lane's
-- DECIDABILITY explicit and let the surface gate on it, so the ~15 rows a human
-- can actually answer stop being buried under ~300 that nobody can.
--
-- Additive, view-only, reversible (DROP VIEW / DROP FUNCTION). No data mutated.
--
-- REVERSAL RUNBOOK
--   drop view if exists public.v_lcc_owner_contact_decidability;
--   drop function if exists public.lcc_p131_is_document_row_label(text);
--   drop function if exists public.lcc_p131_candidate_restates_owner(text,text);
-- ============================================================================

-- A NARROW stoplist for one measured failure: the OM/offering-memorandum
-- extraction path (`true_owner_contact_*`) mints spreadsheet ROW LABELS and
-- addresses as contact names — live examples in this very queue: "Capital
-- Expenditures", "Debt Service", "Income & Expenses", "Fund Name", "Owner",
-- "Toronto, ON M5K 2A1". `lcc_owner_name_is_credible_person` accepts "Debt
-- Service" and "Income & Expenses" (no org marker, two capitalised tokens), which
-- is the documented "looksLikePersonName alone is not enough" trap.
--
-- ⚠️ DELIBERATELY NOT a general name filter, and NOT a blanket exclusion of the
-- OM source. The same source carries REAL people in this queue — Bill Rothacker,
-- Kyle Frances China, Adel B. Bareh — and dropping the source to kill the labels
-- would discard them. That is the P124 mistake (excluding consumer-domain
-- recipients would have deleted the best BD exemplars). Match the label
-- vocabulary itself, nothing else.
create or replace function public.lcc_p131_is_document_row_label(p_name text)
returns boolean language sql immutable as $$
  select coalesce(
    lower(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g')) ~
      ('^\s*(the\s+)?('
       || 'debt service|income|expenses?|income & expenses|income and expenses|'
       || 'capital expenditures?|capex|operating expenses?|'
       || 'fund name|fund|owner|ownership|tenant|property|address|'
       || 'total|subtotal|noi|net operating income|gross income|'
       || 'reserves?|vacancy|management fee|insurance|taxes|real estate taxes|'
       || 'rent roll|rent|n/?a|none|unknown|tbd'
       || ')\s*$'),
    false)
  -- A bare postal/geographic fragment ("Toronto, ON M5K 2A1") is likewise an
  -- address that leaked into a name column, never a decision-maker.
  or coalesce(p_name,'') ~ '\m[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}\M'
  or coalesce(p_name,'') ~ ',\s*[A-Z]{2}\s+[0-9]{5}(-[0-9]{4})?\s*$';
$$;

comment on function public.lcc_p131_is_document_row_label(text) is
  'P131: narrow detector for OM-extraction spreadsheet row labels / address fragments minted as contact names. Scoped to the owner-contact decidability gate; NOT a general-purpose name filter.';

-- A candidate that merely TRUNCATES the owner name is not a distinct
-- decision-maker. Measured on this queue's own bench: "Boyd Watterson" for "Boyd
-- Watterson Global", "Genesis Financial" for "Genesis Financial Group", "Larkin
-- Gifford" for "Larkin Gifford Developments", "Walter Bros." for "Walter Bros.
-- Construction" — all of which `lcc_owner_name_is_credible_person` happily
-- accepts. This is the CLAUDE.md "strict token SUBSET is NOT an abbreviation"
-- rule applied to the contact bench.
--
-- Two deliberate exemptions, both measured:
--   * JOINT-INDIVIDUAL owners. P158a: '&' in an owner name is usually a married
--     couple, not a firm. "Adel B. Bareh" inside "Adel B & Gihan M Bareh" is a
--     real EXTRACTION of one of the two people. Only '&'/'and' exempt — 'or' does
--     not ("Durst family or The Durst Organization" is an alias, not two people).
--   * HONORIFIC-ONLY differences. "Robert Robles" vs "Robert Robles Md" is one
--     individual with a credential, so it stays decidable.
--
-- ⚠️ KNOWN, DELIBERATE FALSE NEGATIVE: where the owner's only extra token is a
-- stripped legal form, this returns false — "Trammell Crow" vs "Trammell Crow Co"
-- reads as decidable even though it is the company restated. That is the SAFE
-- direction and it is the same judgement `isOwnerNameRestated` makes in JS after
-- its 2026-08-21 correction: "Peter Hansen" inside "Peter Hansen LLC" is a
-- single-member LLC whose principal IS that person. Missing a phantom costs one
-- row a human rejects; blocking a real individual owner deletes a decision-maker
-- on a live prospect.
create or replace function public.lcc_p131_candidate_restates_owner(p_cand text, p_owner text)
returns boolean language sql immutable as $$
  with tok as (
    select array(select t from unnest(string_to_array(
             regexp_replace(lower(coalesce(p_cand,'')), '[^a-z0-9]+', ' ', 'g'), ' ')) t
           where t <> '' and t not in ('llc','inc','corp','corporation','ltd','lp','llp','lllp','plc',
             'pllc','pc','pa','trust','trustee','dst','reit','company','co','the','and','of')) as c,
         array(select t from unnest(string_to_array(
             regexp_replace(lower(coalesce(p_owner,'')), '[^a-z0-9]+', ' ', 'g'), ' ')) t
           where t <> '' and t not in ('llc','inc','corp','corporation','ltd','lp','llp','lllp','plc',
             'pllc','pc','pa','trust','trustee','dst','reit','company','co','the','and','of')) as o
  )
  select case
    when coalesce(p_owner,'') ~* '(\s&\s|\sand\s)' then false
    when (select c from tok) <@ (select o from tok)
      and exists (select 1 from tok
                  where (select array(select t from unnest(o) t
                                      where t <> all(c)
                                        and t not in ('md','do','dds','dmd','phd','esq','jr','sr','ii','iii','iv','mr','mrs','ms','dr')))
                        <> '{}')
      then true
    else false
  end;
$$;

comment on function public.lcc_p131_candidate_restates_owner(text,text) is
  'P131: true when a bench candidate merely restates the owner name (a truncation such as "Boyd Watterson" for "Boyd Watterson Global"), so it is not a distinct decision-maker. Exempts joint-individual owners (&/and) and honorific-only differences.';

-- One row per OPEN owner_contact_manual task, carrying WHY it can or cannot be
-- answered from what LCC already holds. `decidable` is the flag a surface gates
-- on (P181: an escalation must carry its confidence and the surface must gate on
-- it); `blocked_reason` names the rung so "we looked and there is nothing" stays
-- distinguishable from "nobody has looked".
create or replace view public.v_lcc_owner_contact_decidability as
with task as (
  select rt.id as research_task_id,
         rt.entity_id,
         rt.status,
         rt.created_at,
         coalesce(rt.metadata->>'owner_name', '')                       as owner_name,
         nullif(rt.metadata->>'rank_value', '')::numeric                as rank_value,
         rt.metadata->>'enrichment_action'                              as enrichment_action,
         rt.metadata->>'demoted_reason'                                 as demoted_reason
  from public.research_tasks rt
  where rt.research_type = 'owner_contact_manual'
    and rt.status in ('queued', 'in_progress')
),
cand as (
  select t.research_task_id,
         b.value->>'name'   as cand_name,
         b.value->>'source' as cand_source,
         b.value->>'role'   as cand_role
  from task t
  join public.owner_contact_pivot o on o.entity_id = t.entity_id
  cross join lateral jsonb_array_elements(coalesce(o.bench, '[]'::jsonb)) b
),
scored as (
  select c.research_task_id, c.cand_name, c.cand_source, c.cand_role,
         -- A candidate is USABLE only if it names someone other than the owner,
         -- reads as a person, carries no organisation marker, and is not an
         -- extraction row label. All four, because each one alone has been
         -- measured to admit garbage.
         (   public.lcc_owner_strict_core(c.cand_name)
           is distinct from public.lcc_owner_strict_core(t.owner_name)
          and not public.lcc_p131_candidate_restates_owner(c.cand_name, t.owner_name)
          and public.lcc_owner_name_is_credible_person(c.cand_name)
          and not public.lcc_owner_name_has_org_marker(c.cand_name)
          and not public.lcc_p131_is_document_row_label(c.cand_name)
         ) as usable
  from cand c join task t on t.research_task_id = c.research_task_id
),
agg as (
  select research_task_id,
         count(*)                                    as bench_size,
         count(*) filter (where usable)              as usable_candidates,
         (array_agg(cand_name  order by usable desc, cand_name))[1] as best_candidate_name,
         (array_agg(cand_source order by usable desc, cand_name))[1] as best_candidate_source,
         (array_agg(cand_role   order by usable desc, cand_name))[1] as best_candidate_role
  from scored group by research_task_id
)
select t.research_task_id,
       t.entity_id,
       t.owner_name,
       t.rank_value,
       t.enrichment_action,
       t.status,
       t.created_at,
       coalesce(a.bench_size, 0)        as bench_size,
       coalesce(a.usable_candidates, 0) as usable_candidates,
       case when coalesce(a.usable_candidates, 0) > 0 then a.best_candidate_name  end as best_candidate_name,
       case when coalesce(a.usable_candidates, 0) > 0 then a.best_candidate_source end as best_candidate_source,
       case when coalesce(a.usable_candidates, 0) > 0 then a.best_candidate_role   end as best_candidate_role,
       (coalesce(a.usable_candidates, 0) > 0) as decidable,
       case
         when coalesce(a.usable_candidates, 0) > 0 then null
         when t.demoted_reason = 'public_entity_not_prospected'
           or public.lcc_owner_name_is_public_body(t.owner_name)
           then 'public_body_not_prospected'
         when coalesce(a.bench_size, 0) = 0 then 'no_candidate_on_file'
         else 'bench_restates_owner_or_row_labels'
       end as blocked_reason,
       case
         when coalesce(a.usable_candidates, 0) > 0
           then 'A named candidate is on file — confirm or reject it on the owner''s Contacts tab.'
         when t.demoted_reason = 'public_entity_not_prospected'
           or public.lcc_owner_name_is_public_body(t.owner_name)
           then 'Public body — not a prospecting target.'
         when coalesce(a.bench_size, 0) = 0
           then 'Nothing on file: no registry manager, no linked person, no correspondence. Needs external acquisition (SOS-direct is blocked upstream), not desk research.'
         else 'The only candidates on file restate the owner''s own name or are extraction artifacts. Needs external acquisition, not desk research.'
       end as decidability_note
from task t
left join agg a on a.research_task_id = t.research_task_id;

comment on view public.v_lcc_owner_contact_decidability is
  'P131 lane B: per-task decidability for owner_contact_manual. decidable=true means a named, person-shaped, non-self-echo, non-row-label candidate is already on file and a human can confirm it now. Everything else carries a blocked_reason so the answerable few are not buried by the unanswerable many (P181). Read-only; classifies, never writes.';

grant select on public.v_lcc_owner_contact_decidability to anon, authenticated, service_role;
