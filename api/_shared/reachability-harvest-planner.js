// W9.2 — Contact-reachability INTERNAL harvest (Prompt 88).
//
// Pure, dependency-free helpers for Wave 9's FIRST unit. Doctrine (playbook + the
// W9.2 prompt + the W7.4/U3 verbatim-evidence pattern): fill a domain contact's
// MISSING email/phone from sources LCC ALREADY HOLDS — deterministic-first.
//
// TWO ARMS (deterministic-first — the U5/85 lesson):
//   * deterministic — an exact-identity donor (the SAME person's synced record,
//     matched via sf_contact_id / salesforce_id / a cross-domain link, NOT
//     name-fuzz) carries an email/phone the target contact lacks. Arithmetic, not
//     judgment: provider 'none', confidence 1.0, a source pointer to the donor.
//     Bulk-confirmable; excluded from any distribution guard.
//   * llm — fuzzy attribution: an email/phone observed in an intake extraction
//     snapshot (or an attributed thread) that LIKELY belongs to this contact (the
//     contact's NAME appears in the same evidence). Ollama PROPOSES with a VERBATIM
//     quote; the validator DROPS a proposal whose value/quote is not a verbatim
//     span of the supplied evidence (dropped log = the precision floor). No evidence
//     ⇒ no LLM call (counted no_evidence). No web search (paused).
//
// A HUMAN confirm lane decides; a deterministic fill-blanks writer applies with
// provenance. Never fabricates: the model returns null when a field is absent.
//
// The live query + write side lives in api/admin.js (handleReachabilityHarvestTick
// + the reachability_harvest_review Decision Center lane + the fill-blanks writer);
// this module is the pure brain it calls. Every function is unit-testable.

export const HARVEST_ARM_DETERMINISTIC = 'deterministic';
export const HARVEST_ARM_LLM = 'llm';

// The provenance source each arm stamps (registered in field_source_priority).
export const HARVEST_SOURCE_DETERMINISTIC = 'w9_2_internal_harvest';
export const HARVEST_SOURCE_LLM = 'comms_observed';
// W9.4: a comms header/signature/create-contact fill is OBSERVED in real mail — it
// stamps comms_observed (same trust band as the LLM arm), even when arithmetic.
export const HARVEST_SOURCE_COMMS = 'comms_observed';

export function normDomain(domain) {
  const d = String(domain || '').toLowerCase();
  return d === 'dialysis' ? 'dia' : d === 'government' ? 'gov' : d;
}

// The reachability fields we harvest, and their per-domain column names (dia uses
// contact_email/contact_phone; gov uses email/phone). Single source of truth.
export const HARVEST_FIELDS = ['email', 'phone'];
export function domainContactColumn(domain, field) {
  const d = normDomain(domain);
  if (field === 'email') return d === 'dia' ? 'contact_email' : 'email';
  if (field === 'phone') return d === 'dia' ? 'contact_phone' : 'phone';
  return null;
}
// The domain contact PK column + the display-name column differ by domain too.
export function domainContactPk(_domain) { return 'contact_id'; }
export function domainContactNameColumn(domain) {
  return normDomain(domain) === 'dia' ? 'contact_name' : 'name';
}

// A stable subject_ref: rh:<arm>:<domain>:<contactId>:<field>. One card / one
// decision per (contact, field) so a re-scan is idempotent + a decided row excluded.
export function contactSubjectRef(arm, domain, contactId, field) {
  return `rh:${arm}:${normDomain(domain)}:${contactId}:${field}`;
}

// ---------------------------------------------------------------------------
// Value-gate + ordering (producer/consumer doctrine). A target with a valued owner
// (rank_value > 0) is processed in rank order; zero-rank targets only after. Pure
// sort over already-fetched rows (belt-and-suspenders — the SQL fetch is ranked too).
// ---------------------------------------------------------------------------
export function valueGateTargets(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const valued = [];
  const zero = [];
  for (const r of list) {
    const v = Number(r && r.rank_value);
    if (Number.isFinite(v) && v > 0) valued.push(r);
    else zero.push(r);
  }
  valued.sort((a, b) => (Number(b.rank_value) || 0) - (Number(a.rank_value) || 0));
  zero.sort((a, b) => String(a.target_contact_id || '').localeCompare(String(b.target_contact_id || '')));
  return valued.concat(zero);
}

