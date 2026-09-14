-- P189 step 1 — make the duplicate-entity detector's BLIND SPOT visible. Read-only, additive.
--
-- THE DEFECT (measured live 2026-08-26, LCC Opps):
--   `v_lcc_merge_candidates` — the repo's duplicate-entity surface — groups on
--   `lcc_normalize_entity_name()`. That function returns NULL/empty for **1,089 live
--   organisations carrying $185.1M of current annual rent**, because it strips
--   group/partners/capital/holdings/company/trust on top of legal forms, and an acronym-named
--   firm has nothing left. The merge surface therefore reports NO duplicates for any of them,
--   forever. Playbook Class 11: the zero is the instrument, not a finding.
--
--   CLAUDE.md already records this reduce-to-nothing failure for `dup-pair-planner.ownerCore`
--   ("Realty Income Corporation" -> the empty string) and for `lcc_owner_strict_core`. It was
--   never checked on the normalizer the merge detector actually USES. **When a hazard is
--   documented for one function, grep every sibling that does the same job — the hazard travels
--   with the technique, not the name.**
--
-- WHAT IT HIDES (this view, first run): **121 groups / 300 entities / $136.5M**, of which
--   **60 groups carry BYTE-IDENTICAL names**:
--     ngpcapital   5 members  $68.3M   "NGP Capital" x5  (identical string)
--     rmrgroup     5 members  $16.4M   "RMR Group" + "The RMR Group" x4
--     avgpartners  4 members  $8.9M    identical
--     gipartners   3 members  $8.6M    identical
--     cimgroup     4 members  · aeicapital 6 · jlbcapital 3 · ngpgroup 3 · ...
--   Control: `select count(*) from v_lcc_merge_candidates where norm_name = ''` returns **0** —
--   the old surface sees none of them, which is what makes these counts trustworthy.
--
-- ⚠️ WHY THIS IS A SEPARATE VIEW AND NOT A FIX TO `v_lcc_merge_candidates`:
--   that view feeds a DESTRUCTIVE path and currently reports **5,222 groups, 3,053 of them
--   `auto_mergeable`**. Re-keying its grouping would change which 3,053 groups auto-merge. That
--   is a gated decision with its own named-row proof, not a side effect of making a blind spot
--   visible. This companion is deliberately PROPOSAL-ONLY and carries **no `auto_mergeable`
--   flag at all**.
--
-- ⚠️ AND `lcc_owner_domain_core` IS A GROUPING KEY HERE, NOT AN IDENTITY KEY. Grouping-for-review
--   and identity-for-write are different jobs (CLAUDE.md). A human confirms every merge, and the
--   merge itself must still go through `lcc_merge_entity` (P160 backref repoints, P153 cycle
--   guard, tombstone-survivor resolution) — never by hand.
--
-- ⚠️ A SECOND, INDEPENDENT BLIND SPOT IS NOT ADDRESSED HERE: a wording difference defeats the
--   normalizer even when it returns a value. Easterly's two live entities normalize to
--   `easterly gov reit` and `easterly government` and never group — the highest-value owner in
--   the Tier 0 lane, rendered as four cards for one firm. That needs its own pass (prompt 189).
--
-- REVERSAL: `drop view v_lcc_merge_candidates_normalizer_blind;` — it reads, it writes nothing.

create or replace view v_lcc_merge_candidates_normalizer_blind as
with blind as (
  select e.id as entity_id,
         e.name,
         lcc_owner_domain_core(e.name) as group_key,
         coalesce((select sum(f.annual_rent) filter (where f.is_current)
                   from lcc_entity_portfolio_facts f where f.entity_id = e.id), 0)::numeric as annual_rent,
         exists(select 1 from lcc_property_owner po where po.owner_entity_id = e.id) as is_resolved_owner
  from entities e
  where e.merged_into_entity_id is null
    and e.entity_type = 'organization'::entity_type
    and coalesce(lcc_normalize_entity_name(e.name),'') = ''   -- the blind population, exactly
    and length(lcc_owner_domain_core(e.name)) >= 5            -- a core too short to identify anything
)
select b.group_key,
       count(*)                                    as member_count,
       count(*) filter (where b.is_resolved_owner) as resolved_owner_members,
       sum(b.annual_rent)                          as combined_annual_rent,
       count(distinct b.name)                      as distinct_names,
       (count(distinct b.name) = 1)                as names_identical,
       array_agg(b.entity_id order by b.annual_rent desc, b.entity_id) as member_entity_ids,
       string_agg(b.name, ' | ' order by b.annual_rent desc, b.entity_id) as member_names
from blind b
group by b.group_key
having count(*) > 1;

comment on view v_lcc_merge_candidates_normalizer_blind is
  'READ-ONLY companion to v_lcc_merge_candidates, covering the population that view is '
  'STRUCTURALLY BLIND TO: live organisations whose lcc_normalize_entity_name() is NULL/empty '
  'because the normalizer strips group/partners/capital/holdings on top of legal forms, leaving '
  'an acronym-named firm with nothing (RMR Group, GI Partners, AVG Partners, NGP Capital). '
  'Grouped by lcc_owner_domain_core (P187, order-preserving). PROPOSAL ONLY -- deliberately '
  'carries NO auto_mergeable flag, because v_lcc_merge_candidates feeds a destructive path with '
  '3,053 auto-mergeable groups and re-keying it is a separate, gated decision (prompt 189). '
  'Grouping-for-review is not identity-for-write: every merge is human-confirmed and must go '
  'through lcc_merge_entity.';
