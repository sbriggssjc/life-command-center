// ============================================================================
// W5.1 — Party extraction from sale notes (two-channel + adjudication)
//
// Fills the missing buyer/seller/broker/lender fields on LIVE sales from the CoStar
// sale-note narrative, WRITING ONLY on field-level agreement between two independent
// extractors:
//
//   Channel A — GLiNER spans  (resolver POST /extract-parties; span-anchored, deterministic)
//   Channel B — local LLM     (api/_shared/ai.js invokeExtractionAI; GaryBuilt/qwen2.5
//                              primary, cloud fallback). Structured-JSON extraction.
//
// Adjudication (per canonical field, cores compared post-normalization):
//   • A and B AGREE (normalized company cores match)  → write  source='party_extract_agree'
//                                                         confidence 0.60
//   • A present, B abstained (null)                   → write  source='gliner_extract'
//                                                         confidence 0.55  (span-anchored)
//   • A and B present but cores CONFLICT              → NO write, log to disagreements
//   • B present, A absent (span-less LLM claim)       → NO write, log to disagreements
//
//   The plan's wording folds "disagreed" into the A-only gliner_extract write. We
//   deliberately tighten that: a genuine value CONFLICT is ambiguity, and the standing
//   data-write doctrine is "surface ambiguity to a review lane, never guess." So a
//   conflict is logged (training signal, entity_match_labels philosophy), not written.
//   Only abstention (B null) yields the A-only write.
//
// This module is PURE + injectable — no direct DB/network at import time. The runner
// (scripts/party-extract-backlog.mjs) wires the resolver fetch, invokeExtractionAI, the
// field-priority guard, the domain PATCH, and the ledger/disagreement inserts.
// ============================================================================

import { invokeExtractionAI } from '../_shared/ai.js';

// Canonical field → actual column, per domain. `lender` has a home only on gov; the map
// omits it for dia so the writer drops it there (dia lender lives on dia.loans, not sales).
export const PARTY_FIELD_MAP = {
  dia: {
    buyer: 'buyer_name',
    seller: 'seller_name',
    listing_broker: 'listing_broker',
    procuring_broker: 'procuring_broker',
  },
  gov: {
    buyer: 'buyer',
    seller: 'seller',
    listing_broker: 'listing_broker',
    procuring_broker: 'purchasing_broker',
    lender: 'lender_name',
  },
};

// Per-domain note-text source columns, most-authoritative first. dia's `notes` (the CoStar
// marketing description) is the deep well — sale_notes_raw alone covers <300 live dia sales,
// whereas notes+sale_notes_raw covers ~2,242. gov has no generic `notes` column.
export const NOTE_COLUMNS = {
  dia: ['sale_notes_raw', 'notes'],
  gov: ['sale_notes_raw'],
};

export const CANONICAL_FIELDS = ['buyer', 'seller', 'listing_broker', 'procuring_broker', 'lender'];

export const SOURCE_AGREE = 'party_extract_agree';
export const SOURCE_GLINER = 'gliner_extract';
export const CONF_AGREE = 0.60;
export const CONF_GLINER = 0.55;

// ---------------------------------------------------------------------------
// Company-name core normalizer — mirrors resolver/app/normalize.py::normalize_company
// (same LEGAL_FORMS list + semantic-token retention) so cores agree with the SQL/resolver
// writers. Used for the agreement key. When a resolver /normalize function is injected the
// runner can prefer it, but this keeps adjudication correct offline (and in unit tests).
// ---------------------------------------------------------------------------
const LEGAL_FORMS = [
  'limited liability company', 'limited liability co', 'limited partnership',
  'limited liability limited partnership', 'professional corporation', 'professional association',
  'llc', 'l l c', 'llp', 'l l p', 'lllp', 'lp', 'l p', 'ltd', 'limited',
  'inc', 'incorporated', 'corp', 'corporation', 'dst', 'reit', 'trust', 'gp', 'fund', 'spe',
].sort((a, b) => b.length - a.length); // longest-first
const STOPWORDS = new Set(['the', 'and', 'of', 'a', 'an', 'for']);

