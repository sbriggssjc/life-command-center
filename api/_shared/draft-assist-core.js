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
 * Every address an exemplar was sent to — `to` first, then `cc`. P125: `cc` was
 * previously invisible to the ranker, so a thread where Scott moved the
 * counterparty to cc (3 of Susan Holdsworth's 55 live rows) scored as if she were
 * not on the message at all. A cc recipient is a weaker signal than a to
 * recipient and is scored as such — but never zero.
 */
export function exemplarRecipients(c) {
  const norm = (v) => (Array.isArray(v) ? v : (v ? [v] : []))
    .filter(Boolean).map((e) => String(e).toLowerCase().trim()).filter(Boolean);
  return { to: norm(c && c.toEmails), cc: norm(c && c.ccEmails) };
}

/**
 * P125 — how strongly this exemplar matches the draft's recipient.
 *   2 = exact address on To      1.5 = exact address on Cc
 *   1 = same organisation domain  0 = unrelated
 * Returned as a level (not a raw score) so the deterministic and embedding
 * rankers weight the SAME judgement on their own scales instead of each
 * inventing one — the embedding ranker previously had no recipient signal at all.
 */
export function recipientMatchLevel(c, recipientEmail) {
  const wantEmail = String(recipientEmail || '').toLowerCase().trim();
  if (!wantEmail) return 0;
  const { to, cc } = exemplarRecipients(c);
  if (to.includes(wantEmail)) return 2;
  if (cc.includes(wantEmail)) return 1.5;
  const wantDomain = emailDomain(wantEmail);
  if (wantDomain && [...to, ...cc].some((e) => emailDomain(e) === wantDomain)) return 1;
  return 0;
}

/**
 * Deterministic exemplar ranker — used when on-prem embeddings are unavailable.
 * Scores each candidate:
 *   +5 / +3.75 / +2.5  exact recipient on To / on Cc / same recipient domain
 *   +3                 same draft-type bucket
 *   + recency          (newest first; < 1pt, breaks ties without dominating)
 *
 * P125 — RECIPIENT NOW OUTRANKS BUCKET, deliberately. Scott's own past mail to
 * THIS counterparty is simultaneously the best voice sample and the best
 * relationship-context sample; a generic same-bucket note to a different party is
 * neither. Under the old weights (bucket 3 > recipient 2) a same-bucket stranger
 * outranked a slightly-off-bucket email to the actual recipient, which is how a
 * draft to Susan Holdsworth retrieved five Villages notes to the title company
 * instead of any of the 55 Scott had written to her.
 *
 * @param {Array<{id,cleaned,bucket,toEmails,ccEmails,ts}>} candidates  Scott-authored, cleaned
 * @param {{bucket:string, recipientEmail?:string}} target
 * @param {number} k
 */
export function rankExemplarsDeterministic(candidates, target, k = 5) {
  const wantBucket = String(target.bucket || '');
  // Newest-first baseline so recency is a stable tiebreaker.
  const withTs = candidates.map((c) => ({ c, t: Date.parse(c.ts || '') || 0 }));
  const maxT = withTs.reduce((m, x) => Math.max(m, x.t), 1);
  const scored = withTs.map(({ c, t }) => {
    let s = recipientMatchLevel(c, target.recipientEmail) * 2.5;
    if (c.bucket === wantBucket) s += 3;
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
 *
 * ⚠️ P125 — THIS RANKER WAS ENTIRELY RECIPIENT-BLIND, and that is invisible from
 * the outside. It scored cosine + a 0.02 bucket nudge and nothing else, so
 * `target.recipientEmail` was accepted and then ignored: backfilling 55 full-body
 * emails Scott had written to the exact recipient changed the retrieved set by
 * nothing at all, because no term in the score could see them. The deterministic
 * ranker did weight recipient (+2), so the two rankers disagreed about what
 * relevance MEANS — and which one ran depended only on whether Ollama answered.
 * Both now read the same `recipientMatchLevel`.
 *
 * The bonus is on the cosine scale (similarity ∈ [-1,1]): 0.25/level puts an
 * exact-recipient exemplar (level 2 ⇒ +0.50) decisively ahead of a semantically
 * similar note to a stranger, which is the intended judgement, without collapsing
 * the ranking into "recipient only" — among recipient-matched candidates cosine
 * still decides the order.
 */
export const EMBEDDING_RECIPIENT_WEIGHT = 0.25;

export function rankExemplarsByEmbedding(candidates, queryVec, target, k = 5) {
  const wantBucket = String(target.bucket || '');
  const scored = candidates
    .filter((c) => Array.isArray(c.vec))
    .map((c) => ({
      c,
      s: cosineSim(c.vec, queryVec)
        + (c.bucket === wantBucket ? 0.02 : 0)
        + recipientMatchLevel(c, target && target.recipientEmail) * EMBEDDING_RECIPIENT_WEIGHT,
    }));
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, Math.max(0, k)).map((x) => x.c);
}

/**
 * P125 — FULL-BODY AND EXACT-RECIPIENT ARE HARD PREFERENCES, NOT WEIGHTS.
 *
 * Both were expressible as score terms, and both were then outvotable by an
 * unrelated signal — which is exactly how the live defect presented. A score term
 * that CAN lose is indistinguishable, from the outside, from one that is not there:
 * the embedding ranker accepted `recipientEmail` and ignored it, and 55 backfilled
 * emails to the actual recipient moved the retrieved set by nothing.
 *
 * So the two guarantees are expressed as an ordered PARTITION and the ranker only
 * orders WITHIN a tier:
 *
 *   tier 1  real body  +  exact recipient (to/cc)   ← both signals; the best exemplar there is
 *   tier 2  real body                               ← voice is evidenced, context is generic
 *   tier 3  preview    +  exact recipient           ← context only; opening/tone at best
 *   tier 4  preview                                 ← last resort
 *
 * Full-body is the OUTER key because a preview can evidence a greeting and nothing
 * else — no sign-off, no paragraph shape, no long-form structure — so it is the
 * harder constraint on the thing being generated. Exact recipient is the inner key.
 *
 * DOMAIN-only matches are deliberately NOT a tier: someone.else@davita.com is a
 * different person, not this relationship. That stays a score weight inside the
 * tier, where it belongs.
 *
 * Lower tiers only ever FILL SLOTS a higher tier could not, so a thin corpus still
 * returns k exemplars rather than being starved by the guarantee. `rank` is
 * whichever ranker the handler resolved, so both paths behave identically.
 */
export const EXEMPLAR_TIERS = [
  { full_body: true, recipient: true },
  { full_body: true, recipient: false },
  { full_body: false, recipient: true },
  { full_body: false, recipient: false },
];

/** Which tier (0-based) this candidate belongs to, given the draft's recipient. */
export function exemplarTier(c, recipientEmail) {
  const isFull = isFullBodyExemplar(c);
  const isRecip = recipientMatchLevel(c, recipientEmail) >= 1.5;   // exact to/cc only
  return (isFull ? 0 : 2) + (isRecip ? 0 : 1);
}

export function selectExemplars(candidates, target, k, rank) {
  const list = Array.isArray(candidates) ? candidates : [];
  const want = target && target.recipientEmail;
  const picked = [];
  const chosen = new Set();
  for (let tier = 0; tier < EXEMPLAR_TIERS.length && picked.length < k; tier += 1) {
    const bucket = list.filter((c) => !chosen.has(c) && exemplarTier(c, want) === tier);
    if (!bucket.length) continue;
    for (const c of rank(bucket, target, k - picked.length)) {
      if (chosen.has(c)) continue;
      chosen.add(c);
      picked.push(c);
    }
  }
  return picked.slice(0, k);
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
// P117: an exemplar past this length could not have come from the old ~255-char
// Graph `bodyPreview` — it is a real captured body, so a draft grounded in it can
// honestly claim full-body precedent (sign-off + paragraph shape included). Set
// above the 255 cap with headroom for the cleaner's trimming.
//
// ⚠️ P125 — THIS LENGTH TEST IS A FALLBACK, NOT THE MEASUREMENT, AND IT WAS WRONG
// AT SCALE. It infers provenance from size, and Scott's voice is short by design
// ("extremely short and punchy" — the profile's own first rule). Measured live on
// LCC Opps 2026-08-21 over the 777 Scott-authored rows that carry a real
// `body_html`, after the cleaner strips the quoted chain and signature:
//
//     cleaned <12 chars  ................  71   (dropped as boilerplate: "AWESOME!", "Just did!")
//     cleaned 12–299 chars  .............  438  ← GENUINE full bodies, called "preview-era openings"
//     cleaned >=300 chars  ..............  268
//     median cleaned prose  .............  160 chars
//
// So the heuristic mislabelled **62% of the real full bodies** and `voice_confidence`
// kept reporting "preview-era OPENINGS only (~255-char cap)" over a corpus that is
// nothing of the kind. Provenance is a FACT we hold at load time — which body column
// the text came from — so carry it (`exemplar.full_body`) rather than re-deriving it
// from a proxy. The length test survives only for callers that supply no provenance.
export const FULL_BODY_MIN_CHARS = 300;

/**
 * Is this exemplar grounded in a real captured body? Provenance-first: the loader
 * sets `full_body` from the SOURCE COLUMN (`body_text`/`body_html` present ⇒ true;
 * only `body_preview`/`activity_events.body` ⇒ false). Falls back to the length
 * heuristic ONLY when the caller supplied no provenance.
 */
export function isFullBodyExemplar(e) {
  if (e && typeof e.full_body === 'boolean') return e.full_body;
  return String((e && e.cleaned) || '').length >= FULL_BODY_MIN_CHARS;
}

/**
 * How many of the retrieved exemplars are genuine full bodies vs old previews.
 * `basis` reports HOW that was decided, so a caller can never mistake the
 * length-heuristic fallback for a provenance read (see the P125 note above).
 */
export function exemplarBodyCoverage(exemplars) {
  const list = Array.isArray(exemplars) ? exemplars : [];
  const lengths = list.map((e) => String((e && e.cleaned) || '').length);
  const full = list.filter(isFullBodyExemplar).length;
  const withProv = list.filter((e) => e && typeof e.full_body === 'boolean').length;
  const basis = list.length === 0 ? 'none'
    : withProv === list.length ? 'provenance'
      : withProv === 0 ? 'length_heuristic' : 'mixed';
  return {
    total: list.length,
    full_body: full,
    preview_only: list.length - full,
    max_chars: lengths.length ? Math.max(...lengths) : 0,
    // P125: a full body whose cleaned prose is under the heuristic's threshold —
    // the population the old length test silently misfiled. Reported so the
    // "short == preview" mistake cannot quietly come back.
    short_full_bodies: list.filter((e) => isFullBodyExemplar(e)
      && String((e && e.cleaned) || '').length < FULL_BODY_MIN_CHARS).length,
    basis,
  };
}

/**
 * An honest, per-draft statement of what the voice is actually grounded in.
 *
 * Stage 1 could only ever say "openings, ~255-char cap". Since the Sent/Archive
 * sweep landed real bodies, that is no longer uniformly true — so the note is now
 * derived from the RETRIEVED EXEMPLARS' actual lengths rather than asserted for
 * the whole corpus. A draft grounded in full bodies says so; one that still fell
 * back to preview-era openings keeps the old caveat, because for that draft the
 * caveat is still correct.
 *
 * Accepts either the exemplar array (preferred — enables the full-body read) or a
 * bare count, so existing callers keep working.
 */
export function voiceConfidenceNote(bucket, exemplarsOrCount) {
  const thin = bucket === 'cold_bd_outreach' || bucket === 'loi_offer' || bucket === 'listing_announcement';
  const isList = Array.isArray(exemplarsOrCount);
  const cov = isList ? exemplarBodyCoverage(exemplarsOrCount) : null;
  const exemplarCount = isList ? cov.total : Number(exemplarsOrCount || 0);

  if (exemplarCount === 0) {
    return 'No matching past exemplars were retrieved for this draft-type — the draft rests on the '
      + 'BRIGGS-WRITING-VOICE profile + the supplied facts alone; edit closely.';
  }

  let base;
  if (cov && cov.full_body === cov.total) {
    base = `Voice is grounded in ${cov.full_body} FULL past email bod(ies) of Scott's — sign-off, paragraph shape and `
      + 'long-form structure are corpus-evidenced here, not inferred from the profile.';
    // P125: a short full body is still a full body. Say so explicitly, because the
    // reader's instinct (and the retired length heuristic) is to read "short" as
    // "truncated preview" — here it means Scott genuinely wrote three lines.
    if (cov.basis !== 'length_heuristic' && cov.short_full_bodies > 0) {
      base += ` ${cov.short_full_bodies} of them are SHORT by choice, not truncated — that brevity is the voice, not a capture limit.`;
    }
  } else if (cov && cov.full_body > 0) {
    base = `Voice is grounded in ${cov.total} past exemplar(s), ${cov.full_body} of them FULL bodies and `
      + `${cov.preview_only} still preview-era openings (~255-char cap) — opening/tone is well-supported throughout, `
      + 'while sign-off and long-form shape rest on the full-body subset.';
  } else {
    base = `Voice is grounded in ${exemplarCount} past exemplar(s) that are preview-era OPENINGS only (~255-char cap), `
      + 'so greeting/opening/tone are high-fidelity while sign-offs and long-form paragraph shape lean on the '
      + 'BRIGGS-WRITING-VOICE profile, not these exemplars.';
  }

  if (thin && exemplarCount < 3) {
    return `${base} This draft-type (${bucket}) is evidence-THIN in the corpus (${exemplarCount} exemplar(s)); `
      + 'the profile flags it LOW-confidence — treat the draft as a starting point.';
  }
  return base;
}

// Number/date/proper-name token detectors for the fact validator.
const NUM_TOKEN = /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[mMbBkK]|million|billion)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|bps|sf|psf|acres?|units?)\b|\b\d[\d,]{2,}(?:\.\d+)?\b/g;
const DATE_TOKEN = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:19|20)\d{2}\b/gi;
// Proper-name = 2+ consecutive Capitalized words (a person/company), avoiding
// sentence-start single words. Conservative: only multi-word runs are flagged.
const NAME_TOKEN = /\b([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|[A-Z]&|LLC|LP|Inc\.?|Co\.?|Corp\.?|Group|Partners|Capital|Realty|Properties)){1,4})\b/g;