// ---------------------------------------------------------------------------
// Whitespace-normalized VERBATIM matching (W7.4/U3 pattern). The validator's floor.
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

// ---------------------------------------------------------------------------
// Reachability value normalization + validity. A harvested value must be a real,
// usable email/phone — never fabricated, never a garbage fragment.
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function normalizeEmail(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}
export function looksLikeEmail(s) {
  const e = normalizeEmail(s);
  return e.length >= 6 && e.length <= 254 && EMAIL_RE.test(e);
}
export function phoneDigits(s) {
  return String(s == null ? '' : s).replace(/[^0-9]/g, '');
}
export function normalizePhone(s) {
  // Keep the human-formatted value but trimmed; the digit count gates validity.
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
export function looksLikePhone(s) {
  const d = phoneDigits(s);
  // US-style: 10 digits, or 11 with a leading 1. Reject obvious non-phones.
  return d.length === 10 || (d.length === 11 && d.startsWith('1'));
}
export function harvestValueValid(field, value) {
  if (field === 'email') return looksLikeEmail(value);
  if (field === 'phone') return looksLikePhone(value);
  return false;
}
export function harvestValueNormalized(field, value) {
  if (field === 'email') return normalizeEmail(value);
  if (field === 'phone') return normalizePhone(value);
  return String(value == null ? '' : value).trim();
}
// Does the harvested VALUE actually appear (verbatim, normalized) inside the quote?
// For a phone we match on the digit-run so "(918) 555-1212" matches "9185551212".
export function valueInQuote(field, value, quote) {
  const q = normalizeForMatch(quote);
  if (!q) return false;
  if (field === 'phone') {
    const qd = phoneDigits(quote);
    const vd = phoneDigits(value);
    return vd.length >= 10 && qd.includes(vd);
  }
  return q.includes(normalizeForMatch(value));
}

// ---------------------------------------------------------------------------
// Evidence assembly bounds (deterministic). Caps raw blocks { source, ref, text }
// to a bounded context (top-K, char-capped). Empty blocks dropped. (Mirrors U3.)
// ---------------------------------------------------------------------------
export const EVIDENCE_TOP_K = 8;
export const EVIDENCE_BLOCK_CHARS = 900;
export const EVIDENCE_TOTAL_CHARS = 5000;

export function assembleEvidence(blocks, opts = {}) {
  const topK = Number.isFinite(opts.topK) ? Math.max(1, opts.topK) : EVIDENCE_TOP_K;
  const blockCap = Number.isFinite(opts.blockChars) ? Math.max(40, opts.blockChars) : EVIDENCE_BLOCK_CHARS;
  const totalCap = Number.isFinite(opts.totalChars) ? Math.max(80, opts.totalChars) : EVIDENCE_TOTAL_CHARS;
  const list = Array.isArray(blocks) ? blocks : [];
  const out = [];
  let droppedEmpty = 0;
  let total = 0;
  for (const b of list) {
    if (out.length >= topK) break;
    const text = normalizeWhitespace(b && b.text != null ? String(b.text) : '');
    if (!text) { droppedEmpty += 1; continue; }
    const clipped = text.slice(0, blockCap);
    if (total + clipped.length > totalCap) {
      const room = totalCap - total;
      if (room < 40) break;
      out.push({ source: String(b.source || 'evidence'), ref: b.ref != null ? String(b.ref) : null, text: clipped.slice(0, room) });
      total += Math.min(room, clipped.length);
      break;
    }
    out.push({ source: String(b.source || 'evidence'), ref: b.ref != null ? String(b.ref) : null, text: clipped });
    total += clipped.length;
  }
  const combined = out.map((b) => b.text).join('\n');
  return { blocks: out, combined, chars: total, dropped_empty: droppedEmpty };
}

export function evidenceIsEmpty(assembled) {
  return !assembled || !Array.isArray(assembled.blocks) || assembled.blocks.length === 0
    || !String(assembled.combined || '').trim();
}

// FNV-1a over the normalized combined evidence + a salt (the target's current
// blank-field set), so a target re-scores ONLY when its evidence changes.
export function evidenceHash(assembled, extra) {
  const combined = assembled && assembled.combined != null ? String(assembled.combined) : '';
  const salt = extra != null ? String(extra) : '';
  const s = normalizeWhitespace(combined) + '' + normalizeWhitespace(salt);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

export function harvestScoredKeyFor(arm, domain, contactId, field, evHash) {
  return `${arm}:${normDomain(domain)}:${contactId}:${field}:${evHash}`;
}

// ---------------------------------------------------------------------------
// The LLM prompt (surface clean_assist). Attribution-only: the model proposes the
// missing email/phone ONLY IF the evidence names THIS contact AND contains the
// value, quoted VERBATIM. It never invents a value.
// ---------------------------------------------------------------------------
export function buildReachabilityPrompt(target, assembled) {
  const t = target && typeof target === 'object' ? target : {};
  const missing = Array.isArray(t.missing_fields) && t.missing_fields.length
    ? t.missing_fields.join(' and ') : 'email and phone';
  const blocks = (assembled && Array.isArray(assembled.blocks) ? assembled.blocks : [])
    .map((b, i) => `[E${i + 1}] (${b.source}${b.ref ? ' #' + b.ref : ''}) ${b.text}`).join('\n');
  return [
    'You are the LCC contact-reachability harvest agent.',
    'You ONLY propose. You never invent a contact detail, never guess, and never write data.',
    `A CONTACT in our records is MISSING ${missing}. Below is evidence LCC already holds. Propose the missing ${missing} ONLY IF the evidence CLEARLY belongs to THIS SAME person (the person's name appears in the same evidence) AND states the value.`,
    '',
    'Contact: ' + (t.contact_name || '(unknown name)') + (t.owner_name ? ' | owner org: ' + t.owner_name : ''),
    '',
    'EVIDENCE (the ONLY text you may quote — quote EXACTLY, never paraphrase):',
    blocks || '(no evidence)',
    '',
    'Return ONLY strict JSON with keys: verdict, field, value, evidence_quote, evidence_source, confidence, reason.',
    '- verdict: "fill_proposal" (the evidence names THIS person and states the value) OR "no_evidence_found".',
    '- field: "email" or "phone" (the field you are filling). null if no_evidence_found.',
    '- value: the email or phone, copied EXACTLY from the evidence. null if no_evidence_found.',
    '- evidence_quote: the VERBATIM substring from the EVIDENCE that shows BOTH the person\'s name AND the value (copy exactly; must be a real span of the evidence above). null if no_evidence_found.',
    '- evidence_source: the [E#] tag of the block you quoted (e.g. "E1").',
    '- confidence: 0.0 to 1.0.',
    '- reason: one short sentence.',
    '- If the evidence does NOT clearly tie the value to THIS person, return "no_evidence_found" — do NOT guess, infer, or use outside knowledge.',
    '- Never propose a value that is not written verbatim in the evidence. Never propose a generic/company inbox as a person\'s email.',
  ].join('\n');
}

// Tolerant JSON extraction (fenced ```json, then first/last-brace).
export function parseHarvestJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try { return JSON.parse(candidate); } catch (_e) { /* fall through */ }
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(candidate.slice(first, last + 1)); } catch (_e) { /* fall through */ }
  }
  return null;
}

