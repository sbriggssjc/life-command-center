// ============================================================================
// api/_shared/draft-assist-core.js — W10 Stage 2 (Prompt 107)
//
// Pure, dependency-free logic for retrieval-grounded drafting. NO network, NO
// LLM, NO DB — every function here is deterministic and unit-testable. The
// handler (api/draft-assist.js) wires these to opsQuery / on-prem Ollama /
// buildDealPacket / createOutlookDraftViaPA.
//
// DOCTRINE ENFORCED STRUCTURALLY (not just by prompt):
//  - Voice shapes HOW; the deal spine supplies WHAT. A fact the spine doesn't
//    hold renders "Not on file" — never invented (extractDealFacts).
//  - The generated draft's numbers/dates/proper-names are validated against the
//    supplied facts + retrieved exemplars; anything else is a fabrication and is
//    flagged + stripped (validateDraftFacts). A fabricated figure is the
//    cardinal sin.
//  - Retrieval only ever ranks Scott-authored OUTBOUND openings (the handler
//    filters by SCOTT_FROM before calling in here).
// ============================================================================

import { classifyDraftType } from './voice-corpus-clean.js';

export const NOT_ON_FILE = 'Not on file';

// Scott's authored-from addresses (verified live 2026-08-13, mirrors
// scripts/voice-distill.mjs). Family addresses are deliberately excluded — the
// retrieval corpus is ONLY Scott's own outbound.
export const SCOTT_FROM = new Set([
  'sabriggs@northmarq.com',
  'teambriggs@northmarq.com',
  'sbriggs@stanjohnsonco.com',
  'teambriggs@stanjohnsonco.com',
]);

// The public draft-type `purpose` vocabulary → the internal classifyDraftType
// bucket used to slice the corpus. This is the single mapping between the
// request surface and the Stage-1 cleaner's buckets.
export const PURPOSE_TO_BUCKET = {
  cold_bd: 'cold_bd_outreach',
  follow_up: 'external_follow_up',
  broker_to_broker: 'external_follow_up',
  client_update: 'external_follow_up',
  loi_ack: 'loi_offer',
  listing_announcement: 'listing_announcement',
  relationship_touch: 'external_follow_up',
};

export const VALID_PURPOSES = Object.keys(PURPOSE_TO_BUCKET);

/** Domain part of an email address, lowercased. '' when not an address. */
export function emailDomain(email) {
  const m = String(email || '').toLowerCase().match(/@([^@\s>]+)$/);
  return m ? m[1] : '';
}

/**
 * Deterministic exemplar ranker — used when on-prem embeddings are unavailable
 * (opening-length text ranks fine on these signals). Scores each candidate:
 *   +3 same draft-type bucket
 *   +2 exact recipient email match, else +1 same recipient domain
 *   + recency (newest first; small, breaks ties without dominating relevance)
 * Returns the top `k` cleaned exemplars, newest-preferred within equal scores.
 *
 * @param {Array<{id,cleaned,bucket,toEmails,ts}>} candidates  Scott-authored, cleaned
 * @param {{bucket:string, recipientEmail?:string}} target
 * @param {number} k
 */
