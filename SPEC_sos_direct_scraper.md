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

---

## Adapter contract + skeleton + wiring (turnkey — added 2026-05-29, G15/C7)

The framework is live in `api/_shared/llc-research.js`: `lookupLlc({name,state})`
checks `SOS_DIRECT_ADAPTERS[<ST>]` first and falls back to OpenCorporates.
Adding a state = adding one registry entry. **The orchestrator is JS**, so
adapters are `.js` (not `.ts` as the original plan wrote).

### Uniform return shape (mirror `lookupViaOpenCorporates`)

```js
// SUCCESS
{
  found: true,
  source: 'sos_FL',                 // 'sos_<state>'
  filing_state, filing_id, filing_date, filing_status,
  registered_agent_name, registered_agent_address,
  manager_name, manager_role,
  payload,                          // raw record, for audit
}
// MISS / NON-FATAL (orchestrator falls through to OpenCorporates except no_match)
{ found: false, source: 'sos_FL', reason: 'no_match' }        // authoritative miss — DO NOT fall through
{ found: false, source: 'sos_FL', reason: 'adapter_pending' } // not yet verified live — falls through
{ found: false, source: 'sos_FL', reason: 'unreachable' }     // site/network error — falls through + retry
{ found: false, source: 'sos_FL', reason: 'rate_limited' }    // back off — falls through
```

### Skeleton (`api/_shared/sos/<state>.js`)

```js
// api/_shared/sos/fl.js  — Florida Sunbiz. Build strategy #1: bulk-mirror.
export async function lookupViaFloridaSunbiz({ name, state }) {
  // GUARD until verified against the live source (audit contract):
  // return { found: false, source: 'sos_FL', reason: 'adapter_pending' };

  try {
    // 1. Resolve: query the FL Sunbiz mirror (preferred) or live search.
    //    const hit = await matchSunbizMirror(name);            // bulk-file mirror
    //    if (!hit) return { found:false, source:'sos_FL', reason:'no_match' };
    // 2. Map hit → uniform shape:
    // return {
    //   found: true, source: 'sos_FL',
    //   filing_state: 'FL', filing_id: hit.documentNumber,
    //   filing_date: hit.dateFiled, filing_status: hit.status,
    //   registered_agent_name: hit.raName, registered_agent_address: hit.raAddr,
    //   manager_name: hit.principals?.[0]?.name, manager_role: hit.principals?.[0]?.title,
    //   payload: hit,
    // };
    return { found: false, source: 'sos_FL', reason: 'adapter_pending' };
  } catch (err) {
    return { found: false, source: 'sos_FL', reason: 'unreachable', error: err?.message };
  }
}
```

### Wiring (in `llc-research.js`)

```js
import { lookupViaFloridaSunbiz } from './sos/fl.js';
const SOS_DIRECT_ADAPTERS = {
  FL: lookupViaFloridaSunbiz,   // enable ONLY after verified against the live source
};
```

### Build order + the hard gate

1. **FL first via bulk-mirror** (Sunbiz publishes downloadable corporate data
   files) — compliant, complete, no anti-bot, no per-request cost. Then the
   other top-queued states (rank `llc_research_queue` by `guessed_state`).
2. **Verify-before-enable (non-negotiable, per the registry contract):** keep an
   adapter returning `adapter_pending` until it's validated against the live
   source format. Enabling an unverified adapter risks writing garbage to
   `recorded_owners`.

### Why this is a workstation task (not remote-agent)

All target SOS endpoints (TX/FL/CA/GA/NC) return **HTTP 403 from the
Claude-on-the-web execution environment** (datacenter-IP / network policy), so
adapters can't be developed or live-verified here. Build them from a
workstation/residential context (or a proper data pipeline for the FL mirror).
Until then the queue persists harmlessly (worker no-ops on `adapter_pending`);
OpenCorporates remains the flagged fallback; `/api/sos-writeback` covers manual
sidebar capture. See `docs/ownership_sales_remediation/2026-05-29_c7_status.md`.