const HARVEST_VERDICTS = new Set(['fill_proposal', 'no_evidence_found']);

// Normalize a raw model object into a harvest proposal. Verdict defaults to
// no_evidence_found on anything unrecognized (never a silent fill). A
// no_evidence_found verdict is stripped of any stray value/quote the model echoed.
export function normalizeHarvestProposal(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  let verdict = String(obj.verdict || '').toLowerCase().trim().replace(/\s+/g, '_');
  if (verdict === 'fill' || verdict === 'proposal' || verdict === 'found' || verdict === 'yes') verdict = 'fill_proposal';
  if (verdict === 'no_evidence' || verdict === 'none' || verdict === 'no' || verdict === 'not_found') verdict = 'no_evidence_found';
  if (!HARVEST_VERDICTS.has(verdict)) verdict = 'no_evidence_found';
  let field = String(obj.field || '').toLowerCase().trim();
  if (field !== 'email' && field !== 'phone') field = '';
  const n = Number(obj.confidence);
  const confidence = Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  let value = obj.value != null ? String(obj.value).replace(/\s+/g, ' ').trim().slice(0, 320) : '';
  let quote = obj.evidence_quote != null ? String(obj.evidence_quote).slice(0, 400) : '';
  let source = obj.evidence_source != null ? String(obj.evidence_source).replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const reason = obj.reason != null ? String(obj.reason).replace(/\s+/g, ' ').trim().slice(0, 400) : '';
  if (verdict === 'no_evidence_found') { value = ''; quote = ''; source = ''; field = ''; }
  return { verdict, field, value, confidence, evidence_quote: quote, evidence_source: source, reason };
}

