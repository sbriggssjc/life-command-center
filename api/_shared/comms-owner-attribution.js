// api/_shared/comms-owner-attribution.js
// ============================================================================
// W9.6 (Prompt 102) — correspondence → owner-LLC attribution PLANNER (pure).
//
// The last major INTERNAL linkage gap (W9.5 baseline: correspondence→owner-LLC
// = 2.5%, 6/241). `activity_events` correspondence is stamped with the deal /
// party / property entity the resolver found — brokers, buyers, seller contacts.
// Those are PARTIES, not the owning LLC, so an email about a property never
// surfaces against the owner we're trying to reach. This unit proposes an
// owner-attribution EDGE (correspondence-entity ↔ true_owner) via two paths:
//
//   PATH A — property_bridge (deterministic): a correspondence entity that
//     resolves to an ASSET (or a deal carrying the asset) → the property's
//     true_owner via the ops graph (`owns` edge). Arithmetic where the link
//     exists; confidence 1.0. Value-gated by owner portfolio rank.
//   PATH B — person_match (verbatim, thinner): a correspondence entity that is a
//     PERSON already tied to a true_owner (owner_contact_pivot active contact, or
//     an unambiguous person→owner relationship edge). U3-pattern verbatim
//     evidence (the correspondent's own header name/email). A shared-token-only
//     name bridge is REJECTED (never guess — W9.1 lesson).
//
// The joins themselves live in the SECURITY-INVOKER SQL RPCs
// (lcc_w9_6_path_a_candidates / lcc_w9_6_path_b_candidates); this module is the
// PURE glue: stable subject_refs, the value gate, the shared-token false-bridge
// guard, verbatim evidence assembly, and proposal shaping. No DB, no I/O — unit-
// testable in isolation (mirrors reachability-harvest-planner.js).
//
// CONFIRM (in admin.js verdict dispatch) is a DETERMINISTIC writer: it appends
// the owner ops entity to activity_events.metadata.linked_entity_ids (the single
// anchor both consumers read) + stamps field_provenance source 'comms_owner_bridge'
// + logs a reversible comms_owner_attribution_apply_log row. NEVER auto — a human
// verdict is always required.
// ============================================================================
import {
  normDomain, normalizeForMatch, normalizeWhitespace, normalizeEmail, looksLikeEmail,
} from './reachability-harvest-planner.js';

export { normDomain, normalizeForMatch, normalizeEmail, looksLikeEmail };

export const PATH_A = 'property_bridge';
export const PATH_B = 'person_match';
export const COA_PATHS = [PATH_A, PATH_B];

// The provenance source the confirm writer stamps on the attribution. Registered
// as a field_source_priority row (target public.activity_events / linked_entity_ids)
// in the W9.6 migration so v_field_provenance_unranked stays 0.
export const COA_PROVENANCE_SOURCE = 'comms_owner_bridge';

// Path A is arithmetic (the owns edge is a fact) → confidence 1.0. Path B rests on
// a curated tie (pivot) or an unambiguous relationship edge — high but not 1.0.
export const COA_CONF_PROPERTY_BRIDGE = 1.0;
export const COA_CONF_PERSON_PIVOT = 0.9;
export const COA_CONF_PERSON_RELATIONSHIP = 0.7;

// A stable subject_ref: coa:<path>:<domain>:<corrEntityId>:<ownerEntityId>. ONE
// card / one decision per (attributed correspondence entity, owner) so a re-scan
// is idempotent and a decided row is excluded from re-proposal. Confirm then
// stamps EVERY activity_event sharing that entity_id (the whole thread history).
export function coaSubjectRef(path, domain, corrEntityId, ownerEntityId) {
  return `coa:${path}:${normDomain(domain)}:${corrEntityId}:${ownerEntityId}`;
}