export function rankExemplarsDeterministic(candidates, target, k = 5) {
  const wantBucket = String(target.bucket || '');
  const wantEmail = String(target.recipientEmail || '').toLowerCase();
  const wantDomain = emailDomain(wantEmail);
  // Newest-first baseline so recency is a stable tiebreaker.
  const withTs = candidates.map((c) => ({ c, t: Date.parse(c.ts || '') || 0 }));
  const maxT = withTs.reduce((m, x) => Math.max(m, x.t), 1);
  const scored = withTs.map(({ c, t }) => {
    let s = 0;
    if (c.bucket === wantBucket) s += 3;
    const recips = (Array.isArray(c.toEmails) ? c.toEmails : [c.toEmails])
      .filter(Boolean).map((e) => String(e).toLowerCase());
    if (wantEmail && recips.includes(wantEmail)) s += 2;
    else if (wantDomain && recips.some((e) => emailDomain(e) === wantDomain)) s += 1;
    // Recency worth < 1 point so it never outranks a relevance signal.
    s += (t / maxT) * 0.9;
    return { c, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, Math.max(0, k)).map((x) => x.c);
}

/** Cosine similarity of two equal-length numeric vectors. 0 on any mismatch. */
export function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Embedding-KNN ranker. Candidates carry a `vec`; the query carries `queryVec`.
 * Falls to bucket-first ordering among equal similarity (stable). The handler
 * only calls this when on-prem embeddings succeeded for BOTH sides.
 */
export function rankExemplarsByEmbedding(candidates, queryVec, target, k = 5) {
  const wantBucket = String(target.bucket || '');
  const scored = candidates
    .filter((c) => Array.isArray(c.vec))
    .map((c) => ({ c, s: cosineSim(c.vec, queryVec) + (c.bucket === wantBucket ? 0.02 : 0) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, Math.max(0, k)).map((x) => x.c);
}

/**
 * Anonymize an exemplar opening of third-party PII before it becomes a few-shot
 * prompt (the persisted-artifact rule). Emails → [email], phone → [phone],
 * $ amounts and %/bps left as-is (they're not third-party PII, and the fact
 * validator needs the exemplar's own numbers to remain visible). Deterministic.
 */
export function anonymizeExemplar(text) {
  return String(text || '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\+?\d[\d().\s-]{7,}\d/g, '[phone]')
    .trim();
}

/** tag() helper unwrap — buildDealPacket wraps facts as { v, source } or scalars. */
function unwrap(x) {
  if (x && typeof x === 'object' && Object.prototype.hasOwnProperty.call(x, 'v')) return x.v;
  return x;
}
function pct(x) {
  const v = unwrap(x);
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // stored as decimal (0.0747) → 7.47%
  return `${(n <= 1 ? n * 100 : n).toFixed(2)}%`;
}

/**
 * Flatten a buildDealPacket result into a FLAT facts object for the drafter.
 * Every value is a plain string; an absent/blank fact is literally "Not on
 * file" — the model is never handed a gap it could fill. `parties` is a short
 * roster string. This is the ONLY place deal facts enter the prompt.
 */
export function extractDealFacts(packet) {
  const facts = {};
  const put = (k, v) => { facts[k] = (v == null || v === '' ) ? NOT_ON_FILE : String(v); };

  if (!packet || typeof packet !== 'object') {
    return { property_label: NOT_ON_FILE, deal_name: NOT_ON_FILE, deal_stage: NOT_ON_FILE, cap_rate: NOT_ON_FILE, parties: NOT_ON_FILE, next_touch: NOT_ON_FILE };
  }
  const meta = packet.meta || {};
  const deal = packet.deal || {};
  const facts_in = packet.facts || packet.data || {};

  put('property_label', unwrap(meta.property_label) || unwrap(facts_in.property_label));
  put('deal_name', unwrap(deal.deal_name) || unwrap((packet.bd || {}).deal_name));
  put('deal_stage', unwrap(deal.stage));
  put('cap_rate', pct(facts_in.cap_rate) || pct(facts_in.stated_cap_rate) || pct(facts_in.calculated_cap_rate));

  const parties = Array.isArray(deal.parties) ? deal.parties : [];
  const roster = parties
    .filter((p) => p && (p.name || p.role))
    .slice(0, 8)
    .map((p) => `${p.role || 'party'}: ${p.name || NOT_ON_FILE}${p.flag ? ` (${p.flag})` : ''}`)
    .join('; ');
  put('parties', roster);

  const cad = deal.cadence || {};
  put('next_touch', unwrap(cad.next_touch_type) && unwrap(cad.next_touch_due)
    ? `${unwrap(cad.next_touch_type)} due ${unwrap(cad.next_touch_due)}`
    : '');
  return facts;
}

/**
 * The corpus is opening-only (~255-char bodyPreview; body_text empty — the
 * Stage-1 finding). Surface that honestly per bucket + exemplar count. Never
 * pretends to full-body fidelity.
 */
export function voiceConfidenceNote(bucket, exemplarCount) {
  const thin = bucket === 'cold_bd_outreach' || bucket === 'loi_offer' || bucket === 'listing_announcement';
  const base =
    'Voice is grounded in Scott\'s SENT-email openings (~255-char preview cap; full bodies not yet ingested), '
    + 'so greeting/opening/tone are high-fidelity while sign-offs and long-form paragraph shape lean on the '
    + 'BRIGGS-WRITING-VOICE profile, not the corpus.';
  if (exemplarCount === 0) {
    return `${base} No matching past exemplars were retrieved for this draft-type — the draft rests on the voice profile + facts alone; edit closely.`;
  }
  if (thin && exemplarCount < 3) {
    return `${base} This draft-type (${bucket}) is evidence-THIN in the corpus (${exemplarCount} exemplar(s)); the profile flags it LOW-confidence — treat the draft as a starting point.`;
  }
  return `${base} Retrieved ${exemplarCount} real past exemplar(s) of this draft-type; opening voice is well-supported.`;
}

// Number/date/proper-name token detectors for the fact validator.
const NUM_TOKEN = /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[mMbBkK]|million|billion)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|bps|sf|psf|acres?|units?)\b|\b\d[\d,]{2,}(?:\.\d+)?\b/g;
const DATE_TOKEN = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:19|20)\d{2}\b/gi;
// Proper-name = 2+ consecutive Capitalized words (a person/company), avoiding
// sentence-start single words. Conservative: only multi-word runs are flagged.
const NAME_TOKEN = /\b([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|[A-Z]&|LLC|LP|Inc\.?|Co\.?|Corp\.?|Group|Partners|Capital|Realty|Properties)){1,4})\b/g;

function normForMatch(s) {
  return String(s || '').toLowerCase().replace(/[\s,$]/g, '');
}

/**
 * Validate a generated draft's facts against the ONLY allowed sources: the
 * supplied deal facts + the retrieved exemplars (+ the caller's own intent/
 * recipient text). Any number, date, or multi-word proper-name NOT grounded
 * there is a fabrication → stripped (numbers/dates replaced with the literal
 * "[Not on file]") and reported. Names are flagged (reported) but not deleted,
 * since a false positive would mangle prose; numbers/dates are the cardinal-sin
 * class and are removed.
 *
 * @returns {{ text, flagged: Array<{type,token}>, clean: boolean }}
 */
export function validateDraftFacts(draftText, { facts = {}, exemplars = [], extra = '' } = {}) {
  const allowedRaw = [
    ...Object.values(facts).map((v) => (v && typeof v === 'object' ? unwrap(v) : v)),
    ...exemplars.map((e) => (typeof e === 'string' ? e : (e && e.cleaned) || '')),
    extra,
  ].filter(Boolean).join(' \n ');
  const allowedNorm = normForMatch(allowedRaw);
  const grounded = (tok) => allowedNorm.includes(normForMatch(tok));

  const flagged = [];
  let text = String(draftText || '');

  const stripKind = (re, type) => {
    text = text.replace(re, (m) => {
      if (grounded(m)) return m;
      flagged.push({ type, token: m.trim() });
      return '[Not on file]';
    });
  };
  stripKind(NUM_TOKEN, 'number');
  stripKind(DATE_TOKEN, 'date');

  // Names: report only (never delete — too prose-destructive on a false hit).
  let nm;
  const seen = new Set();
  // eslint-disable-next-line no-cond-assign
  while ((nm = NAME_TOKEN.exec(text)) !== null) {
    const tok = nm[1];
    if (seen.has(tok) || grounded(tok)) continue;
    // Skip common non-name capitalized runs that legitimately appear in prose.
    if (/^(I |Best Regards|Thank You|Team|Not On File|Best Regards,)/i.test(tok)) continue;
    seen.add(tok);
    flagged.push({ type: 'proper_name', token: tok });
  }
  NAME_TOKEN.lastIndex = 0;

  return { text, flagged, clean: flagged.length === 0 };
}

/**
 * Assemble the on-prem generation prompt: the voice profile (HOW), the retrieved
 * exemplars (precedent), the deal facts (WHAT, with "Not on file" gaps), and the
 * intent. The instructions forbid inventing any fact and forbid strategy/
 * recommendations in writing (offer-submission doctrine). Pure string assembly.
 */
export function buildGenerationPrompt({ voiceProfile = '', exemplars = [], facts = {}, purpose = '', intent = '', recipientLabel = '' } = {}) {
  const exemplarBlock = exemplars.length
    ? exemplars.map((e, i) => `#${i + 1}: ${anonymizeExemplar((e && e.cleaned) || e).replace(/\n+/g, ' / ')}`).join('\n')
    : '(none retrieved — rely on the voice profile below)';
  const factLines = Object.entries(facts).map(([k, v]) => `  - ${k}: ${v}`).join('\n');

  return [
    'You are drafting an email in Scott Briggs\'s own voice. This is a DRAFT for Scott to edit — it is NEVER sent automatically.',
    '',
    '### HARD RULES (a violation makes the draft unusable)',
    '1. Use ONLY the FACTS listed below. If a fact says "Not on file", DO NOT invent it — omit that detail or write "Not on file". Never fabricate a number, name, date, price, or cap rate.',
    '2. Do NOT put negotiation strategy or recommendations in writing. Factual/relational correspondence only (acknowledge, update, follow up, introduce).',
    '3. Match Scott\'s voice from the profile and the real past examples: extremely short and punchy, lead with the answer, warm but direct, no "Dear", no corporate filler, no walls of text.',
    '4. Output STRICT JSON only: {"subject": "...", "body": "..."} — no markdown, no commentary.',
    '',
    '### SCOTT\'S WRITING VOICE (shapes HOW it reads, never WHAT it claims)',
    String(voiceProfile || '(voice profile unavailable)').slice(0, 8000),
    '',
    `### REAL PAST EXAMPLES of this draft-type (${purpose}) — his precedent, adapt don't copy`,
    exemplarBlock,
    '',
    '### FACTS (the ONLY facts you may state; "Not on file" = unknown, never fill it)',
    factLines || '  (no deal facts supplied — write a relational note that states ZERO specific facts)',
    '',
    `### THIS DRAFT`,
    `Recipient: ${recipientLabel || 'Not on file'}`,
    `Purpose: ${purpose}`,
    `Scott's intent: ${intent || '(none given)'}`,
    '',
    'Write the draft now as strict JSON {"subject","body"}.',
  ].join('\n');
}

/** Parse the model's JSON output tolerantly into { subject, body }. */
export function parseDraftJson(raw) {
  const s = String(raw || '');
  let obj = null;
  try { obj = JSON.parse(s); } catch { /* try to find a JSON object */ }
  if (!obj) {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch { obj = null; } }
  }
  if (!obj || typeof obj !== 'object') return { subject: '', body: s.trim(), parsed: false };
  return { subject: String(obj.subject || '').trim(), body: String(obj.body || '').trim(), parsed: true };
}

/**
 * Resolve the internal corpus bucket for a requested purpose. Falls back to
 * classifyDraftType heuristics when a free-text purpose is given.
 */
export function bucketForPurpose(purpose, { subject = '', toEmails = [] } = {}) {
  const p = String(purpose || '').toLowerCase();
  if (PURPOSE_TO_BUCKET[p]) return PURPOSE_TO_BUCKET[p];
  return classifyDraftType({ subject, toEmails }).bucket;
}

export const _internals = { NUM_TOKEN, DATE_TOKEN, NAME_TOKEN, unwrap, pct, normForMatch };