// ---------------------------------------------------------------------------
// The validator (the free precision floor). An LLM proposal is KEPT only when:
//   * verdict === 'fill_proposal', a valid field, a VALID value (real email/phone),
//     a VERBATIM quote, AND the value appears inside that quote.
// Anything else is dropped with a reason (→ reachability_harvest_dropped_log). A
// no_evidence_found is NOT a drop — it is an honest, counted non-proposal.
// Returns { proposal|null, verdict, drop: { reason, quote }|null }.
// ---------------------------------------------------------------------------
export function validateHarvestProposal(proposal, evidenceText) {
  const p = proposal && typeof proposal === 'object' ? proposal : {};
  const verdict = String(p.verdict || 'no_evidence_found');
  if (verdict === 'no_evidence_found') return { proposal: null, verdict, drop: null };
  if (p.field !== 'email' && p.field !== 'phone') {
    return { proposal: null, verdict, drop: { reason: 'invalid_value', quote: p.evidence_quote || null } };
  }
  if (!p.value || !harvestValueValid(p.field, p.value)) {
    return { proposal: null, verdict, drop: { reason: 'invalid_value', quote: p.evidence_quote || null } };
  }
  if (!p.evidence_quote) {
    return { proposal: null, verdict, drop: { reason: 'no_quote', quote: null } };
  }
  if (!quoteVerbatimInEvidence(p.evidence_quote, evidenceText)) {
    return { proposal: null, verdict, drop: { reason: 'quote_not_verbatim', quote: String(p.evidence_quote).slice(0, 200) } };
  }
  if (!valueInQuote(p.field, p.value, p.evidence_quote)) {
    // The value must be inside the quoted span — otherwise it isn't grounded.
    return { proposal: null, verdict, drop: { reason: 'value_not_in_quote', quote: String(p.evidence_quote).slice(0, 200) } };
  }
  return { proposal: { ...p, value: harvestValueNormalized(p.field, p.value) }, verdict, drop: null };
}

export const HARVEST_MIN_CONFIDENCE = 0.6;
export function isProposableHarvest(validated, minConfidence = HARVEST_MIN_CONFIDENCE) {
  if (!validated || !validated.proposal) return false;
  const c = Number(validated.proposal.confidence);
  return Number.isFinite(c) && c >= minConfidence;
}

