// api/_shared/address-reverse.js
// ============================================================================
// CONTACT-SELECTION Slice 4 — Phase C: address reverse-lookup (FRAMEWORK)
// ----------------------------------------------------------------------------
// For an owner with a RESIDENTIAL registered/notice address, the resident is
// the principal ("owns the house the LLC is registered at"). Source for the 78
// contactless dia owners is `true_owners.notice_address_1` (populated for ALL
// 78), NOT the gov `registered_agent_address` the original prompt assumed.
//
// FRAMEWORK, not a live scraper (sandbox has no egress). Built + unit-tested
// here: the residential-vs-registered-agent-SERVICE classifier (the safety
// gate), the person guard, and the unconfigured/feature-flag behavior. The
// actual reverse-lookup HTTP is a deferred, deps-injected fetcher behind
// `OWNER_ENRICH_ADDRESS_URL`; it no-ops until a free, rate-limited source is
// wired + validated post-deploy.
//
// SAFETY: a registered-agent SERVICE address (CSC / CT Corporation / Cogency /
// "Registered Agents, Inc." / a law firm / a PO box) resolves to the AGENT, not
// the owner's principal — so it is REJECTED (never attached as the principal).
// Those owners are really Phase-B (SOS) territory, or stay queued.
// ============================================================================

import { looksLikePersonName, isImplausiblePersonName } from './entity-link.js';

// Commercial registered-agent SERVICE providers + law/agent-firm markers. An
// address (or its accompanying recipient line) matching these is the agent's
// office, not the principal's residence. Anchored on the service-firm WORDS so
// a real resident street address is never tripped.
const AGENT_SERVICE_RE = new RegExp(
  [
    'corporation\\s+service\\s+company', '\\bC\\s*S\\s*C\\b',
    'C\\s*T\\s+corporation', '\\bcogency\\b', 'national\\s+registered\\s+agents?',
    'registered\\s+agents?,?\\s+inc', 'incorp\\s+services', 'legalzoom',
    'northwest\\s+registered\\s+agent', 'united\\s+states\\s+corporation\\s+agents?',
    'harvard\\s+business\\s+services', 'paracorp', '\\bparasec\\b', 'capitol\\s+services',
    'registered\\s+agent', 'resident\\s+agent', 'statutory\\s+agent',
    'c/o\\b', '\\bP\\.?\\s*O\\.?\\s*box\\b', '\\bsuite\\s+\\d', '\\bste\\.?\\s+\\d',
    '\\bLLP\\b', '\\bL\\.?L\\.?P\\b', 'law\\s+(?:firm|office|group)', 'attorneys?\\s+at\\s+law',
  ].join('|'),
  'i',
);

/**
 * True when an address (and/or its recipient line) is a commercial
 * registered-agent SERVICE address — NOT the owner's residence. Reverse-lookup
 * must NOT attach the resolved name as the owner's principal in this case.
 *
 * @param {string} address  notice/registered address line(s)
 * @param {string} [recipientName]  the addressee, if separate (often the agent firm)
 */
export function isRegisteredAgentServiceAddress(address, recipientName = '') {
  const hay = `${recipientName || ''} ${address || ''}`.trim();
  if (!hay) return false;
  return AGENT_SERVICE_RE.test(hay);
}

/**
 * Classify a candidate notice address for reverse-lookup eligibility.
 * @returns {{eligible:boolean, reason:string}}
 */
export function classifyReverseAddress(address, recipientName = '') {
  const a = String(address || '').trim();
  if (!a || a.length < 6) return { eligible: false, reason: 'no_address' };
  if (isRegisteredAgentServiceAddress(a, recipientName)) return { eligible: false, reason: 'agent_service_address' };
  // A residential street address starts with a street number.
  if (!/\d/.test(a)) return { eligible: false, reason: 'no_street_number' };
  return { eligible: true, reason: 'residential_candidate' };
}

/**
 * Validate a reverse-lookup result into an attachable principal. Returns null
 * when the resolved name isn't a plausible human (same guards as every mint).
 */
export function sanitizeAddressResult(res) {
  if (!res || typeof res.person_name !== 'string') return null;
  const name = res.person_name.replace(/\s+/g, ' ').trim();
  if (!looksLikePersonName(name) || isImplausiblePersonName(name)) return null;
  return { person_name: name, role: res.role || 'economic_owner_contact' };
}

export function isAddressAdapterConfigured() {
  return !!process.env.OWNER_ENRICH_ADDRESS_URL;
}

/**
 * Build the `addressLookup(row)` the worker calls. Classifies the owner's
 * notice address; only RESIDENTIAL (non-agent-service) addresses proceed to the
 * deferred reverse-lookup fetcher. A registered-agent service address → no
 * attach (`reason:'agent_service_address'`), the owner stays queued / routes to
 * Phase B.
 *
 *   deps.fetch(address, row) -> { person_name, role } | null   (production; deferred)
 *   deps.cache { get, set }                                     (optional)
 *
 * Unconfigured (no OWNER_ENRICH_ADDRESS_URL or no fetcher) ⇒
 * `{ ok:false, reason:'unconfigured' }`.
 */
export function buildAddressReverseAdapter(deps = {}) {
  const fetcher = deps.fetch;
  const cache = deps.cache;
  return async function addressLookup(row) {
    if (!isAddressAdapterConfigured() || typeof fetcher !== 'function') return { ok: false, reason: 'unconfigured' };
    const address = row.notice_address || row.registered_address || '';
    const recipient = row.notice_recipient || '';
    const cls = classifyReverseAddress(address, recipient);
    if (!cls.eligible) return { ok: false, reason: cls.reason };
    const key = `addr|${String(address).toLowerCase().replace(/\s+/g, ' ').trim()}`;
    let parsed;
    if (cache) { const hit = await cache.get(key); if (hit !== undefined && hit !== null) parsed = hit; }
    if (parsed === undefined) {
      try { parsed = await fetcher(address, row); } catch (e) { return { ok: false, reason: 'fetch_error', detail: String(e && e.message || e) }; }
      if (cache) { try { await cache.set(key, parsed || null); } catch (_e) { /* soft */ } }
    }
    const clean = sanitizeAddressResult(parsed);
    if (!clean) return { ok: false, reason: 'no_result' };
    return { ok: true, ...clean };
  };
}
