// W9.1 — Contact-acquisition engine, STAGE 1 (Prompt 98).
//
// Pure, dependency-free helpers for Wave 9's contact-acquisition unit — the lever
// on the 68-73% no-contact gap. For the value-ranked pool of true owners with NO
// contact (ops v_owner_contact_worklist), run the sanctioned acquisition chain per
// owner in COST ORDER, STOPPING AT FIRST SUCCESS. Every stage emits a PROPOSAL
// (never a direct write); a human verdict resolves it into the ops entity graph.
//
// STAGES (Stage 1 = internal sources only; the runner takes a PLUGGABLE stage list
// so Stage 2 (SOS-direct) slots in later without rework):
//   * crossref     (1a) — the SAME human/org already carries a contact under a
//                         DIFFERENT owner entity → ATTACH-existing-person. Cheapest.
//   * institution  (1a) — an institution-class owner (REIT/bank/fund) has a registry
//                         contact → ATTACH-existing-person.
//   * deed_signatory (1b) — a signatory/officer name in the owner's own recorded deed
//                         text → MINT a lane-only contact (VERBATIM-quoted).
//   * broker_of_record (1c) — the listing broker on the OM that SOLD the owner their
//                         building → ATTACH/MINT an ASSOCIATED research contact,
//                         ALWAYS typed broker_of_record (never a direct owner contact).
//
// A HUMAN confirm lane (Decision Center contact_acquisition_review) decides; the
// verdict writer attaches/mints in the ops graph. Never fabricates.
//
// The live query + write side lives in api/_handlers/contact-acquisition-engine.js
// (the tick) + api/admin.js (the verdict); this module is the pure brain they call.
// Every function is unit-testable.

export const STAGE_CROSSREF = 'crossref';
export const STAGE_INSTITUTION = 'institution';
export const STAGE_DEED = 'deed_signatory';
export const STAGE_BROKER = 'broker_of_record';
export const STAGE_SOS = 'sos_direct'; // Stage 2 — reserved (not run in Stage 1).

// Cost-ordered Stage-1 stage list. The runner walks this order per owner and STOPS
// at the first stage that yields a proposal. Stage 2 appends STAGE_SOS here later.
export const STAGE_1_ORDER = [STAGE_CROSSREF, STAGE_INSTITUTION, STAGE_DEED, STAGE_BROKER];

export const PROPOSED_KIND_ATTACH = 'attach';
export const PROPOSED_KIND_MINT = 'mint';

// The per-stage proposal shape (attach vs mint) + the contact role it takes on the
// owner. A broker is ALWAYS broker_of_record; a deed signatory is deed_signatory;
// cross-reference/institution people are the owner's own prospecting_contact.
export const STAGE_META = {
  [STAGE_CROSSREF]:   { kind: PROPOSED_KIND_ATTACH, role: 'prospecting_contact' },
  [STAGE_INSTITUTION]:{ kind: PROPOSED_KIND_ATTACH, role: 'prospecting_contact' },
  [STAGE_DEED]:       { kind: PROPOSED_KIND_MINT,   role: 'deed_signatory' },
  [STAGE_BROKER]:     { kind: PROPOSED_KIND_MINT,   role: 'broker_of_record' },
};

export function stageProposedKind(stage) { return (STAGE_META[stage] || {}).kind || null; }
export function stageContactRole(stage) { return (STAGE_META[stage] || {}).role || 'prospecting_contact'; }

export function normDomain(domain) {
  const d = String(domain || '').toLowerCase();
  return d === 'dialysis' ? 'dia' : d === 'government' ? 'gov' : d;
}