// ---------------------------------------------------------------------------
// The deterministic arm (ARM 1) — arithmetic, NO LLM. Given a target contact
// (missing a field) and a DONOR record matched by an EXACT identity key, produce a
// fill proposal iff the donor carries a VALID value for that field. confidence 1.0,
// provider 'none'. The source pointer records the exact donor + key. Returns
// { proposal }|null. `donor.match_key` is the identity column that matched
// (sf_contact_id | salesforce_id | cross_domain), `donor.value` the donor's value.
// ---------------------------------------------------------------------------
export function buildDeterministicProposal(field, donor) {
  const d = donor && typeof donor === 'object' ? donor : {};
  const value = d.value;
  if (!field || (field !== 'email' && field !== 'phone')) return null;
  if (!value || !harvestValueValid(field, value)) return null;
  const key = d.match_key ? String(d.match_key) : 'identity';
  const donorId = d.donor_contact_id != null ? String(d.donor_contact_id) : null;
  const donorDomain = d.donor_domain ? normDomain(d.donor_domain) : null;
  return {
    verdict: 'fill_proposal',
    field,
    value: harvestValueNormalized(field, value),
    confidence: 1.0,
    evidence_quote: null, // deterministic — the source pointer IS the evidence
    evidence_source: donorId ? (key + ':' + donorId) : key,
    reason: 'Exact-identity donor (' + key + (donorDomain ? '/' + donorDomain : '') + ') carries this ' + field + '.',
    source_pointer: { match_key: key, donor_contact_id: donorId, donor_domain: donorDomain },
  };
}

// ---------------------------------------------------------------------------
// Bounded scorer (pure, injectable clock) — mirrors U3's scoreLinksWithBudget so a
// single HTTP invocation never outruns the Railway proxy on ollama latency.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// W9.4 (Prompt 94) — Comms-harvest arm. A THIRD input source for the SAME two-arm
// split: correspondence LCC already ingests (activity_events). It yields (a) header
// name+email pairs (deterministic class — routed through the deterministic arm,
// provenance comms_observed since it is OBSERVED in real mail), (b) signature-block
// phones (LLM class — the verbatim-quote validator gates them), and (c) thread
// participants attributable to an owner who has NO contact row yet (create-contact
// shape — target_kind 'owner', minted ONLY via a human verdict, never auto).
//
// Doctrine: harvest ONLY from business-attributed, non-private threads
// (correspondence-privacy scoping); never fabricate; every fill/create is a
// PROPOSAL a human confirms. These helpers are pure (the live scan lives in admin.js).
// ---------------------------------------------------------------------------

// The internal / self domain — mail from these senders is not a BD counterparty
// and never seeds a contact fill or a new contact.
export function isInternalEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return false;
  return /@(?:[^@]*\.)?northmarq\.com$/.test(e) || /@(?:[^@]*\.)?stanjohnsonco\.com$/.test(e);
}

// A role/functional inbox is never a person's reachable contact detail.
const GENERIC_LOCALPARTS = new Set([
  'no-reply', 'noreply', 'no_reply', 'donotreply', 'do-not-reply', 'info', 'sales',
  'support', 'admin', 'hello', 'contact', 'notifications', 'notification', 'alerts',
  'alert', 'help', 'team', 'office', 'mail', 'marketing', 'newsletter', 'news',
  'updates', 'billing', 'accounts', 'accounting', 'careers', 'jobs', 'webmaster',
  'postmaster', 'service', 'services', 'inquiries', 'enquiries', 'privacy', 'legal',
]);
export function isGenericInbox(email) {
  const e = normalizeEmail(email);
  if (!e) return true;
  const local = e.split('@')[0].replace(/\+.*$/, '');
  if (GENERIC_LOCALPARTS.has(local)) return true;
  // bare functional prefixes like "info-passovgroup" / "no-reply.foo"
  const head = local.split(/[.\-_]/)[0];
  return GENERIC_LOCALPARTS.has(head);
}

