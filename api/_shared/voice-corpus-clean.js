// Prompt 100 — W10 Stage 1 — voice-corpus-clean
//
// Pure, dependency-free deterministic cleaner for Scott's authored sent-email
// corpus. A voice profile trained on boilerplate teaches boilerplate, so this
// runs FIRST (a data-quality step) — it keeps ONLY Scott's freshly-typed prose
// and drops the quoted reply chain, the Briggs signature block, forwarded
// headers, legal disclaimers, and mobile-client sig lines.
//
// GROUNDING (live forensics, LCC Opps 2026-08-13): the correspondence store
// keeps Graph's `bodyPreview` (~255-char cap) in `activity_events.body` /
// `email_bodies.body_preview`. In practice each Scott preview is a short opening
// that frequently (a) bleeds into the quoted chain (`________ From: … Sent: …`)
// and (b) ends with the inline signature ("Scott Briggs Senior Vice President ·
// Northmarq D (918) 794-9787 | E sabriggs@northmarq.com"), because Outlook
// top-posts the signature. Both MUST be stripped or the profile learns the
// footer, not the voice. No LLM here — regex only, so nothing leaves the box.

const REPLY_MARKERS = [
  /_{4,}/,                                   // Outlook horizontal rule before quote
  /-{3,}\s*Original Message\s*-{3,}/i,
  /-{3,}\s*Forwarded message\s*-{3,}/i,
  /^\s*From:\s.+$/im,                        // quoted header block
  /\bOn\b.{0,120}\bwrote:/is,                // "On <date>, <name> wrote:"
  /\bSent from my\b/i,                       // mobile client sig
  /\bGet Outlook for (iOS|Android)\b/i,
];

// Signature anchors — the earliest hit cuts the sig + everything after it.
const SIGNATURE_ANCHORS = [
  /\bScott\s+A?\.?\s*Briggs\b/i,             // the name in the sig block
  /\bSenior Vice President\b/i,
  /\bD\s*\(?918\)?\s*[.\s-]?794[.\s-]?9787\b/,   // his direct line
  /\bsabriggs@northmarq\.com\b/i,
  /\bStan Johnson Company is now Northmarq\b/i,
  /\b6120 S\.?\s*Yale\b/i,                   // the office address line
];

// Closing tokens that (when they sit right before the sig / end) are a sign-off,
// not prose. Only trimmed when trailing — "Thanks!" mid-sentence is kept.
const SIGNOFF_TRAIL =
  /\s*(?:\b(?:best regards|best|regards|thanks|thank you|cheers|talk soon|sincerely|warm regards|v\/r)\b\s*[,.!]?)\s*$/i;

const DISCLAIMER_MARKERS = [
  /\bCONFIDENTIAL(?:ITY)?\b.{0,40}\bNOTICE\b/i,
  /\bThis (?:e-?mail|message)\b.{0,60}\b(?:confidential|intended (?:solely |only )?for)\b/i,
  /\bIf you (?:are not|received this).{0,60}\b(?:in error|intended recipient)\b/i,
];

/** Strip a leading UTF-8 BOM and normalize CRLF → LF. */
export function normalizeRaw(raw) {
  return String(raw == null ? '' : raw)
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n');
}

/** Cut everything from the FIRST reply/forward marker onward. */
export function stripReplyChain(text) {
  let cut = text.length;
  for (const re of REPLY_MARKERS) {
    const m = text.match(re);
    if (m && m.index != null && m.index < cut) cut = m.index;
  }
  // Also drop a run of leading '>' quote lines if they open the body.
  let out = text.slice(0, cut);
  out = out.replace(/(^|\n)\s*>.*(?=\n|$)/g, '$1');
  return out;
}