// ---------------------------------------------------------------------------
// Whitespace-normalized VERBATIM matching (W7.4/U3 pattern) — the mint precision floor.
// ---------------------------------------------------------------------------
export function normalizeWhitespace(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
export function normalizeForMatch(s) {
  return normalizeWhitespace(s).toLowerCase();
}
export const MIN_QUOTE_CHARS = 8;
export function quoteVerbatimInEvidence(quote, evidenceText) {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  const hay = normalizeForMatch(evidenceText);
  if (!hay) return false;
  return hay.includes(q);
}
// The proposed NAME must appear inside the quoted span (grounding). Names are
// matched loosely on token containment so "John Q. Smith" matches "by John Smith".
export function nameInQuote(name, quote) {
  const n = normalizeForMatch(name);
  const q = normalizeForMatch(quote);
  if (!n || !q) return false;
  if (q.includes(n)) return true;
  // token subset: every significant token of the name appears in the quote.
  const tokens = n.split(' ').filter((t) => t.length >= 2);
  if (tokens.length < 2) return false;
  return tokens.every((t) => q.includes(t));
}

// ---------------------------------------------------------------------------
// Junk / non-person name guard (mirrors entity-link's looksLikePersonName intent,
// pure). Rejects firm suffixes, deal artifacts, federal/agency names, and empty/
// single-token noise so a mint is only ever a plausible HUMAN "First Last".
// ---------------------------------------------------------------------------
const FIRM_SUFFIX_RE = /\b(llc|l\.l\.c|lp|l\.p|inc|incorporated|corp|corporation|co|company|ltd|limited|trust|holdings|partners|partnership|associates|properties|realty|group|capital|management|mgmt|investments|ventures|fund|reit|bank|na|n\.a)\b/i;
const FEDERAL_RE = /\b(gsa|general services|united states|u\.s\.|department|federal|agency|administration|va|dhs|ssa|irs|usda|fbi|state of|county of|city of)\b/i;
const JUNK_TOKENS = /\b(unknown|n\/a|none|tbd|various|see attached|et al|estate of|trustee|redacted)\b/i;

export function looksLikePersonName(name) {
  const s = normalizeWhitespace(name);
  if (!s || s.length < 4 || s.length > 80) return false;
  if (FIRM_SUFFIX_RE.test(s)) return false;
  if (FEDERAL_RE.test(s)) return false;
  if (JUNK_TOKENS.test(s)) return false;
  if (/\d/.test(s)) return false; // a real person name carries no digits
  // Require at least a first + last token, each alphabetic.
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5) return false;
  return tokens.every((t) => /^[A-Za-z][A-Za-z'.\-]*$/.test(t));
}

// ---------------------------------------------------------------------------
// Value-gate + ordering (producer/consumer doctrine). A valued owner (rank_value > 0)
// is processed in rank order; zero-rank owners only after. Pure sort over already-
// fetched rows (belt-and-suspenders — the SQL fetch is ranked too).
// ---------------------------------------------------------------------------
export function valueGateOwners(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const valued = [];
  const zero = [];
  for (const r of list) {
    const v = Number(r && r.rank_value);
    if (Number.isFinite(v) && v > 0) valued.push(r);
    else zero.push(r);
  }
  valued.sort((a, b) => (Number(b.rank_value) || 0) - (Number(a.rank_value) || 0));
  zero.sort((a, b) => String(a.entity_id || '').localeCompare(String(b.entity_id || '')));
  return valued.concat(zero);
}

// ---------------------------------------------------------------------------
// subject_ref: ca:<stage>:<ownerEntityId>:<candidateHash>. One card / one decision
// per (owner, stage, candidate) so a re-scan is idempotent + a decided row excluded.
// The candidate hash keys on the attach person id OR the minted name (stable).
// ---------------------------------------------------------------------------
export function fnv1a(s) {
  const str = String(s == null ? '' : s);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}
export function candidateHash(stage, candidate) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const key = c.candidate_entity_id
    ? 'e:' + String(c.candidate_entity_id)
    : 'n:' + normalizeForMatch(c.candidate_name || '');
  return fnv1a(String(stage) + '|' + key);
}
export function acquisitionSubjectRef(stage, ownerEntityId, candidate) {
  return `ca:${stage}:${ownerEntityId}:${candidateHash(stage, candidate)}`;
}

// ---------------------------------------------------------------------------
// Stage builders — each takes RAW source rows (fetched live by the handler) and the
// owner, returns a normalized candidate proposal object or null (no source → null).
// PURE: no IO. The handler stops at the first non-null.
// ---------------------------------------------------------------------------

// 1a cross-reference: an existing person entity under a different owner. ATTACH.
export function buildCrossrefProposal(owner, resolved) {
  const r = resolved && typeof resolved === 'object' ? resolved : {};
  if (!r.person_entity_id || !r.person_name) return null;
  if (!looksLikePersonName(r.person_name)) return null;
  const conf = r.confidence === 'high' ? 0.9 : r.confidence === 'medium' ? 0.75 : 0.6;
  return {
    stage: STAGE_CROSSREF,
    proposed_kind: PROPOSED_KIND_ATTACH,
    candidate_entity_id: String(r.person_entity_id),
    candidate_name: normalizeWhitespace(r.person_name),
    candidate_role: r.person_role || null,
    candidate_title: r.person_title || null,
    proposed_contact_role: 'prospecting_contact',
    evidence_quote: null,
    evidence_source: r.source_entity_id ? ('entity:' + r.source_entity_id) : null,
    source_pointer: { strategy: r.strategy || null, source_owner_id: r.source_entity_id || null, source_owner_name: r.source_owner_name || null },
    confidence: conf,
    reason: 'Same person is already a contact under ' + (r.source_owner_name || 'a related owner') + ' (' + (r.strategy || 'cross-reference') + ').',
  };
}

// 1a institution: a registry contact for an institution-class owner. ATTACH (if the
// registry carries an entity id) else MINT-from-registry (still typed prospecting).
export function buildInstitutionProposal(owner, resolved) {
  const r = resolved && typeof resolved === 'object' ? resolved : {};
  if (!r.contact_name) return null;
  if (!looksLikePersonName(r.contact_name)) return null;
  const conf = r.confidence === 'high' ? 0.85 : r.confidence === 'medium' ? 0.7 : 0.6;
  const hasEntity = !!r.contact_entity_id;
  return {
    stage: STAGE_INSTITUTION,
    proposed_kind: hasEntity ? PROPOSED_KIND_ATTACH : PROPOSED_KIND_MINT,
    candidate_entity_id: hasEntity ? String(r.contact_entity_id) : null,
    candidate_name: normalizeWhitespace(r.contact_name),
    candidate_role: r.contact_title || null,
    candidate_title: r.contact_title || null,
    proposed_contact_role: 'prospecting_contact',
    evidence_quote: null,
    evidence_source: r.source_url || (r.source ? ('registry:' + r.source) : 'institution_registry'),
    source_pointer: { via: 'institution_registry', source: r.source || null, source_url: r.source_url || null, institution_name: r.institution_name || null },
    confidence: conf,
    reason: 'Institution registry lists this contact for ' + (r.institution_name || 'this sponsor') + '.',
  };
}

// 1b deed signatory: a person name parsed from the owner's own deed TEXT. MINT, but
// ONLY when the name is a plausible person AND appears VERBATIM in the deed quote.
// Returns { proposal }|{ drop:{reason} } so the handler can log the precision floor.
export function buildDeedSignatoryProposal(owner, sig) {
  const s = sig && typeof sig === 'object' ? sig : {};
  const name = normalizeWhitespace(s.name);
  const quote = s.quote != null ? String(s.quote) : '';
  if (!name) return { drop: { reason: 'no_quote', name: null, quote: null } };
  if (!looksLikePersonName(name)) return { drop: { reason: 'junk_name', name, quote } };
  if (!quote) return { drop: { reason: 'no_quote', name, quote: null } };
  if (!quoteVerbatimInEvidence(quote, s.evidence_text)) {
    return { drop: { reason: 'quote_not_verbatim', name, quote: String(quote).slice(0, 200) } };
  }
  if (!nameInQuote(name, quote)) {
    return { drop: { reason: 'name_not_in_quote', name, quote: String(quote).slice(0, 200) } };
  }
  return {
    proposal: {
      stage: STAGE_DEED,
      proposed_kind: PROPOSED_KIND_MINT,
      candidate_entity_id: null,
      candidate_name: name,
      candidate_role: s.title || 'signatory',
      candidate_title: s.title || null,
      proposed_contact_role: 'deed_signatory',
      evidence_quote: normalizeWhitespace(quote).slice(0, 400),
      evidence_source: s.document_id ? ('deed:' + s.document_id) : 'deed_record',
      source_pointer: { via: 'deed_signatory', document_id: s.document_id || null, deed_id: s.deed_id || null, property_id: s.property_id || null, domain: s.domain ? normDomain(s.domain) : null },
      confidence: 0.7,
      reason: 'Deed signatory named in the owner\'s own recorded instrument.',
    },
  };
}

// 1c broker-of-record: the listing broker on the sale that conveyed the building to
// this owner. ATTACH an existing broker entity if we have one, else MINT — ALWAYS
// typed broker_of_record. A broker is NEVER a direct owner contact.
export function buildBrokerProposal(owner, broker) {
  const b = broker && typeof broker === 'object' ? broker : {};
  const name = normalizeWhitespace(b.broker_name);
  if (!name) return null;
  if (!looksLikePersonName(name)) return null; // a firm-only "broker" is not a person contact
  const hasEntity = !!b.broker_entity_id;
  return {
    stage: STAGE_BROKER,
    proposed_kind: hasEntity ? PROPOSED_KIND_ATTACH : PROPOSED_KIND_MINT,
    candidate_entity_id: hasEntity ? String(b.broker_entity_id) : null,
    candidate_name: name,
    candidate_role: 'broker_of_record',
    candidate_title: b.broker_firm || null,
    proposed_contact_role: 'broker_of_record',
    evidence_quote: null,
    evidence_source: b.sale_id ? ('sale:' + b.sale_id) : (b.listing_id ? ('listing:' + b.listing_id) : 'sales_transaction'),
    source_pointer: { via: 'broker_of_record', sale_id: b.sale_id || null, listing_id: b.listing_id || null, property_id: b.property_id || null, domain: b.domain ? normDomain(b.domain) : null, broker_firm: b.broker_firm || null },
    confidence: 0.65,
    reason: 'Listing broker of record on the sale that conveyed this asset to the owner.',
  };
}

// The typing guard the tests pin: a broker_of_record proposal MUST carry role
// broker_of_record and MUST NOT be presented as the owner's own prospecting contact.
export function isBrokerTypingValid(proposal) {
  const p = proposal && typeof proposal === 'object' ? proposal : {};
  if (p.stage !== STAGE_BROKER) return true;
  return p.proposed_contact_role === 'broker_of_record' && p.candidate_role === 'broker_of_record';
}

// ---------------------------------------------------------------------------
// The stage runner (PURE) — walks a PLUGGABLE stage list for one owner, calling the
// injected async stage fn, STOPPING at the first stage that returns a proposal.
// stageFns is a map stage -> async (owner) => proposal|null. Returns
// { proposal|null, stage|null, attempted:[...], stopped_at_success:bool }.
// This is the Stage-2 seam: append STAGE_SOS to `order` + provide its stageFn.
// ---------------------------------------------------------------------------
export async function runStagesForOwner(owner, stageFns, order = STAGE_1_ORDER) {
  const attempted = [];
  for (const stage of order) {
    const fn = stageFns && stageFns[stage];
    if (typeof fn !== 'function') continue;
    attempted.push(stage);
    // eslint-disable-next-line no-await-in-loop
    const proposal = await fn(owner);
    if (proposal && typeof proposal === 'object') {
      return { proposal, stage, attempted, stopped_at_success: true };
    }
  }
  return { proposal: null, stage: null, attempted, stopped_at_success: false };
}

// Finalize a raw stage proposal into a review row (adds owner facts + subject_ref +
// stamps the stage-canonical kind/role so a builder can't emit an off-type row).
export function finalizeProposal(owner, proposal, extra = {}) {
  const o = owner && typeof owner === 'object' ? owner : {};
  const p = proposal && typeof proposal === 'object' ? proposal : {};
  const stage = p.stage;
  const meta = STAGE_META[stage] || {};
  const kind = meta.kind || p.proposed_kind;
  return {
    subject_ref: acquisitionSubjectRef(stage, o.entity_id, p),
    stage,
    proposed_kind: kind,
    domain: normDomain(o.primary_domain || p.source_pointer?.domain || ''),
    owner_entity_id: o.entity_id,
    owner_name: o.owner_name || null,
    rank_value: Number.isFinite(Number(o.rank_value)) ? Number(o.rank_value) : null,
    candidate_entity_id: p.candidate_entity_id || null,
    candidate_name: p.candidate_name,
    candidate_role: p.candidate_role || null,
    candidate_title: p.candidate_title || null,
    // stage canonically owns the contact role (broker_of_record can't be overridden).
    proposed_contact_role: meta.role || p.proposed_contact_role || 'prospecting_contact',
    evidence_quote: p.evidence_quote || null,
    evidence_source: p.evidence_source || null,
    source_pointer: p.source_pointer || {},
    confidence: Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : 0,
    reason: p.reason || null,
    seeder: 'w9_1_contact_acquisition',
    model_provider: extra.model_provider || null,
    model_name: extra.model_name || null,
  };
}