// ---------------------------------------------------------------------------
// Value-gate + ordering (producer/consumer doctrine): a candidate whose owner
// carries portfolio value (rank_value > 0) is proposed in rank order; zero-rank
// candidates only after. Pure sort over already-fetched rows (the SQL fetch is
// ranked too — belt-and-suspenders). Deterministic tiebreak on the subject key.
// ---------------------------------------------------------------------------
export function valueGateCandidates(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const valued = [];
  const zero = [];
  for (const r of list) {
    const v = Number(r && r.rank_value);
    if (Number.isFinite(v) && v > 0) valued.push(r);
    else zero.push(r);
  }
  const key = (r) => String((r && (r.corr_entity_id || r.corrEntityId)) || '') + ':' + String((r && (r.owner_entity_id || r.ownerEntityId)) || '');
  valued.sort((a, b) => (Number(b.rank_value) || 0) - (Number(a.rank_value) || 0) || key(a).localeCompare(key(b)));
  zero.sort((a, b) => key(a).localeCompare(key(b)));
  return valued.concat(zero);
}

// ---------------------------------------------------------------------------
// The false-bridge guard (W9.1 reject-in-lane lesson): NEVER attribute on a
// shared-token name. Returns true when the two names' significant tokens overlap
// in AT MOST ONE token (e.g. a shared surname) — i.e. the only thing tying them
// is a common word, which is NOT evidence of the same party. Used to REJECT a
// Path-B relationship-tier bridge whose correspondent↔owner name overlap is a
// coincidence, and to DOWN-GATE any bridge we cannot corroborate with an email.
// Pure/deterministic. Generic corporate/stopword tokens never count as overlap.
// ---------------------------------------------------------------------------
const STOP_TOKENS = new Set([
  'llc', 'l.l.c', 'lp', 'llp', 'lllp', 'inc', 'incorporated', 'corp', 'corporation',
  'co', 'company', 'ltd', 'limited', 'trust', 'the', 'and', 'of', 'group', 'holdings',
  'holding', 'properties', 'property', 'partners', 'partnership', 'associates', 'realty',
  'real', 'estate', 'investments', 'investment', 'capital', 'management', 'mgmt', 'dst',
  'series', 'a', 'an', 'llc.', 'jr', 'sr', 'ii', 'iii', 'iv',
]);
export function significantTokens(name) {
  const norm = normalizeForMatch(name).replace(/[^a-z0-9 ]+/g, ' ');
  const out = [];
  for (const t of norm.split(/\s+/)) {
    if (!t) continue;
    if (STOP_TOKENS.has(t)) continue;
    if (t.length < 2) continue;
    out.push(t);
  }
  return [...new Set(out)];
}
export function sharedTokenOnly(nameA, nameB) {
  const a = new Set(significantTokens(nameA));
  const b = significantTokens(nameB);
  if (!a.size || !b.length) return true; // no significant content → cannot corroborate
  let overlap = 0;
  for (const t of new Set(b)) if (a.has(t)) overlap += 1;
  return overlap <= 1;
}

// ---------------------------------------------------------------------------
// Verbatim evidence (U3 pattern). Path B carries the correspondent's OWN header
// identity — a `Name <email>` span from the thread — so a human confirms the
// person really is who we bridged. Path A carries the deterministic join text.
// ---------------------------------------------------------------------------
export function commsHeaderEvidence(name, email) {
  const nm = name ? normalizeWhitespace(name) : '';
  const em = email && looksLikeEmail(email) ? normalizeEmail(email) : '';
  if (nm && em) return `${nm} <${em}>`;
  if (em) return em;
  if (nm) return nm;
  return '';
}