export function normalizeCore(name) {
  if (!name || !String(name).trim()) return '';
  let clean = String(name).toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let core = clean;
  let changed = true;
  while (changed) {
    changed = false;
    for (const form of LEGAL_FORMS) {
      const pat = new RegExp('(?:^| )' + form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?= |$)', 'g');
      const next = core.replace(pat, ' ').replace(/\s+/g, ' ').trim();
      if (next !== core) { core = next; changed = true; }
    }
  }
  if (!core) core = clean; // name was ONLY a legal form
  return core;
}

function coreTokens(core) {
  return core.split(' ').filter((t) => t && !STOPWORDS.has(t));
}

/**
 * Do two normalized cores refer to the same party? Equal, or one is a contiguous
 * PREFIX or SUFFIX of the other in token space (firm names commonly extend:
 * "Colliers" ⊂ "Colliers International"; "Medical Care" ⊂ "Fresenius Medical Care").
 * Prefix/suffix — NOT arbitrary subset — so a generic shared middle token
 * ("Capital") can't force a false agreement.
 */
export function coresAgree(aCore, bCore) {
  if (!aCore || !bCore) return false;
  if (aCore === bCore) return true;
  const ta = coreTokens(aCore);
  const tb = coreTokens(bCore);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const prefix = short.every((t, i) => long[i] === t);
  const suffix = short.every((t, i) => long[long.length - short.length + i] === t);
  return prefix || suffix;
}

// ---------------------------------------------------------------------------
// Channel B — LLM structured extraction
// ---------------------------------------------------------------------------
export function buildExtractionPrompt(noteText) {
  const clipped = String(noteText || '').slice(0, 8000);
  return `You extract the DEAL PARTIES from a commercial real estate sale note. Return ONLY a single JSON object, no prose, no markdown fences.

Keys (use null when the note does NOT explicitly state the value — NEVER guess or infer):
  "buyer":            the acquiring party (company or person), as written
  "seller":           the disposing party, as written
  "listing_broker":   the broker/brokerage that represented the SELLER (listing/marketing side)
  "procuring_broker": the broker/brokerage that represented the BUYER (procuring/purchasing side)
  "lender":           the debt/financing provider, as written
  "price":            the sale price as a number (no $ or commas), else null
  "cap_rate":         the cap rate as a decimal (7.25% -> 0.0725), else null

Rules:
- Only include a party the text names explicitly. If a role is not mentioned, its value is null.
- A government agency/tenant (GSA, VA, SSA, a federal agency) is NEVER a buyer/seller.
- Do not put a broker in the buyer/seller field or vice versa.
- Names exactly as written (keep "LLC"/"Inc."/"& Co."). No commentary.

Sale note:
"""
${clipped}
"""

JSON:`;
}

/**
 * Robustly parse Channel B's response text into the canonical party object.
 * Strips code fences, extracts the first balanced {...}, coerces "" → null, trims strings.
 * Returns { buyer, seller, listing_broker, procuring_broker, lender, price, cap_rate } with
 * null for anything missing/unparseable — never throws.
 */
