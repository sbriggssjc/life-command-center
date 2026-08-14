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
import { INTERNAL_DOMAINS } from './voice-corpus-clean.js';

export { normDomain, normalizeForMatch, normalizeEmail, looksLikeEmail };

export const PATH_A = 'property_bridge';
export const PATH_B = 'person_match';
export const COA_PATHS = [PATH_A, PATH_B];

// The provenance source the confirm writer stamps on the attribution. Registered
// as a field_source_priority row (target public.activity_events / linked_entity_ids)
// in the W9.6 migration so v_field_provenance_unranked stays 0.
export const COA_PROVENANCE_SOURCE = 'comms_owner_bridge';

// The observed curated field for the attribution edge. The owner id is appended
// to activity_events.metadata.linked_entity_ids; provenance is keyed on that field.
export const COA_PROVENANCE_TARGET_DATABASE = 'lcc_opps';
export const COA_PROVENANCE_TARGET_TABLE = 'public.activity_events';
export const COA_PROVENANCE_FIELD = 'linked_entity_ids';

// Build the rpc/lcc_merge_field argument object for an owner-bridge attribution.
// p_value is the RAW owner-entity id — the RPC param is jsonb and casts it, so it
// must NOT be JSON.stringify'd (that double-encodes into '"\"<id>\""'). This is the
// single builder both the live confirm writer and the regression test consume, so
// the correct p_value shape can't silently drift back to the double-encoded form.
export function buildOwnerBridgeProvenanceArgs({ sampleId, ownerEid, sourceRunId, confidence, workspaceId, recordedBy } = {}) {
  if (!sampleId || !ownerEid) return null;
  return {
    p_workspace_id: workspaceId || null,
    p_target_database: COA_PROVENANCE_TARGET_DATABASE,
    p_target_table: COA_PROVENANCE_TARGET_TABLE,
    p_record_pk: String(sampleId),
    p_field_name: COA_PROVENANCE_FIELD,
    p_value: String(ownerEid),
    p_source: COA_PROVENANCE_SOURCE,
    p_source_run_id: sourceRunId || 'verdict',
    p_confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : null,
    p_recorded_by: recordedBy || null,
  };
}

// Path A is arithmetic (the owns edge is a fact) → confidence 1.0. Path B rests on
// a curated tie (pivot) or an unambiguous relationship edge — high but not 1.0.
export const COA_CONF_PROPERTY_BRIDGE = 1.0;
export const COA_CONF_PERSON_PIVOT = 0.9;
export const COA_CONF_PERSON_RELATIONSHIP = 0.7;

// ---------------------------------------------------------------------------
// W9.6 Path-B PRECISION guards (Prompt 103, deterministic — NO LLM). The live
// dry-run showed Path B carried ~23% noise whose loudest cards were the worst:
//   1. INTERNAL-TEAM correspondents (Scott Briggs 828 rows, Toby Scrivner 128)
//      proposed as an owner-contact of "Stan Johnson Co" — a NorthMarq/SJC deal-
//      team member is NEVER an owner-attribution subject.
//   2. BROKERAGE/advisor entities mis-modeled as `true_owner` upstream (Avison
//      Young, Newmark, Kidder Mathews, Transwestern, Coldwell Banker …) — a
//      broker at that firm gets attributed to it. That is an owner-graph LABELING
//      bug (these should not be `true_owner` at all — flagged for a future ORE
//      cleanup unit; NOT fixed here), but we must not surface it in the lane.
// Both are dropped in the planner with an honest per-reason count. The SQL RPC
// mirrors these predicates so a direct RPC call is clean too (drop_reason column).
// ---------------------------------------------------------------------------

// Reuse the ONE own-firm domain allowlist (voice-corpus-clean.js). A correspondent
// whose email is on a teammate domain is never an owner-attribution subject.
export function isInternalTeamEmail(email) {
  if (!looksLikeEmail(email)) return false;
  const e = normalizeEmail(email);
  return INTERNAL_DOMAINS.some((d) => e.endsWith('@' + d) || e.endsWith('.' + d));
}

