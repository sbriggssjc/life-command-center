// Prompt 100 — W10 Stage 1 — voice-corpus-clean
//
// Pure, dependency-free deterministic cleaner for Scott's authored sent-email
// corpus. A voice profile trained on boilerplate teaches boilerplate, so this
// runs FIRST (a data-quality step) — it keeps ONLY Scott's freshly-typed prose
// and drops the quoted reply chain, the Briggs signature block, forwarded
// headers, legal disclaimers, and mobile-client sig lines.
//
// GROUNDING (live forensics, LCC Opps 2026-08-13): historically the
// correspondence store kept ONLY Graph's `bodyPreview` (~255-char cap) in
// `activity_events.body` / `email_bodies.body_preview`. Each Scott preview is a
// short opening that frequently (a) bleeds into the quoted chain (`________
// From: … Sent: …`) and (b) ends with the inline signature ("Scott Briggs
// Senior Vice President · Northmarq D (918) 794-9787 | E sabriggs@northmarq.com"),
// because Outlook top-posts the signature. Both MUST be stripped or the profile
// learns the footer, not the voice.
//
// PROMPT 117 (2026-08-18) — RE-VERIFIED ON REAL FULL BODIES. Live forensics over
// the 654 Scott-authored `email_bodies` rows that now carry a full `body_html`
// found three things a 255-char preview could never expose, all fixed here:
//   (a) 24% of full bodies carried NO text-level reply marker — Outlook's quote
//       boundary is an HTML div (`id="appendonsend"` / `id="divRplyFwdMsg"`),
//       invisible once tags are stripped. htmlToText now emits a sentinel rule at
//       those divs (and at gmail_quote / <blockquote type="cite">) so the existing
//       line-anchored markers fire. 83 of those 157 bodies carry such a div.
//   (b) Cutting at the FIRST marker can cut to nothing when the marker opens the
//       body (an empty `appendonsend` div on a brand-new message). A MIN_LEAD
//       guard now ignores any marker with < 12 chars of real prose before it —
//       measured live: 52 bodies emptied → 0.
//   (c) `from_email` is NOT proof of authorship on this store: 118 of 654 are
//       self-addressed machine mail (74 are the app's own LCC Morning Briefing /
//       Weekly Deep Dive) and ~107 open by addressing Scott (inbound filed under
//       his address). Training on either teaches the app's template or someone
//       else's voice, so `voiceCorpusExclusion()` gates them out. Usable
//       Scott-authored full bodies: 654 → 399.
// Retention measured over those 654: HTML→text averages 7,537 chars, of which
// ~1,303 (17.3%) is Scott's own fresh prose — i.e. ~83% of a typical full body is
// quoted chain + signature + disclaimer that MUST be stripped.
//
// PROMPT 110 (2026-08-14) — full-body ingestion: once the Power-Automate flows
// forward a "Get email (V3)" body, rows carry the FULL body in
// `email_bodies.body_text` / `body_html` (and inbound metadata). The cleaner
// matters MORE on a full body (there is a real reply chain + signature to cut),
// so consumers now prefer full body → tag-stripped html → preview via
// `pickBestBody`, falling back cleanly while bodies are still empty. The
// deterministic cleaning below is unchanged — it already handles both lengths.
// No LLM here — regex only, so nothing leaves the box.

const REPLY_MARKERS = [
  /_{4,}/,                                   // Outlook horizontal rule before quote
  /-{3,}\s*Original Message\s*-{3,}/i,
  /-{3,}\s*Forwarded message\s*-{3,}/i,
  /\bBegin forwarded message\b/i,
  /^\s*From:\s.+$/im,                        // quoted header block
  /^\s*Sent:\s.+$/im,                        // P117: header block whose From: line was an image/link
  /\bOn\b.{0,120}\bwrote:/is,                // "On <date>, <name> wrote:"
  /\bSent from my\b/i,                       // mobile client sig
  /\bGet Outlook for (iOS|Android)\b/i,
];

// P117: the STRUCTURAL quote boundary (see QUOTE_BOUNDARY_TAGS) is ambiguous in a
// way a text marker is not — Outlook emits an EMPTY `<div id="appendonsend">` on a
// freshly composed message, so the boundary can sit at the very top with nothing
// quoted after it. Cutting there would empty the body (measured: 52 of 654). The
// MIN_LEAD guard therefore applies to that injected sentinel ONLY; the ordinary
// text markers keep their original semantics (a real `________ From:` at position
// 0 genuinely means the whole body is quoted, even on a six-character reply).
const MIN_LEAD_CHARS = 12;

/** Earliest marker index, or `text.length` when none matches. */
function earliestCut(text, markers) {
  let cut = text.length;
  for (const re of markers) {
    const m = text.match(re);
    if (m && m.index != null && m.index < cut) cut = m.index;
  }
  return cut;
}