export function parseChannelBResponse(text) {
  const empty = { buyer: null, seller: null, listing_broker: null, procuring_broker: null, lender: null, price: null, cap_rate: null };
  if (!text || typeof text !== 'string') return empty;
  let body = text.replace(/```(?:json)?/gi, '').trim();
  const start = body.indexOf('{');
  if (start === -1) return empty;
  // Find the matching closing brace for the first object.
  let depth = 0, end = -1;
  for (let i = start; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return empty;
  let obj;
  try { obj = JSON.parse(body.slice(start, end + 1)); } catch { return empty; }
  const clean = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || /^(null|n\/a|none|unknown|undisclosed|confidential)$/i.test(s)) return null;
    return s;
  };
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[$,%\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  return {
    buyer: clean(obj.buyer),
    seller: clean(obj.seller),
    listing_broker: clean(obj.listing_broker),
    procuring_broker: clean(obj.procuring_broker),
    lender: clean(obj.lender),
    price: num(obj.price),
    cap_rate: num(obj.cap_rate),
  };
}

// ---------------------------------------------------------------------------
// Adjudication
// ---------------------------------------------------------------------------
/**
 * Adjudicate one canonical field from the two channels.
 * @returns {{ field, decision: 'write'|'skip', source?, confidence?, value?,
 *             aValue, bValue, aCore, bCore, disagreementKind? }}
 */
export function adjudicateField(field, aValue, bValue) {
  const a = aValue ? String(aValue).trim() : null;
  const b = bValue ? String(bValue).trim() : null;
  const aCore = normalizeCore(a);
  const bCore = normalizeCore(b);

  if (a && b) {
    if (coresAgree(aCore, bCore)) {
      // Agreement — write the MORE COMPLETE surface (still span-grounded via A).
      const value = b.length > a.length ? b : a;
      return { field, decision: 'write', source: SOURCE_AGREE, confidence: CONF_AGREE, value, aValue: a, bValue: b, aCore, bCore };
    }
    return { field, decision: 'skip', disagreementKind: 'value_conflict', aValue: a, bValue: b, aCore, bCore };
  }
  if (a && !b) {
    // A-only (LLM abstained). Span-anchored → gliner_extract write.
    return { field, decision: 'write', source: SOURCE_GLINER, confidence: CONF_GLINER, value: a, aValue: a, bValue: null, aCore, bCore };
  }
  if (!a && b) {
    // B-only — span-less LLM claim is hallucination-shaped. Never write; log.
    return { field, decision: 'skip', disagreementKind: 'b_only', aValue: null, bValue: b, aCore, bCore };
  }
  return { field, decision: 'skip', aValue: null, bValue: null, aCore, bCore };
}

/**
 * Adjudicate all canonical fields.
 * @param channelA resolver /extract-parties response (has .spans for grounding)
 * @param channelB parsed LLM object
 * @returns { field: adjudication } for every canonical field
 */
export function adjudicate(channelA, channelB) {
  const a = channelA || {};
  const b = channelB || {};
  const spanByField = {};
  for (const s of (a.spans || [])) {
    if (s && s.field && !(s.field in spanByField)) spanByField[s.field] = s;
  }
  const out = {};
  for (const field of CANONICAL_FIELDS) {
    const dec = adjudicateField(field, a[field], b[field]);
    const span = spanByField[field] || null;
    dec.span = span ? { text: span.text, start: span.start, end: span.end } : null;
    out[field] = dec;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Channel orchestration (IO — injectable for tests)
// ---------------------------------------------------------------------------
async function callResolverExtractParties(resolverUrl, noteText, fetchImpl) {
  const f = fetchImpl || fetch;
  const base = String(resolverUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('RESOLVER_URL not set — Channel A unavailable');
  const res = await f(`${base}/extract-parties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: String(noteText || '').slice(0, 20000) }),
  });
  if (!res.ok) throw new Error(`resolver /extract-parties ${res.status}`);
  return res.json();
}

/**
 * Run BOTH channels on one note and adjudicate.
 * @param noteText the sale-note narrative
 * @param opts { resolverUrl, fetchImpl, invokeExtractionAIImpl }
 * @returns { channelA, channelB, aiFinalProvider, aiTried, decisions }
 */
export async function extractParties(noteText, opts = {}) {
  const invoke = opts.invokeExtractionAIImpl || invokeExtractionAI;

  const channelA = await callResolverExtractParties(opts.resolverUrl, noteText, opts.fetchImpl);

  const aiResult = await invoke({ prompt: buildExtractionPrompt(noteText) });
  const responseText = aiResult?.data?.response || '';
  const channelB = aiResult?.ok ? parseChannelBResponse(responseText) : parseChannelBResponse('');
  // The provider that actually produced the answer — the bulk run gates on 'ollama'.
  const aiFinalProvider = aiResult?.provider || null;

  const decisions = adjudicate(channelA, channelB);
  return { channelA, channelB, aiFinalProvider, aiTried: aiResult?.tried || [], decisions };
}