// Deterministic brokerage/advisor-name guard. No structured brokerage flag exists
// on ops `entities` (owner LLCs and brokerages are both `organization`), so this is
// a conservative, documented stoplist of the majors + a few brokerage TOKEN tells.
// KNOWN upstream data-modeling issue: these entities carry a `true_owner` identity
// they should not — a future ORE unit should re-classify them. Deliberately does
// NOT stoplist "realty"/"commercial"/"capital"/"partners" alone (real owners use
// them — Kingsbarn Realty, Elliott Bay Healthcare Realty, Cook Commercial Partners,
// Anchor Point Capital, Government Investment Partners all survive).
const BROKERAGE_NAME_TOKENS = [
  'cbre', 'jll', 'cushman', 'wakefield', 'avison young', 'colliers', 'newmark',
  'knight frank', 'nmrk', 'kidder mathews', 'transwestern', 'coldwell banker',
  'stan johnson', 'marcus & millichap', 'marcus and millichap', 'savills',
  'lee & associates', 'lee and associates', 'sperry', 'svn', 'keller williams',
  'real estate investment services', 'realty advisors', 'brokerage',
];
export function isBrokerageOwnerName(name) {
  const n = normalizeWhitespace(String(name || '')).toLowerCase();
  if (!n) return false;
  if (n.includes('®')) return true; // a registered-mark firm name (e.g. "Coldwell Banker Commercial®")
  return BROKERAGE_NAME_TOKENS.some((tok) => n.includes(tok));
}

// Prompt 104 — brokerage/advisor EMAIL-DOMAIN guard (create_contact precision).
// The reachability harvest's create_contact arm must never mint a broker/advisor
// as an owner's OWN contact (the Philip Sharrow <philip.sharrow@scopecre.com>
// class — a CRE advisory corresponding on two unrelated owners' deals). Reuses
// the brokerage NAME stoplist above and adds a documented brokerage/advisory
// DOMAIN stoplist. Grep-first: no existing EXPORTED brokerage-domain constant
// covers scopecre.com (sidebar-pipeline's BROKERAGE_EMAIL_DOMAIN_RE is the
// national majors only and is not exported), so this is the single documented
// list. Kept conservative — only firm domains, never a name-token that real
// owners share (see the note on the name stoplist above).
const BROKERAGE_EMAIL_DOMAINS = [
  'scopecre.com',
  'cbre.com', 'jll.com', 'us.jll.com', 'colliers.com', 'nmrk.com', 'newmark.com',
  'cushwake.com', 'cushmanwakefield.com', 'avisonyoung.com', 'kidder.com',
  'transwestern.com', 'coldwellbanker.com', 'marcusmillichap.com', 'matthews.com',
  'savills.com', 'savills-na.com', 'lee-associates.com', 'svn.com',
  'kellerwilliams.com', 'kw.com',
];
export function isBrokerageEmail(email) {
  if (!looksLikeEmail(email)) return false;
  const e = normalizeEmail(email);
  const domain = e.split('@')[1] || '';
  if (!domain) return false;
  return BROKERAGE_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d));
}

// The create_contact brokerage-contact guard: a candidate whose NAME reads as a
// brokerage OR whose evidence EMAIL is a brokerage/advisory domain is a deal
// party, never the owner's own principal. Used by the reachability harvest mint
// arm (admin.js) to DROP such a create_contact.
export function isBrokerageContact(name, email) {
  return isBrokerageOwnerName(name) || isBrokerageEmail(email);
}

// The single drop-reason resolver (mirrors the SQL RPC's drop_reason). Precedence:
// internal_team → brokerage_target. Returns null when the candidate is clean.
export function pathBDropReason(c) {
  if (!c) return null;
  if (isInternalTeamEmail(c.correspondent_email)) return 'internal_team';
  if (isBrokerageOwnerName(c.owner_name)) return 'brokerage_target';
  return null;
}

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
  // W9.6 precision guards (Prompt 103) — drop internal-team correspondents and
  // brokerage-target owners deterministically (also enforced in the SQL RPC).
  if (isInternalTeamEmail(c.correspondent_email)) return null;
  if (isBrokerageOwnerName(c.owner_name)) return null;
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