// Common capitalized English words that legitimately appear Title-Cased in email
// subjects/openings ("Quick Check-In", "Following Up", "Touch Base") — NOT person
// or company names. A multi-word run made up ENTIRELY of these is benign boilerplate
// and must not be flagged as an ungrounded proper name (the false-positive that made
// fact_validation.clean falsely false on nearly every draft). A run with even one
// non-stopword token ("Boyd Watterson", "Kingsbarn Capital") is still flagged.
const NAME_STOPWORDS = new Set([
  'quick', 'check', 'checking', 'follow', 'following', 'followup', 'up', 'touch', 'base',
  'best', 'thanks', 'thank', 'regards', 'cheers', 're', 'fwd', 'fw',
  'hi', 'hello', 'hey', 'dear', 'good', 'morning', 'afternoon', 'evening',
  'the', 'a', 'an', 'and', 'or', 'to', 'on', 'in', 'of', 'for', 'with', 'at', 'by',
  'your', 'our', 'my', 'we', 'you', 'us', 'me', 'i',
  'just', 'please', 'let', 'know', 'here', 'there', 'next', 'week', 'today', 'tomorrow',
  'call', 'meeting', 'update', 'note', 'quick', 'reminder', 'intro', 'introduction',
  'great', 'sounds', 'sorry', 'welcome', 'congrats', 'congratulations', 'happy',
  'new', 'year', 'looking', 'forward', 'circling', 'back', 'catching', 'reaching', 'out',
]);

/** A NAME_TOKEN run is boilerplate iff EVERY alphabetic word in it is a stopword. */
function isBoilerplateNameRun(run) {
  const words = String(run || '')
    .split(/[\s-]+/)
    .map((w) => w.replace(/[^A-Za-z&]/g, '').toLowerCase())
    .filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => NAME_STOPWORDS.has(w));
}

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
    // Skip Title-Cased boilerplate ("Quick Check-In", "Following Up", "Touch Base")
    // where every word is a common capitalized English word, not a person/company.
    if (isBoilerplateNameRun(tok)) continue;
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

export const _internals = { NUM_TOKEN, DATE_TOKEN, NAME_TOKEN, NAME_STOPWORDS, isBoilerplateNameRun, unwrap, pct, normForMatch };
