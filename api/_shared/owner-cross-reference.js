// api/_shared/owner-cross-reference.js
// ============================================================================
// Owner cross-reference resolver — the FRONT of Scott's ownership-resolution
// chain, done FREE on the records we already hold.
// ----------------------------------------------------------------------------
// Scott's real method for finding an owner's decision-maker is a public-records
// chain: County records (LLC → owner + address) → State SOS (managing member /
// registered agent) → CROSS-MATCH the overlapping names/addresses against our
// existing contact/company records + naming structure → web/people-search only
// LAST (for phone/email, once identity is known). This module implements the
// cross-match step on the LCC entity graph: resolve a CONTACTLESS owner's
// decision-maker by REUSING a contact we've already established on a RELATED
// owner. It is the owner-contact-enrich worker's FREE step-1 (`crossRef`), ahead
// of the SOS / address / deed / web adapters.
//
// Three strategies (priority order), all resolved + guarded in SQL
// (lcc_resolve_owner_cross_reference; see the migration):
//   1. same_asset  — a co-owner of the SAME property (LCC's grounded form of
//                    "shared records/address"; owner entities hold no notice
//                    address in LCC).
//   2. same_parent — the R5/R6 resolved parent / SPE family.
//   3. naming_core — a DISTINCTIVE shared name-core (Starwood REIT ↔ Starwood
//                    Capital Group). A common single token ("thomas",
//                    "healthcare", "sage") over-matches WRONG families, so the
//                    guard requires a multi-token core OR a distinctive single
//                    token (≥ 8 chars, not in the industry/geo denylist).
//
// The SQL never reuses an operator's contacts and re-uses the existing person
// guards (lcc_looks_like_person / lcc_is_rejected_contact_name); this JS layer
// RE-APPLIES the JS person guards (looksLikePersonName / isImplausiblePersonName)
// as defense-in-depth, and shapes the `crossRef(row)` adapter contract the worker
// expects. No confident related contact ⇒ `{ ok:false, reason:'no_sibling' }`
// (the worker falls through to SOS/web/manual — never a guess). Every attach
// rides the existing attach path + guards (the worker mints the reused person by
// name through ensureEntityLink, deduping to the same entity by canonical_name)
// and records `via='cross_reference:<strategy>'` for provenance.
// ============================================================================

import { opsQuery as defaultOpsQuery } from './ops-db.js';
import { looksLikePersonName, isImplausiblePersonName } from './entity-link.js';

// Generic single-token name-cores that carry no family signal alone — a
// single-token naming match is only allowed for a DISTINCTIVE token (≥ 8 chars
// AND not in this list). Mirrors v_generic in lcc_resolve_owner_cross_reference.
export const GENERIC_CORE_TOKENS = new Set([
  'healthcare', 'national', 'american', 'united', 'global', 'pacific', 'western', 'eastern',
  'northern', 'southern', 'atlantic', 'premier', 'prime', 'summit', 'capital', 'equity', 'realty',
  'property', 'properties', 'holdings', 'partners', 'associates', 'management', 'investments',
  'development', 'enterprises', 'group', 'trust', 'ventures', 'advisors', 'financial', 'commercial',
  'residential', 'industrial', 'retail', 'medical', 'senior', 'first', 'general', 'standard',
  'consolidated', 'integrated', 'metropolitan', 'metro', 'central', 'liberty', 'heritage', 'legacy',
  'community', 'sterling', 'pinnacle', 'horizon', 'gateway', 'cornerstone', 'keystone', 'landmark',
  'investment', 'realestate', 'real', 'estate', 'income',
]);

/**
 * The whole-token shared core of two normalized name-cores, or null. Either an
 * exact match, or one core is a WHOLE-TOKEN prefix of the other (so "starwood"
 * overlaps "starwood real estate" but NOT "starwoodish"). Pure — mirrors the SQL
 * CASE. `coreA`/`coreB` are DB-normalized cores (lcc_normalize_entity_name).
 */
export function sharedCoreOf(coreA, coreB) {
  const a = String(coreA || '').trim();
  const b = String(coreB || '').trim();
  if (!a || !b) return null;
  if (a === b) return a;
  if (b.startsWith(a + ' ')) return a;   // a is a whole-token prefix of b
  if (a.startsWith(b + ' ')) return b;   // b is a whole-token prefix of a
  return null;
}