// Parse ONE address token into { name, email }. Handles Graph/RFC forms:
//   'John Doe <j@x.com>'  → { name:'John Doe', email:'j@x.com' }
//   '"Doe, John" <j@x.com>'→ { name:'Doe, John', email:'j@x.com' }
//   'j@x.com'             → { name:null, email:'j@x.com' }
// A token that carries no valid email yields { name, email:null }. Never throws.
export function parseHeaderAddress(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { name: null, email: null };
  const m = s.match(/^(.*?)<\s*([^<>]+?)\s*>\s*$/);
  if (m) {
    let name = m[1].trim().replace(/^["']|["']$/g, '').trim();
    const email = looksLikeEmail(m[2]) ? normalizeEmail(m[2]) : null;
    // A "name" that is itself the email (no real display name) is not a name.
    if (name && looksLikeEmail(name)) name = '';
    return { name: name || null, email };
  }
  if (looksLikeEmail(s)) return { name: null, email: normalizeEmail(s) };
  return { name: s.replace(/^["']|["']$/g, '').trim() || null, email: null };
}

// A correspondence row is HARVESTABLE only when it is BUSINESS-ATTRIBUTED and NOT
// private-scoped (correspondence-privacy doctrine). Attribution = a deal/party/entity
// anchor exists (entity_id, metadata.party_entity_id/deal_entity_id, or linked
// entity ids). visibility='private' is ALWAYS excluded regardless of attribution.
export function commsRowHarvestable(row) {
  const r = row && typeof row === 'object' ? row : {};
  if (String(r.visibility || '').toLowerCase() === 'private') return false;
  const md = r.metadata && typeof r.metadata === 'object' ? r.metadata : {};
  const linked = Array.isArray(md.linked_entity_ids) ? md.linked_entity_ids : [];
  return !!(r.entity_id || md.party_entity_id || md.deal_entity_id || linked.length > 0);
}

// The owner/entity anchors a harvestable row attributes to (ops entity ids). Used
// both to gate the fill arms and to seed create-contact candidates. Deduped.
export function commsRowEntityAnchors(row) {
  const r = row && typeof row === 'object' ? row : {};
  const md = r.metadata && typeof r.metadata === 'object' ? r.metadata : {};
  const out = new Set();
  if (r.entity_id) out.add(String(r.entity_id));
  if (md.party_entity_id) out.add(String(md.party_entity_id));
  if (md.deal_entity_id) out.add(String(md.deal_entity_id));
  for (const e of (Array.isArray(md.linked_entity_ids) ? md.linked_entity_ids : [])) if (e) out.add(String(e));
  return [...out];
}

// US-style phone extractor over a text span (the signature region). Returns unique
// candidates as { phone (verbatim as written), digits, span (a ±window quote that
// contains the phone, for the verbatim validator) }. Rejects year-like / non-phone
// digit runs via looksLikePhone.
const PHONE_TOKEN_RE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;
export const SIGNATURE_TAIL_CHARS = 900;
export function signatureRegion(body, tail = SIGNATURE_TAIL_CHARS) {
  const s = String(body == null ? '' : body);
  const n = Number.isFinite(tail) ? Math.max(80, tail) : SIGNATURE_TAIL_CHARS;
  return s.length <= n ? s : s.slice(s.length - n);
}
export function extractSignaturePhones(text, spanChars = 80) {
  const s = String(text == null ? '' : text);
  if (!s) return [];
  const out = [];
  const seen = new Set();
  let m;
  PHONE_TOKEN_RE.lastIndex = 0;
  while ((m = PHONE_TOKEN_RE.exec(s)) !== null) {
    const tok = m[0];
    if (!looksLikePhone(tok)) continue;
    const digits = phoneDigits(tok).slice(-10);
    if (seen.has(digits)) continue;
    seen.add(digits);
    const start = Math.max(0, m.index - spanChars);
    const end = Math.min(s.length, m.index + tok.length + spanChars);
    out.push({ phone: normalizePhone(tok), digits, span: normalizeWhitespace(s.slice(start, end)) });
  }
  return out;
}

// A stable subject_ref for a create-contact proposal (target_kind='owner'): one
// card per (domain, owner, proposed email) so a re-scan is idempotent.
export function commsNewContactSubjectRef(domain, ownerId, email) {
  const key = normalizeEmail(email) || 'noemail';
  return `rhc:${normDomain(domain)}:${ownerId}:${key}`;
}

// The deterministic COMMS header proposal — arithmetic, NO LLM. A header carried a
// display NAME bound to a VALID, non-internal, non-generic EMAIL that matches a
// blank contact's normalized name. confidence 1.0, provider 'none', provenance
// comms_observed (observed in real mail), source pointer = the message id.
export function buildCommsHeaderProposal(field, donor) {
  const d = donor && typeof donor === 'object' ? donor : {};
  if (field !== 'email' && field !== 'phone') return null;
  const value = d.value;
  if (!value || !harvestValueValid(field, value)) return null;
  if (field === 'email' && (isInternalEmail(value) || isGenericInbox(value))) return null;
  const mid = d.message_id != null ? String(d.message_id) : null;
  return {
    verdict: 'fill_proposal',
    field,
    value: harvestValueNormalized(field, value),
    confidence: 1.0,
    evidence_quote: d.quote != null ? String(d.quote).slice(0, 400) : null,
    evidence_source: mid ? ('comms:' + mid) : 'comms_header',
    reason: 'Correspondence header binds this ' + field + ' to this contact by name.',
    source_pointer: { via: 'comms_header', message_id: mid, source_type: d.source_type || null },
  };
}

// ---------------------------------------------------------------------------
// W9.2/W9.4 create_contact PRECISION (Prompt 104) — fan-out cap (deterministic,
// NO LLM). A candidate contact — keyed by its normalized EMAIL (a person's own
// address is the strongest identity), falling back to normalized NAME when no
// email — that would be create_contact'd for >= HARVEST_MINT_FANOUT_MAX DISTINCT
// owners is almost never a genuine owner principal: it is a broker/advisor/shared
// mailbox spreading across unrelated deals (the Philip Sharrow class — one email
// bound to two unrelated owners by the header-pair harvest). Mirrors the
// planContactMinting fan-out cap (tm-misparse.js) + the TrafficMetrix
// one-email-across-many-subjects lesson. Pure counting over the candidate set.
// ---------------------------------------------------------------------------
export const HARVEST_MINT_FANOUT_MAX = 2;

// Stable contact identity key. Email wins (normalized); else the normalized name.
export function createContactKey(name, email) {
  const e = normalizeEmail(email);
  if (e && looksLikeEmail(e)) return 'e:' + e;
  const n = normalizeForMatch(name || '');
  return n ? 'n:' + n : '';
}

// The distinct-owner key a create-contact candidate attributes to (domain-scoped).
export function createContactOwnerKey(cand) {
  const c = cand && typeof cand === 'object' ? cand : {};
  const id = c.target_owner_id != null ? String(c.target_owner_id) : '';
  if (!id) return '';
  return normDomain(c.domain) + ':' + id;
}

// Map each contact-key → the Set of distinct owners it would be minted for.
export function createContactFanoutMap(candidates) {
  const map = new Map();
  for (const c of (Array.isArray(candidates) ? candidates : [])) {
    const key = createContactKey(c && c.contact_name, c && c.value);
    if (!key) continue;
    const owner = createContactOwnerKey(c);
    if (!owner) continue;
    let set = map.get(key);
    if (!set) { set = new Set(); map.set(key, set); }
    set.add(owner);
  }
  return map;
}

// The set of contact-keys whose distinct-owner count >= max (→ suppress as
// fan-out). max defaults to HARVEST_MINT_FANOUT_MAX (>= 2 distinct owners).
export function createContactFanoutSuppressed(candidates, max = HARVEST_MINT_FANOUT_MAX) {
  const cap = Number.isFinite(max) ? Math.max(2, max) : HARVEST_MINT_FANOUT_MAX;
  const map = createContactFanoutMap(candidates);
  const out = new Set();
  for (const [key, owners] of map.entries()) if (owners.size >= cap) out.add(key);
  return out;
}

export async function scoreHarvestWithBudget(items, scoreOne, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : Infinity;
  const maxN = Number.isFinite(opts.maxN) ? Math.max(0, opts.maxN) : list.length;
  const cap = Math.min(maxN, list.length);
  const start = now();
  const results = [];
  let budgetExhausted = false;
  for (let i = 0; i < cap; i++) {
    if (now() - start >= budgetMs) { budgetExhausted = true; break; }
    // eslint-disable-next-line no-await-in-loop
    results.push(await scoreOne(list[i], i));
  }
  return {
    results, scored: results.length, budget_exhausted: budgetExhausted,
    remaining_unscored: Math.max(0, list.length - results.length),
    capped: Math.max(0, list.length - cap), cap,
  };
}