/** Cut everything from the FIRST signature anchor onward. */
export function stripSignature(text) {
  let cut = text.length;
  for (const re of SIGNATURE_ANCHORS) {
    const m = text.match(re);
    if (m && m.index != null && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut);
}

/** Remove a legal/confidentiality disclaimer block (and everything after it). */
export function stripDisclaimer(text) {
  let cut = text.length;
  for (const re of DISCLAIMER_MARKERS) {
    const m = text.match(re);
    if (m && m.index != null && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut);
}

/** Trim a trailing sign-off token that immediately preceded the sig. */
export function stripTrailingSignoff(text) {
  let out = text;
  // Apply up to twice ("… Stay tuned. Best regards," → "… Stay tuned.").
  for (let i = 0; i < 2; i += 1) {
    const next = out.replace(SIGNOFF_TRAIL, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Collapse runs of blank lines / trailing spaces without flattening paragraphs. */
export function tidyWhitespace(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, '').replace(/^[ \t]+/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Full clean: BOM/CRLF → strip reply chain → disclaimer → signature →
 * trailing sign-off → tidy. Returns ONLY Scott's freshly-typed prose.
 */
export function cleanEmailBody(raw) {
  let t = normalizeRaw(raw);
  t = stripReplyChain(t);
  t = stripDisclaimer(t);
  t = stripSignature(t);
  t = stripTrailingSignoff(t);
  return tidyWhitespace(t);
}

const URL_ONLY = /^\s*(?:https?:\/\/|webcal:\/\/|mailto:)\S+\s*$/i;
const RECALL_NOTICE = /\bwould like to recall the message\b/i;

/**
 * True when what's left is not usable voice signal: empty, a URL/calendar link,
 * a "recall the message" system notice, or too short to carry any style.
 * Callers drop these from the training corpus.
 */
export function isMostlyBoilerplate(cleaned, { minChars = 12 } = {}) {
  const c = String(cleaned || '').trim();
  if (c.length < minChars) return true;
  if (URL_ONLY.test(c)) return true;
  if (RECALL_NOTICE.test(c)) return true;
  // Nothing but punctuation / a stray token.
  if (!/[A-Za-z]{2,}/.test(c)) return true;
  return false;
}

const INTERNAL_DOMAINS = ['northmarq.com', 'stanjohnsonco.com'];

/**
 * Deterministic draft-type bucketing from cheap signals (subject prefix,
 * recipient domain, keyword cues). A light LLM classify can refine the
 * `general_reply` residue later, but this covers the strong cases with no model
 * and no egress. Returns { bucket, audience, confidence }.
 */
export function classifyDraftType({ cleaned = '', subject = '', toEmails = [], fromEmail = '' } = {}) {
  const subj = String(subject || '').toLowerCase();
  const body = String(cleaned || '').toLowerCase();
  const recips = (Array.isArray(toEmails) ? toEmails : [toEmails])
    .filter(Boolean)
    .map((e) => String(e).toLowerCase());
  const isReply = /^\s*(re:|fw:|fwd:)/i.test(subject || '');
  const allInternal = recips.length > 0 && recips.every(
    (e) => INTERNAL_DOMAINS.some((d) => e.endsWith('@' + d) || e.endsWith('.' + d)),
  );
  const audience = recips.length === 0 ? 'unknown' : allInternal ? 'internal' : 'external';

  const hay = subj + ' ' + body;
  let bucket;
  if (/\b(loi|letter of intent|offer|purchase (?:agreement|and sale)|psa|counter)\b/.test(hay)) {
    bucket = 'loi_offer';
  } else if (/\b(pleased to present|new (?:listing|offering)|now available|just listed|pre-?market|for sale)\b/.test(hay)) {
    bucket = 'listing_announcement';
  } else if (audience === 'internal') {
    bucket = 'internal_coordination';
  } else if (!isReply && audience === 'external') {
    bucket = 'cold_bd_outreach';
  } else if (isReply && audience === 'external') {
    bucket = 'external_follow_up';
  } else {
    bucket = 'general_reply';
  }
  // Confidence is high for the keyword-driven buckets, medium for the
  // audience/thread-shape residue that a light classify could still refine.
  const confidence = bucket === 'loi_offer' || bucket === 'listing_announcement' ? 'high' : 'medium';
  return { bucket, audience, confidence };
}

export const _internals = { REPLY_MARKERS, SIGNATURE_ANCHORS, DISCLAIMER_MARKERS, INTERNAL_DOMAINS };