export function propertyBridgeEvidence(c) {
  const parts = [];
  if (c.property_label) parts.push(`property: ${normalizeWhitespace(c.property_label)}`);
  if (c.owner_name) parts.push(`owner (true_owner): ${normalizeWhitespace(c.owner_name)}`);
  if (c.corr_entity_name) parts.push(`correspondence entity: ${normalizeWhitespace(c.corr_entity_name)}`);
  parts.push('join: correspondence.entity → owns-edge → owner');
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// Proposal shaping. Turns a Path-A / Path-B candidate row (from the SQL RPC) into
// a comms_owner_attribution_review body. Returns null when a required field is
// missing or the false-bridge guard rejects the candidate (counted, never
// silently dropped by the caller). NEVER fabricates an owner.
// ---------------------------------------------------------------------------
export function buildPathAProposal(c, meta = {}) {
  if (!c || !c.corr_entity_id || !c.owner_entity_id || !c.owner_true_owner_id) return null;
  const domain = normDomain(c.owner_domain);
  if (domain !== 'dia' && domain !== 'gov') return null;
  const subjectRef = coaSubjectRef(PATH_A, domain, c.corr_entity_id, c.owner_entity_id);
  return {
    subject_ref: subjectRef,
    path: PATH_A,
    domain,
    corr_entity_id: String(c.corr_entity_id),
    owner_entity_id: String(c.owner_entity_id),
    target_owner_id: String(c.owner_true_owner_id),
    owner_name: c.owner_name || null,
    corr_entity_name: c.corr_entity_name || null,
    tie_kind: 'owns_edge',
    correspondent_name: null,
    correspondent_email: null,
    thread_count: Number(c.corr_row_count) || null,
    sample_activity_id: c.sample_activity_id || null,
    evidence_quote: propertyBridgeEvidence(c),
    evidence_source: c.sample_activity_id ? ('comms:' + c.sample_activity_id) : 'comms_property_bridge',
    confidence: COA_CONF_PROPERTY_BRIDGE,
    rank_value: Number(c.rank_value) || null,
    reason: `Correspondence attributed to ${c.corr_entity_name || 'an asset/deal'} which the ops graph owns-links to ${c.owner_name || 'this owner'}.`,
    provenance_source: COA_PROVENANCE_SOURCE,
    source_run_id: meta.sourceRunId || 'dry',
    scan_batch_id: meta.scanBatchId || null,
  };
}

export function buildPathBProposal(c, meta = {}) {
  if (!c || !c.corr_entity_id || !c.owner_entity_id || !c.owner_true_owner_id) return null;
  const domain = normDomain(c.owner_domain);
  if (domain !== 'dia' && domain !== 'gov') return null;
  const tieKind = c.tie_kind === 'active_contact' ? 'active_contact' : 'relationship';
  // false-bridge guard: a relationship-tier bridge with NO corroborating email
  // AND only a shared-token name overlap is a coincidence → reject in lane.
  const hasEmail = looksLikeEmail(c.correspondent_email);
  if (tieKind === 'relationship' && !hasEmail && sharedTokenOnly(c.correspondent_name, c.owner_name)) {
    return null;
  }
  const subjectRef = coaSubjectRef(PATH_B, domain, c.corr_entity_id, c.owner_entity_id);
  const evidence = commsHeaderEvidence(c.correspondent_name, c.correspondent_email);
  return {
    subject_ref: subjectRef,
    path: PATH_B,
    domain,
    corr_entity_id: String(c.corr_entity_id),
    owner_entity_id: String(c.owner_entity_id),
    target_owner_id: String(c.owner_true_owner_id),
    owner_name: c.owner_name || null,
    corr_entity_name: c.corr_entity_name || c.correspondent_name || null,
    tie_kind: tieKind,
    correspondent_name: c.correspondent_name || null,
    correspondent_email: hasEmail ? normalizeEmail(c.correspondent_email) : null,
    thread_count: Number(c.corr_row_count) || null,
    sample_activity_id: c.sample_activity_id || null,
    evidence_quote: evidence || null,
    evidence_source: c.sample_activity_id ? ('comms:' + c.sample_activity_id) : 'comms_person_match',
    confidence: tieKind === 'active_contact' ? COA_CONF_PERSON_PIVOT : COA_CONF_PERSON_RELATIONSHIP,
    rank_value: Number(c.rank_value) || null,
    reason: `Correspondent ${c.correspondent_name || 'person'} is ${tieKind === 'active_contact' ? 'the active contact of' : 'tied to'} ${c.owner_name || 'this owner'} — attribute their thread to the owner.`,
    provenance_source: COA_PROVENANCE_SOURCE,
    source_run_id: meta.sourceRunId || 'dry',
    scan_batch_id: meta.scanBatchId || null,
  };
}