/**
 * Is a shared core distinctive enough to imply the SAME family? Multi-token core,
 * or a distinctive single token (≥ 8 chars, not generic). Pure — mirrors the SQL.
 */
export function isDistinctiveSharedCore(shared) {
  const s = String(shared || '').trim();
  if (!s) return false;
  const tokens = s.split(/\s+/);
  if (tokens.length >= 2) return true;                       // multi-token → distinctive
  return s.length >= 8 && !GENERIC_CORE_TOKENS.has(s);       // single distinctive token
}

/** A naming-core match is safe only when the cores share a distinctive core. */
export function namingCoreMatches(coreA, coreB) {
  return isDistinctiveSharedCore(sharedCoreOf(coreA, coreB));
}

/** Defense-in-depth person guard (the SQL already filtered). */
export function isReusablePersonName(name) {
  return !!name && looksLikePersonName(name) && !isImplausiblePersonName(name);
}

/**
 * Build the `crossRef(row)` the worker calls as step 1 of external enrichment.
 * Calls the SQL resolver, re-applies the JS person guard, and returns the
 * adapter contract: { ok, person_name, role, strategy, source_entity_id,
 * source_owner_name, confidence } or { ok:false, reason }.
 *
 *   deps.opsQuery — defaults to the live opsQuery.
 */
export function buildCrossRefAdapter(deps = {}) {
  const q = deps.opsQuery || defaultOpsQuery;
  return async function crossRef(row) {
    if (!row || !row.entity_id) return { ok: false, reason: 'no_entity' };
    let res;
    try {
      res = await q('POST', 'rpc/lcc_resolve_owner_cross_reference', { p_entity_id: row.entity_id });
    } catch (e) {
      return { ok: false, reason: 'resolver_error', detail: String(e && e.message || e) };
    }
    if (!res || !res.ok) return { ok: false, reason: 'resolver_error', detail: res && res.data };
    const hit = Array.isArray(res.data) ? res.data[0] : null;
    if (!hit || !hit.person_name) return { ok: false, reason: 'no_sibling' };
    if (!isReusablePersonName(hit.person_name)) return { ok: false, reason: 'guard_rejected' };
    return {
      ok: true,
      person_name: hit.person_name,
      role: hit.person_role || 'principal',
      strategy: hit.strategy || 'cross_reference',
      source_entity_id: hit.source_entity_id || null,
      source_owner_name: hit.source_owner_name || null,
      confidence: hit.confidence || 'medium',
    };
  };
}

/**
 * Dry-run / sizing: run the resolver over the value-ranked top-N contactless
 * worklist (no writes) and report per-strategy counts + a sample of the proposed
 * (owner → reused contact, source) pairs so the yield can be eyeballed BEFORE any
 * real run. The JS person guard is re-applied so guard-failing rows are reported
 * separately (never counted as a resolvable match).
 *
 * @returns {{resolved, by_strategy, guard_dropped, sample, min_value, limit}}
 */
export async function crossRefDryRun(deps = {}, { minValue = 1000000, limit = 400 } = {}) {
  const q = deps.opsQuery || defaultOpsQuery;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 400, 1), 1000);
  let res;
  try {
    res = await q('POST', 'rpc/lcc_cross_reference_worklist_preview',
      { p_min_value: minValue, p_limit: lim }, { timeoutMs: 45000 });
  } catch (e) {
    return { ok: false, reason: 'preview_error', detail: String(e && e.message || e) };
  }
  if (!res || !res.ok) return { ok: false, reason: 'preview_error', detail: res && res.data };
  const rows = Array.isArray(res.data) ? res.data : [];
  const byStrategy = {};
  const sample = [];
  let resolved = 0;
  let guardDropped = 0;
  for (const r of rows) {
    if (!isReusablePersonName(r.person_name)) { guardDropped += 1; continue; }
    resolved += 1;
    byStrategy[r.strategy] = (byStrategy[r.strategy] || 0) + 1;
    if (sample.length < 20) {
      sample.push({
        owner: r.owner_name,
        rank_value: r.rank_value != null ? Math.round(Number(r.rank_value)) : null,
        strategy: r.strategy,
        reuse_from: r.source_owner_name,
        person: r.person_name,
      });
    }
  }
  return { ok: true, resolved, by_strategy: byStrategy, guard_dropped: guardDropped,
    sample, min_value: minValue, limit: lim };
}
