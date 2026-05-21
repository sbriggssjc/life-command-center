# SOS-Direct Scraper — Build Spec

**Date:** 2026-05-21
**Why:** `recorded_owners.registered_agent_name / manager_name / filing_id / state_of_incorporation` are **0 / ~0** on both DBs. The `llc_research_queue` has **461 gov + 1,235 dia rows stuck `queued`, 0 completed** — the enrichment was gated on a paid OpenCorporates key and the free SOS-direct path was deferred. This is the universal unlock: it supplies the manager/member → true-owner → decision-maker chain *and* the registered-agent address that gives the address matcher its fuel.

## Goal
Drain `llc_research_queue` by looking up each owner LLC in its state's Secretary-of-State business registry and writing back: `registered_agent_name`, `registered_agent_address`, `manager_name`/`manager_role` (managers/members), `filing_id`, `filing_date`, `filing_status`, `state_of_incorporation`.

## Architecture (per-state adapters behind one worker)
- **Worker**: `?_route=sos-research-tick` (Vercel) or an edge function, GET=dry-run / POST=drain, `limit` cap (≤50/tick to respect rate limits + connection budget).
- **Per-state adapter registry**: each adapter knows one SOS site's search + entity-detail parse (most states expose a free business-entity search; some have JSON endpoints, others need HTML parse). Start with the states holding the most queued owners (rank `llc_research_queue` by state). Fall back to **sidebar-assisted manual capture** for states without an adapter (the broker pulls the SOS page; the sidebar ingests it) — so coverage is never blocked on building all 50 states.
- **State derivation**: use the owner's known state (`recorded_owners.state` / property state / `state_of_incorporation`) to pick the adapter; skip with `no_jurisdiction` if unknown (visible, not silently queued).

## Write-back + resolution
1. Update `recorded_owners` agent/manager/filing fields (priority-gated like other writes; SOS outranks CoStar for these).
2. Create **contacts** for managers/members (`contact_type='decision_maker'`, `data_source='sos'`) — same pattern as `sam_propagate_to_owners`.
3. Run the manager/agent through `resolve_company`/`resolve_contact` → `unified_contacts` → resolves recorded→**true** owner.
4. Mark the queue row `completed` on success, **`no_match`** when SOS returns nothing (visible), `unreachable` on site error with a retry counter — **never leave it silently `queued`** (the coverage alert already fires on a stalled queue).

## Anti-patterns to guard (reuse existing filters)
- Skip `is_generic_gov_owner` names (USA/City of…) — already `skipped_public_reit` for REITs.
- Don't auto-merge two LLCs sharing a registered agent (agents serve many entities) — agent is a contact link, not an identity match.

## Scheduling
`*/15` or `*/30`, capped 50/tick, staggered, through the pooler (per the scheduling review). The two queues (1,700 rows) drain in days at 50/15min.

## Acceptance
- `llc_research_queue` completion rate > 0 (the stalled alert clears).
- `recorded_owners.registered_agent_name` count climbs from 0; new `data_source='sos'` decision-maker contacts appear.
- `v_ownership_coverage.pct_owner_has_sos_agent` trends up; the address matcher (O-8) gains fuel from registered-agent addresses.

## Sequence vs other work
This is the **keystone unlock** — it (a) fills owner addresses (with the deed/county fix), enabling the address matcher; (b) supplies decision-maker contacts; (c) resolves recorded→true owner. Prioritize the top-N states by queued volume; sidebar-assisted capture covers the long tail immediately.