// Signature anchors — the earliest hit cuts the sig + everything after it.
const SIGNATURE_ANCHORS = [
  /\bScott\s+A?\.?\s*Briggs\b/i,             // the name in the sig block
  /\bSenior Vice President\b/i,
  /\bD\s*\(?918\)?\s*[.\s-]?794[.\s-]?9787\b/,   // his direct line
  /\bsabriggs@northmarq\.com\b/i,
  /\bStan Johnson Company is now Northmarq\b/i,
  /\b6120 S\.?\s*Yale\b/i,                   // the office address line
  // P117 (full-body shapes): the direct line also appears dotted / bare, and the
  // team mailbox signs some client mail.
  /\b918[.\s-]?794[.\s-]?9787\b/,
  /\bteambriggs@northmarq\.com\b/i,
  /\bTeam Briggs\b\s*\n/i,
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

// Dependency-free HTML → text. Drops <script>/<style>, turns block/break tags
// into newlines so the reply-chain + signature markers survive on their own
// lines (the cleaner keys on line-anchored markers), strips remaining tags, and
// decodes the handful of entities Outlook emits. On-prem only — no parser dep,
// nothing egresses.
// P117: the mail clients mark the quote boundary STRUCTURALLY, in a tag attribute
// that vanishes the moment tags are stripped — Outlook uses `<div id="appendonsend">`
// / `<div id="divRplyFwdMsg">`, Gmail `class="gmail_quote"`, Apple Mail
// `<blockquote type="cite">`. 83 of the 157 full bodies that had NO text-level
// marker carry one of these. Emitting the same underscore rule Outlook draws in
// plain text lets the existing line-anchored REPLY_MARKERS do the cutting, so the
// boundary logic stays in ONE place.
const QUOTE_BOUNDARY_TAGS =
  /<(?:div|blockquote)\b[^>]*(?:id\s*=\s*["']?(?:appendonsend|divRplyFwdMsg)["']?|class\s*=\s*["'][^"']*gmail_quote|type\s*=\s*["']?cite["']?)[^>]*>/gi;
// A private token (not the plain underscore rule) so an injected boundary stays
// distinguishable from one Outlook actually wrote into the text. Any sentinel that
// does NOT qualify as a cut is deleted, so it can never leak into the corpus.
const QUOTE_SENTINEL = '\n\u0001LCC_QUOTE_BOUNDARY\u0001\n';
const QUOTE_SENTINEL_TOKEN = '\u0001LCC_QUOTE_BOUNDARY\u0001';

const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', middot: '\u00b7', bull: '\u2022',
};

/** Decode the numeric + named entities Outlook/Gmail actually emit. */
export function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const v = NAMED_ENTITIES[String(name).toLowerCase()];
      return v == null ? m : v;
    });
}

function safeFromCodePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  // U+FEFF (zero-width no-break space) is emitted by Outlook as &#65279; and is
  // pure noise in a training corpus.
  if (n === 0xfeff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

export function htmlToText(html) {
  let s = String(html == null ? '' : html);
  if (!s) return '';
  s = s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(QUOTE_BOUNDARY_TAGS, QUOTE_SENTINEL)
    .replace(/<\/?(?:p|div|tr|table|ul|ol|h[1-6]|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<(?:br|hr|li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return normalizeRaw(s);
}

/**
 * Pick the richest available raw body, forward-compatible with the Prompt-110
 * full-body ingestion: full `body_text` → tag-stripped `body_html` → the capped
 * `body_preview`/`body`. Returns '' when nothing is present. This is the single
 * resolver every corpus/harvest consumer calls so the fallback stays identical
 * across surfaces while bodies are still accruing.
 */
export function pickBestBody({ body_text, body_html, body_preview, body } = {}) {
  const text = String(body_text == null ? '' : body_text).trim();
  if (text) return String(body_text);
  const html = String(body_html == null ? '' : body_html).trim();
  if (html) {
    const stripped = htmlToText(body_html).trim();
    if (stripped) return stripped;
  }
  const preview = firstNonBlank(body_preview, body);
  return preview == null ? '' : String(preview);
}

function firstNonBlank(...vals) {
  for (const v of vals) {
    if (v != null && String(v).trim() !== '') return v;
  }
  return null;
}

/**
 * Cut everything from the FIRST reply/forward marker onward — whichever comes
 * first, a text marker (original semantics) or a QUALIFYING structural sentinel
 * (min-lead guarded, see MIN_LEAD_CHARS). A non-qualifying sentinel is deleted
 * rather than honoured, so it never reaches the corpus.
 */
export function stripReplyChain(text) {
  let cut = earliestCut(text, REPLY_MARKERS);
  const si = text.indexOf(QUOTE_SENTINEL_TOKEN);
  if (si >= 0 && si < cut && text.slice(0, si).trim().length >= MIN_LEAD_CHARS) cut = si;
  let out = text.slice(0, cut).split(QUOTE_SENTINEL_TOKEN).join('\n');
  // Also drop a run of leading '>' quote lines if they open the body.
  out = out.replace(/(^|\n)\s*>.*(?=\n|$)/g, '$1');
  return out;
}

/** Cut everything from the FIRST signature anchor onward. */
export function stripSignature(text) {
  return text.slice(0, earliestCut(text, SIGNATURE_ANCHORS));
}

/** Remove a legal/confidentiality disclaimer block (and everything after it). */
export function stripDisclaimer(text) {
  return text.slice(0, earliestCut(text, DISCLAIMER_MARKERS));
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
    .split(QUOTE_SENTINEL_TOKEN).join('\n')
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
  return cleanEmailBodyDetailed(raw).cleaned;
}

/**
 * P117: same clean, but ALSO returns what was trimmed off the tail.
 *
 * `cleanEmailBody` deliberately removes the sign-off ("Best regards,") because a
 * training exemplar should be prose, not a closer — which means a shape read of
 * the CLEANED text can never observe a sign-off, and the sign-off is precisely
 * the attribute Stage 1 could not evidence. The distiller therefore reads
 * `signoff` from here (captured BEFORE the trim) and `cleaned` for the prose.
 *
 * Returns { cleaned, signoff, chars_before_clean, chars_after_clean }.
 */
export function cleanEmailBodyDetailed(raw) {
  const normalized = normalizeRaw(raw);
  let t = normalized;
  t = stripReplyChain(t);
  t = stripDisclaimer(t);
  t = stripSignature(t);
  const withSignoff = tidyWhitespace(t);
  const cleaned = tidyWhitespace(stripTrailingSignoff(t));
  return {
    cleaned,
    signoff: detectSignoff(withSignoff),
    chars_before_clean: normalized.trim().length,
    chars_after_clean: cleaned.length,
  };
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

// ============================================================================
// P117 — CORPUS MEMBERSHIP GUARDS (`from_email` is NOT proof of authorship)
//
// Measured live over the 654 Scott-from rows that carry a full `body_html`:
//   • 118 are addressed ONLY to Scott himself — 74 of them are the app's own
//     "LCC Morning Briefing" / "Weekly Deep Dive" generator output, the rest are
//     self-notes. A voice profile trained on those learns the BRIEFING TEMPLATE.
//   • ~107 open by addressing Scott ("Hi Scott,", "Scott,") — inbound mail filed
//     under his address. Training on those learns SOMEONE ELSE's voice.
// Both are invisible at the 255-char preview length, which is why Stage 1 never
// had to guard for them. `voiceCorpusExclusion` returns a REASON (not a bare
// boolean) so a stats run can report exactly what it dropped and why.
// ============================================================================

// Subjects emitted by our own generators. Extend when a new generator ships.
const MACHINE_SUBJECT = /\b(LCC (?:Morning Briefing|Weekly Deep Dive)|Daily Briefing|Automated (?:report|digest)|Undeliverable|Out of Office)\b/i;

// A cleaned body that OPENS by addressing Scott was written TO him, not BY him.
const ADDRESSED_TO_SCOTT =
  /^\s*(?:(?:hi|hey|hello|good\s+(?:morning|afternoon|evening))[\s,]+)?scott\b\s*[,.!:—–-]/i;

/** True when the recipients are Scott and nobody else (self-note / generator). */
export function isSelfAddressed(toEmails, ccEmails, fromEmail) {
  const from = String(fromEmail || '').toLowerCase().trim();
  if (!from) return false;
  const all = []
    .concat(Array.isArray(toEmails) ? toEmails : (toEmails ? [toEmails] : []))
    .concat(Array.isArray(ccEmails) ? ccEmails : (ccEmails ? [ccEmails] : []))
    .map((e) => String(e || '').toLowerCase().trim())
    .filter(Boolean);
  if (all.length === 0) return false;          // unknown recipients — don't guess
  return all.every((e) => e === from);
}

/**
 * Why this row must NOT enter the voice corpus — or null when it may.
 * Reasons: `machine_generated` | `self_addressed` | `addressed_to_scott` |
 * `boilerplate_or_empty`.
 */
export function voiceCorpusExclusion({ cleaned = '', subject = '', toEmails = [], ccEmails = [], fromEmail = '' } = {}) {
  if (MACHINE_SUBJECT.test(String(subject || ''))) return 'machine_generated';
  if (isSelfAddressed(toEmails, ccEmails, fromEmail)) return 'self_addressed';
  if (ADDRESSED_TO_SCOTT.test(String(cleaned || ''))) return 'addressed_to_scott';
  if (isMostlyBoilerplate(cleaned)) return 'boilerplate_or_empty';
  return null;
}

// ============================================================================
// P117 — SHAPE EXTRACTION (the attributes a 255-char opening could not show)
// ============================================================================

// The ONLY closer form the corpus actually evidences at scale is "Best regards,"
// (53 of 399 usable full bodies; 26% of EXTERNAL mail, 2% of internal). The rest
// are listed so a future occurrence is detected rather than silently missed —
// today they measure ZERO, and the profile says so.
const SIGNOFF_FORMS = [
  'best regards', 'kind regards', 'warm regards', 'regards', 'best',
  'thanks', 'thank you', 'many thanks', 'cheers', 'talk soon', 'sincerely', 'take care', 'v/r',
];
const SIGNOFF_LINE = new RegExp(`^(${SIGNOFF_FORMS.map((f) => f.replace('/', '\\/')).join('|')})\\s*[,.!]?$`, 'i');

/**
 * Split cleaned prose into paragraphs. A blank line is a paragraph break; single
 * newlines inside a paragraph (Outlook wraps each visual line in its own <div>)
 * are joined back into one flowing paragraph so word/sentence counts are honest.
 */
export function splitParagraphs(cleaned) {
  return String(cleaned || '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

/** The trailing sign-off line, verbatim, or null when the body just ends. */
export function detectSignoff(cleaned) {
  const lines = String(cleaned || '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 2; i -= 1) {
    if (SIGNOFF_LINE.test(lines[i])) return lines[i];
  }
  return null;
}

function countSentences(text) {
  const parts = String(text || '').split(/(?<=[.!?])[\s"')\]]+/).map((x) => x.trim()).filter(Boolean);
  return parts.length;
}

/**
 * Deterministic per-email shape. This is what makes the sign-off / paragraph /
 * long-form sections of the profile CORPUS-EVIDENCED with no model in the loop —
 * the same discipline Stage 1 used for its openings.
 */
export function bodyShape(cleaned) {
  const text = String(cleaned || '');
  const paragraphs = splitParagraphs(text);
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = countSentences(text);
  const signoff = detectSignoff(text);
  return {
    chars: text.length,
    words: words.length,
    sentences,
    paragraphs: paragraphs.length,
    words_per_paragraph: paragraphs.length ? Math.round((words.length / paragraphs.length) * 10) / 10 : 0,
    words_per_sentence: sentences ? Math.round((words.length / sentences) * 10) / 10 : 0,
    first_paragraph_words: paragraphs.length ? paragraphs[0].split(/\s+/).filter(Boolean).length : 0,
    signoff,
    has_signoff: signoff != null,
    uses_list: /(^|\n)\s*(?:[0-9]+[.)]|[-*·•])\s+/.test(text),
    exclamations: (text.match(/!/g) || []).length,
    // Long-form == past the old 255-char preview ceiling by a clear margin, i.e.
    // material the Stage-1 corpus structurally could not contain.
    is_long_form: text.length >= 400,
  };
}

// PII / deal-confidential redaction for anything that lands in a COMMITTED doc.
// The distill itself runs on-prem, so the model may see the real text; what gets
// written to disk must not carry a third party's contact details or a live number.
const REDACTORS = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]'],
  [/\b(?:\+?1[.\s-]?)?\(?\d{3}\)?[.\s-]?\d{3}[.\s-]?\d{4}\b/g, '[phone]'],
  [/\bhttps?:\/\/\S+/gi, '[link]'],
  [/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[mMbBkK]|million|billion)?/g, '[amount]'],
  [/\b\d{1,6}\s+[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Pkwy|Parkway|Hwy|Highway)\b\.?/g, '[address]'],
];

/** Redact third-party PII + deal-confidential specifics from an excerpt. */
export function redactExcerpt(text) {
  let out = String(text == null ? '' : text);
  for (const [re, rep] of REDACTORS) out = out.replace(re, rep);
  return out;
}

// The firm's own / teammate email domains. Exported so other modules (e.g. the
// W9.6 comms→owner attribution guard) share ONE own-firm domain allowlist rather
// than re-declaring it. NorthMarq + the legacy Stan Johnson Co domain.
export const INTERNAL_DOMAINS = ['northmarq.com', 'stanjohnsonco.com'];

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

export const _internals = {
  REPLY_MARKERS, SIGNATURE_ANCHORS, DISCLAIMER_MARKERS, INTERNAL_DOMAINS,
  MIN_LEAD_CHARS, QUOTE_BOUNDARY_TAGS, QUOTE_SENTINEL_TOKEN, MACHINE_SUBJECT, ADDRESSED_TO_SCOTT, SIGNOFF_FORMS,
};
