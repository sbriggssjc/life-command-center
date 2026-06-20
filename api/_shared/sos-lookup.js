// api/_shared/sos-lookup.js
// ============================================================================
// CONTACT-SELECTION Slice 4 — Phase B: free per-state SOS manager lookup (FRAMEWORK)
// ----------------------------------------------------------------------------
// For an LLC/LP owner the principal is the manager / managing-member / officer
// on the entity's Secretary-of-State filing (authority-2). Scott's preference:
// FREE SOS-direct over paid OpenCorporates.
//
// THIS FILE IS THE FRAMEWORK, NOT A LIVE SCRAPER. Per the build doctrine, we do
// NOT blind-ship per-state response parsers we cannot validate against live
// sites (this sandbox has no egress — every request 403s). So:
//   • State INFERENCE, the adapter REGISTRY/dispatch, the person guards, and the
//     unconfigured/feature-flag behavior are built + unit-tested here.
//   • Each state's response PARSER is a deferred stub (`parse:null`, the adapter
//     `enabled:false`) until a CAPTURED sample response is wired and validated
//     in the Railway env (which has egress). The adapter no-ops until then.
//
// The 78 contactless owners are ALL dia and ALL carry `true_owners.state`
// (+ a few `recorded_owners.state_of_incorporation`), so the state-inference
// input exists for every owner. An owner whose filing state can't be resolved /
// has no enabled adapter is left QUEUED (honest) — never a guess-attach.
// ============================================================================

import { looksLikePersonName, isImplausiblePersonName } from './entity-link.js';

const US_STATE_RE = /^[A-Z]{2}$/;

/**
 * Ordered, deduped candidate filing states for an owner. `state_of_incorporation`
 * (explicit filing state) is most authoritative; the owner's location `state` is
 * a PROXY (an LLC may file in DE/NV regardless), so DE + NV are appended as the
 * common formation-state fallbacks. All uppercased + validated 2-letter.
 *
 * @param {{state_of_incorporation?:string, owner_state?:string}} row
 * @returns {string[]}
 */
export function inferFilingStates(row = {}) {
  const out = [];
  const push = (s) => {
    if (!s) return;
    const v = String(s).trim().toUpperCase();
    if (US_STATE_RE.test(v) && !out.includes(v)) out.push(v);
  };
  push(row.state_of_incorporation);
  push(row.owner_state);
  push('DE');
  push('NV');
  return out;
}

// ---------------------------------------------------------------------------
// Per-state adapter registry
// ---------------------------------------------------------------------------
// Each adapter: { state, name, search_hint, enabled, parse }.
//   enabled  — false until a captured response validates `parse` (post-deploy).
//   parse(body) -> { person_name, role } | null   (DEFERRED per state)
//
// The framework dispatches to the FIRST enabled adapter for an inferred state.
// Adding a state = drop in an adapter with a validated `parse` and flip enabled.
// search_hint documents the free entry point for the post-deploy wire-up; the
// actual HTTP is performed by the injected fetcher, never hard-coded here.
export const SOS_STATE_ADAPTERS = {
  FL: { state: 'FL', name: 'FL Sunbiz', search_hint: 'https://search.sunbiz.org/Inquiry/CorporationSearch/ByName', enabled: false, parse: null },
  CA: { state: 'CA', name: 'CA bizfile', search_hint: 'https://bizfileonline.sos.ca.gov/search/business', enabled: false, parse: null },
  TX: { state: 'TX', name: 'TX Comptroller/SOSDirect', search_hint: 'https://mycpa.cpa.state.tx.us/coa/', enabled: false, parse: null },
};

export function enabledSosStates() {
  return Object.values(SOS_STATE_ADAPTERS).filter((a) => a.enabled && typeof a.parse === 'function').map((a) => a.state);
}

/**
 * Validate a parsed SOS result into an attachable principal, applying the same
 * person-plausibility guards as every other mint path. Returns null when the
 * parsed name is not a plausible human (an agent firm, junk, or a deal string).
 */
export function sanitizeSosResult(res) {
  if (!res || typeof res.person_name !== 'string') return null;
  const name = res.person_name.replace(/\s+/g, ' ').trim();
  if (!looksLikePersonName(name) || isImplausiblePersonName(name)) return null;
  return { person_name: name, role: res.role || 'managing_member' };
}

export function isSosAdapterConfigured() {
  return !!process.env.OWNER_ENRICH_SOS_URL && enabledSosStates().length > 0;
}

/**
 * Build the `sosLookup(row)` the worker calls. Orchestration only:
 *   infer states → first enabled+configured state → deps.fetch (deferred) →
 *   adapter.parse → guard → result. Caching is via deps.cache (optional;
 *   keyed on `${name}|${state}`) so a re-tick / repeat owner doesn't re-hit.
 *
 *   deps.fetch(adapter, name, state) -> rawBody     (production; deferred)
 *   deps.cache { get(key), set(key,val) }           (optional)
 *
 * Unconfigured (no OWNER_ENRICH_SOS_URL, no enabled adapter, or no fetcher) ⇒
 * `{ ok:false, reason:'unconfigured' }`. An owner with no resolvable enabled
 * state ⇒ `{ ok:false, reason:'no_enabled_state', states }` (stays QUEUED).
 *
 * @param deps {{ fetch?:Function, cache?:{get:Function,set:Function}, adapters?:object }}
 */
export function buildSosLookupAdapter(deps = {}) {
  const adapters = deps.adapters || SOS_STATE_ADAPTERS;
  const fetcher = deps.fetch;
  const cache = deps.cache;
  return async function sosLookup(row) {
    if (!process.env.OWNER_ENRICH_SOS_URL || typeof fetcher !== 'function') return { ok: false, reason: 'unconfigured' };
    const enabled = Object.values(adapters).filter((a) => a.enabled && typeof a.parse === 'function');
    if (!enabled.length) return { ok: false, reason: 'unconfigured' };
    const name = String(row.owner_name || '').trim();
    if (!name) return { ok: false, reason: 'no_owner_name' };
    const states = inferFilingStates(row);
    const tried = [];
    for (const st of states) {
      const adapter = adapters[st];
      if (!adapter || !adapter.enabled || typeof adapter.parse !== 'function') continue;
      tried.push(st);
      const key = `${name.toLowerCase()}|${st}`;
      let parsed;
      if (cache) { const hit = await cache.get(key); if (hit !== undefined && hit !== null) parsed = hit; }
      if (parsed === undefined) {
        let body;
        try { body = await fetcher(adapter, name, st); } catch (e) { continue; }
        if (body == null) continue;
        try { parsed = adapter.parse(body); } catch (e) { parsed = null; }
        if (cache) { try { await cache.set(key, parsed || null); } catch (_e) { /* soft */ } }
      }
      const clean = sanitizeSosResult(parsed);
      if (clean) return { ok: true, state_resolved: st, ...clean };
    }
    return { ok: false, reason: tried.length ? 'no_result' : 'no_enabled_state', states };
  };
}
